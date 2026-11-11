import { describe, expect, it } from 'vitest'
import { listedModels } from './models'

describe('listedModels', () => {
	it('keeps the models meant for display, in server order, with their display names', () => {
		expect(
			listedModels({
				models: [
					{ slug: 'gpt-6-luna', display_name: 'GPT-6 Luna', visibility: 'list' },
					{ slug: 'internal', display_name: 'Internal', visibility: 'hide' },
					{ slug: 'gpt-5.6-terra', display_name: 'GPT-5.6 Terra', visibility: 'list' },
					{ slug: 'gpt-5.6-luna', visibility: 'list' },
				],
			}),
		).toEqual([
			{ slug: 'gpt-6-luna', name: 'GPT-6 Luna' },
			{ slug: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
			{ slug: 'gpt-5.6-luna', name: 'gpt-5.6-luna' },
		])
	})

	it('reads the standard `data` shape and survives junk', () => {
		expect(listedModels({ data: [{ id: 'm', visibility: 'list' }] })).toEqual([
			{ slug: 'm', name: 'm' },
		])
		expect(listedModels(undefined)).toEqual([])
		expect(
			listedModels({ models: [null, { visibility: 'list' }, { slug: 7, visibility: 'list' }] }),
		).toEqual([])
	})
})
