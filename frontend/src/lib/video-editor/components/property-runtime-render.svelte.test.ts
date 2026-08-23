import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { TimelineFrameRenderer } from '$lib/video-editor/media/render-export';
import type { Project, TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import PreviewLayer from './preview-layer.svelte';

const WIDTH = 96;
const HEIGHT = 64;

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
});
