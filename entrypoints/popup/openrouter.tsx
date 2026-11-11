import { useState } from 'react'
import { type OpenRouterError, testOpenRouter } from '@/src/lib/model/openrouter'
import { DEFAULT_MODEL, type Settings, writeSettings } from '@/src/lib/settings'
import { FIELD } from './styles'

const ERROR_LINES: Record<OpenRouterError['kind'], string> = {
	unauthorized: 'OpenRouter rejected the API key.',
	credits: 'OpenRouter reports no credits left.',
	timeout: 'OpenRouter took too long to answer.',
	request: 'OpenRouter request failed.',
	invalid: 'OpenRouter answered with an unexpected response.',
}

interface OpenRouterSettingsProps {
	settings: Settings
	isLoading: boolean
}

export function OpenRouterSettings({ settings, isLoading }: OpenRouterSettingsProps) {
	const [key, setKey] = useState(settings.openRouterKey)
	const [model, setModel] = useState(settings.model)
	const [notice, setNotice] = useState('')
	const [isTesting, setIsTesting] = useState(false)

	async function save() {
		const saved = await writeSettings({
			openRouterKey: key.trim(),
			model: model.trim() || DEFAULT_MODEL,
		})
		setKey(saved.openRouterKey)
		setModel(saved.model)
		setNotice('Saved.')
	}

	async function test() {
		const call = { key: key.trim(), model: model.trim() || DEFAULT_MODEL }
		if (!call.key) return setNotice('Enter an OpenRouter API key first.')

		setIsTesting(true)
		setNotice('Testing…')
		const error = await testOpenRouter(call)
		setNotice(
			error
				? `${ERROR_LINES[error.kind]}${error.status ? ` (HTTP ${error.status})` : ''}`
				: `Connected: ${call.model}`,
		)
		setIsTesting(false)
	}

	return (
		<>
			<label className="flex flex-col gap-1 text-neutral-400 text-xs">
				OpenRouter API key
				<input
					type="password"
					autoComplete="off"
					disabled={isLoading}
					value={key}
					onChange={(event) => setKey(event.target.value)}
					className={FIELD}
				/>
			</label>
			<label className="flex flex-col gap-1 text-neutral-400 text-xs">
				Model
				<input
					type="text"
					spellCheck={false}
					disabled={isLoading}
					value={model}
					onChange={(event) => setModel(event.target.value)}
					placeholder={DEFAULT_MODEL}
					className={FIELD}
				/>
			</label>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={save}
					disabled={isLoading}
					className="rounded bg-blue-600 px-3 py-1.5 font-medium text-sm disabled:opacity-50"
				>
					Save
				</button>
				<button
					type="button"
					onClick={test}
					disabled={isTesting || isLoading}
					className="rounded border border-neutral-700 px-3 py-1.5 text-sm disabled:opacity-50"
				>
					Test
				</button>
				<span aria-live="polite" className="text-neutral-400 text-xs">
					{isLoading ? 'Loading…' : notice}
				</span>
			</div>
		</>
	)
}
