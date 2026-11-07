import type { DiffFile } from '../diff/parse-diff'
import { classifyRole, isLockfile } from '../layers/roles'

export interface LineCounts {
	additions: number
	deletions: number
}

export type ExcludedKind = 'tests' | 'docs' | 'lockfiles' | 'generated' | 'blank' | 'whitespace'

/** Lines left after excluded files and excluded lines, and what each exclusion took. */
export interface CodeLines {
	code: LineCounts
	/** Only the kinds that excluded something. */
	excluded: Partial<Record<ExcludedKind, LineCounts>>
}

export const EXCLUDED_LABELS: Record<ExcludedKind, string> = {
	tests: 'tests',
	docs: 'docs',
	lockfiles: 'lockfiles',
	generated: 'generated',
	blank: 'blank and comment lines',
	whitespace: 'whitespace-only changes',
}

function excludedFileKind(path: string): ExcludedKind | undefined {
	if (isLockfile(path)) return 'lockfiles'
	const role = classifyRole(path)
	if (role === 'test') return 'tests'
	if (role === 'docs') return 'docs'
	if (role === 'generated') return 'generated'

	return undefined
}

// Comment-only lines by their first characters; a line that only closes a comment counts too.
const C_LIKE = /^(\/\/|\/\*|\*\/|\*(\s|$))/
// A line opening with "* " is a selector in a stylesheet (`* { … }`), not a comment continuation.
const STYLESHEET = /^(\/\/|\/\*|\*\/)/
const HASH = /^#/
const DASHES = /^--/
const MARKUP = /^(<!--|-->)/
const MARKUP_AND_SCRIPT = /^(<!--|-->|\/\/|\/\*|\*\/|\*(\s|$))/

const COMMENT_BY_EXTENSION: Record<string, RegExp> = {}
for (const [pattern, extensions] of [
	[
		C_LIKE,
		'js jsx mjs cjs ts tsx mts cts rs go c h cc cpp cxx hpp cs java kt kts swift scala dart groovy gradle php',
	],
	[STYLESHEET, 'css scss less'],
	[HASH, 'py rb sh bash zsh fish yml yaml toml'],
	[DASHES, 'sql lua'],
	[MARKUP, 'html htm xml svg'],
	[MARKUP_AND_SCRIPT, 'vue svelte astro'],
] as const)
	for (const extension of extensions.split(' ')) COMMENT_BY_EXTENSION[extension] = pattern

const HASH_FILES = new Set(['Dockerfile', 'Makefile', 'Gemfile', 'Rakefile'])

function commentPattern(path: string): RegExp | undefined {
	const name = path.split('/').at(-1) ?? ''
	if (HASH_FILES.has(name)) return HASH
	const dot = name.lastIndexOf('.')

	return dot > 0 ? COMMENT_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] : undefined
}

const WHITESPACE = /\s+/g

/**
 * Splits a diff's changed lines into code and what is not: whole test, docs, lockfile and generated
 * files, blank and comment-only lines, and lines whose only change is whitespace. A removed and an
 * added line of the same hunk that are equal without their whitespace cancel each other out. One
 * pass over the lines, with a map per hunk.
 */
export function codeLines(files: DiffFile[]): CodeLines {
	const code: LineCounts = { additions: 0, deletions: 0 }
	const excluded: CodeLines['excluded'] = {}
	const exclude = (kind: ExcludedKind, additions: number, deletions: number) => {
		if (additions === 0 && deletions === 0) return
		const counts = excluded[kind] ?? { additions: 0, deletions: 0 }
		counts.additions += additions
		counts.deletions += deletions
		excluded[kind] = counts
	}

	for (const file of files) {
		const kind = excludedFileKind(file.path)
		if (kind) {
			exclude(kind, file.additions, file.deletions)
			continue
		}

		const comment = commentPattern(file.path)
		const isExcludedLine = (trimmed: string) => trimmed === '' || Boolean(comment?.test(trimmed))
		for (const hunk of file.hunks) {
			const removed = new Map<string, number>()
			for (const line of hunk.removedLines) {
				const squeezed = line.replace(WHITESPACE, '')
				if (squeezed) removed.set(squeezed, (removed.get(squeezed) ?? 0) + 1)
			}

			const matched = new Map<string, number>()
			let pairs = 0
			for (const line of hunk.addedLines) {
				const squeezed = line.replace(WHITESPACE, '')
				const left = squeezed ? (removed.get(squeezed) ?? 0) : 0
				if (left > 0) {
					removed.set(squeezed, left - 1)
					matched.set(squeezed, (matched.get(squeezed) ?? 0) + 1)
					pairs += 1
				} else if (isExcludedLine(line.trim())) exclude('blank', 1, 0)
				else code.additions += 1
			}
			exclude('whitespace', pairs, pairs)

			for (const line of hunk.removedLines) {
				const squeezed = line.replace(WHITESPACE, '')
				const pending = matched.get(squeezed) ?? 0
				if (squeezed && pending > 0) matched.set(squeezed, pending - 1)
				else if (isExcludedLine(line.trim())) exclude('blank', 0, 1)
				else code.deletions += 1
			}
		}
	}

	return { code, excluded }
}
