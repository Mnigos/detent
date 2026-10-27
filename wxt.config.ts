import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

export default defineConfig({
	modules: ['@wxt-dev/module-react'],
	manifest: {
		name: 'detent for GitHub',
		description:
			'Review GitHub pull requests in ordered layers, rank files by review risk, and see diff sizes on pull request lists.',
		host_permissions: [
			'https://github.com/*',
			'https://patch-diff.githubusercontent.com/*',
			'https://openrouter.ai/*',
		],
		permissions: ['storage'],
	},
	vite: () => ({
		plugins: [tailwindcss()],
	}),
	// The owner tests in Helium with the extension loaded unpacked; WXT must not launch a browser of its own.
	webExt: { disabled: true },
	// Dev and build share one output directory, so the unpacked extension in Helium reloads from either.
	outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
})
