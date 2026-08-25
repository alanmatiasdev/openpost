import { describe, expect, it } from 'vitest';
import {
	canvasPointToSpatialEffectUv,
	spatialEffectUvToCanvasPoint,
	type SpatialEffectCanvasGeometry
} from './spatial-effect-coordinates';

describe('spatial effect canvas coordinates', () => {
	it('maps source UV through the item transform', () => {
		expect(
			spatialEffectUvToCanvasPoint(
				{ x: 0.25, y: 0.75 },
				{
					item: { transform: { x: 100, y: -50, width: 960, height: 540 } },
					canvasWidth: 1920,
					canvasHeight: 1080
				}
			)
		).toEqual({ x: 820, y: 625 });
	});

	it('maps cropped source edges to the visible item edges', () => {
		const geometry: SpatialEffectCanvasGeometry = {
			item: {
				transform: { width: 1000, height: 500 },
				crop: { left: 0.25, right: 0.25, top: 0.1, bottom: 0.2 }
			},
			canvasWidth: 1000,
			canvasHeight: 500
		};
		expect(spatialEffectUvToCanvasPoint({ x: 0.25, y: 0.1 }, geometry)).toEqual({
			x: 0,
			y: 0
		});
		const bottomRight = spatialEffectUvToCanvasPoint({ x: 0.75, y: 0.8 }, geometry);
		expect(bottomRight.x).toBeCloseTo(1000, 10);
		expect(bottomRight.y).toBeCloseTo(500, 10);
	});

	it('round-trips rotation, flips, crop, offset, and a custom anchor', () => {
		const geometry = {
			item: {
				transform: {
					x: 170,
					y: -90,
					width: 840,
					height: 620,
					anchorX: 130,
					anchorY: 410,
					rotation: 37,
					flipHorizontal: true,
					flipVertical: true
				},
				crop: { left: 0.12, right: 0.08, top: 0.2, bottom: 0.05 }
			},
			canvasWidth: 1920,
			canvasHeight: 1080
		};
		const uv = { x: 0.73, y: 0.41 };
		const canvasPoint = spatialEffectUvToCanvasPoint(uv, geometry);
		expect(canvasPointToSpatialEffectUv(canvasPoint, geometry).x).toBeCloseTo(uv.x, 10);
		expect(canvasPointToSpatialEffectUv(canvasPoint, geometry).y).toBeCloseTo(uv.y, 10);
	});

	it('maps through the same projective corner pin used by preview and export', () => {
		const geometry: SpatialEffectCanvasGeometry = {
			item: {
				transform: { width: 200, height: 100 },
				cornerPin: {
					topLeft: [20, 10],
					topRight: [-10, 5],
					bottomRight: [15, -20],
					bottomLeft: [-5, -10],
					referenceWidth: 200,
					referenceHeight: 100
				}
			},
			canvasWidth: 200,
			canvasHeight: 100
		};
		expect(spatialEffectUvToCanvasPoint({ x: 0, y: 0 }, geometry)).toEqual({
			x: 20,
			y: 10
		});
		const uv = { x: 0.63, y: 0.42 };
		const projected = spatialEffectUvToCanvasPoint(uv, geometry);
		const restored = canvasPointToSpatialEffectUv(projected, geometry);
		expect(restored.x).toBeCloseTo(uv.x, 9);
		expect(restored.y).toBeCloseTo(uv.y, 9);
	});

	it('clamps pointer writes to the shader texture', () => {
		const geometry = {
			item: { transform: { width: 100, height: 100 } },
			canvasWidth: 100,
			canvasHeight: 100
		};
		expect(canvasPointToSpatialEffectUv({ x: -500, y: 800 }, geometry)).toEqual({
			x: 0,
			y: 1
		});
	});
});
