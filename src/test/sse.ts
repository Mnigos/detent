/** An SSE body from events, cut into chunks that split lines and events where they fall. */
export function sseBody(events: object[], chunkSize = 17): ReadableStream<Uint8Array> {
	const text = events.map((event) => `event: x\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('')
	const bytes = new TextEncoder().encode(text)

	return new ReadableStream({
		start(controller) {
			for (let start = 0; start < bytes.length; start += chunkSize)
				controller.enqueue(bytes.slice(start, start + chunkSize))
			controller.close()
		},
	})
}

export const completedEvents = (answer: string) => [
	{ type: 'response.created', response: { status: 'in_progress' } },
	...(answer.match(/.{1,7}/gs) ?? []).map((delta) => ({
		type: 'response.output_text.delta',
		delta,
	})),
	{ type: 'response.completed', response: { status: 'completed' } },
]
