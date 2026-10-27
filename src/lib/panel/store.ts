import type { FileRole } from '../layers/roles'

export interface PanelFile {
	path: string
	role: FileRole
	additions: number
	deletions: number
	/** The model marked this file as one to read carefully. */
	isFocus?: boolean
}

export interface PanelLayer {
	id: string
	name: string
	summary: string
	files: PanelFile[]
	isTrailing: boolean
}

export interface PanelPosition {
	layerIndex: number
	fileIndex: number
	isRaw: boolean
	isCollapsed: boolean
}

export interface PanelState extends PanelPosition {
	layers: PanelLayer[]
	viewed: ReadonlySet<string>
	status: string
	/** A model request is in flight; the layers on screen are provisional. */
	isAnalyzing: boolean
	isTrailingExpanded: boolean
	toast?: string
}

export type PanelAction =
	| { type: 'next-file' }
	| { type: 'previous-file' }
	| { type: 'next-layer' }
	| { type: 'previous-layer' }
	| { type: 'select'; layerIndex: number; fileIndex: number }
	| { type: 'analyzing'; status: string }
	| { type: 'labels'; layers: PanelLayer[]; status: string }
	| { type: 'toggle-raw' }
	| { type: 'toggle-collapsed' }
	| { type: 'toggle-trailing' }
	/** `silent` marks a sync from page loading: the set updates, the position and page stay put. */
	| { type: 'viewed'; paths: ReadonlySet<string>; silent?: boolean }
	| { type: 'dismiss-toast' }

export const TOAST_MILLISECONDS = 2000

const readingOrder = (layers: PanelLayer[]) =>
	layers.flatMap((layer, layerIndex) =>
		layer.files.map((_file, fileIndex) => ({ layerIndex, fileIndex })),
	)

const positionOf = (order: { layerIndex: number; fileIndex: number }[], state: PanelState) =>
	order.findIndex(
		(entry) => entry.layerIndex === state.layerIndex && entry.fileIndex === state.fileIndex,
	)

const reachableOrder = (state: PanelState) =>
	readingOrder(state.layers).filter(
		({ layerIndex }) =>
			!state.layers[layerIndex]?.isTrailing ||
			state.isTrailingExpanded ||
			layerIndex === state.layerIndex,
	)

const clampPosition = (state: PanelState): PanelState => {
	const layerIndex = Math.min(Math.max(state.layerIndex, 0), Math.max(state.layers.length - 1, 0))
	const files = state.layers[layerIndex]?.files.length ?? 0

	return {
		...state,
		layerIndex,
		fileIndex: Math.min(Math.max(state.fileIndex, 0), Math.max(files - 1, 0)),
	}
}

export const currentFile = (state: PanelState): PanelFile | undefined =>
	state.layers[state.layerIndex]?.files[state.fileIndex]

export const isLayerComplete = (layer: PanelLayer | undefined, viewed: ReadonlySet<string>) =>
	layer !== undefined &&
	layer.files.length > 0 &&
	layer.files.every((file) => viewed.has(file.path))

export const viewedCount = (layer: PanelLayer, viewed: ReadonlySet<string>) =>
	layer.files.filter((file) => viewed.has(file.path)).length

function step(state: PanelState, delta: number): PanelState {
	const order = reachableOrder(state)
	const next = order[positionOf(order, state) + delta]

	return next ? { ...state, ...next } : state
}

function nextUnviewed(state: PanelState): PanelState {
	const order = reachableOrder(state)
	const from = positionOf(order, state)
	for (let offset = 1; offset <= order.length; offset += 1) {
		const entry = order[(from + offset) % order.length]
		const file = entry && state.layers[entry.layerIndex]?.files[entry.fileIndex]
		if (entry && file && !state.viewed.has(file.path)) return { ...state, ...entry }
	}

	return state
}

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
	left.size === right.size && [...left].every((value) => right.has(value))

