// Uploads the built zip to the Chrome Web Store and submits it for review, through Chrome Web Store API v2 with a
// service account. It uses publish-browser-extension, the library behind `wxt submit`. The release workflow
// (.github/workflows/release.yml) runs it; docs/store/listing.md, "Release", lists the one-time setup.
// Usage: node tooling/cws-release.mjs <zip> [--dry-run]
// Environment: CWS_SERVICE_ACCOUNT_JSON (the service account's JSON key), CWS_PUBLISHER_ID, CWS_EXTENSION_ID.
// It reads the item's status first and stops when a review is pending, an upload is still processing, or the store
// already has this version. --dry-run stops after that check: it signs in and reads the status, uploads nothing.
import { readFileSync } from 'node:fs'
import { ChromeWebStoreV2, resolveConfig, submit, validateConfig } from 'publish-browser-extension'

const fail = (message) => {
	console.error(`::error::${message}`)
	process.exit(1)
}

const requireEnv = (name) => {
	const value = process.env[name]?.trim()
	if (!value) fail(`${name} is not set. See docs/store/listing.md, "Release".`)
	return value
}

// Never echo the key: errors name the field, not its content.
const readServiceAccount = () => {
	let key
	try {
		key = JSON.parse(requireEnv('CWS_SERVICE_ACCOUNT_JSON'))
	} catch {
		fail(
			'CWS_SERVICE_ACCOUNT_JSON is not valid JSON. Set it to the whole JSON key file of the service account.',
		)
	}
	if (key?.type !== 'service_account' || !key.client_email || !key.private_key) {
		fail(
			'CWS_SERVICE_ACCOUNT_JSON has no client_email or private_key. Use the JSON key of a service account.',
		)
	}
	// GitHub masks the secret as stored, with "\n" escapes; the parsed key has real line breaks, so mask each line.
	if (process.env.GITHUB_ACTIONS === 'true') {
		for (const line of key.private_key.split('\n'))
			if (line.trim()) console.log(`::add-mask::${line.trim()}`)
	}
	return key
}

const versionsOf = (revision) =>
	(revision?.distributionChannels ?? []).map((channel) => channel.crxVersion).filter(Boolean)

const describe = (revision) => {
	if (!revision) return 'none'
	const versions = versionsOf(revision)
	return versions.length ? `${revision.state} (${versions.join(', ')})` : revision.state
}

const [zip, ...flags] = process.argv.slice(2)
if (!zip) fail('Usage: node tooling/cws-release.mjs <zip> [--dry-run]')
const dryRun = flags.includes('--dry-run')
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const key = readServiceAccount()
const chrome = {
	apiVersion: 'v2',
	zip,
	extensionId: requireEnv('CWS_EXTENSION_ID'),
	publisherId: requireEnv('CWS_PUBLISHER_ID'),
	serviceAccountClientEmail: key.client_email,
	serviceAccountPrivateKey: key.private_key,
	cancelPending: false,
}

let status
try {
	const { chrome: options } = validateConfig(resolveConfig({ dryRun, chrome }))
	status = await new ChromeWebStoreV2(options).getStatus()
} catch (error) {
	fail(
		`Could not read the item's status: ${error.message}\nA failed token exchange means the key in CWS_SERVICE_ACCOUNT_JSON is wrong or deleted. A 401 or 403 means the service account is not added under Account in the developer dashboard, the Chrome Web Store API is not enabled in its Google Cloud project, or CWS_PUBLISHER_ID or CWS_EXTENSION_ID is wrong.`,
	)
}

const published = status.publishedItemRevisionStatus
const submitted = status.submittedItemRevisionStatus
console.log(`Published: ${describe(published)}`)
console.log(`Submitted: ${describe(submitted)}`)
console.log(`Last upload: ${status.lastAsyncUploadState ?? 'none'}`)
if (status.takenDown) console.log('::warning::The store has taken this item down.')

if (submitted?.state === 'PENDING_REVIEW') {
	fail(
		`Version ${versionsOf(submitted).join(', ') || '?'} is in review, and the store takes no new upload until that review ends. Wait for the review, or cancel it in the developer dashboard, then re-run this workflow.`,
	)
}
if (status.lastAsyncUploadState === 'IN_PROGRESS') {
	fail('The store is still processing an earlier upload. Re-run this workflow in a few minutes.')
}
const live = [published, submitted].filter((revision) =>
	['PUBLISHED', 'PUBLISHED_TO_TESTERS', 'STAGED'].includes(revision?.state),
)
if (live.some((revision) => versionsOf(revision).includes(version))) {
	fail(
		`The store already has version ${version}. Bump version in package.json and tag the new version.`,
	)
}

// submit() exits the process with code 1 on a failed upload or publish.
await submit({ dryRun, chrome })
