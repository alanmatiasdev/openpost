import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	curvePath,
	editorKeyframes,
	graphCoordinates,
	graphPoint,
	graphValueRange,
	keyframeIdentity,
	marqueeSelection,
	type GraphViewport
} from './keyframe-editor';

const item: TimelineItem = {
	id: 'clip',
	trackId: 'track',
	from: 0,
	durationInFrames: 60,
	label: 'Clip',
	type: 'video',
	keyframes: {
		opacity: {
			frames: [0, 30, 59],
			values: [0, 1, 0.5],
			ids: ['a', 'b', 'c'],
			easings: ['hold', 'cubic-bezier', 'linear'],
			easingConfigs: [
				null,
				{ type: 'cubic-bezier', bezier: { x1: 0.2, y1: 0.8, x2: 0.4, y2: 1 } },
				null
			]
		}
	}
};

describe('keyframe editor math', () => {
	it('adapts parallel tracks without losing easing metadata', () => {
		const points = editorKeyframes(item, 'opacity');
		expect(points).toHaveLength(3);
		expect(points[1]).toMatchObject({ id: 'b', frame: 30, value: 1, easing: 'cubic-bezier' });
		expect(keyframeIdentity(points[0]!)).toBe('a');
	});

	it('auto-fits values with FreeCut padding inside property bounds', () => {
		expect(graphValueRange('opacity', editorKeyframes(item, 'opacity'))).toEqual({
			min: 0,
			max: 1
		});
		const narrow = graphValueRange('opacity', [{ value: 0.5 }, { value: 0.6 }]);
		expect(narrow.min).toBeCloseTo(0.488);
		expect(narrow.max).toBeCloseTo(0.612);
	});

	it('round-trips graph coordinates', () => {
		const viewport: GraphViewport = {
			width: 640,
			height: 240,
			startFrame: 0,
			endFrame: 60,
			minValue: 0,
			maxValue: 1
		};
		const screen = graphPoint(30, 0.25, viewport);
		const graph = graphCoordinates(screen.x, screen.y, viewport);
		expect(graph.frame).toBeCloseTo(30);
		expect(graph.value).toBeCloseTo(0.25);
	});

	it('samples hold and configured curves', () => {
		const points = editorKeyframes(item, 'opacity');
		const viewport: GraphViewport = {
			width: 640,
			height: 240,
			startFrame: 0,
			endFrame: 60,
			minValue: 0,
			maxValue: 1
		};
		expect(curvePath(points[0]!, points[1]!, viewport, 2)).toContain('L 190.00,212.00');
		expect(curvePath(points[1]!, points[2]!, viewport, 2)).not.toContain('NaN');
	});

	it('supports replace, add, and toggle marquee selection', () => {
		const base = new Set(['a', 'b']);
		expect([...marqueeSelection('replace', base, ['c'])]).toEqual(['c']);
		expect([...marqueeSelection('add', base, ['c'])]).toEqual(['a', 'b', 'c']);
		expect([...marqueeSelection('toggle', base, ['b', 'c'])]).toEqual(['a', 'c']);
	});
});
