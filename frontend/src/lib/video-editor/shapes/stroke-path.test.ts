import { describe, expect, it, vi } from 'vitest';
import type { TimelineItem } from '../project/types';
import {
	flattenShapePath,
	maximumTaperScale,
	renderShapeStroke,
	taperWidthScale,
	type FlattenedShapePath,
	type ShapeStrokeContext
} from './stroke-path';

function shape(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'shape',
		trackId: 'overlay',
		from: 0,
		durationInFrames: 90,
		label: 'Shape',
		type: 'shape',
		shapeType: 'path',
		strokeEnabled: true,
		strokeWidth: 20,
		...overrides
	};
}

function paintContext(): ShapeStrokeContext & {
	arc: ReturnType<typeof vi.fn>;
	fill: ReturnType<typeof vi.fn>;
	moveTo: ReturnType<typeof vi.fn>;
	stroke: ReturnType<typeof vi.fn>;
} {
	return {
		beginPath: vi.fn<() => void>(),
		moveTo: vi.fn<(x: number, y: number) => void>(),
		lineTo: vi.fn<(x: number, y: number) => void>(),
		closePath: vi.fn<() => void>(),
		arc: vi.fn<
			(
				x: number,
				y: number,
				radius: number,
				startAngle: number,
				endAngle: number,
				counterclockwise?: boolean
			) => void
		>(),
		stroke: vi.fn<() => void>(),
		fill: vi.fn<() => void>(),
		strokeStyle: '',
		fillStyle: '',
		lineWidth: 0,
		lineCap: 'butt',
		lineJoin: 'miter',
		miterLimit: 4
	};
}

const openLine: FlattenedShapePath = {
	points: [
		{ x: 0, y: 50, progress: 0 },
		{ x: 100, y: 50, progress: 1 }
	],
	totalLength: 100,
	closed: false
};

describe('shape stroke paths', () => {
	it('flattens the shared shape builder with normalized arc length', () => {
		const path = flattenShapePath((target) => {
			target.beginPath();
			target.rect(0, 0, 100, 50);
		});

		expect(path.closed).toBe(true);
		expect(path.totalLength).toBeCloseTo(300, 5);
		expect(path.points[0]).toMatchObject({ x: 0, y: 0, progress: 0 });
		expect(path.points.at(-1)).toMatchObject({ x: 0, y: 0, progress: 1 });
	});

	it('keeps both fragments when an offset trim wraps across an open endpoint', () => {
		const context = paintContext();
		renderShapeStroke(
			context,
			openLine,
			shape({ trimPathStart: 25, trimPathEnd: 75, trimPathOffset: 180 })
		);

		expect(context.stroke).toHaveBeenCalledTimes(2);
		expect(context.moveTo).toHaveBeenNthCalledWith(1, 75, 50);
		expect(context.moveTo).toHaveBeenNthCalledWith(2, 0, 50);
	});

	it('eases independent start and end taper widths over the visible range', () => {
		const item = shape({
			taperStartWidth: 0,
			taperStartLength: 50,
			taperEndWidth: 50,
			taperEndLength: 25
		});

		expect(taperWidthScale(0, item)).toBe(0);
		expect(taperWidthScale(0.25, item)).toBeCloseTo(0.5);
		expect(taperWidthScale(0.5, item)).toBe(1);
		expect(taperWidthScale(1, item)).toBeCloseTo(0.5);
	});

	it('ignores endpoint widths whose taper length is disabled', () => {
		expect(maximumTaperScale(shape({ taperStartWidth: 200, taperStartLength: 0 }))).toBe(1);
		expect(maximumTaperScale(shape({ taperStartWidth: 200, taperStartLength: 25 }))).toBe(2);
	});

	it('fills one compound outline for a tapered translucent stroke', () => {
		const context = paintContext();
		renderShapeStroke(
			context,
			openLine,
			shape({ taperStartWidth: 0, taperStartLength: 100, strokeLineCap: 'round' })
		);

		expect(context.stroke).not.toHaveBeenCalled();
		expect(context.fill).toHaveBeenCalledOnce();
		expect(context.arc).toHaveBeenCalledOnce();
	});
});
