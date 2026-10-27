import { isLayerComplete, type PanelLayer, viewedCount } from '@/src/lib/panel/store'
import { FileList } from './FileList'

interface LayerListProps {
	layers: PanelLayer[]
	layerIndex: number
	viewed: ReadonlySet<string>
	isRaw: boolean
	isTrailingExpanded: boolean
	onSelect: (layerIndex: number, fileIndex: number) => void
	onToggleTrailing: () => void
}

export function LayerList({
	layers,
	layerIndex,
	viewed,
	isRaw,
	isTrailingExpanded,
	onSelect,
	onToggleTrailing,
}: LayerListProps) {
	return (
		<ol className="flex flex-col gap-px px-2 py-2">
			{layers.map((layer, index) => {
				const isCurrent = !isRaw && index === layerIndex
				const seen = viewedCount(layer, viewed)

				return (
					<li key={layer.id}>
						<div
							className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left ${
								isCurrent
									? 'bg-neutral-200/80 dark:bg-neutral-800'
									: 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60'
							}`}
						>
							<button
								type="button"
								onClick={() => onSelect(index, 0)}
								aria-current={isCurrent}
								className="flex min-w-0 flex-1 items-start gap-2 text-left"
							>
								<span className="w-4 shrink-0 pt-px text-[10px] text-neutral-500 tabular-nums">
									{isLayerComplete(layer, viewed) ? '✓' : index + 1}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium text-neutral-900 text-xs dark:text-neutral-100">
										{layer.name}
									</span>
									{layer.summary && !layer.isTrailing && (
										<span className="line-clamp-2 text-[11px] text-neutral-600 leading-snug dark:text-neutral-400">
											{layer.summary}
										</span>
									)}
									<span className="mt-0.5 block text-[10px] text-neutral-500 tabular-nums">
										{layer.files.length} files
										{layer.isTrailing ? '' : ` · ${seen}/${layer.files.length}`}
									</span>
								</span>
							</button>
							{layer.isTrailing && (
								<button
									type="button"
									onClick={onToggleTrailing}
									aria-expanded={isTrailingExpanded}
									aria-label={isTrailingExpanded ? 'Collapse layer' : 'Expand layer'}
									className="shrink-0 px-1 text-neutral-500 text-xs"
								>
									{isTrailingExpanded ? '▾' : '▸'}
								</button>
							)}
						</div>
						{layer.isTrailing && isTrailingExpanded && (
							<FileList
								files={layer.files}
								fileIndex={-1}
								viewed={viewed}
								onSelect={(fileIndex) => onSelect(index, fileIndex)}
							/>
						)}
					</li>
				)
			})}
		</ol>
	)
}
