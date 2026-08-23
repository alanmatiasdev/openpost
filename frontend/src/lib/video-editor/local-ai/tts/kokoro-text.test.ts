import { describe, expect, it } from 'vitest';
import { chunkTextForKokoro } from './kokoro-text';

describe('chunkTextForKokoro', () => {
	it('keeps sentence punctuation while respecting the model input limit', () => {
		const text = `${'First sentence. '.repeat(10)}${'second '.repeat(30)}`;
		const chunks = chunkTextForKokoro(text, 80);

		expect(chunks.length).toBeGreaterThan(2);
		expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
		expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
	});

	it('normalizes paragraph whitespace without emitting empty segments', () => {
		expect(chunkTextForKokoro('  Hello.\r\n\r\n\r\n World!  ')).toEqual(['Hello. World!']);
	});
});
