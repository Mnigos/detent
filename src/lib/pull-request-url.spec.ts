import { describe, expect, it } from 'vitest'
import { parsePullRequestUrl } from './pull-request-url'

describe('parsePullRequestUrl', () => {
	it.each([
		['https://github.com/owner/repo/pull/123', 'conversation'],
		['https://github.com/owner/repo/pull/123/', 'conversation'],
		['https://github.com/owner/repo/pull/123?w=1', 'conversation'],
		['https://github.com/owner/repo/pull/123#issuecomment-1', 'conversation'],
		['https://github.com/owner/repo/pull/123/files', 'files'],
		['https://github.com/owner/repo/pull/123/files/', 'files'],
		['https://github.com/owner/repo/pull/123/files/abc123def', 'files'],
		['https://github.com/owner/repo/pull/123/files?diff=split#diff-1', 'files'],
		['https://github.com/owner/repo/pull/123/changes', 'changes'],
		['https://github.com/owner/repo/pull/123/changes/abc123def', 'changes'],
		['https://github.com/owner/repo/pull/123/commits', 'commits'],
		['https://github.com/owner/repo/pull/123/commits/abc123', 'commits'],
		['https://github.com/owner/repo/pull/123/checks', 'checks'],
	])('parses %s as the %s tab', (url, tab) => {
		expect(parsePullRequestUrl(url)).toEqual({ owner: 'owner', repo: 'repo', number: 123, tab })
	})

	it('keeps owner and repo names containing dots and dashes', () => {
		expect(parsePullRequestUrl('https://github.com/TanStack/router.js/pull/8170/files')).toEqual({
			owner: 'TanStack',
			repo: 'router.js',
			number: 8170,
			tab: 'files',
		})
	})

	it.each([
		'https://github.com/owner/repo',
		'https://github.com/owner/repo/pulls',
		'https://github.com/owner/repo/pull/abc',
		'https://github.com/owner/repo/issues/123',
		'https://github.com/owner/repo/pull/123/conflicts',
		'https://gitlab.com/owner/repo/pull/123',
		'https://github.example.com/owner/repo/pull/123',
		'not a url',
	])('returns undefined for %s', (url) => {
		expect(parsePullRequestUrl(url)).toBeUndefined()
	})
})
