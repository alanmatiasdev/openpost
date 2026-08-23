/** Shared preview/export compositor for transformed layers and real backdrops. */

import type { TimelineItem } from '../project/types';
import { effectsToCssFilter } from '../effects/filter';
import {
	createGpuCompositor,
	type GpuCompositor,
	type GpuRenderEffect
} from '../effects/gpu/compositor';
import { getGpuEffectDefaultParams } from '../effects/gpu/registry';
import { isNonNormalBlend } from '../effects/gpu/blend-modes';
import { blendImageData } from '../effects/gpu/cpu-blend';
import { mediaDrawGeometry } from './render-geometry';

type StackCanvas = HTMLCanvasElement | OffscreenCanvas;
type StackContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
interface RoundedPathContext {
	roundRect?: (x: number, y: number, width: number, height: number, radius: number) => void;
	rect: (x: number, y: number, width: number, height: number) => void;
}

export interface StackLayerSource {
	source: CanvasImageSource & TexImageSource;
	width: number;
	height: number;
}

export function itemOpacity(item: TimelineItem): number {
	return Math.min(1, Math.max(0, item.transform?.opacity ?? 1));
}

export function drawTransformedLayer(
	context: StackContext,
	image: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	item: TimelineItem,
	canvasWidth: number,
	canvasHeight: number,
	alpha: number
): void {
	const transform = item.transform ?? {};
	const geometry = mediaDrawGeometry(item, sourceWidth, sourceHeight, canvasWidth, canvasHeight);
	context.save();
	context.globalAlpha = Math.min(1, Math.max(0, alpha));
	context.filter = effectsToCssFilter(item.effects) || 'none';
	context.translate(geometry.centerX, geometry.centerY);
	context.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
	context.scale(
		transform.flipHorizontal === true ? -1 : 1,
		transform.flipVertical === true ? -1 : 1
	);
	const cornerRadius = Math.min(
		Math.max(0, transform.cornerRadius ?? 0),
		geometry.drawWidth / 2,
		geometry.drawHeight / 2
	);
	if (cornerRadius > 0) {
		context.beginPath();
		const pathContext: RoundedPathContext = context;
		if (pathContext.roundRect) {
			pathContext.roundRect(
				-geometry.anchorX,
				-geometry.anchorY,
				geometry.drawWidth,
				geometry.drawHeight,
				cornerRadius
			);
		} else {
			pathContext.rect(
				-geometry.anchorX,
				-geometry.anchorY,
				geometry.drawWidth,
				geometry.drawHeight
			);
		}
		context.clip();
	}
	context.drawImage(
		image,
		geometry.sourceX,
		geometry.sourceY,
		geometry.sourceWidth,
		geometry.sourceHeight,
		-geometry.anchorX,
		-geometry.anchorY,
		geometry.drawWidth,
		geometry.drawHeight
	);
	context.restore();
}

/** One persistent canvas stack with a single reusable WebGL2 compositor. */
export class CanvasStackCompositor {
	private readonly context: StackContext;
	private readonly layerCanvas: StackCanvas;
	private readonly layerContext: StackContext;
	private readonly gpuCanvas: StackCanvas;
	private readonly gpuCompositor: GpuCompositor | null;
	private width = 1;
	private height = 1;
	private lastFailure: string | null = null;

	constructor(private readonly canvas: StackCanvas) {
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Failed to create the composition canvas context.');
		this.context = context;
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';
		this.layerCanvas =
			typeof OffscreenCanvas === 'function'
				? new OffscreenCanvas(1, 1)
				: document.createElement('canvas');
		const layerContext = this.layerCanvas.getContext('2d');
		if (!layerContext) throw new Error('Failed to create the layer canvas context.');
		this.layerContext = layerContext;
		this.layerContext.imageSmoothingEnabled = true;
		this.layerContext.imageSmoothingQuality = 'high';
		this.gpuCanvas =
			typeof OffscreenCanvas === 'function'
				? new OffscreenCanvas(1, 1)
				: document.createElement('canvas');
		this.gpuCompositor = createGpuCompositor(this.gpuCanvas);
	}

