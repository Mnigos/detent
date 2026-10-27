import { useSyncExternalStore } from 'react'
import { currentFile, isLayerComplete, type PanelStore } from '@/src/lib/panel/store'
import { FileList } from './FileList'
import { LayerList } from './LayerList'
import { Toast } from './Toast'

const HINTS = 'j/k file · n/p layer · ⏎ scroll · v viewed · r raw · ` hide'
// GitHub composes its own sticky offset from these two variables; they inherit into the shadow root.
const TOP = 'calc(var(--base-sticky-header-height, 0px) + var(--observed-header-height, 60px))'

interface PanelProps {
	store: PanelStore
	onScrollToFile: () => void
	onToggleViewed: () => void
}

export function Panel({ store, onScrollToFile, onToggleViewed }: PanelProps) {
	const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
	const layer = state.layers[state.layerIndex]

	if (state.isCollapsed)
		return (
			<button
				type="button"
				onClick={() => store.dispatch({ type: 'toggle-collapsed' })}
				style={{ top: TOP }}
				className="fixed right-0 z-[9000] rounded-l-md border border-neutral-300 border-r-0 bg-white px-2 py-3 font-medium text-[10px] text-neutral-600 [writing-mode:vertical-rl] dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400"
			>
				detent {state.layerIndex + 1}/{state.layers.length}
			</button>
		)

	return (
		<aside
			style={{ top: TOP, height: `calc(100vh - ${TOP})` }}
			className="fixed right-0 z-[9000] flex w-80 flex-col border-neutral-300 border-l bg-white font-sans text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-100"
		>
			<header className="flex items-center gap-2 border-neutral-200 border-b px-3 py-2 dark:border-neutral-800">
				<span className="font-semibold text-sm tracking-tight">detent</span>
				<span className="text-neutral-500 text-xs tabular-nums">
					{state.layerIndex + 1} / {state.layers.length}
				</span>
				<button
					type="button"
					onClick={() => store.dispatch({ type: 'toggle-raw' })}
					aria-pressed={state.isRaw}
					className={`ml-auto rounded border px-2 py-0.5 text-[11px] ${
						state.isRaw
							? 'border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300'
							: 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400'
					}`}
				>
					Raw order
				</button>
				<button
					type="button"
					onClick={() => store.dispatch({ type: 'toggle-collapsed' })}
					aria-label="Collapse panel"
					className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
				>
					`
				</button>
			</header>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<LayerList
					layers={state.layers}
					layerIndex={state.layerIndex}
					viewed={state.viewed}
					isRaw={state.isRaw}
					isTrailingExpanded={state.isTrailingExpanded}
					onSelect={(layerIndex, fileIndex) =>
						store.dispatch({ type: 'select', layerIndex, fileIndex })
					}
					onToggleTrailing={() => store.dispatch({ type: 'toggle-trailing' })}
				/>
				{layer && (
					<div className="border-neutral-200 border-t pt-2 dark:border-neutral-800">
						<p className="px-4 pb-1 font-medium text-[10px] text-neutral-500 uppercase tracking-wide">
							{layer.name}
							{isLayerComplete(layer, state.viewed) ? ' · done' : ''}
						</p>
						<FileList
							files={layer.files}
							fileIndex={state.fileIndex}
							viewed={state.viewed}
							onSelect={(fileIndex) =>
								store.dispatch({ type: 'select', layerIndex: state.layerIndex, fileIndex })
							}
						/>
					</div>
				)}
			</div>

			<footer className="flex flex-col gap-1 border-neutral-200 border-t px-3 py-2 text-[10px] text-neutral-500 dark:border-neutral-800">
				<span>{state.status}</span>
				<span className="flex items-center gap-2">
					<button
						type="button"
						onClick={onScrollToFile}
						className="underline-offset-2 hover:underline"
					>
						Scroll to {currentFile(state)?.path.split('/').at(-1) ?? '—'}
					</button>
					<button
						type="button"
						onClick={onToggleViewed}
						className="underline-offset-2 hover:underline"
					>
						Toggle viewed
					</button>
				</span>
				<span>{HINTS}</span>
			</footer>

			{state.toast && <Toast text={state.toast} />}
		</aside>
	)
}
