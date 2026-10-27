import type { PanelFile } from '@/src/lib/panel/store'

const ROLE_BADGE: Record<string, string> = {
	contract: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
	server: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
	ui: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
	test: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

interface FileListProps {
	files: PanelFile[]
	fileIndex: number
	viewed: ReadonlySet<string>
	onSelect: (fileIndex: number) => void
}

export function FileList({ files, fileIndex, viewed, onSelect }: FileListProps) {
	return (
		<ul className="flex flex-col gap-px px-2 pb-2">
			{files.map((file, index) => {
				const separator = file.path.lastIndexOf('/') + 1
				const isCurrent = index === fileIndex
				const isViewed = viewed.has(file.path)

				return (
					<li key={file.path}>
						<button
							type="button"
							onClick={() => onSelect(index)}
							aria-current={isCurrent}
							className={`flex w-full flex-col gap-1 rounded px-2 py-1.5 text-left ${
								isCurrent
									? 'bg-neutral-200/80 dark:bg-neutral-800'
									: 'hover:bg-neutral-200/50 dark:hover:bg-neutral-800/60'
							} ${isViewed ? 'opacity-55' : ''}`}
						>
							<span
								className="truncate text-xs"
								title={file.isFocus ? `${file.path}\nWorth a careful read` : file.path}
							>
								{file.isFocus ? (
									<span
										className="mr-1.5 text-[9px] text-blue-500"
										role="img"
										aria-label="Worth a careful read"
									>
										●
									</span>
								) : null}
								<span className="text-neutral-500 dark:text-neutral-500">
									{file.path.slice(0, separator)}
								</span>
								<span className="text-neutral-900 dark:text-neutral-100">
									{file.path.slice(separator)}
								</span>
							</span>
							<span className="flex items-center gap-2 text-[10px]">
								<span
									className={`rounded px-1 py-px font-medium ${
										ROLE_BADGE[file.role] ??
										'bg-neutral-500/15 text-neutral-600 dark:text-neutral-400'
									}`}
								>
									{file.role}
								</span>
								<span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
								<span className="text-rose-600 dark:text-rose-400">−{file.deletions}</span>
								{isViewed && (
									<span className="ml-auto text-neutral-500 dark:text-neutral-400">viewed</span>
								)}
							</span>
						</button>
					</li>
				)
			})}
		</ul>
	)
}
