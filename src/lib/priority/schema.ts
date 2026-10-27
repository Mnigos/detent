export type Priority = 'urgent' | 'high' | 'medium' | 'low'

export const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low']

export const PRIORITY_NAMES: Record<Priority, string> = {
	urgent: 'Urgent',
	high: 'High',
	medium: 'Medium',
	low: 'Low',
}

/** Urgent is the short list for a reviewer without time; anything past this reads as High. */
export const URGENT_LIMIT = 10

export interface PriorityEntry {
	path: string
	priority: Priority
	/** One line on what could break; only Urgent and High files carry one. */
	reason?: string
}

export const PRIORITY_SCHEMA = {
	type: 'object',
	required: ['files'],
	additionalProperties: false,
	properties: {
		files: {
			type: 'array',
			items: {
				type: 'object',
				required: ['file', 'priority', 'reason'],
				additionalProperties: false,
				properties: {
					file: { type: 'string' },
					priority: { type: 'string', enum: PRIORITIES },
					reason: { type: 'string' },
				},
			},
		},
	},
}

const REASON_LIMIT = 140

const isPriority = (value: unknown): value is Priority =>
	typeof value === 'string' && (PRIORITIES as string[]).includes(value)

function toEntry(value: unknown): PriorityEntry | undefined {
	const entry = value as { file?: unknown; path?: unknown; priority?: unknown; reason?: unknown }
	if (!entry || typeof entry !== 'object') return undefined

	const path = typeof entry.file === 'string' ? entry.file : entry.path
	const priority = typeof entry.priority === 'string' ? entry.priority.toLowerCase() : undefined
	if (typeof path !== 'string' || !path.trim() || !isPriority(priority)) return undefined

	const reason = typeof entry.reason === 'string' ? entry.reason.trim().slice(0, REASON_LIMIT) : ''

	return {
		path: path.trim(),
		priority,
		...(reason && (priority === 'urgent' || priority === 'high') ? { reason } : {}),
	}
}

/** Valid entries of a model answer or a saved one; the first entry of a path wins. */
export function toPriorityEntries(value: unknown): PriorityEntry[] | undefined {
	if (!Array.isArray(value)) return undefined

	const entries = new Map<string, PriorityEntry>()
	for (const entry of value.map(toEntry))
		if (entry && !entries.has(entry.path)) entries.set(entry.path, entry)

	return entries.size > 0 ? [...entries.values()] : undefined
}

export function parsePriorityResponse(text: string): PriorityEntry[] | undefined {
	try {
		return toPriorityEntries((JSON.parse(text) as { files?: unknown } | null)?.files)
	} catch {
		return undefined
	}
}
