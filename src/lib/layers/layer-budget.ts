import type { Edge } from './graph'

export interface Draft {
	core: string[]
	attached: string[]
	rank: number
	name?: string
}

export const directoryOf = (path: string) => path.split('/').slice(0, -1)

export const sharedPrefixLength = (left: string[], right: string[]) => {
	let shared = 0
	while (shared < left.length && shared < right.length && left[shared] === right[shared])
		shared += 1

	return shared
}

export const commonDirectory = (paths: string[]) =>
	paths
		.map(directoryOf)
		.reduce(
			(left, right) => left.slice(0, sharedPrefixLength(left, right)),
			directoryOf(paths[0] ?? ''),
		)

/** A step past this many files is no longer one reviewable behavior. */
export const STEP_SIZE_LIMIT = 25
const MAX_LAYERS = 30

// An upper bound for the model, not a target: a sweep of ten fixes needs ten steps, and a
// 400-file pull request needs room for steps of a reviewable size.
export const layerBudget = (reviewableFiles: number) =>
	reviewableFiles <= 12
		? 3
		: reviewableFiles <= 30
			? 5
			: reviewableFiles <= 60
				? 7
				: Math.max(10, Math.min(MAX_LAYERS, Math.ceil(reviewableFiles / 15)))

export function mergeToBudget(ordered: Draft[], edges: Edge[], budget: number): Draft[] {
	const drafts = [...ordered]
	while (drafts.length > budget) {
		const smallest = drafts.reduce((best, draft) =>
			draft.core.length < best.core.length ? draft : best,
		)
		const inSmallest = new Set(smallest.core)
		const scored = drafts
			.filter((draft) => draft !== smallest)
			.map((draft) => {
				const inDraft = new Set(draft.core)

				return {
					draft,
					edges: edges.filter(
						({ from, to }) =>
							(inSmallest.has(from) && inDraft.has(to)) ||
							(inDraft.has(from) && inSmallest.has(to)),
					).length,
					shared: sharedPrefixLength(commonDirectory(smallest.core), commonDirectory(draft.core)),
				}
			})
		const linked = scored.filter((entry) => entry.edges > 0)
		// Ties fall to the earlier layer because the reductions only replace on a strictly better score.
		const target =
			linked.length > 0
				? linked.reduce((best, entry) =>
						entry.edges > best.edges || (entry.edges === best.edges && entry.shared > best.shared)
							? entry
							: best,
					)
				: scored.some((entry) => entry.shared > 0)
					? scored.reduce((best, entry) => (entry.shared > best.shared ? entry : best))
					: scored.reduce((best, entry) =>
							entry.draft.core.length < best.draft.core.length ? entry : best,
						)
		const [first, second] = [smallest, target.draft].sort(
			(left, right) => drafts.indexOf(left) - drafts.indexOf(right),
		) as [Draft, Draft]
		drafts[drafts.indexOf(first)] = { ...first, core: [...first.core, ...second.core].sort() }
		drafts.splice(drafts.indexOf(second), 1)
	}

	return drafts
}
