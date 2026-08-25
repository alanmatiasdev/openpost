import { afterEach, describe, expect, it } from 'vitest';
import { scopeSamples } from './scope-samples.svelte';

afterEach(() => scopeSamples.clear('clip'));

describe('scope samples', () => {
	it('keeps canvas samples on the GPU path until a CPU consumer asks for pixels', () => {
		const canvas = new OffscreenCanvas(2, 1);
		const context = canvas.getContext('2d');
		expect(context).not.toBeNull();
		if (!context) return;
		context.fillStyle = '#ff0000';
		context.fillRect(0, 0, 1, 1);
		context.fillStyle = '#0000ff';
		context.fillRect(1, 0, 1, 1);

		scopeSamples.publishCanvas('clip', canvas);
		const sample = scopeSamples.current;
		expect(sample?.source).toBe(canvas);
		expect(sample?.image).toBeNull();
		if (!sample) return;

		const image = scopeSamples.readImage(sample);
		expect(Array.from(image?.data ?? [])).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
		expect(scopeSamples.readImage(sample)).toBe(image);
	});
});
