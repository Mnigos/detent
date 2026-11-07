import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from '../diff/parse-diff'
import { codeLines } from './code-lines'

// One file with one hunk; `lines` are the hunk body with their +, - or space prefix.
const file = (path: string, lines: string[]) =>
	[
		`diff --git a/${path} b/${path}`,
		`--- a/${path}`,
		`+++ b/${path}`,
		'@@ -1 +1 @@',
		...lines,
	].join('\n')

const count = (...files: string[]) => codeLines(parseUnifiedDiff(files.join('\n')))

describe('codeLines', () => {
	it('counts plain changed lines as code', () => {
		expect(count(file('src/a.ts', ['+const a = 1', '-const a = 2', ' keep']))).toEqual({
			code: { additions: 1, deletions: 1 },
			excluded: {},
		})
	})

	it.each([
		['src/a.spec.ts', 'tests'],
		['packages/router/tests/link.test.tsx', 'tests'],
		['fixtures/github-pulls-list.html', 'tests'],
		['src/__fixtures__/user.json', 'tests'],
		['pkg/server/handler_test.go', 'tests'],
		['README.md', 'docs'],
		['docs/guide/start.mdx', 'docs'],
		['docs/config.json', 'docs'],
		['bun.lock', 'lockfiles'],
		['pnpm-lock.yaml', 'lockfiles'],
		['package-lock.json', 'lockfiles'],
		['yarn.lock', 'lockfiles'],
		['crates/x/Cargo.lock', 'lockfiles'],
		['src/routeTree.gen.ts', 'generated'],
		['src/__snapshots__/button.test.tsx.snap', 'generated'],
		['dist/index.min.js', 'generated'],
	])('leaves out %s as %s', (path, kind) => {
		expect(count(file(path, ['+a', '+b', '-c']))).toEqual({
			code: { additions: 0, deletions: 0 },
			excluded: { [kind]: { additions: 2, deletions: 1 } },
		})
	})

	it.each(['package.json', 'tsconfig.json', '.github/workflows/ci.yml', 'vite.config.ts'])(
		'counts the config file %s as code',
		(path) => {
			expect(count(file(path, ['+"a": 1', '-"a": 2'])).code).toEqual({ additions: 1, deletions: 1 })
		},
	)

	it('leaves out blank and whitespace-only lines in any file', () => {
		expect(count(file('src/a.ts', ['+', '+   ', '+\t', '-', '+x = 1']))).toEqual({
			code: { additions: 1, deletions: 0 },
			excluded: { blank: { additions: 3, deletions: 1 } },
		})
		expect(count(file('LICENSE', ['+', '+text'])).excluded.blank).toEqual({
			additions: 1,
			deletions: 0,
		})
	})

	it.each([
		[
			'C-like',
			['src/a.ts', 'src/a.tsx', 'src/main.rs', 'cmd/main.go', 'App.java', 'App.kt', 'App.swift'],
			['+// note', '+/** doc', '+ * more', '+ */', '+  /* block */', '-// old', '+a * b', '+x = 1'],
			{ additions: 5, deletions: 1 },
			{ additions: 2, deletions: 0 },
		],
		[
			'CSS',
			['src/styles.css', 'src/styles.scss'],
			['+/* note */', '+ */', '+.a { color: red }', '+* { box-sizing: border-box }'],
			{ additions: 2, deletions: 0 },
			{ additions: 2, deletions: 0 },
		],
		[
			'hash',
			['tool.py', 'lib/x.rb', 'run.sh', 'config.yml', 'Cargo.toml', 'Dockerfile'],
			['+# note', '+  # indented', '-#!/usr/bin/env x', '+x = 1'],
			{ additions: 2, deletions: 1 },
			{ additions: 1, deletions: 0 },
		],
		[
			'dashes',
			['db/query.sql', 'init.lua'],
			['+-- note', '+select 1'],
			{ additions: 1, deletions: 0 },
			{ additions: 1, deletions: 0 },
		],
		[
			'markup',
			['index.html', 'src/App.vue', 'src/App.svelte'],
			['+<!-- note -->', '+<div></div>'],
			{ additions: 1, deletions: 0 },
			{ additions: 1, deletions: 0 },
		],
	])('leaves out %s comment lines', (_, paths, lines, comments, code) => {
		for (const path of paths) {
			const result = count(file(path, lines))
			expect(result.excluded.blank, path).toEqual(comments)
			expect(result.code, path).toEqual(code)
		}
	})

	it('keeps comment-looking lines as code where the language does not use that marker', () => {
		expect(count(file('src/a.ts', ['+# not a comment', '+-- nor this'])).code).toEqual({
			additions: 2,
			deletions: 0,
		})
		expect(count(file('tool.py', ['+// division', '+x = 1'])).code).toEqual({
			additions: 2,
			deletions: 0,
		})
		expect(count(file('LICENSE', ['+// text'])).code).toEqual({ additions: 1, deletions: 0 })
	})

	it('cancels a removed and an added line that differ only in whitespace', () => {
		expect(
			count(
				file('src/a.ts', [
					'-if (a) {',
					'-  run()',
					'-}',
					'+if (a) {',
					'+    run()',
					'+}',
					'+run(  )',
					'+next()',
				]),
			),
		).toEqual({
			code: { additions: 2, deletions: 0 },
			excluded: { whitespace: { additions: 3, deletions: 3 } },
		})
	})

	it('pairs each removed line at most once and only within its hunk', () => {
		const twoHunks = [
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,2 +1 @@',
			'-  run()',
			'-  run()',
			'@@ -10 +10,3 @@',
			'+run()',
			'+run()',
			'+run()',
		].join('\n')
		expect(count(twoHunks)).toEqual({
			code: { additions: 3, deletions: 2 },
			excluded: {},
		})

		expect(count(file('src/a.ts', ['-  run()', '+run()', '+run()']))).toEqual({
			code: { additions: 1, deletions: 0 },
			excluded: { whitespace: { additions: 1, deletions: 1 } },
		})
	})

	it('adds the counts up to the totals', () => {
		const files = parseUnifiedDiff(
			[
				file('src/a.ts', ['+// c', '+', '-  x()', '+x()', '+y()', '-z()']),
				file('src/a.spec.ts', ['+t()']),
				file('bun.lock', ['+l', '-l']),
			].join('\n'),
		)
		const { code, excluded } = codeLines(files)
		const sum = (side: 'additions' | 'deletions') =>
			code[side] + Object.values(excluded).reduce((total, counts) => total + counts[side], 0)

		expect(sum('additions')).toBe(files.reduce((total, f) => total + f.additions, 0))
		expect(sum('deletions')).toBe(files.reduce((total, f) => total + f.deletions, 0))
	})

	it('stays linear on a large diff', () => {
		const lines = Array.from({ length: 200_000 }, (_, index) =>
			index % 2 ? `+  value${(index >> 1) % 1000}()` : `-value${(index >> 1) % 1000}()`,
		)
		const started = performance.now()
		const { excluded } = count(file('src/big.ts', lines))

		expect(excluded.whitespace).toEqual({ additions: 100_000, deletions: 100_000 })
		expect(performance.now() - started).toBeLessThan(2000)
	})
})
