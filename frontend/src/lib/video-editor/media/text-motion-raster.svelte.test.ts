import { describe, expect, it } from 'vitest';
import type { Project, TimelineItem } from '../project/types';
import { createTextMotionEffect } from '../timeline/text-motion-presets';
import { TimelineFrameRenderer } from './render-export';
import { renderTextItemRaster } from './text-raster';

const WIDTH = 320;
const HEIGHT = 120;

function textItem(): TimelineItem {
	return {
		id: 'text',
		trackId: 'visual',
		from: 0,
		durationInFrames: 60,
		label: 'OpenPost',
		text: 'OpenPost',
		type: 'text',
		fontSize: 52,
		fontWeight: 700,
		color: '#ffffff',
		transform: { width: WIDTH, height: HEIGHT },
		textMotion: { in: createTextMotionEffect('typewriter') }
	};
}

function brightness(data: Uint8ClampedArray): number {
	let total = 0;
	for (let index = 0; index < data.length; index += 4) {
		total += (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0);
	}
	return total;
}

function previewBrightness(item: TimelineItem, frame: number): number {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas2D is required for the text motion browser test.');
	renderTextItemRaster(context, item, WIDTH, HEIGHT, { absoluteFrame: frame });
	return brightness(context.getImageData(0, 0, WIDTH, HEIGHT).data);
}

function project(item: TimelineItem): Project {
	return {
		id: 'project',
		name: 'Text motion',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 2,
		metadata: { width: WIDTH, height: HEIGHT, fps: 30, backgroundColor: '#000000' },
		timeline: {
			items: [item],
			tracks: [
				{
					id: 'visual',
					name: 'Visual',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			transitions: []
		}
	};
}

describe('text motion raster', () => {
	it('reveals text by frame while leaving settled text unchanged', () => {
		const item = textItem();
		expect(previewBrightness(item, 0)).toBe(0);
		expect(previewBrightness(item, 4)).toBeGreaterThan(0);
		expect(previewBrightness(item, 30)).toBeGreaterThan(previewBrightness(item, 4));
	});

	it('uses the same frame-aware raster during export', async () => {
		const item = textItem();
		const renderer = new TimelineFrameRenderer(project(item));
		try {
			const hidden = await renderer.render(0);
			const hiddenContext = hidden.getContext('2d', { willReadFrequently: true });
			expect(hiddenContext).not.toBeNull();
			const hiddenBrightness = hiddenContext
				? brightness(hiddenContext.getImageData(0, 0, WIDTH, HEIGHT).data)
				: -1;
			const revealed = await renderer.render(30);
			const revealedContext = revealed.getContext('2d', { willReadFrequently: true });
			expect(revealedContext).not.toBeNull();
			const revealedBrightness = revealedContext
				? brightness(revealedContext.getImageData(0, 0, WIDTH, HEIGHT).data)
				: -1;
			expect(hiddenBrightness).toBe(0);
			expect(revealedBrightness).toBeGreaterThan(0);
		} finally {
			renderer.dispose();
		}
	});
});
