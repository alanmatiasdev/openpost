import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicationRoute = readFileSync(
	new URL('./publications/[id]/+page.svelte', import.meta.url),
	'utf8'
);

describe('composer deletion navigation completion', () => {
	it('waits for Publication navigation before the composer resolves focus', () => {
		expect(publicationRoute).toContain("await goto(resolve('/'))");
		expect(publicationRoute).toContain('onDeleted={handleSuccess}');
	});
});
