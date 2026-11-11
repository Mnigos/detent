import { useState } from 'react'
import { type ChatGptStatus, chatGpt } from '@/src/lib/chatgpt/messages'
import { writeSettings } from '@/src/lib/settings'
import { FIELD } from './styles'

interface ChatGptAccountProps {
	status: ChatGptStatus
	/** The chosen model slug; empty means the first one the account lists. */
	model: string
	isLoading: boolean
}

export function ChatGptAccount({ status: initialStatus, model, isLoading }: ChatGptAccountProps) {
	const [status, setStatus] = useState(initialStatus)
	const [chosen, setChosen] = useState(model)
	const [isBusy, setIsBusy] = useState(false)
	const [error, setError] = useState('')
	const notice = error || status.notice

	// The popup closes as soon as the sign-in tab opens; the account shows up the next time it opens.
	async function signIn() {
		setIsBusy(true)
		setError('')
		const answer = await chatGpt.signIn().catch(() => undefined)
		if (!answer?.ok) setError(answer?.message ?? 'ChatGPT sign-in failed. Try again.')
		setIsBusy(false)
	}

	async function signOut() {
		setIsBusy(true)
		setError('')
		const next = await chatGpt.signOut().catch(() => undefined)
		if (next) setStatus(next)
		else setError('Sign out failed. Try again.')
		setIsBusy(false)
	}

	async function choose(slug: string) {
		setChosen(slug)
		await writeSettings({ chatgptModel: slug })
	}

	if (!status.signedIn)
		return (
			<div className="flex flex-col gap-2">
				<button
					type="button"
					onClick={signIn}
					disabled={isLoading || isBusy}
					className="self-start rounded bg-neutral-100 px-3 py-1.5 font-medium text-neutral-950 text-sm disabled:opacity-50"
				>
					Continue with ChatGPT
				</button>
				{notice && (
					<p role="alert" className="text-amber-300 text-xs">
						{notice}
					</p>
				)}
			</div>
		)

	const selected = status.models.some((entry) => entry.slug === chosen)
		? chosen
		: (status.models[0]?.slug ?? '')
	return (
		<div className="flex flex-col gap-2">
			<p className="text-neutral-300 text-xs">
				Signed in as{' '}
				<span className="text-neutral-100">{status.email ?? 'your ChatGPT account'}</span>
			</p>
			<label className="flex flex-col gap-1 text-neutral-400 text-xs">
				Model
				<select
					disabled={isLoading || isBusy || status.models.length === 0}
					value={selected}
					onChange={(event) => void choose(event.target.value)}
					className={FIELD}
				>
					{status.models.map((entry) => (
						<option key={entry.slug} value={entry.slug}>
							{entry.name}
						</option>
					))}
				</select>
			</label>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={signOut}
					disabled={isLoading || isBusy}
					className="rounded border border-neutral-700 px-3 py-1.5 text-sm disabled:opacity-50"
				>
					Sign out
				</button>
				{notice && (
					<p role="alert" className="text-amber-300 text-xs">
						{notice}
					</p>
				)}
			</div>
		</div>
	)
}
