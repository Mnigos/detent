export interface PullRequestLocation {
	owner: string
	repo: string
	number: number
	tab: 'conversation' | 'commits' | 'checks' | 'files' | 'changes'
}

// GitHub's newer pull request pages serve "Files changed" at /changes; the classic ones at /files.
const PULL_REQUEST_PATH =
	/^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/(commits|checks|files|changes)(?:\/.*)?|\/?)$/

export function parsePullRequestUrl(url: string): PullRequestLocation | undefined {
	let pathname: string
	try {
		const parsed = new URL(url)
		if (parsed.hostname !== 'github.com') return undefined
		pathname = parsed.pathname
	} catch {
		return undefined
	}

	const match = PULL_REQUEST_PATH.exec(pathname)
	if (!match) return undefined

	const [, owner, repo, number] = match
	if (!owner || !repo || !number) return undefined
	return {
		owner,
		repo,
		number: Number(number),
		tab: (match[4] ?? 'conversation') as PullRequestLocation['tab'],
	}
}
