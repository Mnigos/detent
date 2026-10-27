import type { Skeleton } from './build-skeleton'
import { type FileRole, ROLE_RANK } from './roles'

export interface LabelMove {
	path: string
	toLayerId: string
}

export interface LabelEntry {
	id: string
	name: string
	summary: string
	moveFiles?: LabelMove[]
	mergeIds?: string[]
}

export interface LabeledLayer {
	id: string
	name: string
	summary: string
	files: { path: string; role: FileRole; isFocus?: boolean }[]
	source: 'model' | 'fallback'
	isTrailing: boolean
}

export const LABEL_SCHEMA = {
	type: 'object',
	required: ['layers'],
	properties: {
		layers: {
			type: 'array',
			items: {
				type: 'object',
				required: ['id', 'name', 'summary'],
				properties: {
					id: { type: 'string' },
					name: { type: 'string', maxLength: 48 },
					summary: { type: 'string', maxLength: 160 },
					moveFiles: {
						type: 'array',
						items: {
							type: 'object',
							required: ['path', 'toLayerId'],
							properties: { path: { type: 'string' }, toLayerId: { type: 'string' } },
						},
					},
					mergeIds: { type: 'array', items: { type: 'string' } },
				},
			},
		},
	},
}

const isText = (value: unknown): value is string => typeof value === 'string'

const toMove = (value: unknown): LabelMove | undefined => {
	const move = value as Partial<LabelMove> | null
	if (!move || !isText(move.path) || !isText(move.toLayerId)) return undefined

	return { path: move.path, toLayerId: move.toLayerId }
}

const toEntry = (value: unknown): LabelEntry | undefined => {
	const entry = value as Partial<LabelEntry> | null
	if (!entry || !isText(entry.id) || !isText(entry.name) || !isText(entry.summary)) return undefined

	const moveFiles = (Array.isArray(entry.moveFiles) ? entry.moveFiles : [])
		.map(toMove)
		.filter((move) => move !== undefined)
	const mergeIds = (Array.isArray(entry.mergeIds) ? entry.mergeIds : []).filter(isText)

	return { id: entry.id, name: entry.name, summary: entry.summary, moveFiles, mergeIds }
}

export function toLabelEntries(value: unknown): LabelEntry[] | undefined {
	if (!Array.isArray(value)) return undefined

	const entries = value.map(toEntry).filter((entry) => entry !== undefined)

	return entries.length > 0 ? entries : undefined
}

export function parseLabelResponse(text: string): LabelEntry[] | undefined {
	try {
		return toLabelEntries((JSON.parse(text) as { layers?: unknown } | null)?.layers)
	} catch {
		return undefined
	}
}

export function applyLabels(skeleton: Skeleton, entries: LabelEntry[]): LabeledLayer[] {
	const known = new Map(skeleton.layers.map((layer) => [layer.id, layer]))
	const owners = new Map(
		skeleton.layers.flatMap((layer) => layer.files.map((file) => [file.path, layer.id] as const)),
	)
	const counts = new Map(skeleton.layers.map((layer) => [layer.id, layer.files.length]))
	const labels = new Map(entries.filter((entry) => known.has(entry.id)).map((e) => [e.id, e]))
	const consumed = new Set<string>()

	// The trailing group is a structural decision, so the model can neither absorb it nor dissolve it.
	for (const entry of labels.values())
		for (const id of entry.mergeIds ?? []) {
			const source = known.get(id)
			if (!source || source.isTrailing || known.get(entry.id)?.isTrailing) continue
			if (id === entry.id || consumed.has(id) || consumed.has(entry.id)) continue

			consumed.add(id)
			for (const file of source.files) owners.set(file.path, entry.id)
			counts.set(entry.id, (counts.get(entry.id) ?? 0) + source.files.length)
		}

	for (const entry of labels.values())
		for (const { path, toLayerId } of entry.moveFiles ?? []) {
			const from = owners.get(path)
			if (from === undefined || from === toLayerId || !known.has(toLayerId)) continue
			if (consumed.has(toLayerId) || (counts.get(from) ?? 0) <= 1) continue

			counts.set(from, (counts.get(from) ?? 1) - 1)
			counts.set(toLayerId, (counts.get(toLayerId) ?? 0) + 1)
			owners.set(path, toLayerId)
		}

	return skeleton.layers
		.filter((layer) => !consumed.has(layer.id))
		.map((layer) => {
			const label = labels.get(layer.id)

			return {
				id: layer.id,
				name: label?.name.trim() || layer.fallbackName,
				summary: label?.summary.trim() ?? '',
				files: skeleton.layers
					.flatMap((source) => source.files.filter((file) => owners.get(file.path) === layer.id))
					.sort(
						(left, right) =>
							ROLE_RANK[left.role] - ROLE_RANK[right.role] || left.path.localeCompare(right.path),
					),
				source: label ? 'model' : 'fallback',
				isTrailing: layer.isTrailing,
			}
		})
}
