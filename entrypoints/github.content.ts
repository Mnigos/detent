import { browser } from 'wxt/browser'
import { parsePullsListUrl } from '@/src/lib/list/rows'
import { LOADING_TEXT, showAnalysisBadge } from '@/src/lib/panel/analysis-badge'
import { observeMutations } from '@/src/lib/panel/github-dom'
import { parsePullRequestUrl } from '@/src/lib/pull-request-url'
import { readSettings } from '@/src/lib/settings'
import { startListStats } from '@/src/list/mount'
import { startPanel } from '@/src/panel/mount'
import { startTree } from '@/src/tree/mount'

const FAILURE_ID = 'detent-failure'

// A failure that only reaches the console is invisible to a reviewer; the page says what went wrong.
function showFailure(error: unknown, retry: () => void) {
	document.getElementById(FAILURE_ID)?.remove()
	const notice = document.createElement('div')
	notice.id = FAILURE_ID
	notice.textContent = `detent could not start: ${error instanceof Error ? error.message : String(error)}. Click to retry.`
	notice.style.cssText =
		'position:fixed;right:16px;bottom:16px;z-index:9999;max-width:28rem;padding:8px 12px;border-radius:6px;background:#7f1d1d;color:#fff;font:12px/1.4 sans-serif;cursor:pointer'
	notice.title = 'Click to retry'
	notice.addEventListener('click', () => {
		notice.remove()
		retry()
	})
	document.body.append(notice)
}

export default defineContentScript({
	// Reviewers reach pull requests by soft navigation from lists and notifications; a script matched
	// only on /pull/ URLs never runs on those documents, so it runs everywhere and checks the URL itself.
	matches: ['https://github.com/*'],
	runAt: 'document_idle',
	cssInjectionMode: 'ui',
	main(ctx) {
		let panel: { mount: () => void; remove: () => void } | undefined
		// undefined forces the next sync() through, including to tear a view down when its key is ''.
		let mounted: string | undefined = ''
		let generation = 0

		async function sync() {
			const location = parsePullRequestUrl(window.location.href)
			const list = parsePullsListUrl(window.location.href)
			const { isEnabled, showListStats } = await readSettings()
			const view = !isEnabled
				? undefined
				: location?.tab === 'files'
					? 'panel'
					: location?.tab === 'changes'
						? 'tree'
						: list && showListStats
							? 'list'
							: undefined
			// A list keeps its view across filters and pages; its observer picks up the new rows.
			const key =
				view === 'list'
					? `list:${list?.owner}/${list?.repo}`
					: view
						? `${view}:${location?.owner}/${location?.repo}/${location?.number}`
						: ''
			if (key === mounted && generation > 0) return

			mounted = key
			generation += 1
			const current = generation
			panel?.remove()
			panel = undefined
			document.getElementById(FAILURE_ID)?.remove()
			showAnalysisBadge(Boolean(view) && view !== 'list', LOADING_TEXT)
			if (!view) return

			try {
				const next =
					view === 'list'
						? await startListStats()
						: location &&
							(view === 'tree' ? await startTree(ctx, location) : await startPanel(ctx, location))
				if (!next) return
				if (current !== generation) return next.remove()

				panel = next
				panel.mount()
			} catch (error) {
				console.warn('[detent]', error)
				showAnalysisBadge(false)
				// A retry starts the page over: the mounted key is forgotten so sync() mounts again.
				showFailure(error, () => {
					mounted = undefined
					void sync()
				})
			}
		}

		void sync()
		// Switching the extension off or on in the popup applies to open pages at once.
		browser.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local' || !changes.settings) return

			mounted = undefined
			void sync()
		})
		// GitHub navigates with pushState; currententrychange covers it, navigatesuccess the rest.
		if (window.navigation) {
			window.navigation.addEventListener('currententrychange', () => void sync())
			window.navigation.addEventListener('navigatesuccess', () => void sync())
		}
		window.addEventListener('popstate', () => void sync())
		// The URL check on DOM changes is the safety net for a navigation no event announced.
		let href = window.location.href
		observeMutations(document.body, [], () => {
			if (window.location.href === href) return

			href = window.location.href
			void sync()
		})
	},
})
