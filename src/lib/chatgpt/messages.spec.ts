import { describe, expect, it } from 'vitest'
import { pickModel } from './messages'

const model = (slug: string) => ({ slug, name: slug })

describe('pickModel', () => {
	it('keeps the saved choice while the account lists it', () => {
		expect(pickModel('gpt-6.1-sol', [model('gpt-6.1-sol'), model('gpt-6-luna')])).toBe(
			'gpt-6.1-sol',
		)
	})

	it('prefers gpt-6-luna when nothing valid is saved', () => {
		const models = [model('gpt-6.1-sol'), model('gpt-6.5-luna'), model('gpt-6-luna')]
		expect(pickModel('', models)).toBe('gpt-6-luna')
		expect(pickModel('gone-model', models)).toBe('gpt-6-luna')
	})

	it('takes the first listed Luna when gpt-6-luna is missing', () => {
		expect(
			pickModel('', [model('gpt-6.1-sol'), model('gpt-6.5-luna'), model('gpt-5.6-luna')]),
		).toBe('gpt-6.5-luna')
	})

	it('takes the first listed model when no Luna is listed', () => {
		expect(pickModel('', [model('gpt-6.1-sol'), model('gpt-5.6-terra')])).toBe('gpt-6.1-sol')
	})

	it('keeps the saved value when the list is empty, and takes gpt-6-luna when none is saved', () => {
		expect(pickModel('gpt-6.1-sol', [])).toBe('gpt-6.1-sol')
		expect(pickModel('', [])).toBe('gpt-6-luna')
	})
})
