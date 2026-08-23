import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../project/types';
import { buildShapePath } from './render';

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
		transform: { width: 400, height: 300 },
		...overrides
	};
}

function pathRecorder() {
	return {
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		bezierCurveTo: vi.fn(),
		quadraticCurveTo: vi.fn(),
		closePath: vi.fn(),
		ellipse: vi.fn(),
		rect: vi.fn(),
		roundRect: vi.fn()
	};
}

describe('buildShapePath', () => {
	it('builds every primitive without falling back to a rectangle', () => {
		for (const shapeType of [
			'rectangle',
			'circle',
			'ellipse',
			'triangle',
			'star',
			'polygon',
			'heart'
		] as const) {
			const path = pathRecorder();
			buildShapePath(path, shape({ shapeType }), 400, 300);
			expect(path.beginPath, shapeType).toHaveBeenCalledOnce();
			const segments =
				path.rect.mock.calls.length +
				path.roundRect.mock.calls.length +
				path.ellipse.mock.calls.length +
				path.lineTo.mock.calls.length +
				path.bezierCurveTo.mock.calls.length;
			expect(segments, shapeType).toBeGreaterThan(0);
		}
	});

	it('keeps a locked circle centered and round inside non-square bounds', () => {
		const path = pathRecorder();
		buildShapePath(path, shape({ shapeType: 'circle' }), 400, 300);
		expect(path.ellipse).toHaveBeenCalledWith(200, 150, 150, 150, 0, 0, Math.PI * 2);
	});

	it('uses normalized Bezier handles and preserves an open path', () => {
		const path = pathRecorder();
		buildShapePath(
			path,
			shape({
				shapeType: 'path',
				pathClosed: false,
				pathVertices: [
					{ position: [0.1, 0.2], inHandle: [0, 0], outHandle: [0.2, 0] },
					{ position: [0.9, 0.8], inHandle: [-0.2, 0], outHandle: [0, 0] }
				]
			}),
			400,
			300
		);

		expect(path.moveTo).toHaveBeenCalledWith(40, 60);
		expect(path.bezierCurveTo).toHaveBeenCalledOnce();
		const controls = path.bezierCurveTo.mock.calls[0]!;
		expect(controls[0]).toBeCloseTo(120);
		expect(controls[1]).toBeCloseTo(60);
		expect(controls[2]).toBeCloseTo(280);
		expect(controls[3]).toBeCloseTo(240);
		expect(controls[4]).toBeCloseTo(360);
		expect(controls[5]).toBeCloseTo(240);
		expect(path.closePath).not.toHaveBeenCalled();
	});

	it('rounds star and polygon corners with the shared path builder', () => {
		const path = pathRecorder();
		buildShapePath(
			path,
			shape({ shapeType: 'star', shapePoints: 7, shapeInnerRadius: 0.35, shapeCornerRadius: 12 }),
			400,
			300
		);
		expect(path.quadraticCurveTo).toHaveBeenCalledTimes(14);
		expect(path.closePath).toHaveBeenCalledOnce();
	});
});
