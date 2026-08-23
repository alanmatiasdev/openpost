import { describe, expect, it } from 'vitest';
import type { Project, TimelineItem } from '../project/types';
import { TimelineFrameRenderer } from './render-export';
import { renderSubtitleRaster } from './text-raster';

const WIDTH = 480;
const HEIGHT = 180;

function subtitleItem(): TimelineItem {
	return {
		id: 'subtitle',
		trackId: 'captions',
		from: 0,
		durationInFrames: 90,
		label: 'Captions',
		type: 'subtitle',
		fontFamily: 'Inter',
		fontSize: 42,
		fontWeight: 600,
		color: '#ffffff',
		textAlign: 'center',
		verticalAlign: 'middle',
		lineHeight: 1.15,
		paddingX: 12,
		paddingY: 12,
		backgroundColor: 'rgba(0, 0, 0, 0.55)',
		backgroundFit: 'content',
		borderRadius: 4,
		transform: { width: WIDTH, height: HEIGHT },
		cues: [
			{
				id: 'cue',
				startFrame: 0,
				endFrame: 90,
				text: '{\\an8}<b>Hello</b> <font color="#ffd400"><u>world</u></font>'
			}
		]
	};
}

function project(item: TimelineItem): Project {
	return {
		id: 'project',
		name: 'Styled captions',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 3,
		metadata: {
			width: WIDTH,
			height: HEIGHT,
			fps: 30,
			backgroundColor: '#000000'
		},
		timeline: {
			items: [item],
			tracks: [
				{
					id: 'captions',
					name: 'Captions',
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

function pixels(canvas: HTMLCanvasElement | OffscreenCanvas): Uint8ClampedArray {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas2D is required for subtitle validation.');
	return context.getImageData(0, 0, WIDTH, HEIGHT).data;
}

describe('styled subtitle raster', () => {
	it('uses cue markup and produces identical preview and export pixels', async () => {
		const item = subtitleItem();
		const cueText = item.cues![0]!.text;
		const preview = document.createElement('canvas');
		preview.width = WIDTH;
		preview.height = HEIGHT;
		const previewContext = preview.getContext('2d', {
			willReadFrequently: true
		});
		if (!previewContext) throw new Error('Canvas2D is required for subtitle validation.');
		renderSubtitleRaster(previewContext, cueText, item, WIDTH, HEIGHT);
		previewContext.save();
		previewContext.globalCompositeOperation = 'destination-over';
		previewContext.fillStyle = '#000000';
		previewContext.fillRect(0, 0, WIDTH, HEIGHT);
		previewContext.restore();

		const renderer = new TimelineFrameRenderer(project(item));
		try {
			const exported = await renderer.render(0);
			expect(pixels(exported)).toEqual(pixels(preview));
		} finally {
			renderer.dispose();
		}

		const data = pixels(preview);
		let yellowPixels = 0;
		for (let index = 0; index < data.length; index += 4) {
			const red = data[index] ?? 0;
			const green = data[index + 1] ?? 0;
			const blue = data[index + 2] ?? 0;
			if (red > 200 && green > 150 && blue < 100) yellowPixels += 1;
		}
		expect(yellowPixels).toBeGreaterThan(20);
	});
});
