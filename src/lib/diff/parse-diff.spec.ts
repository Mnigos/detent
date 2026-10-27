import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../test/load-fixture'
import { parseUnifiedDiff } from './parse-diff'

const tessera165 = parseUnifiedDiff(loadFixture('tessera-165'))
const tessera166 = parseUnifiedDiff(loadFixture('tessera-166'))
const tanstack8170 = parseUnifiedDiff(loadFixture('tanstack-router-8170'))

const findFile = (files: ReturnType<typeof parseUnifiedDiff>, path: string) =>
	files.find((file) => file.path === path)

describe('parseUnifiedDiff', () => {
	it.each([
		[tessera165, 26],
		[tessera166, 5],
		[tanstack8170, 36],
	])('parses every `diff --git` header into a file', (files, expected) => {
		expect(files).toHaveLength(expected)
	})

	it('marks files with `new file mode` as added', () => {
		expect(tessera165.filter((file) => file.status === 'added')).toHaveLength(8)
		expect(
			findFile(tessera165, 'apps/web/src/modules/github-import/helpers/id-list.ts')?.status,
		).toBe('added')
	})

	it('marks renames and keeps the old path', () => {
		const renamed = tessera165.filter((file) => file.status === 'renamed')

		expect(renamed.map((file) => [file.oldPath, file.path])).toEqual([
			[
				'apps/web/src/modules/pull-requests/components/pull-requests-search-input.spec.tsx',
				'apps/web/src/shared/components/search-input.spec.tsx',
			],
			[
				'apps/web/src/modules/pull-requests/components/pull-requests-search-input.tsx',
				'apps/web/src/shared/components/search-input.tsx',
			],
		])
	})

	it('marks untouched files as modified and never as binary', () => {
		expect(
			findFile(tessera166, 'apps/api/src/modules/repositories/application/repositories.service.ts')
				?.status,
		).toBe('modified')
		expect(tessera166.every((file) => !file.isBinary)).toBe(true)
	})

	it('counts additions and deletions per file', () => {
		expect(
			findFile(
				tessera165,
				'apps/api/src/modules/github-import/infrastructure/github-octokit.client.ts',
			),
		).toMatchObject({ additions: 70, deletions: 41 })
		expect(findFile(tessera165, 'packages/contracts/src/github-import.contract.ts')).toMatchObject({
			additions: 21,
			deletions: 0,
		})
		expect(
			findFile(tanstack8170, 'packages/solid-start/src/createSolidStartHandler.ts'),
		).toMatchObject({ additions: 200, deletions: 0 })
	})

	it('reads hunk ranges, headers and line contents', () => {
		const file = findFile(
			tessera166,
			'apps/api/src/modules/repositories/application/repositories.service.ts',
		)

		expect(file?.hunks).toHaveLength(1)
		expect(file?.hunks[0]).toMatchObject({
			oldStart: 626,
			oldLines: 7,
			newStart: 626,
			newLines: 13,
			header: 'export class RepositoriesService {',
			removedLines: ['\t\tif (!enablement?.installationId) {'],
		})
		expect(file?.hunks[0]?.addedLines).toContain('\t\tif (!isInstalled) {')
	})

	it('counts every hunk in a multi-hunk file', () => {
		expect(
			findFile(
				tessera166,
				'apps/api/src/modules/repositories/infrastructure/repositories.repository.ts',
			)?.hunks,
		).toHaveLength(2)
	})

	it('keeps additions and deletions consistent with the hunk line arrays', () => {
		for (const file of [...tessera165, ...tessera166, ...tanstack8170]) {
			const added = file.hunks.reduce((total, hunk) => total + hunk.addedLines.length, 0)
			const removed = file.hunks.reduce((total, hunk) => total + hunk.removedLines.length, 0)

			expect([file.path, added, removed]).toEqual([file.path, file.additions, file.deletions])
		}
	})

	it('parses hunkless entries: a binary addition, a pure rename and a mode change', () => {
		const files = parseUnifiedDiff(
			[
				'diff --git a/assets/logo.png b/assets/logo.png',
				'new file mode 100644',
				'index 0000000..1111111',
				'Binary files /dev/null and b/assets/logo.png differ',
				'diff --git a/src/old-name.ts b/src/new-name.ts',
				'similarity index 100%',
				'rename from src/old-name.ts',
				'rename to src/new-name.ts',
				'diff --git a/scripts/deploy.sh b/scripts/deploy.sh',
				'old mode 100644',
				'new mode 100755',
			].join('\n'),
		)

		expect(files).toEqual([
			{
				path: 'assets/logo.png',
				status: 'added',
				isBinary: true,
				additions: 0,
				deletions: 0,
				hunks: [],
			},
			{
				path: 'src/new-name.ts',
				oldPath: 'src/old-name.ts',
				status: 'renamed',
				isBinary: false,
				additions: 0,
				deletions: 0,
				hunks: [],
			},
			{
				path: 'scripts/deploy.sh',
				status: 'modified',
				isBinary: false,
				additions: 0,
				deletions: 0,
				hunks: [],
			},
		])
	})

	it('parses inline diff features that the fixtures do not cover', () => {
		const files = parseUnifiedDiff(
			[
				'diff --git a/logo.png b/logo.png',
				'index 0000000..1111111 100644',
				'Binary files a/logo.png and b/logo.png differ',
				'diff --git a/gone.ts b/gone.ts',
				'deleted file mode 100644',
				'index 1111111..0000000',
				'--- a/gone.ts',
				'+++ /dev/null',
				'@@ -1 +0,0 @@',
				"-export const gone = 'gone'",
				'diff --git a/tail.ts b/tail.ts',
				'index 1111111..2222222 100644',
				'--- a/tail.ts',
				'+++ b/tail.ts',
				'@@ -1,2 +1,2 @@ header text',
				' const kept = 1',
				'-const tail = 1',
				'+const tail = 2',
				'\\ No newline at end of file',
			].join('\n'),
		)

		expect(files.map((file) => [file.path, file.status, file.isBinary])).toEqual([
			['logo.png', 'modified', true],
			['gone.ts', 'deleted', false],
			['tail.ts', 'modified', false],
		])
		expect(files[1]).toMatchObject({ additions: 0, deletions: 1 })
		expect(files[2]?.hunks[0]).toMatchObject({
			oldStart: 1,
			oldLines: 2,
			newLines: 2,
			header: 'header text',
			addedLines: ['const tail = 2'],
			removedLines: ['const tail = 1'],
		})
	})
})
