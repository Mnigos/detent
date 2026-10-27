import { describe, expect, it } from 'vitest'
import { classifyRole, ROLE_RANK } from './roles'

describe('classifyRole', () => {
	it.each([
		['bun.lock', 'generated'],
		['bun.lockb', 'generated'],
		['pnpm-lock.yaml', 'generated'],
		['Cargo.lock', 'generated'],
		['package-lock.json', 'generated'],
		['apps/web/src/routeTree.gen.ts', 'generated'],
		['apps/web/src/__snapshots__/button.snap', 'generated'],
		['packages/db/src/schema.generated.ts', 'generated'],
		['apps/web/dist/index.js', 'generated'],
		['apps/web/src/vendor.min.js', 'generated'],
		['packages/db/migrations/meta/_journal.json', 'generated'],
		['apps/api/tests/integration/repositories.integration.spec.ts', 'test'],
		['apps/web/src/modules/x/__tests__/helper.ts', 'test'],
		['e2e/checkout.ts', 'test'],
		['src/lib/parse.test.ts', 'test'],
		['README.md', 'docs'],
		['docs/architecture.mdx', 'docs'],
		['apps/api/docs/api.txt', 'docs'],
		['package.json', 'config'],
		['tsconfig.build.json', 'config'],
		['vitest.config.ts', 'config'],
		['.github/workflows/ci.yml', 'config'],
		['Dockerfile', 'config'],
		['biome.json', 'config'],
		['railway.json', 'config'],
		['apps/api/.env.example', 'config'],
		['packages/contracts/src/github-import.contract.ts', 'contract'],
		['packages/db/src/schema/users.ts', 'contract'],
		['packages/domain/src/user-id.ts', 'contract'],
		['apps/web/src/types.ts', 'contract'],
		['packages/solid-start/src/tanstack-start.d.ts', 'contract'],
		['services/git/proto/git.proto', 'contract'],
		['packages/api/src/schema.graphql', 'contract'],
		['packages/db/migrations/0001_init.sql', 'migration'],
		['packages/db/migrations/20240101_add_users.ts', 'migration'],
		['packages/db/migrations/2024/add-users.js', 'migration'],
		['apps/api/src/billing/add-plans.migration.ts', 'migration'],
		['prisma/migrations/20240101_init/migration.sql', 'migration'],
		['packages/db/migrations/README.txt', 'other'],
		['apps/api/src/modules/x/application/x.service.ts', 'server'],
		['apps/api/src/modules/x/infrastructure/x.repository.ts', 'server'],
		['services/git/src/main.rs', 'server'],
		['scripts/deploy.py', 'server'],
		['cmd/server/main.go', 'server'],
		['apps/web/src/modules/x/components/card.tsx', 'ui'],
		['apps/web/src/modules/x/hooks/use-x.ts', 'ui'],
		['apps/web/src/styles/global.css', 'ui'],
		['apps/web/src/routes/index.vue', 'ui'],
		['LICENSE', 'other'],
		['benchmarks/solid-server-functions.ts', 'other'],
		['.gitignore', 'other'],
	])('classifies %s as %s', (path, role) => {
		expect(classifyRole(path)).toBe(role)
	})

	it('prefers the earlier rule when several match', () => {
		expect(classifyRole('apps/web/src/components/button.spec.tsx')).toBe('test')
		expect(classifyRole('apps/web/src/components/button.tsx')).toBe('ui')
		expect(classifyRole('packages/db/migrations/meta/_journal.json')).toBe('generated')
		expect(classifyRole('packages/db/migrations/0001_init.sql')).toBe('migration')
		expect(classifyRole('packages/db/migrations/meta/0000_snapshot.json')).toBe('generated')
	})

	it('ranks migrations first, then contracts, and generated files last among the ranked roles', () => {
		expect(ROLE_RANK).toEqual({
			migration: 0,
			contract: 1,
			server: 2,
			ui: 3,
			other: 4,
			docs: 5,
			config: 6,
			generated: 7,
			test: 8,
		})
	})
})
