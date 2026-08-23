import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { TimelineFrameRenderer } from '$lib/video-editor/media/render-export';
import type { Project, TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import PreviewLayer from './preview-layer.svelte';

const WIDTH = 96;
const HEIGHT = 64;

interface PixelBounds {
	width: number;
	height: number;
}

function item(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: 'visuals',
		from: 0,
		durationInFrames: 30,
		label: id,
		type: 'shape',
		shapeType: 'rectangle',
		fillColor: '#ff0000',
		fillEnabled: true,
		transform: { width: 20, height: 20 },
		...overrides
	};
}

function project(items: TimelineItem[]): Project {
	return {
		id: 'property-runtime-render',
		name: 'Property runtime render',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: WIDTH, height: HEIGHT, fps: 30, backgroundColor: '#000000' },
		timeline: {
			tracks: [
				{
					id: 'visuals',
					name: 'Visuals',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items
		}
	};
}

describe('property runtime rendering', () => {
	it('uses the same linked expression result in preview and export', async () => {
		const driver = item('driver', {
			transform: { x: 25, width: 20, height: 20, opacity: 0 }
		});
		const follower = item('follower', {
			propertyLinks: [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: driver.id,
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 0
				}
			],
			expressions: [
				{
					type: 'expression',
					targetProperty: 'x',
					source: 'value + 10',
					enabled: true
				}
			]
		});
		const items = [driver, follower];
		timelineStore.setAll({ items, currentFrame: 0, fps: 30 });

		const screen = await render(PreviewLayer, {
			item: follower,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const preview = screen.container.querySelector<HTMLElement>('[data-preview-item="follower"]');
		expect(preview).not.toBeNull();
		if (!preview) return;
		expect(Number.parseFloat(preview.style.left)).toBeCloseTo(50 + (35 / WIDTH) * 100, 4);

		const renderer = new TimelineFrameRenderer(project(items));
		try {
			const frame = await renderer.render(0);
			const context = frame.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('Canvas2D is required for property runtime validation.');
			expect([...context.getImageData(83, 32, 1, 1).data]).toEqual([255, 0, 0, 255]);
			expect([...context.getImageData(48, 32, 1, 1).data]).toEqual([0, 0, 0, 255]);
		} finally {
			renderer.dispose();
		}
	});

	it('renders coupled scale and anchor lanes identically in preview and export', async () => {
		const shape = item('scaled', {
			vectorKeyframes: {
				scale: [{ id: 'scale', frame: 0, value: { x: 200, y: 50 }, easing: 'linear' }],
				anchor: [{ id: 'anchor', frame: 0, value: { x: 20, y: 5 }, easing: 'linear' }]
			}
		});
		timelineStore.setAll({ items: [shape], currentFrame: 0, fps: 30 });

		const screen = await render(PreviewLayer, {
			item: shape,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const preview = screen.container.querySelector<HTMLElement>('[data-preview-item="scaled"]');
		expect(preview).not.toBeNull();
		if (!preview) return;
		expect(Number.parseFloat(preview.style.width)).toBeCloseTo((40 / WIDTH) * 100, 4);
		expect(Number.parseFloat(preview.style.height)).toBeCloseTo((10 / HEIGHT) * 100, 4);

		const renderer = new TimelineFrameRenderer(project([shape]));
		try {
			const frame = await renderer.render(0);
			const context = frame.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('Canvas2D is required for vector lane validation.');
			expect([...context.getImageData(30, 32, 1, 1).data]).toEqual([255, 0, 0, 255]);
			expect([...context.getImageData(20, 32, 1, 1).data]).toEqual([0, 0, 0, 255]);
		} finally {
			renderer.dispose();
		}
	});

	it('renders animated path vertices identically in preview and export', async () => {
		const shape = item('animated-path', {
			shapeType: 'path',
			pathClosed: true,
			strokeEnabled: false,
			transform: { width: 60, height: 40 },
			pathVertices: [
				{ position: [0, 0], inHandle: [0, 0], outHandle: [0, 0] },
				{ position: [0.2, 1], inHandle: [0, 0], outHandle: [0, 0] },
				{ position: [0.4, 0], inHandle: [0, 0], outHandle: [0, 0] }
			],
			keyframes: {
				'pathVertex:1:positionX': { frames: [0, 15], values: [0.2, 0.8] },
				'pathVertex:2:positionX': { frames: [0, 15], values: [0.4, 1] }
			}
		});
		timelineStore.setAll({ items: [shape], currentFrame: 15, fps: 30 });

		const screen = await render(PreviewLayer, {
			item: shape,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const previewCanvas = screen.container.querySelector('canvas');
		if (!previewCanvas) throw new Error('Animated path preview canvas did not render.');
		await vi.waitFor(() => expect(redBounds(previewCanvas).width).toBeGreaterThan(50));
		const previewBounds = redBounds(previewCanvas);

		const renderer = new TimelineFrameRenderer(project([shape]));
		try {
			const frame = await renderer.render(15);
			const exportBounds = redBounds(frame);
			expect(exportBounds.width).toBe(previewBounds.width);
			expect(exportBounds.height).toBe(previewBounds.height);
		} finally {
			renderer.dispose();
		}
	});
});

function redBounds(canvas: HTMLCanvasElement | OffscreenCanvas): PixelBounds {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas2D is required for path render validation.');
	const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
	let minX = canvas.width;
	let minY = canvas.height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < canvas.height; y += 1) {
		for (let x = 0; x < canvas.width; x += 1) {
			const index = (y * canvas.width + x) * 4;
			if ((pixels[index] ?? 0) < 200 || (pixels[index + 3] ?? 0) < 200) continue;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}
	return {
		width: maxX >= minX ? maxX - minX + 1 : 0,
		height: maxY >= minY ? maxY - minY + 1 : 0
	};
}
