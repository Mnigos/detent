// ChatGPT credentials live in the extension origin's IndexedDB, not in chrome.storage: content scripts
// on github.com can read chrome.storage.local (detent's own read its settings there), but they run on
// the page's origin and never reach this database. Only the service worker opens it.
const DATABASE = 'detent-chatgpt'
const STORE = 'vault'

let opening: Promise<IDBDatabase> | undefined

function open(): Promise<IDBDatabase> {
	opening ??= new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1)
		request.onupgradeneeded = () => request.result.createObjectStore(STORE)
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	}).catch((error: unknown) => {
		opening = undefined
		throw error
	})

	return opening
}

async function run<T>(
	mode: IDBTransactionMode,
	operation: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
	const database = await open()

	return new Promise<T>((resolve, reject) => {
		const transaction = database.transaction(STORE, mode)
		const request = operation(transaction.objectStore(STORE))
		transaction.oncomplete = () => resolve(request.result as T)
		transaction.onerror = () => reject(transaction.error)
		transaction.onabort = () => reject(transaction.error)
	})
}

export const vault = {
	get: <T>(key: string) => run<T | undefined>('readonly', (store) => store.get(key)),
	set: (key: string, value: unknown) =>
		run<unknown>('readwrite', (store) => store.put(value, key)).then(() => undefined),
	remove: (key: string) =>
		run<unknown>('readwrite', (store) => store.delete(key)).then(() => undefined),
}
