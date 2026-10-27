import { layerId, type Skeleton } from './build-skeleton'
import type { LabeledLayer } from './label-schema'
import { baseName } from './layer-names'
import { placeLeftovers } from './leftovers'
import { ROLE_LAYER_NAMES } from './roles'
import { attachTests, stemOf, testSubjectOf } from './test-subject'

export interface GroupingEntry {
	name: string
	summary: string
	files: string[]
	/** Files of this step that deserve a careful read rather than a glance. */
	focus?: string[]
}

export const GROUPING_SCHEMA = {
	type: 'object',
	required: ['layers'],
	additionalProperties: false,
	properties: {
		layers: {
			type: 'array',
			items: {
				type: 'object',
				required: ['name', 'summary', 'files', 'focus'],
				additionalProperties: false,
				properties: {
					name: { type: 'string' },
					summary: { type: 'string' },
					files: { type: 'array', items: { type: 'string' } },
					focus: { type: 'array', items: { type: 'string' } },
				},
			},
		},
	},
}

const isText = (value: unknown): value is string => typeof value === 'string'

const toEntry = (value: unknown): GroupingEntry | undefined => {
	const entry = value as Partial<GroupingEntry> | null
	if (!entry || !isText(entry.name) || !isText(entry.summary) || !Array.isArray(entry.files))
		return undefined

	return {
		name: entry.name,
		summary: entry.summary,
		files: entry.files.filter(isText),
		...(Array.isArray(entry.focus) ? { focus: entry.focus.filter(isText) } : {}),
	}
}

export function toGroupingEntries(value: unknown): GroupingEntry[] | undefined {
	if (!Array.isArray(value)) return undefined

	const entries = value.map(toEntry).filter((entry) => entry !== undefined)

	return entries.length > 0 ? entries : undefined
}

export function parseGroupingResponse(text: string): GroupingEntry[] | undefined {
	try {
		return toGroupingEntries((JSON.parse(text) as { layers?: unknown } | null)?.layers)
	} catch {
		return undefined
	}
}

export function applyGrouping(
	skeleton: Skeleton,
	entries: GroupingEntry[],
): LabeledLayer[] | undefined {
	const roles = new Map(
		skeleton.layers.flatMap((layer) => layer.files.map((file) => [file.path, file.role] as const)),
	)
	const generated = [...roles].filter(([, role]) => role === 'generated').map(([path]) => path)
	const placed = new Set(generated)
	const groups = entries
		.map((entry) => {
			const files: string[] = []
			for (const path of entry.files) {
				if (!roles.has(path) || placed.has(path)) continue

				placed.add(path)
				files.push(path)
			}

			return { name: entry.name.trim(), summary: entry.summary.trim(), files, focus: entry.focus }
		})
		.filter((group) => group.files.length > 0)
	if (groups.length === 0) return undefined

	// A test belongs right after the file it tests, whether the model forgot it or put it elsewhere.
	const stems = new Map(
		groups.flatMap((group) =>
			group.files.flatMap((path) =>
				testSubjectOf(path) === undefined ? [[stemOf(path), group] as const] : [],
			),
		),
	)
	for (const path of roles.keys()) {
		const subject = testSubjectOf(path)
		const group = subject === undefined ? undefined : stems.get(subject)
		if (!group || group.files.includes(path)) continue

		for (const other of groups) other.files = other.files.filter((file) => file !== path)
		placed.add(path)
		group.files.splice(group.files.findIndex((file) => stemOf(file) === subject) + 1, 0, path)
	}
	// Whatever the model left out lands next to its neighbours rather than in a leftover bucket.
	const complete = placeLeftovers(
		groups,
		[...roles.keys()].filter((path) => roles.get(path) !== 'generated'),
	)

	const toLayer = (
		files: string[],
		name: string,
		summary: string,
		isTrailing: boolean,
		focus: ReadonlySet<string> = new Set(),
	): LabeledLayer => ({
		id: layerId(files),
		name,
		summary,
		files: files.map((path) => ({
			path,
			role: roles.get(path) ?? 'other',
			...(focus.has(path) ? { isFocus: true } : {}),
		})),
		source: isTrailing ? 'fallback' : 'model',
		isTrailing,
	})

	return [
		...complete
			.filter((group) => group.files.length > 0)
			.map((group) =>
				toLayer(
					attachTests(group.files),
					group.name || baseName(group.files),
					group.summary,
					false,
					new Set(group.focus),
				),
			),
		...(generated.length > 0 ? [toLayer(generated, ROLE_LAYER_NAMES.generated, '', true)] : []),
	]
}
