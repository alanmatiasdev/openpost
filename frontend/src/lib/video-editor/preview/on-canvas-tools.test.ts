import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	buildMotionPathPoints,
	calculateAnchorDrag,
	calculateCropFromDrag,
	calculateTransformResize,
	calculateTransformRotation,
	transformHandleCursor,
	transformHandlePoint
} from './on-canvas-tools';

describe('on-canvas crop geometry', () => {
	it('inverse-rotates pointer movement into the clip local axes', () => {
		const crop = calculateCropFromDrag({
			edge: 'left',
			startCrop: undefined,
			startPoint: { x: 0, y: 0 },
			currentPoint: { x: 0, y: 25 },
			rotation: 90,
			mediaWidth: 100,
			mediaHeight: 50,
			sourceDimension: 400
		});
		expect(crop.left).toBe(0.25);
	});

	it('keeps at least one intrinsic source pixel visible', () => {
		const crop = calculateCropFromDrag({
			edge: 'right',
			startCrop: { left: 0.25, right: 0, top: 0, bottom: 0 },
			startPoint: { x: 100, y: 0 },
			currentPoint: { x: -1000, y: 0 },
			rotation: 0,
			mediaWidth: 100,
			mediaHeight: 50,
			sourceDimension: 400
		});
		expect(crop.right).toBe(299 / 400);
	});
});

describe('on-canvas anchor geometry', () => {
	it('compensates position so a rotated layer does not jump', () => {
		const next = calculateAnchorDrag(
			{ x: 10, y: 20, width: 200, height: 100, rotation: 90 },
			{ x: 0, y: 0 },
			{ x: 0, y: 20 }
		);
		expect(next.anchorX).toBeCloseTo(120);
		expect(next.anchorY).toBeCloseTo(50);
		expect(next.x).toBeCloseTo(-10);
		expect(next.y).toBeCloseTo(40);
	});
});

describe('on-canvas transform geometry', () => {
	const transform = { x: 0, y: 0, width: 200, height: 100, rotation: 0 };

	it('scales media from its center with aspect lock by default', () => {
		const startPoint = transformHandlePoint({
			transform,
			handle: 'se',
			canvasWidth: 1000,
			canvasHeight: 500
		});
		const next = calculateTransformResize({
			startTransform: transform,
			handle: 'se',
			startPoint,
			currentPoint: { x: startPoint.x + 50, y: startPoint.y + 25 },
			maintainAspectRatio: true,
			oppositeAnchored: false,
			canvasWidth: 1000,
			canvasHeight: 500
		});
		expect(next.x).toBe(0);
		expect(next.y).toBe(0);
		expect(next.width).toBeCloseTo(300);
		expect(next.height).toBeCloseTo(150);
	});

	it('supports free edge scaling and Control-anchored opposite edges', () => {
		const startPoint = transformHandlePoint({
			transform,
			handle: 'e',
			canvasWidth: 1000,
			canvasHeight: 500
		});
		expect(
			calculateTransformResize({
				startTransform: transform,
				handle: 'e',
				startPoint,
				currentPoint: { x: startPoint.x + 50, y: startPoint.y },
				maintainAspectRatio: false,
				oppositeAnchored: false,
				canvasWidth: 1000,
				canvasHeight: 500
			})
		).toMatchObject({ x: 0, y: 0, width: 300, height: 100 });
		expect(
			calculateTransformResize({
				startTransform: transform,
				handle: 'e',
				startPoint,
				currentPoint: { x: startPoint.x + 50, y: startPoint.y },
				maintainAspectRatio: true,
				oppositeAnchored: true,
				canvasWidth: 1000,
				canvasHeight: 500
			})
		).toMatchObject({ x: 25, y: 0, width: 250, height: 125 });
	});

	it('does not flip through a handle or collapse below the FreeCut minimum', () => {
		const startPoint = transformHandlePoint({
			transform,
			handle: 'e',
			canvasWidth: 1000,
			canvasHeight: 500
		});
		const next = calculateTransformResize({
			startTransform: transform,
			handle: 'e',
			startPoint,
			currentPoint: { x: startPoint.x - 500, y: startPoint.y },
			maintainAspectRatio: false,
			oppositeAnchored: false,
			canvasWidth: 1000,
			canvasHeight: 500
		});
		expect(next).toMatchObject({ width: 20, height: 100 });
	});

	it('keeps a rotated opposite corner fixed in project space', () => {
		const rotated = { ...transform, rotation: 90 };
		const startPoint = transformHandlePoint({
			transform: rotated,
			handle: 'se',
			canvasWidth: 1000,
			canvasHeight: 500
		});
		const next = calculateTransformResize({
			startTransform: rotated,
			handle: 'se',
			startPoint,
			currentPoint: { x: startPoint.x - 25, y: startPoint.y + 50 },
			maintainAspectRatio: true,
			oppositeAnchored: true,
			canvasWidth: 1000,
			canvasHeight: 500
		});
		expect(next.x).toBeCloseTo(-12.5);
		expect(next.y).toBeCloseTo(25);
		expect(next.width).toBeCloseTo(250);
		expect(next.height).toBeCloseTo(125);
		expect(next.rotation).toBe(90);
	});

	it('snaps rotation to 15 degrees unless free rotation is requested', () => {
		const startPoint = { x: 500, y: 150 };
		const angle = (22 * Math.PI) / 180;
		const currentPoint = { x: 500 + Math.sin(angle) * 100, y: 250 - Math.cos(angle) * 100 };
		expect(
			calculateTransformRotation({
				startTransform: transform,
				startPoint,
				currentPoint,
				canvasWidth: 1000,
				canvasHeight: 500
			}).rotation
		).toBe(15);
		expect(
			calculateTransformRotation({
				startTransform: transform,
				startPoint,
				currentPoint,
				canvasWidth: 1000,
				canvasHeight: 500,
				snap: false
			}).rotation
		).toBeCloseTo(22);
	});

	it('rotates resize cursors with the selected item', () => {
		expect(transformHandleCursor('e', 0)).toBe('ew-resize');
		expect(transformHandleCursor('e', 90)).toBe('ns-resize');
		expect(transformHandleCursor('ne', 45)).toBe('ew-resize');
	});
});

