import { describe, expect, it } from 'vitest';
import { createGpuCompositor } from './compositor';
import { getGpuEffectDefaultParams } from './registry';

function sourceFrame(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	const gradient = context.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, '#101020');
	gradient.addColorStop(0.5, '#f06435');
	gradient.addColorStop(1, '#f8f4e8');
	context.fillStyle = gradient;
	context.fillRect(0, 0, width, height);
	context.fillStyle = '#45c6a8';
	context.fillRect(width / 4, height / 4, width / 2, height / 2);
	return canvas;
}

function pixels(canvas: HTMLCanvasElement): Uint8Array {
	const gl = canvas.getContext('webgl2');
	if (!gl) throw new Error('WebGL2 unavailable');
	const data = new Uint8Array(canvas.width * canvas.height * 4);
	gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
	return data;
}

describe('special GPU effects in Chromium', () => {
	it.each(['gpu-ascii', 'gpu-halftone'])('compiles and renders %s through WebGL2', (effectId) => {
		const width = 96;
		const height = 64;
		const source = sourceFrame(width, height);
		const output = document.createElement('canvas');
		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;

		const rendered = compositor.render(source, width, height, [
			{ effectId, params: getGpuEffectDefaultParams(effectId) }
		]);
		expect(rendered, compositor.failureReason() ?? undefined).toBe(true);
		const data = pixels(output);
		const opaquePixels = Array.from(
			{ length: width * height },
			(_, index) => data[index * 4 + 3]
		).filter((alpha) => (alpha ?? 0) > 0).length;
		const colors = new Set(
			Array.from(
				{ length: width * height },
				(_, index) =>
					`${data[index * 4]},${data[index * 4 + 1]},${data[index * 4 + 2]},${data[index * 4 + 3]}`
			)
		);
		expect(opaquePixels).toBeGreaterThan(width * height * 0.8);
		expect(colors.size).toBeGreaterThan(4);
		compositor.dispose();
	});

	it('rebuilds the ASCII atlas for custom glyphs and font changes', () => {
		const definition = getGpuEffectDefaultParams('gpu-ascii');
		const output = document.createElement('canvas');
		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		const source = sourceFrame(96, 64);
		const firstRendered = compositor.render(source, 96, 64, [
			{
				effectId: 'gpu-ascii',
				params: { ...definition, charSet: 'custom', customChars: 'OPEN', font: 'courier' }
			}
		]);
		expect(firstRendered, compositor.failureReason() ?? undefined).toBe(true);
		const first = pixels(output);
		const secondRendered = compositor.render(source, 96, 64, [
			{
				effectId: 'gpu-ascii',
				params: { ...definition, charSet: 'custom', customChars: '01', font: 'monospace' }
			}
		]);
		expect(secondRendered, compositor.failureReason() ?? undefined).toBe(true);
		const second = pixels(output);
		expect(second).not.toEqual(first);
		compositor.dispose();
	});
});
