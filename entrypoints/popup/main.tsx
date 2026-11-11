import { createRoot } from 'react-dom/client'
import { chatGpt } from '@/src/lib/chatgpt/messages'
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
				// The worker owns the ChatGPT account and may reach OpenAI for the models, so it is asked
				// only when ChatGPT is chosen; only that section waits. The popup sees the email, the
				// models and a notice, never a token.
				chatgpt={settings.provider === 'chatgpt' ? chatGpt.status() : undefined}
				chatgptRequests={chatgptRequests}
			/>,
		),
)