function applyViewed(state: PanelState, paths: ReadonlySet<string>, silent = false): PanelState {
	if (sameSet(state.viewed, paths)) return state
	if (silent) return { ...state, viewed: paths }

	const layer = state.layers[state.layerIndex]
	const wasComplete = isLayerComplete(layer, state.viewed)
	const file = currentFile(state)
	const next = { ...state, viewed: paths }
	if (!wasComplete && isLayerComplete(layer, paths)) {
		// Land on the nearest file still unviewed: later layers first, then anything left behind.
		const order = readingOrder(state.layers)
		const unviewed = (entry: { layerIndex: number; fileIndex: number }) =>
			!paths.has(state.layers[entry.layerIndex]?.files[entry.fileIndex]?.path ?? '')
		const moved =
			order.filter((entry) => entry.layerIndex > state.layerIndex).find(unviewed) ??
			order.find(unviewed)
		const following = moved && state.layers[moved.layerIndex]
		const toast = following
			? `Layer ${state.layerIndex + 1} done. Next: ${following.name}`
			: `Layer ${state.layerIndex + 1} done. Every layer is reviewed.`

		return { ...next, ...moved, toast }
	}
	if (file && !state.viewed.has(file.path) && paths.has(file.path)) return nextUnviewed(next)

	return next
}

function relabel(state: PanelState, layers: PanelLayer[], status: string): PanelState {
	const path = currentFile(state)?.path
	const moved = readingOrder(layers).find(
		(entry) => layers[entry.layerIndex]?.files[entry.fileIndex]?.path === path,
	)

	return clampPosition({ ...state, ...moved, layers, status, isAnalyzing: false })
}

export function reducePanel(state: PanelState, action: PanelAction): PanelState {
	switch (action.type) {
		case 'next-file':
			return step(state, 1)
		case 'previous-file':
			return step(state, -1)
		case 'next-layer':
			return state.layers[state.layerIndex + 1]
				? { ...state, layerIndex: state.layerIndex + 1, fileIndex: 0 }
				: state
		case 'previous-layer':
			return state.layerIndex > 0
				? { ...state, layerIndex: state.layerIndex - 1, fileIndex: 0 }
				: state
		case 'select':
			return clampPosition({ ...state, layerIndex: action.layerIndex, fileIndex: action.fileIndex })
		case 'analyzing':
			return { ...state, status: action.status, isAnalyzing: true }
		case 'labels':
			return relabel(state, action.layers, action.status)
		case 'toggle-raw':
			return { ...state, isRaw: !state.isRaw }
		case 'toggle-collapsed':
			return { ...state, isCollapsed: !state.isCollapsed }
		case 'toggle-trailing':
			return { ...state, isTrailingExpanded: !state.isTrailingExpanded }
		case 'viewed':
			return applyViewed(state, action.paths, action.silent)
		case 'dismiss-toast':
			return state.toast === undefined ? state : { ...state, toast: undefined }
	}
}

export interface PanelStore {
	getSnapshot: () => PanelState
	subscribe: (listener: () => void) => () => void
	dispatch: (action: PanelAction) => void
}

export interface PanelStoreOptions {
	position?: Partial<PanelPosition>
	viewed?: ReadonlySet<string>
	status: string
	savePosition: (position: PanelPosition) => void
}

export function createPanelStore(layers: PanelLayer[], options: PanelStoreOptions): PanelStore {
	const { position, savePosition } = options
	let state = clampPosition({
		layers,
		layerIndex: position?.layerIndex ?? 0,
		fileIndex: position?.fileIndex ?? 0,
		isRaw: position?.isRaw === true,
		isCollapsed: position?.isCollapsed === true,
		viewed: options.viewed ?? new Set<string>(),
		status: options.status,
		isAnalyzing: false,
		isTrailingExpanded: false,
	})
	const listeners = new Set<() => void>()
	let toastTimer: ReturnType<typeof setTimeout> | undefined

	function dispatch(action: PanelAction) {
		const next = reducePanel(state, action)
		if (next === state) return

		const moved =
			next.layerIndex !== state.layerIndex ||
			next.fileIndex !== state.fileIndex ||
			next.isRaw !== state.isRaw ||
			next.isCollapsed !== state.isCollapsed
		const gainedToast = next.toast !== undefined && next.toast !== state.toast
		state = next
		for (const listener of listeners) listener()
		if (moved)
			savePosition({
				layerIndex: next.layerIndex,
				fileIndex: next.fileIndex,
				isRaw: next.isRaw,
				isCollapsed: next.isCollapsed,
			})
		if (!gainedToast) return

		clearTimeout(toastTimer)
		toastTimer = setTimeout(() => dispatch({ type: 'dismiss-toast' }), TOAST_MILLISECONDS)
	}

	return {
		getSnapshot: () => state,
		subscribe(listener) {
			listeners.add(listener)

			return () => {
				listeners.delete(listener)
			}
		},
		dispatch,
	}
}
