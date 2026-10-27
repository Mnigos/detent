import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../test/load-fixture'
import { parseUnifiedDiff } from '../diff/parse-diff'
import { buildSkeleton } from './build-skeleton'
import {
	cleanBody,
	condenseForGrouping,
	diffExcerpts,
	EXCERPT_BUDGET,
	groupingInstruction,
	RICH_BUDGET,
	reviewGuidance,
} from './condense'
import { buildCochangeEdges, buildEdges } from './graph'

// Three public pull requests in one diff: 67 files across two repositories, two of them generated.
const SWEEP = ['tessera-165', 'tessera-166', 'tanstack-router-8170']

const prepare = (fixture: string | string[]) => {
	const files = parseUnifiedDiff([fixture].flat().map(loadFixture).join(''))
	const skeleton = buildSkeleton(files, buildEdges(files), buildCochangeEdges(files))

	return { files, skeleton }
}

const grouping = (fixture: string | string[], title = 'T', body = '', options = {}) => {
	const { files, skeleton } = prepare(fixture)

	return { files, skeleton, text: condenseForGrouping(skeleton, files, { title, body }, options) }
}

const fileLines = (text: string) => text.split('\n').filter((line) => line.startsWith('- '))

describe('condenseForGrouping', () => {
	it('includes inferred dependency directions even without a changed import', () => {
		const { text } = grouping('provider-lock', 'Add locking')

		expect(text).toContain('src/entitlement.repository.ts [server] +7/-0 @1')
		expect(text).toContain('src/renew.handler.ts [other] +2/-1 @2 needs @1')
		expect(text).toContain('read @n before that file')
	})

	it('states the grouping instruction with the budget right after the title', () => {
		const { skeleton, text } = grouping('tessera-165')
		const [title, instruction] = text.split('\n\n')

		expect(title).toBe('Pull request: T')
		expect(skeleton.maxLayers).toBe(5)
		expect(instruction).toContain(groupingInstruction(5))
		expect(instruction).toContain('Return between 1 and 5 steps, one per independent behavior.')
		expect(instruction).toContain('directories, packages and file kinds are never steps')
		expect(instruction).toContain('new helpers before their callers')
	})

	it('lists every reviewable file with its role and counts, without skeleton headings', () => {
		const { files, text } = grouping('tanstack-router-8170')

		expect(text.length).toBeLessThanOrEqual(RICH_BUDGET)
		expect(text).not.toContain('## ')
		expect(text).not.toContain('pnpm-lock.yaml')
		expect(text).not.toContain('routeTree.gen.ts')
		for (const file of files.filter((entry) => !/pnpm-lock|\.gen\./.test(entry.path)))
			expect(text).toMatch(
				new RegExp(`^- ${file.path.replaceAll('.', '\\.')} \\[\\w+\\] \\+\\d+/-\\d+`, 'm'),
			)
	})

	it('keeps a signal on every reviewable file of a 67-file sweep within the budget', () => {
		const { text } = grouping(SWEEP)
		const lines = fileLines(text)

		expect(text.length).toBeLessThanOrEqual(RICH_BUDGET)
		expect(lines).toHaveLength(65)
		expect(lines.filter((line) => line.includes(' :: '))).toHaveLength(65)
	})

	it('reads the behavior out of shared identifiers and hunk contexts, not only exports', () => {
		const { text } = grouping(SWEEP, 'Sweep', '', { budget: RICH_BUDGET })
		const line = (path: string) => fileLines(text).find((entry) => entry.startsWith(`- ${path} `))

		expect(
			line('apps/api/src/modules/repositories/infrastructure/repositories.repository.ts'),
		).toContain('linkGitHubInstallationByOwner')
		expect(
			line('apps/web/src/modules/github-import/components/github-import-source-selector.tsx'),
		).toContain('hasLoadMoreError')
		expect(
			line('apps/api/src/modules/github-import/presentation/github-import.controller.ts'),
		).toContain('GitHubImportController')
		expect(line('benchmarks/ssr/scenarios/server-fn-transport/bench.ts')).toContain('commonHeaders')
	})

	it('spends fewer signals per file when the budget tightens, never none', () => {
		const count = (text: string) =>
			fileLines(text).reduce(
				(sum, line) => sum + (line.split(' :: ')[1]?.split(' | ').length ?? 0),
				0,
			)
		const rich = grouping(SWEEP, 'Sweep', '', { budget: RICH_BUDGET }).text
		const tight = grouping(SWEEP, 'Sweep', '', { budget: 10_000 }).text

		expect(rich.length).toBeLessThanOrEqual(RICH_BUDGET)
		expect(tight.length).toBeLessThanOrEqual(10_000)
		expect(count(tight)).toBeLessThan(count(rich))
		expect(count(tight)).toBeGreaterThanOrEqual(fileLines(tight).length)
	})

	it('keeps a long body by default and clips it to the given limit', () => {
		const body = `${'y'.repeat(1500)}\n\nSummary by CodeRabbit\n- New Features`
		const rich = grouping('tessera-166', 'Add the import contract', body).text
		const nano = grouping('tessera-166', 'Add the import contract', body, {
			bodyLimit: 600,
		}).text

		expect(rich.startsWith('Pull request: Add the import contract\n')).toBe(true)
		expect(rich).toContain('y'.repeat(1500))
		expect(rich).not.toContain('CodeRabbit')
		expect(nano).toContain('y'.repeat(600))
		expect(nano).not.toContain('y'.repeat(601))
	})

	it('drops the body, then the signals, and never a file when the budget is too small', () => {
		const { text, files } = grouping(SWEEP, 'Sweep', 'body text', { budget: 100 })

		expect(text).not.toContain('body text')
		for (const line of fileLines(text)) expect(line).not.toContain(' :: ')
		expect(fileLines(text)).toHaveLength(files.length - 2)
	})
})

