import { createRoot } from 'react-dom/client'
import { chatGpt, SIGNED_OUT } from '@/src/lib/chatgpt/messages'
import { EMPTY_USAGE, readChatGptRequests, readUsage } from '@/src/lib/model/usage'
import { DEFAULT_SETTINGS, readSettings } from '@/src/lib/settings'
import { App } from './app'
import './style.css'

const container = document.getElementById('root')
if (!container) throw new Error('popup root element is missing')

const root = createRoot(container)
// Paint at once with the fields disabled; the stored values swap in through a remount when they arrive.
root.render(
	<App
		key="loading"
		settings={DEFAULT_SETTINGS}
		usage={EMPTY_USAGE}
		chatgpt={SIGNED_OUT}
		chatgptRequests={0}
		isLoading
	/>,
)
void Promise.all([
	readSettings(),
	readUsage(),
	readChatGptRequests(),
	// The worker owns the ChatGPT account; the popup only ever sees its email and models.
	chatGpt.status().catch(() => undefined),
]).then(([settings, usage, chatgptRequests, chatgpt]) =>
	root.render(
		<App
			key="ready"
			settings={settings}
			usage={usage}
			chatgpt={chatgpt ?? SIGNED_OUT}
			chatgptRequests={chatgptRequests}
		/>,
	),
)
