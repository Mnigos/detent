import { describe, expect, it } from 'vitest'
import { groupingRepairPaths } from './grouping-quality'
import { LABEL_LAYERS_MESSAGE, type LabelLayersRequest } from './label-layers'

const CONTRACT = 'packages/chat/chat.types.ts'
const HOOK = 'apps/admin-web/hooks/usePlanApproval.ts'
const CARD = 'packages/chat/components/PlanCard.tsx'
const REQUEST: LabelLayersRequest = {
	type: LABEL_LAYERS_MESSAGE,
	scope: 'example/1',
	digest: 'a',
	maxLayers: 3,
	groupingInput: '',
	files: [CONTRACT, HOOK, CARD].map((path) => ({ path, digest: 'a' })),
}

describe('grouping quality', () => {
	it('keeps shared definitions separate and accepts one behavior spanning packages', () => {
		expect(
			groupingRepairPaths(
				[
					{ name: 'Define chat contracts', summary: 'Check the shared types.', files: [CONTRACT] },
					{
						name: 'Approve proposed plans',
						summary: 'Check plan decision handling.',
						files: [HOOK, CARD],
					},
				],
				REQUEST,
			),
		).toEqual([])
	})
	it('flags a contracts group containing consumers without flagging an unrelated behavior', () => {
		expect(
			groupingRepairPaths(
				[
					{ name: 'Define chat contracts', summary: 'Check types.', files: [CONTRACT, HOOK] },
					{ name: 'Render plan decisions', summary: 'Check the view.', files: [CARD] },
				],
				REQUEST,
			),
		).toEqual([CONTRACT, HOOK])
	})
	it.each(['Web changes · admin-web', 'admin-web', 'components · chat'])(
		'flags directory-only title %s even with a description',
		(name) => {
			expect(
				groupingRepairPaths(
					[{ name, summary: 'Some changes.', files: [CONTRACT, HOOK, CARD] }],
					REQUEST,
				),
			).toHaveLength(3)
		},
	)
})
