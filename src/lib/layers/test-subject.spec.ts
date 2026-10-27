import { describe, expect, it } from 'vitest'
import { attachTests, testSubjectOf } from './test-subject'

describe('testSubjectOf', () => {
	it('resolves test and spec files, also under __tests__, and nothing else', () => {
		expect(testSubjectOf('src/a/env.test.ts')).toBe('src/a/env')
		expect(testSubjectOf('src/a/env.spec.tsx')).toBe('src/a/env')
		expect(testSubjectOf('src/a/__tests__/env.test.ts')).toBe('src/a/env')
		expect(testSubjectOf('src/a/env.ts')).toBeUndefined()
		expect(testSubjectOf('src/a/testing.ts')).toBeUndefined()
	})
})

describe('attachTests', () => {
	it('moves each test right after its subject and leaves orphans where they were', () => {
		expect(
			attachTests(['a.ts', 'b.ts', 'c.ts', 'x.spec.ts', 'b.spec.ts', 'a.test.ts', 'b.test.tsx']),
		).toEqual(['a.ts', 'a.test.ts', 'b.ts', 'b.spec.ts', 'b.test.tsx', 'c.ts', 'x.spec.ts'])
	})

	it('pulls a test that came before its subject down behind it', () => {
		expect(attachTests(['a.spec.ts', 'z.ts', 'a.ts'])).toEqual(['z.ts', 'a.ts', 'a.spec.ts'])
	})
})
