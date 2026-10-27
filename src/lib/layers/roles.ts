export type FileRole =
	| 'contract'
	| 'server'
	| 'ui'
	| 'test'
	| 'config'
	| 'generated'
	| 'migration'
	| 'docs'
	| 'other'

export const ROLE_RANK: Record<FileRole, number> = {
	migration: 0,
	contract: 1,
	server: 2,
	ui: 3,
	other: 4,
	docs: 5,
	config: 6,
	generated: 7,
	test: 8,
}

export const ROLE_LAYER_NAMES: Record<FileRole, string> = {
	migration: 'Database migrations',
	contract: 'Shared changes',
	server: 'API changes',
	ui: 'Web changes',
	other: 'Other changes',
	docs: 'Docs changes',
	config: 'Config changes',
	generated: 'Generated',
	test: 'Tests',
}

const LOCKFILES = [
	'bun.lock',
	'bun.lockb',
	'package-lock.json',
	'pnpm-lock.yaml',
	'yarn.lock',
	'Cargo.lock',
]

const RULES: [FileRole, RegExp][] = [
	['generated', /\.snap$|\.gen\.|\.generated\.|\/dist\/|\/build\/|\/migrations\/meta\/|\.min\./],
	[
		'migration',
		/\/migrations\/[^/]+\.sql$|\/migrations\/.*\.[jt]s$|\.migration\.|\/prisma\/migrations\//,
	],
	['test', /\.spec\.|\.test\.|\/__tests__\/|\/tests\/|\/e2e\//],
	['docs', /\.mdx?$|\/docs\//],
	[
		'config',
		/(^|\/)(package\.json|Dockerfile|biome\.json|railway\.json)$|(^|\/)tsconfig[^/]*\.json$|\.config\.|(^|\/)\.github\/|\.ya?ml$|(^|\/)\.env/,
	],
	[
		'contract',
		/\/contracts?\/|\/schemas?\/|\/domain\/|\.contract\.|\.schema\.|\.types\.|(^|\/)types\.ts$|\.d\.ts$|\.proto$|\.graphql$/,
	],
	[
		'server',
		/\/api\/|\/server\/|\/services\/|\/backend\/|\/infrastructure\/|\/application\/|\/presentation\/|\.service\.|\.controller\.|\.repository\.|\.processor\.|\.(rs|go|py)$/,
	],
	[
		'ui',
		/\.(tsx|jsx|vue|svelte|css)$|\/components\/|\/routes\/|\/pages\/|\/app\/|\/web\/|\/hooks\//,
	],
]

export function classifyRole(path: string): FileRole {
	const normalized = `/${path}`
	if (LOCKFILES.includes(path.split('/').at(-1) ?? '')) return 'generated'

	for (const [role, pattern] of RULES) if (pattern.test(normalized)) return role

	return 'other'
}
