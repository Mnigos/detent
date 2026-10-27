import { describe, expect, it } from 'vitest'
import { loadFixture } from '../../test/load-fixture'
import { parseUnifiedDiff } from '../diff/parse-diff'
import { buildMethodEdges } from './graph'
import type { LabeledLayer } from './label-schema'
import { orderReviewLayers } from './reading-order'

function layer(id: string, ...paths: string[]): LabeledLayer {
	return {
		id,
		name: id,
		summary: '',
		isTrailing: id === 'generated',
		source: 'model',
		files: paths.map((path) => ({ path, role: 'server' })),
	}
}
const pathsOf = (layers: LabeledLayer[]) =>
	layers.map((layer) => layer.files.map((file) => file.path))

describe('dependency reading order', () => {
	it('puts the new lock implementation before its caller even in a saved model grouping', () => {
		const files = parseUnifiedDiff(loadFixture('provider-lock'))
		const layers = [layer('billing', 'src/renew.handler.ts', 'src/entitlement.repository.ts')]
		expect(pathsOf(orderReviewLayers(layers, buildMethodEdges(files)))).toEqual([
			['src/entitlement.repository.ts', 'src/renew.handler.ts'],
		])
		expect(pathsOf(layers)).toEqual([['src/renew.handler.ts', 'src/entitlement.repository.ts']])
	})
	it('orders dependencies across layers while preserving groups and generated files last', () => {
		const layers = [
			layer('consumer', 'handler'),
			layer('helper', 'helper'),
			layer('generated', 'lock'),
		]
		expect(
			orderReviewLayers(layers, [
				{ from: 'handler', to: 'helper', kind: 'import' },
				{ from: 'handler', to: 'lock', kind: 'import' },
			]).map((entry) => entry.id),
		).toEqual(['helper', 'consumer', 'generated'])
	})
	it('preserves cycle order and is stable on repeated application', () => {
		const layers = [layer('cycle', 'a', 'b', 'c')]
		const edges = [
			{ from: 'a', to: 'b', kind: 'import' as const },
			{ from: 'b', to: 'a', kind: 'import' as const },
		]
		const ordered = orderReviewLayers(layers, edges)
		expect(ordered).toEqual(layers)
		expect(orderReviewLayers(ordered, edges)).toEqual(ordered)
	})
	it('keeps every test right behind the file it tests instead of at the end', () => {
		const layers = [
			layer(
				'billing',
				'src/a.command.ts',
				'src/a.handler.ts',
				'src/a.handler.spec.ts',
				'src/a.command.spec.ts',
			),
		]
		expect(
			pathsOf(
				orderReviewLayers(layers, [
					{ from: 'src/a.handler.ts', to: 'src/a.command.ts', kind: 'import' },
					{ from: 'src/a.handler.spec.ts', to: 'src/a.handler.ts', kind: 'import' },
					{ from: 'src/a.command.spec.ts', to: 'src/a.command.ts', kind: 'import' },
				]),
			),
		).toEqual([
			['src/a.command.ts', 'src/a.command.spec.ts', 'src/a.handler.ts', 'src/a.handler.spec.ts'],
		])
	})
	it('leaves unrelated files in their relative order and follows transitive dependencies', () => {
		const layers = [layer('all', 'caller', 'unrelated', 'helper', 'definition', 'test')]
		const edges = [
			{ from: 'caller', to: 'helper', kind: 'import' as const },
			{ from: 'helper', to: 'definition', kind: 'import' as const },
			{ from: 'test', to: 'caller', kind: 'import' as const },
		]
		expect(pathsOf(orderReviewLayers(layers, edges))).toEqual([
			['definition', 'helper', 'caller', 'unrelated', 'test'],
		])
	})
})
