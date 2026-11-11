import { browser } from 'wxt/browser'
import type { PanelStore } from './store'

/**
 * The "Hide tests" view filter, remembered across pull requests. It has its own key: a change
 * to `settings` remounts detent and asks for the diff again, and this filter must not.
 */
export const HIDE_TESTS_KEY = 'hideTests'

export async function readHideTests(): Promise<boolean> {
	try {
		return (await browser.storage.local.get(HIDE_TESTS_KEY))[HIDE_TESTS_KEY] === true
	} catch {
		return false
	}
}

export const writeHideTests = (isHiding: boolean) =>
	browser.storage.local.set({ [HIDE_TESTS_KEY]: isHiding }).catch(() => undefined)

/** Flips the filter on this page at once and saves it for the next pull request. */
export function toggleHideTests(store: PanelStore) {
	const isHiding = !store.getSnapshot().isHidingTests
	store.dispatch({ type: 'hide-tests', isHiding })
	void writeHideTests(isHiding)
}

/** Another tab, or this one, saving the filter applies it here as well. */
export function followHideTests(store: PanelStore): () => void {
	const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
		if (area !== 'local' || !(HIDE_TESTS_KEY in changes)) return

		store.dispatch({ type: 'hide-tests', isHiding: changes[HIDE_TESTS_KEY]?.newValue === true })
	}
	browser.storage.onChanged.addListener(onChanged)

	return () => browser.storage.onChanged.removeListener(onChanged)
}