describe('reviewGuidance', () => {
	it('lifts a "how to review" section out of the description and stops at the next heading', () => {
		const body = [
			'## Summary',
			'Adds billing periods.',
			'',
			'## How to review',
			'1. Start with the schema in `billing.schema.ts`.',
			'2. Then the scheduler, the processor is a straight port.',
			'',
			'## Checklist',
			'- [x] tests',
		].join('\n')
		expect(reviewGuidance(body)).toBe(
			'## How to review\n1. Start with the schema in `billing.schema.ts`.\n2. Then the scheduler, the processor is a straight port.',
		)
	})

	it('takes the paragraph of a bare cue sentence and answers nothing without a cue', () => {
		expect(
			reviewGuidance(
				'Some context.\n\nStart with the migration, then the handler.\nSkip the lock.\n\nThanks!',
			),
		).toBe('Start with the migration, then the handler.\nSkip the lock.')
		expect(reviewGuidance('Adds a thing.\n\nNo hints here.')).toBe('')
	})

	it('puts the guidance into the prompt with the instruction to follow it', () => {
		const { text } = grouping(
			'tessera-166',
			'Add the import contract',
			'Intro.\n\n## Reviewer notes\nRead the contract first, the service is mechanical.',
		)
		expect(text).toContain(
			'Review guidance from the author, follow it for the steps and their order:\n## Reviewer notes\nRead the contract first, the service is mechanical.',
		)
		expect(text).toContain("the author's review guidance names steps or an order")
	})
})

describe('cleanBody', () => {
	it('cuts bot summaries and collapses blank runs before clipping', () => {
		expect(cleanBody('What changes  \n\n\n\nA fix.\n\nReviewed by Cursor Bugbot for x', 40)).toBe(
			'What changes\n\nA fix.',
		)
	})
})

describe('diffExcerpts', () => {
	it('renders every reviewable file with its hunks and context lines', () => {
		const { files, skeleton } = prepare(SWEEP)
		const excerpts = diffExcerpts(files, skeleton)
		const controller = 'apps/api/src/modules/github-import/presentation/github-import.controller.ts'
		const excerpt = excerpts.get(controller)

		expect(excerpts.size).toBe(65)
		expect(excerpts.has('pnpm-lock.yaml')).toBe(false)
		expect(excerpt).toContain(`### ${controller}`)
		expect(excerpt).toContain('+\t\t\t({ input }) =>')
		expect(excerpt).toContain('-\t\t\tasync () => ({')
		expect(excerpt).toMatch(/^@@ export class GitHubImportController \{/m)
		expect([...excerpts.values()].join('\n\n').length).toBeLessThanOrEqual(EXCERPT_BUDGET)
	})

	it('shares a small budget fairly so large files cannot crowd out small ones', () => {
		const { files, skeleton } = prepare(SWEEP)
		const excerpts = diffExcerpts(files, skeleton, 20_000)
		const lengths = [...excerpts.values()].map((block) => block.length)

		expect(excerpts.size).toBe(65)
		expect(lengths.reduce((sum, length) => sum + length, 0)).toBeLessThanOrEqual(20_000)
		expect(Math.max(...lengths)).toBeLessThan(1_000)
		expect(
			excerpts.get(
				'apps/api/src/modules/github-import/infrastructure/github-octokit.client.spec.ts',
			),
		).toContain('more lines not shown')
	})

	it('never exceeds a tiny budget and skips files it cannot show at all', () => {
		const { files, skeleton } = prepare(SWEEP)
		for (const budget of [0, 800, 4_000]) {
			const blocks = [...diffExcerpts(files, skeleton, budget).values()]

			expect(blocks.join('\n\n').length).toBeLessThanOrEqual(budget)
		}
	})
})
