import { createRoot } from 'react-dom/client'
import { chatGpt } from '@/src/lib/chatgpt/messages'
import { EMPTY_USAGE, readChatGptRequests, readUsage } from '@/src/lib/model/usage'
import { DEFAULT_SETTINGS, readSettings } from '@/src/lib/settings'
import { App } from './app'
import './style.css'

const container = document.getElementById('root')
if (!container) throw new Error('popup root element is missing')

// The worker owns the ChatGPT account and may need to reach OpenAI first; only the ChatGPT section
// waits for it. The popup only ever sees the email, the models and a notice.
const chatgpt = chatGpt.status()
const root = createRoot(container)
// Paint at once with the fields disabled; the stored values swap in through a remount when they arrive.
root.render(
	<App
		key="loading"
		settings={DEFAULT_SETTINGS}
		usage={EMPTY_USAGE}
		chatgpt={chatgpt}
		chatgptRequests={0}
		isLoading
	/>,
)
void Promise.all([readSettings(), readUsage(), readChatGptRequests()]).then(
	([settings, usage, chatgptRequests]) =>
		root.render(
			<App
				key="ready"
				settings={settings}
				usage={usage}
				chatgpt={chatgpt}
				chatgptRequests={chatgptRequests}
			/>,
		),
)