	beginFrame(width: number, height: number, backgroundColor: string): void {
		this.width = Math.max(1, Math.round(width));
		this.height = Math.max(1, Math.round(height));
		if (this.canvas.width !== this.width) this.canvas.width = this.width;
		if (this.canvas.height !== this.height) this.canvas.height = this.height;
		if (this.layerCanvas.width !== this.width) this.layerCanvas.width = this.width;
		if (this.layerCanvas.height !== this.height) this.layerCanvas.height = this.height;
		this.context.imageSmoothingEnabled = true;
		this.context.imageSmoothingQuality = 'high';
		this.layerContext.imageSmoothingEnabled = true;
		this.layerContext.imageSmoothingQuality = 'high';
		this.context.globalAlpha = 1;
		this.context.globalCompositeOperation = 'source-over';
		this.context.filter = 'none';
		this.context.fillStyle = backgroundColor;
		this.context.fillRect(0, 0, this.width, this.height);
		this.lastFailure = null;
	}

	private gpuEffects(item: TimelineItem): GpuRenderEffect[] {
		return (item.effects ?? []).flatMap((effect) =>
			effect.type === 'gpu' && effect.enabled
				? [
						{
							effectId: effect.effectId,
							params: {
								...getGpuEffectDefaultParams(effect.effectId),
								...effect.params
							}
						}
					]
				: []
		);
	}

	private renderGpuEffects(
		source: StackLayerSource,
		item: TimelineItem,
		time: number
	): CanvasImageSource {
		const effects = this.gpuEffects(item);
		if (effects.length === 0 || !this.gpuCompositor) return source.source;
		const rendered = this.gpuCompositor.render(
			source.source,
			source.width,
			source.height,
			effects,
			{ time }
		);
		if (!rendered) {
			this.lastFailure = this.gpuCompositor.failureReason();
			return source.source;
		}
		return this.gpuCanvas;
	}

	compositeLayer(source: StackLayerSource, item: TimelineItem, alpha: number, time: number): void {
		const processed = this.renderGpuEffects(source, item, time);
		const blendMode = item.blendMode ?? 'normal';
		if (!isNonNormalBlend(blendMode)) {
			drawTransformedLayer(
				this.context,
				processed,
				source.width,
				source.height,
				item,
				this.width,
				this.height,
				alpha
			);
			return;
		}

		this.layerContext.globalAlpha = 1;
		this.layerContext.globalCompositeOperation = 'source-over';
		this.layerContext.filter = 'none';
		this.layerContext.clearRect(0, 0, this.width, this.height);
		drawTransformedLayer(
			this.layerContext,
			processed,
			source.width,
			source.height,
			item,
			this.width,
			this.height,
			alpha
		);

		if (
			this.gpuCompositor?.render(this.layerCanvas, this.width, this.height, [], {
				time,
				blendMode,
				backdrop: this.canvas,
				dissolveAlpha: alpha
			})
		) {
			this.context.globalAlpha = 1;
			this.context.globalCompositeOperation = 'copy';
			this.context.filter = 'none';
			this.context.drawImage(this.gpuCanvas, 0, 0);
			this.context.globalCompositeOperation = 'source-over';
			return;
		}

		this.lastFailure = this.gpuCompositor?.failureReason() ?? 'WebGL2 unavailable';
		const basePixels = this.context.getImageData(0, 0, this.width, this.height);
		const layerPixels = this.layerContext.getImageData(0, 0, this.width, this.height);
		this.context.putImageData(blendImageData(basePixels, layerPixels, blendMode, alpha), 0, 0);
	}

	failureReason(): string | null {
		return this.lastFailure;
	}

	dispose(): void {
		this.gpuCompositor?.dispose();
	}
}
