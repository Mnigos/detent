import { browser } from 'wxt/browser'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { digestText } from '../diff/digest'
import { requestPullRequestDiff } from '../diff/fetch-diff'
import { parseUnifiedDiff } from '../diff/parse-diff'
import { buildSkeleton } from '../layers/build-skeleton'
import { condenseForGrouping, diffExcerpts } from '../layers/condense'
import { buildCochangeEdges, buildEdges, buildMethodEdges } from '../layers/graph'
import { applyGrouping } from '../layers/grouping'
import { applyLabels, type LabeledLayer } from '../layers/label-schema'
import { orderReviewLayers } from '../layers/reading-order'
import { requestLayerLabels } from '../model/label-layers'
import { createPriorityRequest, planPriorities } from '../priority/ranking'
import { COLLAPSED_PRIORITY_SECTIONS } from '../priority/sections'
import { PRIORITY_LINES } from '../priority/status'
import type { PullRequestLocation } from '../pull-request-url'
import { anchorIdForPath, fetchPullRequestBody, readPullRequestSummary } from './github-dom'
import { STATUS_LINES, statusLineFor } from './status'
import {
	createPanelStore,
	currentFile,
	type PanelLayer,
	type PanelPosition,
	type PanelStore,
} from './store'

export interface ReviewSession {
	store: PanelStore
	anchorIds: ReadonlyMap<string, string>
	stop: () => void
	/** Asks the model for priorities once; absent where Priority Review is not offered. */
	requestPriorities?: () => void
}

export interface ReviewSessionOptions {
	withPriorities?: boolean
}

interface SavedPosition extends PanelPosition {
	path?: string
}

async function readPosition(key: string) {
	try {
		const stored = await browser.storage.session.get(key)

		return stored[key] as Partial<SavedPosition> | undefined
	} catch {
		return undefined
	}
}

export async function createReviewSession(
	ctx: ContentScriptContext,
	location: PullRequestLocation,
	readViewed: (anchorIds: ReadonlyMap<string, string>) => ReadonlySet<string>,
	{ withPriorities = false }: ReviewSessionOptions = {},
): Promise<ReviewSession> {
	const text = await requestPullRequestDiff(location)
	const files = parseUnifiedDiff(text)
	const sizes = new Map(files.map((file) => [file.path, file]))
	const skeleton = buildSkeleton(files, buildEdges(files), buildCochangeEdges(files))
	const dependencies = [...skeleton.edges, ...buildMethodEdges(files)]
	const toPanelLayers = (labeled: LabeledLayer[]): PanelLayer[] =>
		orderReviewLayers(labeled, dependencies).map((layer) => ({
			id: layer.id,
			name: layer.name,
			summary: layer.summary,
			isTrailing: layer.isTrailing,
			files: layer.files.map(({ path, role, isFocus }) => ({
				path,
				role,
				additions: sizes.get(path)?.additions ?? 0,
				deletions: sizes.get(path)?.deletions ?? 0,
				...(isFocus ? { isFocus } : {}),
			})),
		}))
	const digest = await digestText(text)
	const scope = `${location.owner}/${location.repo}/${location.number}`.toLowerCase()
	const key = `panel:${scope}`
	const anchorIds = new Map(
		await Promise.all(files.map(async ({ path }) => [path, await anchorIdForPath(path)] as const)),
	)
	const summary = readPullRequestSummary()
	if (!summary.body)
		summary.body = await fetchPullRequestBody(
			`https://github.com/${location.owner}/${location.repo}/pull/${location.number}`,
		)
	const request = {
		skeleton,
		scope,
		digest,
		maxLayers: skeleton.maxLayers,
		files: await Promise.all(
			files
				.filter((file) =>
					skeleton.layers.some((layer) =>
						layer.files.some((entry) => entry.path === file.path && entry.role !== 'generated'),
					),
				)
				.map(async (file) => ({
					path: file.path,
					digest: await digestText(
						JSON.stringify({
							status: file.status,
							oldPath: file.oldPath,
							hunks: file.hunks.map((hunk) => ({
								added: hunk.addedLines,
								removed: hunk.removedLines,
							})),
						}),
					),
				})),
		),
		groupingInput: condenseForGrouping(skeleton, files, summary),
	}
	// The cache probe needs only the identity; the model inputs travel once, with the analysis request.
	const cached = await requestLayerLabels({ ...request, cacheOnly: true }).catch(() => undefined)
	const analysisRequest = {
		...request,
		diffExcerpts: Object.fromEntries(diffExcerpts(files, skeleton)),
	}
	const labeled = cached?.grouping
		? applyGrouping(skeleton, cached.grouping)
		: cached
			? applyLabels(skeleton, cached.layers)
			: undefined
	const layers = toPanelLayers(labeled ?? applyLabels(skeleton, []))
	const priorities = withPriorities ? planPriorities(files, layers, summary) : undefined
	const position = (await readPosition(key)) ?? (await readPosition(`panel:${digest}`))
	const shown = position?.isPriority && priorities ? priorities.sections : layers
	const layerIndex = shown.findIndex((layer) =>
		layer.files.some((file) => file.path === position?.path),
	)
	const savedPosition =
		layerIndex >= 0
			? {
					...position,
					layerIndex,
					fileIndex:
						shown[layerIndex]?.files.findIndex((file) => file.path === position?.path) ?? 0,
				}
			: position
	const store = createPanelStore(layers, {
		position: savedPosition,
		viewed: readViewed(anchorIds),
		status: cached ? statusLineFor(cached) : STATUS_LINES.fallback,
		...(priorities
			? {
					priorityLayers: priorities.sections,
					priorityStatus: PRIORITY_LINES.fallback,
					collapsedSections: COLLAPSED_PRIORITY_SECTIONS,
				}
			: {}),
		savePosition: (position) => {
			void browser.storage.session
				.set({ [key]: { ...position, path: currentFile(store.getSnapshot())?.path } })
				.catch(() => undefined)
		},
	})

	let stopped = false

	async function requestLabels() {
		// Saved groups keep their own line; only a first analysis has nothing else to say.
		store.dispatch({
			type: 'analyzing',
			status: cached ? store.getSnapshot().status : STATUS_LINES.analyzing,
		})
		const response = await requestLayerLabels(analysisRequest).catch(() => undefined)
		if (stopped || !ctx.isValid) return
		// No reply at all means the worker went away mid-request; say so instead of spinning forever.
		if (!response) {
			const { groupLayers } = store.getSnapshot()
			store.dispatch({ type: 'labels', layers: groupLayers, status: STATUS_LINES.interrupted })
			return
		}

		// A model answer that names nothing the diff contains labels nothing, whatever the worker claims.
		const labeled = response.grouping
			? (applyGrouping(skeleton, response.grouping) ?? applyLabels(skeleton, []))
			: applyLabels(skeleton, response.layers)
		const source = labeled.some((layer) => layer.source === 'model') ? 'model' : 'fallback'
		store.dispatch({
			type: 'labels',
			layers: toPanelLayers(labeled),
			status: statusLineFor({ ...response, source }),
		})
	}

	if (!cached || cached.isStale) void requestLabels()

	return {
		store,
		anchorIds,
		stop() {
			stopped = true
		},
		...(priorities
			? {
					requestPriorities: createPriorityRequest({
						plan: priorities,
						store,
						scope,
						digest,
						diffExcerpts: analysisRequest.diffExcerpts,
						isActive: () => !stopped && ctx.isValid,
					}),
				}
			: {}),
	}
}
