import { describe, expect, it } from 'vitest';
import {
	applyCanvasMoveSnapping,
	applyCanvasResizeSnapping,
	computeCanvasItemBounds,
	type SnapTransform
} from './canvas-snapping';

function transform(patch: Partial<SnapTransform> = {}): SnapTransform {
	return { x: 0, y: 0, width: 100, height: 100, rotation: 0, ...patch };
}

describe('canvas move snapping', () => {
	it('snaps the nearest rotated bound to the canvas and neighboring layers', () => {
		const centered = applyCanvasMoveSnapping({
			transform: transform({ x: 4, y: -3 }),
			canvasWidth: 1000,
			canvasHeight: 500
		});
		expect(centered.transform).toMatchObject({ x: 0, y: 0 });
		expect(centered.snapLines).toEqual([
			{ type: 'vertical', position: 500, label: '50%' },
			{ type: 'horizontal', position: 250, label: '50%' }
		]);

		const neighbor = computeCanvasItemBounds(transform({ x: 200, y: 0 }), 1000, 500);
		const aligned = applyCanvasMoveSnapping({
			transform: transform({ x: 103, y: 0 }),
			canvasWidth: 1000,
			canvasHeight: 500,
			otherItemBounds: [neighbor]
		});
		expect(aligned.transform.x).toBe(100);
		expect(aligned.snapLines).toContainEqual({
			type: 'vertical',
			position: 650,
			label: 'align'
		});
	});

	it('keeps thresholds constant in screen pixels and releases with hysteresis', () => {
		const nearAtQuarterScale = applyCanvasMoveSnapping({
			transform: transform({ x: 30, width: 300 }),
			canvasWidth: 1000,
			canvasHeight: 500,
			canvasScale: 0.25
		});
		expect(nearAtQuarterScale.transform.x).toBe(0);
		const outsideEnter = applyCanvasMoveSnapping({
			transform: transform({ x: 40, width: 300 }),
			canvasWidth: 1000,
			canvasHeight: 500,
			canvasScale: 0.25
		});
		expect(outsideEnter.transform.x).toBe(40);
		const held = applyCanvasMoveSnapping({
			transform: transform({ x: 60, width: 300 }),
			canvasWidth: 1000,
			canvasHeight: 500,
			canvasScale: 0.25,
			currentSnapLines: [{ type: 'vertical', position: 500, label: '50%' }]
		});
		expect(held.transform.x).toBe(0);
	});

	it('computes a rotation-aware box around an offset anchor', () => {
		const result = computeCanvasItemBounds(
			transform({ width: 200, height: 100, rotation: 90, anchorX: 0, anchorY: 0 }),
			1000,
			500
		);
		expect(result).toMatchObject({ left: 400, right: 500, top: 250, bottom: 450 });
	});
});

describe('canvas resize snapping', () => {
	it('snaps aspect-locked edges to percentage guides', () => {
		const result = applyCanvasResizeSnapping({
			transform: transform({ width: 490, height: 245 }),
			canvasWidth: 1000,
			canvasHeight: 500,
			maintainAspectRatio: true
		});
		expect(result.transform).toMatchObject({ width: 500, height: 250 });
		expect(result.snapLines).toEqual(
			expect.arrayContaining([
				{ type: 'vertical', position: 250, label: '25%' },
				{ type: 'vertical', position: 750, label: '75%' },
				{ type: 'horizontal', position: 125, label: '25%' },
				{ type: 'horizontal', position: 375, label: '75%' }
			])
		);
	});

	it('snaps free width and height independently', () => {
		const result = applyCanvasResizeSnapping({
			transform: transform({ width: 490, height: 490 }),
			canvasWidth: 1000,
			canvasHeight: 1000,
			maintainAspectRatio: false
		});
		expect(result.transform).toMatchObject({ width: 500, height: 500 });
	});

	it('maps rotated visual bounds back to the correct source dimension', () => {
		const result = applyCanvasResizeSnapping({
			transform: transform({ width: 100, height: 490, rotation: 90 }),
			canvasWidth: 1000,
			canvasHeight: 1000,
			maintainAspectRatio: false
		});
		expect(result.transform).toMatchObject({ width: 100, height: 500, rotation: 90 });
		expect(result.snapLines).toEqual(
			expect.arrayContaining([
				{ type: 'vertical', position: 250, label: '25%' },
				{ type: 'vertical', position: 750, label: '75%' }
			])
		);
	});
});
