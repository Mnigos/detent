import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

export default defineConfig({
	modules: ['@wxt-dev/module-react'],
	manifest: {
		name: 'detent for GitHub',
		description:
			'Review GitHub pull requests in ordered layers, rank files by priority, and see diff sizes, code lines and conflicts on PR lists.',
		host_permissions: [
			'https://github.com/*',
			'https://patch-diff.githubusercontent.com/*',
			'https://openrouter.ai/*',
			// ChatGPT sign-in (token, revocation, signing keys) and the Responses and models API.
			'https://auth.openai.com/*',
			'https://api.openai.com/*',
			// Needed for the declarativeNetRequest rule that turns the sign-in callback into an
			// extension page; nothing is ever fetched from 127.0.0.1.
			'http://127.0.0.1/*',
		],
		permissions: ['storage', 'declarativeNetRequestWithHostAccess'],
		// Only pages on auth.openai.com, where the consent redirect starts, may open the callback page.
		web_accessible_resources: [
			{ resources: ['chatgpt-callback.html'], matches: ['https://auth.openai.com/*'] },
		],
	},
	vite: () => ({
		plugins: [tailwindcss()],
	}),
	// The owner tests in Helium with the extension loaded unpacked; WXT must not launch a browser of its own.
	webExt: { disabled: true },
	// Dev and build share one output directory, so the unpacked extension in Helium reloads from either.
	outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
})
