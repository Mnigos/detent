// Stands in for the IndexedDB vault (jsdom and Node have no IndexedDB): `vi.mock('./vault', ...)`.
export const vaultStore = new Map<string, unknown>()

export const vault = {
	get: async <T>(key: string) => structuredClone(vaultStore.get(key)) as T | undefined,
	set: async (key: string, value: unknown) => {
		vaultStore.set(key, structuredClone(value))
	},
	remove: async (key: string) => {
		vaultStore.delete(key)
	},
}
