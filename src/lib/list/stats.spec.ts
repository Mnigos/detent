import { describe, expect, it } from 'vitest'
import { diffStats, formatCount, formatFiles } from './stats'

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
		expect(diffStats(DIFF)).toEqual({ additions: 2, deletions: 2, files: 2 })
	})

	it('answers zeros for an empty diff', () => {
		expect(diffStats('')).toEqual({ additions: 0, deletions: 0, files: 0 })
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
