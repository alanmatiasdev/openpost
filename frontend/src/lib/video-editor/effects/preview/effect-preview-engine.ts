/**
 * Live effect previews rendered by the same WebGL2 compositor as playback and export.
 * Ported from FreeCut's effect-thumbnail engine and adapted to OpenPost's registry.
 */

import { createGpuCompositor, type GpuCompositor } from '../gpu/compositor';
import { getGpuEffect } from '../gpu/registry';
import { normalizeGpuParam, type GpuParamValues, type GpuShaderDefinition } from '../gpu/types';
import { effectUnit, type CssFilterType } from '../types';

export const EFFECT_PREVIEW_WIDTH = 160;
export const EFFECT_PREVIEW_HEIGHT = 90;

const SAMPLE_URL = new URL('./effect-preview-sample.svg', import.meta.url).href;

interface PreviewPipeline {
	canvas: HTMLCanvasElement | OffscreenCanvas;
	compositor: GpuCompositor;
}

let pipeline: PreviewPipeline | null = null;
let pipelinePromise: Promise<PreviewPipeline | null> | null = null;
let samplePromise: Promise<HTMLCanvasElement | OffscreenCanvas | null> | null = null;

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas | null {
	return createHtmlCanvas(width, height) ?? createOffscreenCanvas(width, height);
}

function createHtmlCanvas(width: number, height: number): HTMLCanvasElement | null {
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function createOffscreenCanvas(width: number, height: number): OffscreenCanvas | null {
	return typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(width, height);
}

export function ensureEffectPreviewPipeline(): Promise<PreviewPipeline | null> {
	if (pipelinePromise) return pipelinePromise;
	pipelinePromise = Promise.resolve().then(() => {
		const candidates = [
			createHtmlCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT),
			createOffscreenCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT)
		];
		for (const canvas of candidates) {
			if (!canvas) continue;
			const compositor = createGpuCompositor(canvas);
			if (!compositor) continue;
			pipeline = { canvas, compositor };
			return pipeline;
		}
		return null;
	});
	return pipelinePromise;
}

function getReadyEffectPreviewPipeline(): PreviewPipeline | null {
	return pipeline;
}

/** Decode the bundled frame once. Every preview draws from this same source. */
export function getEffectPreviewSample(): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
	if (samplePromise) return samplePromise;
	samplePromise = new Promise((resolve) => {
		const canvas = createCanvas(EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
		// eslint-disable-next-line anti-slop/no-runtime-typeof -- this is the SSR boundary for the browser Image API.
		if (!canvas || typeof Image === 'undefined') {
			resolve(null);
			return;
		}
		const context = canvas.getContext('2d');
		if (!context) {
			resolve(null);
			return;
		}
		const image = new Image();
		image.onload = () => {
			context.drawImage(image, 0, 0, EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT);
			resolve(canvas);
		};
		image.onerror = () => resolve(null);
		image.src = SAMPLE_URL;
	});
	return samplePromise;
}

/** Push neutral defaults toward a useful poster value without leaving the declared range. */
export function getShowcaseParams(definition: GpuShaderDefinition): GpuParamValues {
	return Object.fromEntries(
		definition.schema.map((param) => {
			if (!param.type || param.type === 'number') {
				const value =
					param.default === param.min
						? param.min + (param.max - param.min) * 0.3
						: param.default === param.max
							? param.default
							: param.default + (param.max - param.default) * 0.3;
				return [param.name, value];
			}
			return [param.name, param.default];
		})
	);
}

/** Blend from registry defaults to the poster target. Non-numeric choices use the target. */
export function blendGpuPreviewParams(
	effectId: string,
	target: GpuParamValues,
	strength: number
): GpuParamValues {
	const definition = getGpuEffect(effectId);
	if (!definition) return target;
	return Object.fromEntries(
		definition.schema.map((param) => {
			if (!param.type || param.type === 'number') {
				const goal = Number(normalizeGpuParam(param, target[param.name] ?? param.default));
				return [param.name, param.default + (goal - param.default) * strength];
			}
			return [param.name, target[param.name] ?? param.default];
		})
	);
}

export function cssPreviewFilter(type: CssFilterType, amount: number, strength = 1): string {
	const neutral = type === 'brightness' || type === 'contrast' || type === 'saturation' ? 1 : 0;
	const blended = neutral + (amount - neutral) * strength;
	return `${type}(${blended}${effectUnit(type)})`;
}

export function renderGpuEffectPreview(
	sample: TexImageSource,
	effectId: string,
	target: GpuParamValues,
	strength: number
): (HTMLCanvasElement | OffscreenCanvas) | null {
	const ready = getReadyEffectPreviewPipeline();
	if (!ready) return null;
	const rendered = ready.compositor.render(sample, EFFECT_PREVIEW_WIDTH, EFFECT_PREVIEW_HEIGHT, [
		{ effectId, params: blendGpuPreviewParams(effectId, target, strength) }
	]);
	return rendered ? ready.canvas : null;
}

export function prewarmEffectPreviews(): void {
	void ensureEffectPreviewPipeline();
	void getEffectPreviewSample();
}
