export function Toast({ text }: { text: string }) {
	return (
		<div
			role="status"
			className="pointer-events-none absolute inset-x-3 bottom-16 rounded-md bg-neutral-900 px-3 py-2 text-neutral-50 text-xs shadow-lg dark:bg-neutral-50 dark:text-neutral-900"
		>
			{text}
		</div>
	)
}
