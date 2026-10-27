import { useState } from 'react'
import { type OpenRouterError, testOpenRouter } from '@/src/lib/model/openrouter'
import { EMPTY_USAGE, formatCost, resetUsage, type Usage } from '@/src/lib/model/usage'
import { DEFAULT_MODEL, type Settings, writeSettings } from '@/src/lib/settings'

const ERROR_LINES: Record<OpenRouterError['kind'], string> = {
	unauthorized: 'OpenRouter rejected the API key.',
	credits: 'OpenRouter reports no credits left.',
	timeout: 'OpenRouter took too long to answer.',
	request: 'OpenRouter request failed.',
	invalid: 'OpenRouter answered with an unexpected response.',
}

const FIELD =
	'rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500'

interface AppProps {
	settings: Settings
	usage: Usage
	isLoading?: boolean
}

export function App({ settings, usage: initialUsage, isLoading = false }: AppProps) {
	const [usage, setUsage] = useState(initialUsage)
	const [key, setKey] = useState(settings.openRouterKey)
	const [isEnabled, setIsEnabled] = useState(settings.isEnabled)
	const [showListStats, setShowListStats] = useState(settings.showListStats)
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

	async function toggleEnabled(next: boolean) {
		setIsEnabled(next)
		await writeSettings({ isEnabled: next })
	}

	async function toggleListStats(next: boolean) {
		setShowListStats(next)
		await writeSettings({ showListStats: next })
	}

	async function reset() {
		await resetUsage()
		setUsage(EMPTY_USAGE)
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
		<main className="flex w-[28rem] flex-col gap-3 bg-neutral-950 p-4 text-neutral-100">
			<h1 className="font-semibold text-base">detent for GitHub</h1>
			<label className="flex items-center gap-2 text-neutral-300 text-sm">
				<input
					type="checkbox"
					disabled={isLoading}
					checked={isEnabled}
					onChange={(event) => void toggleEnabled(event.target.checked)}
				/>
				Group pull request files into layers
			</label>
			<label className="flex items-center gap-2 text-neutral-300 text-sm">
				<input
					type="checkbox"
					disabled={isLoading}
					checked={showListStats}
					onChange={(event) => void toggleListStats(event.target.checked)}
				/>
				Show diff size on pull request lists
			</label>
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
			<p className="text-[11px] text-neutral-500">
				Diffs and descriptions of the pull requests you open go to OpenRouter under your key.
				Nothing else leaves the browser.{' '}
				<a
					href="https://github.com/Mnigos/detent/blob/main/PRIVACY.md"
					target="_blank"
					rel="noreferrer"
					className="underline hover:text-neutral-300"
				>
					Privacy
				</a>
				{' · '}
				<a
					href="https://github.com/Mnigos/detent"
					target="_blank"
					rel="noreferrer"
					className="underline hover:text-neutral-300"
				>
					Source
				</a>
			</p>
			<p className="flex justify-end gap-2 text-[11px] text-neutral-500">
				<span title="Spent by detent on this key since the last reset">
					Usage: {formatCost(usage.cost)} · {usage.requests}{' '}
					{usage.requests === 1 ? 'request' : 'requests'}
				</span>
				<button type="button" onClick={reset} className="hover:text-neutral-300">
					reset
				</button>
			</p>
		</main>
	)
}
