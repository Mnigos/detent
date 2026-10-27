export const stemOf = (path: string) => path.replace(/\.[^/.]+$/, '')

/** `a/b.test.ts`, `a/b.spec.tsx` and `a/__tests__/b.test.ts` all test `a/b`. */
export function testSubjectOf(path: string): string | undefined {
	const stem = stemOf(path)
	if (!/\.(test|spec)$/.test(stem)) return undefined

	return stem.replace(/\.(test|spec)$/, '').replace(/\/__tests__\//, '/')
}

/** Moves every test right after the file it tests when both are in the list; the rest stay put. */
export function attachTests(paths: string[]): string[] {
	const stems = new Map(paths.map((path) => [stemOf(path), path]))
	const tests = new Map<string, string[]>()
	for (const path of paths) {
		const subject = testSubjectOf(path)
		if (subject === undefined || !stems.has(subject) || stems.get(subject) === path) continue

		tests.set(subject, [...(tests.get(subject) ?? []), path])
	}
	const attached = new Set([...tests.values()].flat())

	return paths.flatMap((path) =>
		attached.has(path) ? [] : [path, ...(tests.get(stemOf(path)) ?? [])],
	)
}
