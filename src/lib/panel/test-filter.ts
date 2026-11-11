import type { PanelFile, PanelLayer, PanelState } from './store'

export const isTestFile = (file: PanelFile) => file.role === 'test'

/** The layers with their test files taken out; a layer left empty disappears. */
export function withoutTests(layers: PanelLayer[]): PanelLayer[] {
	if (!layers.some((layer) => layer.files.some(isTestFile))) return layers

	return layers.flatMap((layer) => {
		const files = layer.files.filter((file) => !isTestFile(file))

		return files.length > 0 ? [{ ...layer, files }] : []
	})
}

/** The test files the filter takes off the page; empty while tests are shown. */
export const hiddenTestPaths = (state: PanelState): ReadonlySet<string> =>
	new Set(
		state.isHidingTests
			? [...state.groupLayers, ...state.priorityLayers].flatMap((layer) =>
					layer.files.filter(isTestFile).map((file) => file.path),
				)
			: [],
	)

export const hiddenTestsHint = (count: number) =>
	`${count} test file${count === 1 ? '' : 's'} hidden`
