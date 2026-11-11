import { Suspense, useState } from 'react'
import { type ChatGptStatus, chatGpt, USAGE_SETTINGS_URL } from '@/src/lib/chatgpt/messages'
import { PROVIDER_NAMES } from '@/src/lib/model/provider'
import { EMPTY_USAGE, formatCost, requestUsageReset, type Usage } from '@/src/lib/model/usage'
import { type ProviderChoice, type Settings, writeSettings } from '@/src/lib/settings'
import { ChatGptAccount } from './chatgpt'
import { OpenRouterSettings } from './openrouter'

const PROVIDERS: ProviderChoice[] = ['openrouter', 'chatgpt']
const LINK = 'underline hover:text-neutral-300'

interface AppProps {
	settings: Settings
	usage: Usage
	/** The worker's answer about the account, asked only when ChatGPT is the chosen provider. */
	chatgpt?: Promise<ChatGptStatus>
	chatgptRequests: number
	isLoading?: boolean
}

const plural = (count: number) => `${count} ${count === 1 ? 'request' : 'requests'}`

export function App({
	settings,
	usage: initialUsage,
	chatgpt: initialChatgpt,
	chatgptRequests: initialRequests,
	isLoading = false,
}: AppProps) {
	const [usage, setUsage] = useState(initialUsage)
	const [chatgptRequests, setChatgptRequests] = useState(initialRequests)
	const [provider, setProvider] = useState(settings.provider)
	const [chatgpt, setChatgpt] = useState(initialChatgpt)
	const [isEnabled, setIsEnabled] = useState(settings.isEnabled)
	const [showListStats, setShowListStats] = useState(settings.showListStats)
	const isChatGpt = provider === 'chatgpt'

	async function choose(next: ProviderChoice) {
		setProvider(next)
		// The worker may reach OpenAI for the models; that waits until ChatGPT is chosen.
		if (next === 'chatgpt' && !chatgpt) setChatgpt(chatGpt.status())
		await writeSettings({ provider: next })
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
		await requestUsageReset(provider)
		if (isChatGpt) setChatgptRequests(0)
		else setUsage(EMPTY_USAGE)
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
				Show diff size and conflicts on pull request lists, and code lines in pull request headers
			</label>
			<fieldset className="flex flex-col gap-1">
				<legend className="mb-1 text-neutral-400 text-xs">Model provider</legend>
				<div className="flex gap-1 rounded border border-neutral-700 p-0.5">
					{PROVIDERS.map((id) => (
						<label
							key={id}
							className={`flex-1 cursor-pointer rounded px-2 py-1 text-center text-sm ${provider === id ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'}`}
						>
							<input
								type="radio"
								name="provider"
								value={id}
								disabled={isLoading}
								checked={provider === id}
								onChange={() => void choose(id)}
								className="sr-only"
							/>
							{PROVIDER_NAMES[id]}
						</label>
					))}
				</div>
			</fieldset>
			{/* Both stay mounted once shown, so switching back keeps what was typed or changed there. */}
			{chatgpt && (
				<div hidden={!isChatGpt}>
					<Suspense fallback={<p className="text-neutral-500 text-xs">Checking ChatGPT…</p>}>
						<ChatGptAccount status={chatgpt} model={settings.chatgptModel} isLoading={isLoading} />
					</Suspense>
				</div>
			)}
			<div hidden={isChatGpt} className="flex flex-col gap-3">
				<OpenRouterSettings settings={settings} isLoading={isLoading} />
			</div>
			<p className="text-[11px] text-neutral-500">
				{isChatGpt
					? 'Diffs and descriptions of the pull requests you open go to OpenAI and count against your ChatGPT plan. Signing in and loading the model list also reach OpenAI.'
					: 'Diffs and descriptions of the pull requests you open go to OpenRouter under your key.'}{' '}
				Nothing else leaves the browser.{' '}
				<a
					href="https://github.com/Mnigos/detent/blob/main/PRIVACY.md"
					target="_blank"
					rel="noreferrer"
					className={LINK}
				>
					Privacy
				</a>
				{' · '}
				<a
					href="https://github.com/Mnigos/detent"
					target="_blank"
					rel="noreferrer"
					className={LINK}
				>
					Source
				</a>
			</p>
			<p className="flex justify-end gap-2 text-[11px] text-neutral-500">
				{isChatGpt ? (
					<>
						<span title="Requests detent sent on your ChatGPT plan since the last reset">
							Usage: {plural(chatgptRequests)}
						</span>
						<a href={USAGE_SETTINGS_URL} target="_blank" rel="noreferrer" className={LINK}>
							Manage usage
						</a>
					</>
				) : (
					<span title="Spent by detent on this key since the last reset">
						Usage: {formatCost(usage.cost)} · {plural(usage.requests)}
					</span>
				)}
				<button type="button" onClick={reset} className="hover:text-neutral-300">
					reset
				</button>
			</p>
		</main>
	)
}
