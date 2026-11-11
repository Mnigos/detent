import { browser } from 'wxt/browser'
import { chatGpt } from '@/src/lib/chatgpt/messages'

// The loopback redirect lands here through a declarativeNetRequest rule. The code goes straight to
// the service worker and out of the address bar and history.
const href = location.href
history.replaceState(null, '', location.pathname)
const status = document.getElementById('status')

void chatGpt
	.finish(href)
	.catch(() => undefined)
	.then(async (answer) => {
		if (!status) return
		if (!answer?.ok) {
			status.textContent = answer?.message ?? 'ChatGPT sign-in failed. Try again from the popup.'
			return
		}
		status.textContent = `Signed in to ChatGPT${answer.email ? ` as ${answer.email}` : ''}. You can close this tab.`
		const tab = await browser.tabs.getCurrent()
		if (tab?.id !== undefined) await browser.tabs.remove(tab.id)
	})
