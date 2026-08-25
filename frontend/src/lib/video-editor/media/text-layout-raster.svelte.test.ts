import { describe, expect, it } from 'vitest';
import type { Project, TimelineItem } from '../project/types';
import { buildTextStylePresetTemplate } from '../typography/text-style-presets';
import { TimelineFrameRenderer } from './render-export';
import { renderTextItemRaster } from './text-raster';
import { expectCanvasRasterParity } from './canvas-parity.test-utils';

const WIDTH = 480;
const HEIGHT = 240;

function lowerThird(): TimelineItem {
	const template = buildTextStylePresetTemplate('lower-third', { width: WIDTH, height: HEIGHT });
	if (!template.label || template.text === undefined) {
		throw new Error('The lower-third template must provide timeline copy.');
	}
	return {
		id: 'text',
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		type: 'text',
		transform: { width: WIDTH, height: HEIGHT },
		...template,
		label: template.label,
		text: template.text
	};
}

function project(item: TimelineItem): Project {
	return {
		id: 'project',
		name: 'Text layout',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 3,
		metadata: { width: WIDTH, height: HEIGHT, fps: 30, backgroundColor: '#000000' },
		timeline: {
			items: [item],
			tracks: [
				{
					id: 'visual',
					name: 'Visual',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			]
		}
	};
}

function pixelData(canvas: HTMLCanvasElement | OffscreenCanvas): Uint8ClampedArray {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas2D is required for text layout validation.');
	return context.getImageData(0, 0, WIDTH, HEIGHT).data;
}

describe('structured text raster', () => {
	it('keeps mixed span styles aligned in preview and export', async () => {
		const item = lowerThird();
		const preview = document.createElement('canvas');
		preview.width = WIDTH;
		preview.height = HEIGHT;
		const previewContext = preview.getContext('2d', { willReadFrequently: true });
		if (!previewContext) throw new Error('Canvas2D is required for text layout validation.');
		renderTextItemRaster(previewContext, item, WIDTH, HEIGHT, { absoluteFrame: 0 });
		previewContext.save();
		previewContext.globalCompositeOperation = 'destination-over';
		previewContext.fillStyle = '#000000';
		previewContext.fillRect(0, 0, WIDTH, HEIGHT);
		previewContext.restore();

		const renderer = new TimelineFrameRenderer(project(item));
		try {
			const exported = await renderer.render(0);
			expectCanvasRasterParity(pixelData(exported), pixelData(preview));
		} finally {
			renderer.dispose();
		}

		const data = pixelData(preview);
		let lightPixels = 0;
		let slatePixels = 0;
		for (let index = 0; index < data.length; index += 4) {
			const red = data[index] ?? 0;
			const green = data[index + 1] ?? 0;
			const blue = data[index + 2] ?? 0;
			if (red > 220 && green > 220 && blue > 220) lightPixels += 1;
			if (red > 130 && blue > red && green > red) slatePixels += 1;
		}
		expect(lightPixels).toBeGreaterThan(40);
		expect(slatePixels).toBeGreaterThan(20);
	});
});
