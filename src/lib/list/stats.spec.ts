import { describe, expect, it } from 'vitest'
import { codeTooltip, diffStats, formatCount, formatFiles, hasExcludedLines } from './stats'

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,3 @@
 keep
-old
+new
+more
diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1 +0,0 @@
-gone
`

describe('diffStats', () => {
	it('sums additions and deletions and counts files', () => {
		expect(diffStats(DIFF)).toMatchObject({ additions: 2, deletions: 2, files: 2 })
	})

	it('answers zeros for an empty diff', () => {
		expect(diffStats('')).toEqual({
			additions: 0,
			deletions: 0,
			files: 0,
			code: { additions: 0, deletions: 0 },
			excluded: {},
		})
	})

	it('counts code lines next to the totals', () => {
		const diff = `${DIFF}diff --git a/a.spec.ts b/a.spec.ts
--- a/a.spec.ts
+++ b/a.spec.ts
@@ -0,0 +1,2 @@
+test()
+
`

		expect(diffStats(diff)).toEqual({
			additions: 4,
			deletions: 2,
			files: 3,
			code: { additions: 2, deletions: 2 },
			excluded: { tests: { additions: 2, deletions: 0 } },
		})
	})
})

describe('format', () => {
	it('groups thousands with a thin space', () => {
		expect(formatCount(1240)).toBe('1 240')
		expect(formatCount(318)).toBe('318')
	})

	it('says file for one and files otherwise', () => {
		expect(formatFiles(1)).toBe('1 file')
		expect(formatFiles(97)).toBe('97 files')
	})
})

describe('code part', () => {
	const stats = (code: { additions: number; deletions: number }) => ({
		additions: 10,
		deletions: 4,
		files: 2,
		code,
		excluded: {},
	})

	it('is shown only when the code counts differ from the totals', () => {
		expect(hasExcludedLines(stats({ additions: 10, deletions: 4 }))).toBe(false)
		expect(hasExcludedLines(stats({ additions: 9, deletions: 4 }))).toBe(true)
		expect(hasExcludedLines(stats({ additions: 10, deletions: 3 }))).toBe(true)
	})

	it('lists each excluded kind in a fixed order with the sides it touched', () => {
		expect(
			codeTooltip({
				excluded: {
					whitespace: { additions: 7, deletions: 7 },
					blank: { additions: 20, deletions: 3 },
					generated: { additions: 12, deletions: 0 },
					lockfiles: { additions: 45, deletions: 5 },
					docs: { additions: 60, deletions: 0 },
					tests: { additions: 1280, deletions: 10 },
				},
			}),
		).toBe(
			'Excluded: tests +1 280 −10, docs +60, lockfiles +45 −5, generated +12, ' +
				'blank and comment lines +20 −3, whitespace-only changes +7 −7.\n' +
				'Comment lines are detected approximately.',
		)
		expect(codeTooltip({ excluded: { docs: { additions: 0, deletions: 3 } } })).toBe(
			'Excluded: docs −3.\nComment lines are detected approximately.',
		)
	})
})
