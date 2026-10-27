import { createRoot } from 'react-dom/client'
import { EMPTY_USAGE, readUsage } from '@/src/lib/model/usage'
import { DEFAULT_MODEL, readSettings } from '@/src/lib/settings'
import { App } from './app'
import './style.css'

const container = document.getElementById('root')
if (!container) throw new Error('popup root element is missing')

const root = createRoot(container)
// Paint at once with the fields disabled; the stored values swap in through a remount when they arrive.
root.render(
	<App
		key="loading"
		settings={{ openRouterKey: '', model: DEFAULT_MODEL }}
		usage={EMPTY_USAGE}
		isLoading
	/>,
)
void Promise.all([readSettings(), readUsage()]).then(([settings, usage]) =>
	root.render(<App key="ready" settings={settings} usage={usage} />),
)
