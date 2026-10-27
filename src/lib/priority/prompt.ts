import { cleanBody, type PullRequestSummary, RICH_BODY_LIMIT } from '../layers/condense'
import type { PriorityFile } from './heuristic'
import { URGENT_LIMIT } from './schema'

export const priorityInstruction = () =>
	`Rank every changed file of this pull request for a reviewer who has no time for a full review and reads only the most important files. urgent: at most ${URGENT_LIMIT} files, ideally fewer, where a bug would hurt most: security, authentication and authorization, data and migrations, money and billing, public API or contract changes, concurrency, core business logic, risky deletions. Keep urgent small; when in doubt choose high. high: other new or changed logic that deserves a careful read. medium: supporting changes a glance settles, such as call-site updates, wiring, styling and configuration. low: tests, docs, lockfiles, generated files, snapshots, fixtures, pure formatting and renames. List every file exactly once, most important first. For urgent and high files, reason is one line of at most 12 words saying what could break; for medium and low files it is an empty string. A file's @number identifies it; in the answer, name files by their @number only (for example "@12"), never by path. Read the diff after the list to judge each file.`

/**
 * The ranking prompt: the pull request's title and description, the instruction, then one line per
 * file with its role, status, size and @number. Generated files are left out; they always rank Low.
 */
export function condenseForPriorities(
	files: readonly PriorityFile[],
	pullRequest: PullRequestSummary,
): string {
	const ranked = files
		.filter((file) => file.role !== 'generated')
		.sort((left, right) => left.path.localeCompare(right.path))
	const title = `Pull request: ${pullRequest.title.trim() || '(untitled)'}`
	const body = cleanBody(pullRequest.body, RICH_BODY_LIMIT)
	const lines = ranked.map(
		({ path, role, status, additions, deletions }, index) =>
			`- ${path} [${role}] ${status} +${additions}/-${deletions} @${index + 1}`,
	)

	return [body ? `${title}\n${body}` : title, priorityInstruction(), lines.join('\n')].join('\n\n')
}
