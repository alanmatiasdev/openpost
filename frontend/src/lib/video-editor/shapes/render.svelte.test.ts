import { describe, expect, it } from 'vitest';
import type { Project, TimelineItem } from '../project/types';
import { TimelineFrameRenderer } from '../media/render-export';
import { renderShapeItemRaster } from './render';

function shape(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'shape',
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: 'Shape',
		type: 'shape',
		shapeType: 'rectangle',
		fillColor: '#f97316',
		fillEnabled: true,
		transform: { width: 200, height: 100 },
		...overrides
	};
}

function raster(item: TimelineItem, width = 200, height = 100): CanvasRenderingContext2D {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas2D is required for the shape browser test.');
	renderShapeItemRaster(context, item, width, height);
	return context;
}

function pixel(context: CanvasRenderingContext2D, x: number, y: number): number[] {
	return [...context.getImageData(x, y, 1, 1).data];
}

describe('shape browser raster', () => {
	it('renders a real two-color linear gradient', () => {
		const context = raster(
			shape({
				fillType: 'linear',
				gradientStartColor: '#ff0000',
				gradientEndColor: '#0000ff',
				gradientAngle: 0
			})
		);
		const left = pixel(context, 20, 50);
		const right = pixel(context, 180, 50);
		expect(left[0]).toBeGreaterThan(left[2]!);
		expect(right[2]).toBeGreaterThan(right[0]!);
		expect(left[3]).toBe(255);
		expect(right[3]).toBe(255);
	});

	it('renders every primitive with transparent space outside non-rectangular paths', () => {
		for (const shapeType of [
			'circle',
			'ellipse',
			'triangle',
			'star',
			'polygon',
			'heart'
		] as const) {
			const context = raster(shape({ shapeType }));
			expect(pixel(context, 100, 50)[3], shapeType).toBeGreaterThan(0);
			expect(pixel(context, 0, 0)[3], shapeType).toBe(0);
		}
	});

	it('renders an open pen path as stroke only', () => {
		const context = raster(
			shape({
				shapeType: 'path',
				pathClosed: false,
				fillEnabled: true,
				strokeEnabled: true,
				strokeColor: '#ffffff',
				strokeWidth: 8,
				strokeLineCap: 'round',
				pathVertices: [
					{ position: [0.1, 0.5], inHandle: [0, 0], outHandle: [0.2, -0.4] },
					{ position: [0.9, 0.5], inHandle: [-0.2, 0.4], outHandle: [0, 0] }
				]
			})
		);
		expect(pixel(context, 100, 50)[3]).toBeGreaterThan(0);
		expect(pixel(context, 100, 90)[3]).toBe(0);
	});

	it('uses the same shape raster in the full export compositor', async () => {
		const item = shape({
			shapeType: 'star',
			fillColor: '#ff0000',
			transform: { width: 100, height: 100 }
		});
		const project: Project = {
			id: 'shape-export',
			name: 'Shape export',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 3,
			metadata: { width: 200, height: 100, fps: 30, backgroundColor: '#000000' },
			timeline: {
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
				],
				items: [item]
			}
		};
		const renderer = new TimelineFrameRenderer(project);
		try {
			const output = await renderer.render(0);
			const context = output.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('Canvas2D is required for export validation.');
			const center = [...context.getImageData(100, 50, 1, 1).data];
			const outside = [...context.getImageData(5, 5, 1, 1).data];
			expect(center[0]).toBeGreaterThan(200);
			expect(center[1]).toBeLessThan(30);
			expect(outside.slice(0, 3)).toEqual([0, 0, 0]);
		} finally {
			renderer.dispose();
		}
	});
});