describe('on-canvas motion paths', () => {
	const item: TimelineItem = {
		id: 'clip',
		trackId: 'video',
		from: 10,
		durationInFrames: 21,
		label: 'Clip',
		type: 'image',
		transform: { x: 0, y: 0, width: 100, height: 100 },
		keyframes: {
			x: { frames: [0, 20], values: [-100, 100] },
			y: { frames: [0, 20], values: [0, 100] }
		}
	};

	it('samples the curve and retains every editable keyframe', () => {
		const points = buildMotionPathPoints({
			item,
			canvasWidth: 1000,
			canvasHeight: 500,
			maxSamples: 5
		});
		expect(points).toHaveLength(5);
		expect(points.filter((point) => point.isKeyframe).map((point) => point.frame)).toEqual([
			10, 30
		]);
		expect(points[0]).toMatchObject({ x: 400, y: 250 });
		expect(points.at(-1)).toMatchObject({ x: 600, y: 350 });
	});

	it('folds a live drag preview into both position lanes', () => {
		const points = buildMotionPathPoints({
			item,
			canvasWidth: 1000,
			canvasHeight: 500,
			maxSamples: 5,
			preview: { frame: 20, x: 80, y: -40 }
		});
		expect(points.find((point) => point.frame === 20)).toMatchObject({
			x: 580,
			y: 210,
			isKeyframe: true
		});
	});

	it('samples stored spatial curves and exposes editable handle coordinates', () => {
		const vectorItem: TimelineItem = {
			...item,
			keyframes: undefined,
			vectorKeyframes: {
				position: [
					{
						id: 'start',
						frame: 0,
						value: { x: -100, y: 0 },
						easing: 'linear',
						spatial: {
							inTangent: { x: -40, y: 0 },
							outTangent: { x: 0, y: 100 },
							continuous: false
						}
					},
					{
						id: 'end',
						frame: 20,
						value: { x: 100, y: 0 },
						easing: 'linear',
						spatial: {
							inTangent: { x: 0, y: 100 },
							outTangent: { x: 40, y: 0 },
							continuous: false
						}
					}
				]
			}
		};
		const points = buildMotionPathPoints({
			item: vectorItem,
			canvasWidth: 1000,
			canvasHeight: 500,
			maxSamples: 5
		});
		expect(points.find((point) => point.frame === 20)).toMatchObject({ x: 500, y: 325 });
		expect(points[0]).toMatchObject({
			vectorId: 'start',
			inHandle: { x: 360, y: 250 },
			outHandle: { x: 400, y: 350 }
		});
	});
});
