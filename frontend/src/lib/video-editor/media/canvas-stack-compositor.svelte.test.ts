import { describe, expect, it } from 'vitest';
import { ALL_BLEND_MODES, type BlendMode } from '../effects/gpu/blend-modes';
import { blendImageData } from '../effects/gpu/cpu-blend';
import { createGpuCompositor } from '../effects/gpu/compositor';
import type { TimelineItem } from '../project/types';
import { CanvasStackCompositor } from './canvas-stack-compositor';

function solid(color: string, width = 4, height = 4): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	context.fillStyle = color;
	context.fillRect(0, 0, width, height);
	return canvas;
}

function layer(blendMode: BlendMode, opacity = 1): TimelineItem {
	return {
		id: 'layer',
		trackId: 'top',
		from: 0,
		durationInFrames: 30,
		label: 'Layer',
		type: 'image',
		blendMode,
		transform: { width: 4, height: 4, opacity }
	};
}

function pixel(canvas: HTMLCanvasElement): number[] {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return Array.from(context.getImageData(2, 2, 1, 1).data);
}

function webglPixel(canvas: HTMLCanvasElement): number[] {
	const context = canvas.getContext('webgl2');
	if (!context) throw new Error('WebGL2 unavailable');
	const result = new Uint8Array(4);
	context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, result);
	return Array.from(result);
}

function displayedPixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
	const copy = document.createElement('canvas');
	copy.width = canvas.width;
	copy.height = canvas.height;
	const context = copy.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	context.drawImage(canvas, 0, 0);
	return context.getImageData(0, 0, copy.width, copy.height).data;
}

describe('CanvasStackCompositor', () => {
	it.each([
		{ mode: 'multiply' as const, expected: [64, 64, 64, 255] },
		{ mode: 'screen' as const, expected: [192, 192, 192, 255] }
	])('blends $mode against the finished frame below', ({ mode, expected }) => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(4, 4, '#808080');
		const source = solid('#808080');

		stack.compositeLayer({ source, width: 4, height: 4 }, layer(mode), 1, 0);

		expect(pixel(output).map((value) => Math.round(value))).toEqual(expected);
		expect(stack.failureReason()).toBeNull();
		stack.dispose();
	});

	it('includes transformed layer opacity in the GPU blend', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(4, 4, '#808080');
		const source = solid('#000000');

		stack.compositeLayer({ source, width: 4, height: 4 }, layer('multiply', 0.5), 0.5, 0);

		const [red, green, blue, alpha] = pixel(output);
		expect(red).toBeGreaterThanOrEqual(62);
		expect(red).toBeLessThanOrEqual(66);
		expect(green).toBe(red);
		expect(blue).toBe(red);
		expect(alpha).toBe(255);
		stack.dispose();
	});

	it('runs clip GPU effects before blending the transformed layer', () => {
		const output = document.createElement('canvas');
		const stack = new CanvasStackCompositor(output);
		stack.beginFrame(4, 4, '#808080');
		const source = solid('#ff0000');
		const item = layer('multiply');
		item.effects = [
			{ id: 'invert', type: 'gpu', effectId: 'gpu-invert', enabled: true, params: {} }
		];

		stack.compositeLayer({ source, width: 4, height: 4 }, item, 1, 0);

		const [red, green, blue, alpha] = pixel(output);
		expect(red).toBeLessThanOrEqual(2);
		expect(green).toBeGreaterThanOrEqual(126);
		expect(blue).toBeGreaterThanOrEqual(126);
		expect(alpha).toBe(255);
		stack.dispose();
	});

	it.each(ALL_BLEND_MODES)('keeps the exact CPU fallback aligned with GPU %s', (mode) => {
		const base = solid('rgb(80 140 200)', 1, 1);
		const layerCanvas = solid('rgb(220 60 130 / 60%)', 1, 1);
		const baseContext = base.getContext('2d', { willReadFrequently: true });
		const layerContext = layerCanvas.getContext('2d', { willReadFrequently: true });
		expect(baseContext).not.toBeNull();
		expect(layerContext).not.toBeNull();
		if (!baseContext || !layerContext) return;
		const cpu = blendImageData(
			baseContext.getImageData(0, 0, 1, 1),
			layerContext.getImageData(0, 0, 1, 1),
			mode,
			0.6
		);

		const output = document.createElement('canvas');
		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		expect(
			compositor.render(layerCanvas, 1, 1, [], {
				backdrop: base,
				blendMode: mode,
				dissolveAlpha: 0.6
			}),
			compositor.failureReason() ?? undefined
		).toBe(true);
		const gpu = webglPixel(output);
		for (let channel = 0; channel < 4; channel++) {
			expect(Math.abs((cpu.data[channel] ?? 0) - (gpu[channel] ?? 0))).toBeLessThanOrEqual(2);
		}
		compositor.dispose();
	});

	it('keeps the full dissolve pattern aligned between CPU and GPU', () => {
		const base = solid('rgb(80 140 200)');
		const layerCanvas = solid('rgb(220 60 130 / 60%)');
		const baseContext = base.getContext('2d', { willReadFrequently: true });
		const layerContext = layerCanvas.getContext('2d', { willReadFrequently: true });
		expect(baseContext).not.toBeNull();
		expect(layerContext).not.toBeNull();
		if (!baseContext || !layerContext) return;
		const cpu = blendImageData(
			baseContext.getImageData(0, 0, 4, 4),
			layerContext.getImageData(0, 0, 4, 4),
			'dissolve',
			0.6
		);

		const output = document.createElement('canvas');
		const compositor = createGpuCompositor(output);
		expect(compositor).not.toBeNull();
		if (!compositor) return;
		expect(
			compositor.render(layerCanvas, 4, 4, [], {
				backdrop: base,
				blendMode: 'dissolve',
				dissolveAlpha: 0.6
			}),
			compositor.failureReason() ?? undefined
		).toBe(true);
		const gpu = displayedPixels(output);
		const mask = (pixels: Uint8ClampedArray) =>
			Array.from({ length: 16 }, (_, index) => ((pixels[index * 4] ?? 0) > 100 ? '1' : '0')).join(
				''
			);
		expect(mask(gpu)).toBe(mask(cpu.data));
		for (let channel = 0; channel < cpu.data.length; channel++) {
			expect(Math.abs((cpu.data[channel] ?? 0) - (gpu[channel] ?? 0))).toBeLessThanOrEqual(2);
		}
		compositor.dispose();
	});
});
