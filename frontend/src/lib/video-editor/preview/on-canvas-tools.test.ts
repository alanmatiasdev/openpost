import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	buildMotionPathPoints,
	calculateAnchorDrag,
	calculateCropFromDrag
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
});
