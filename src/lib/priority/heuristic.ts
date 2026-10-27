import type { DiffFile } from '../diff/parse-diff'
import { type FileRole, ROLE_RANK } from '../layers/roles'
import type { Priority, PriorityEntry } from './schema'

export interface PriorityFile {
	path: string
	role: FileRole
	status: DiffFile['status']
	additions: number
	deletions: number
}

// Paths where a bug costs money, data or access: auth, secrets, billing, payments.
const RISKY_PATH =
	/auth|session|permission|polic(?:y|ies)|rbac|acl|secur|crypt|secret|password|credential|oauth|jwt|csrf|token|billing|payment|invoice|subscription|checkout|stripe|pricing|refund|wallet|ledger|webhook/i
const FIXTURE_PATH =
	/(^|\/)(__fixtures__|fixtures?|__mocks__|mocks?|__snapshots__|testdata)\/|\.stories\.|\.snap$/
const SKIMMED_ROLES: FileRole[] = ['test', 'docs', 'generated']
const CODE_ROLES: FileRole[] = ['server', 'contract', 'ui', 'other', 'migration']
// A removal this size in code, deleted file or not, is a behavior change rather than a cleanup.
const RISKY_DELETION = 20
const LARGE_CHANGE = 40
const TINY_CHANGE = 2
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

interface Ranked extends PriorityEntry {
	isRisky: boolean
	size: number
	role: FileRole
}

function rank(file: PriorityFile): Ranked {
	const size = file.additions + file.deletions
	const isRisky = CODE_ROLES.includes(file.role) && RISKY_PATH.test(file.path)
	const base = { path: file.path, isRisky, size, role: file.role }
	const entry = (priority: Priority, reason?: string): Ranked => ({
		...base,
		priority,
		...(reason ? { reason } : {}),
	})

	if (SKIMMED_ROLES.includes(file.role) || FIXTURE_PATH.test(file.path)) return entry('low')
	if (file.status === 'renamed' && size === 0) return entry('low')
	// Risky paths come before the tiny-change rule: a one-line billing or auth change can be critical.
	if (file.role === 'migration')
		return entry('urgent', 'Database migration: data changes are hard to undo.')
	if (isRisky)
		return file.role === 'ui'
			? entry('high', 'Touches auth, security or billing screens.')
			: entry('urgent', 'Touches auth, security or billing logic.')
	if (CODE_ROLES.includes(file.role) && file.deletions >= RISKY_DELETION)
		return entry(
			'high',
			file.status === 'deleted'
				? `Deletes ${file.deletions} lines of code.`
				: `Removes ${file.deletions} lines of code.`,
		)
	if (file.role === 'contract') return entry('high', 'Changes a shared contract or data shape.')
	if (size <= TINY_CHANGE) return entry('low')
	if (file.role === 'server')
		return size >= LARGE_CHANGE ? entry('high', 'Large change to server logic.') : entry('medium')

	return entry('medium')
}

/**
 * Priorities from the path, role and size of each file, for when no model answers: migrations and
 * auth or billing code first, tests, docs, fixtures and generated files last. Within a priority,
 * the role's reading rank leads (migrations, contracts, server), then risky paths, then the bigger
 * change, so the Urgent cap never pushes a migration out behind a run of billing files.
 */
export function heuristicPriorities(files: readonly PriorityFile[]): PriorityEntry[] {
	return files
		.map(rank)
		.sort(
			(left, right) =>
				PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
				ROLE_RANK[left.role] - ROLE_RANK[right.role] ||
				Number(right.isRisky) - Number(left.isRisky) ||
				right.size - left.size ||
				left.path.localeCompare(right.path),
		)
		.map(({ path, priority, reason }) => ({ path, priority, ...(reason ? { reason } : {}) }))
}
