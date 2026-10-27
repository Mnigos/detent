import { readFileSync } from 'node:fs'

export function loadFixture(name: string): string {
	return readFileSync(new URL(`../../fixtures/${name}.diff`, import.meta.url), 'utf8')
}
