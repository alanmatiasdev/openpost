import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { resolveAnimatedItemAt } from './animated-properties';
import { evaluateItemPropertyExpression } from './property-runtime';

function item(id: string, overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 120,
		label: id,
		type: 'shape',
		transform: { x: 10, y: 20, width: 100, height: 50, opacity: 1 },
		...overrides
	};
}

function resolve(target: TimelineItem, items: TimelineItem[], frame = 30): TimelineItem {
	return resolveAnimatedItemAt(target, frame, {
		fps: 30,
		frameWidth: 1920,
		frameHeight: 1080,
		items
	});
}

describe('property runtime', () => {
	it('evaluates keyframes, direct links, then expressions', () => {
		const source = item('source', {
			keyframes: { x: { frames: [0, 60], values: [20, 80] } }
		});
		const target = item('target', {
			propertyLinks: [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: 'source',
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 0
				}
			],
			expressions: [{ type: 'expression', targetProperty: 'x', source: 'value * 2', enabled: true }]
		});
		expect(resolve(target, [source, target]).transform?.x).toBe(100);
	});

	it('supports delayed followers in composition frames', () => {
		const source = item('source', {
			keyframes: { x: { frames: [0, 60], values: [0, 60] } }
		});
		const target = item('target', {
			propertyLinks: [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: 'source',
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 10
				}
			]
		});
		expect(resolve(target, [source, target], 30).transform?.x).toBe(20);
	});

	it('resolves cross-layer prop references and vector expressions', () => {
		const source = item('source', { transform: { x: 40, y: 80, width: 100, height: 50 } });
		const target = item('target', {
			expressions: [
				{
					type: 'expression',
					targetProperty: 'position',
					source: 'lerp(value, prop("source", "position"), 0.5)',
					enabled: true
				}
			]
		});
		expect(resolve(target, [source, target]).transform).toMatchObject({ x: 25, y: 50 });
	});

	it('keeps authored values for broken links, bad types, and imported cycles', () => {
		const target = item('target', {
			propertyLinks: [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: 'missing',
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 0
				}
			],
			expressions: [{ type: 'expression', targetProperty: 'x', source: '[1, 2]', enabled: true }]
		});
		expect(resolve(target, [target]).transform?.x).toBe(10);
		const first = item('first', {
			propertyLinks: [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: 'second',
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 0
				}
			]
		});
		const second = item('second', {
			transform: { x: 30 },
			propertyLinks: [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: 'first',
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 0
				}
			]
		});
		expect(resolve(first, [first, second]).transform?.x).toBe(10);
	});

	it('returns inline preview errors without mutating the stored expression', () => {
		const target = item('target', {
			expressions: [{ type: 'expression', targetProperty: 'x', source: 'value / 0', enabled: true }]
		});
		const result = evaluateItemPropertyExpression(target, 'x', {
			absoluteFrame: 0,
			fps: 30,
			items: [target],
			resolvePreExpressionItem: (candidate) => candidate
		});
		expect(result).toEqual({ value: 10, error: 'Division by zero' });
	});
});
