import type { DiffFile } from '../diff/parse-diff'

export interface Edge {
	from: string
	to: string
	kind: 'import' | 'identifier' | 'cochange'
}

const IMPORT_PATTERNS = [
	/^\s*(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/,
	/^\s*\}\s*from\s*['"]([^'"]+)['"]/,
	/^\s*import\s*['"]([^'"]+)['"]/,
	/require\(\s*['"]([^'"]+)['"]\s*\)/,
]

const EXPORT_DECLARATION =
	/export\s+(?:declare\s+)?(?:const|let|function|async function|class|interface|type|enum)\s+(\w+)/
const EXPORT_LIST = /export\s*(?:type\s*)?\{([^}]*)\}/
const IDENTIFIER = /^\w+$/
const STOP_LIST = new Set(['Props', 'Input', 'Output', 'State', 'Error', 'Route', 'default'])
const ALIAS_PREFIX = /^(?:@[^/]*|~{1,2})\//
const RELATIVE_PREFIX = /^(?:\.{1,2}\/)+/
const MODULE_SUFFIX = /(?:\/index)?\.(?:[cm]?[jt]sx?|vue|svelte)$|\/index$/
const METHOD_DECLARATION =
	/^[\t ]+(?:(?:public|protected|private|static|async|override|abstract)\s+)*([\w$]+)(?:<[^>\n]+>)?\s*\([^)]*\)\s*(?::[^;{\n]+)?\s*\{/gm
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g
const NON_CODE =
	/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g
const CONTROL_WORDS = new Set(['if', 'while', 'for', 'switch', 'catch', 'with', 'constructor'])

export function buildEdges(files: DiffFile[]): Edge[] {
	const addedLines = new Map(
		files.map((file) => [file.path, file.hunks.flatMap((hunk) => hunk.addedLines)]),
	)
	const moduleNames = new Map(
		files.map((file) => [file.path, file.path.replace(MODULE_SUFFIX, '')]),
	)
	const edges: Edge[] = []
	const seen = new Set<string>()

	const addEdge = (from: string, to: string, kind: Edge['kind']) => {
		if (from === to || seen.has(`${from}\0${to}`)) return

		seen.add(`${from}\0${to}`)
		edges.push({ from, to, kind })
	}

	for (const [path, lines] of addedLines) {
		for (const line of lines) {
			for (const pattern of IMPORT_PATTERNS) {
				const specifier = pattern.exec(line)?.[1]
				if (!specifier) continue

				const wanted = specifier.replace(ALIAS_PREFIX, '').replace(RELATIVE_PREFIX, '')
				// A stripped alias that keeps no directory was an npm scope such as `@tanstack/solid-router`.
				if (ALIAS_PREFIX.test(specifier) && !wanted.includes('/')) break

				const matches = [...moduleNames].filter(
					([candidate, name]) =>
						candidate !== path && (name === wanted || name.endsWith(`/${wanted}`)),
				)
				if (matches.length === 1 && matches[0]) addEdge(path, matches[0][0], 'import')
				break
			}
		}
	}

	const declarations = new Map<string, Set<string>>()
	for (const [path, lines] of addedLines) {
		for (const line of lines) {
			const names = EXPORT_DECLARATION.exec(line)?.slice(1) ?? []
			for (const entry of EXPORT_LIST.exec(line)?.[1]?.split(',') ?? [])
				names.push(entry.trim().split(/\s+/).at(-1) ?? '')

			for (const name of names)
				if (name.length >= 4 && IDENTIFIER.test(name) && !STOP_LIST.has(name))
					declarations.set(name, (declarations.get(name) ?? new Set()).add(path))
		}
	}

	const wordsPerFile = new Map(
		[...addedLines].map(([path, lines]) => [
			path,
			new Set(lines.flatMap((line) => line.split(/\W+/))),
		]),
	)
	for (const [name, declaringPaths] of declarations)
		for (const [path, words] of wordsPerFile) {
			if (!words.has(name)) continue

			for (const declaredIn of declaringPaths) addEdge(path, declaredIn, 'identifier')
		}

	return edges
}

export function buildMethodEdges(files: DiffFile[]): Edge[] {
	const addedLines = new Map(
		files.map((file) => [
			file.path,
			file.hunks
				.flatMap((hunk) => hunk.addedLines)
				.join('\n')
				.replace(NON_CODE, '')
				.split('\n'),
		]),
	)
	const methods = new Map<string, Set<string>>()
	const edges: Edge[] = []
	for (const [path, lines] of addedLines) {
		if (!/\.[cm]?[jt]sx?$/.test(path)) continue
		for (const match of lines.join('\n').matchAll(METHOD_DECLARATION)) {
			const name = match[1]
			if (name && !CONTROL_WORDS.has(name))
				methods.set(name, (methods.get(name) ?? new Set()).add(path))
		}
	}
	for (const [name, owners] of methods) {
		const [owner] = owners
		if (!owner || owners.size !== 1) continue
		const ownerName = owner
			.split('/')
			.at(-1)
			?.replace(/\.[cm]?[jt]sx?$/, '')
			.replace(/[^a-z0-9]/gi, '')
			.toLowerCase()
		const call = new RegExp(`([\\w$]+)\\.${name.replaceAll('$', '\\$')}(?:<[^>\\n]+>)?\\s*\\(`, 'g')
		for (const [path, lines] of addedLines)
			if (
				path !== owner &&
				lines.some(
					(line) =>
						!line.trimStart().startsWith('*') &&
						[...line.matchAll(call)].some(
							(match) => match[1]?.replace(/[^a-z0-9]/gi, '').toLowerCase() === ownerName,
						),
				)
			)
				edges.push({ from: path, to: owner, kind: 'identifier' })
	}

	return edges
}

const COCHANGE_MAX_FILES = 6
const COCHANGE_MIN_LENGTH = 6
const COCHANGE_SIGNALS = 4
// Identifiers with a second word: single lowercase words such as `filter` or `status` are noise.
const COMPOUND_IDENTIFIER = /^(?:[a-z][a-z0-9]*[A-Z_][\w$]*|[A-Z][a-z0-9]+[A-Z][\w$]*)$/
const COCHANGE_STOP_LIST = new Set([
	'useState',
	'useEffect',
	'useMemo',
	'useCallback',
	'useRef',
	'getState',
	'setState',
	'className',
	'onClick',
	'onChange',
	'onSubmit',
	'ariaLabel',
	'dataTestid',
	'toString',
	'JSON',
	'Promise',
	'Record',
	'Partial',
	'Readonly',
	'ReactNode',
	'FC',
])
const EXCLUDED_FROM_COCHANGE =
	/\.(?:spec|test)\.|\/__tests__\/|\.(?:md|mdx|snap|lock|ya?ml|json)$|(^|\/)[^/]*lock[^/]*$/i

function identifierOwners(files: DiffFile[]): Map<string, Set<string>> {
	const owners = new Map<string, Set<string>>()
	for (const file of files) {
		if (EXCLUDED_FROM_COCHANGE.test(file.path) || file.isBinary) continue
		// Strings stay: union members and event names such as 'timed_out' are how behaviors show up.
		const text = file.hunks
			.flatMap((hunk) => [...hunk.addedLines, ...hunk.removedLines])
			.join('\n')
			.replace(COMMENTS, '')
		for (const word of new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []))
			if (
				word.length >= COCHANGE_MIN_LENGTH &&
				COMPOUND_IDENTIFIER.test(word) &&
				!COCHANGE_STOP_LIST.has(word)
			)
				owners.set(word, (owners.get(word) ?? new Set()).add(file.path))
	}
	for (const [word, paths] of owners)
		if (paths.size < 2 || paths.size > COCHANGE_MAX_FILES) owners.delete(word)

	return owners
}

/**
 * Identifiers a file added or removed that another changed non-test file also added or removed.
 * They tie the files of one behavior change together when nothing is imported or exported.
 * Each file keeps its few rarest ones: this is what the prompt shows, not the full graph.
 */
export function sharedIdentifiers(files: DiffFile[]): Map<string, string[]> {
	const owners = identifierOwners(files)
	const shared = new Map<string, string[]>()
	for (const [word, paths] of owners)
		for (const path of paths) shared.set(path, [...(shared.get(path) ?? []), word])
	// Rarer identifiers first: a word shared by two files says more than one shared by six.
	for (const [path, words] of shared)
		shared.set(
			path,
			words
				.sort((left, right) => (owners.get(left)?.size ?? 0) - (owners.get(right)?.size ?? 0))
				.slice(0, COCHANGE_SIGNALS),
		)

	return shared
}

/** One edge per file pair sharing an identifier, rarest identifiers first for a bounded union. */
export function buildCochangeEdges(files: DiffFile[]): Edge[] {
	const edges: Edge[] = []
	const seen = new Set<string>()
	const groups = [...identifierOwners(files).values()].sort((left, right) => left.size - right.size)
	for (const group of groups) {
		const paths = [...group]
		for (const [index, from] of paths.entries())
			for (const to of paths.slice(index + 1)) {
				const pair = [from, to].sort().join('\0')
				if (seen.has(pair)) continue
				seen.add(pair)
				edges.push({ from, to, kind: 'cochange' })
			}
	}

	return edges
}
