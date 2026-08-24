import { describe, expect, test } from 'vitest';
import type { TimelineItem } from '../project/types';
import { resolveAnimatedItemAt } from './animated-properties';
import {
	applyTransformParentBinding,
	createTransformParentBinding,
	hasRedundantTransformParentLink,
	resolveTransformHierarchy,
	wouldCreateTransformParentCycle,
	worldToLocalTransform,
	type ResolvedTransform
} from './transform-parenting';

function pose(
	x: number,
	y: number,
	width: number,
	height: number,
	rotation = 0
): ResolvedTransform {
	return {
		x,
		y,
		width,
		height,
		rotation,
		anchorX: width / 2,
		anchorY: height / 2,
		opacity: 1,
		cornerRadius: 0
	};
}

function item(id: string, transform: ResolvedTransform): TimelineItem {
	return {
		id,
		trackId: `${id}-track`,
		from: 0,
		durationInFrames: 60,
		label: id,
		type: 'controller',
		transform
	};
}

describe('transform parenting', () => {
	test('preserves the bind pose and follows parent translation, scale, and rotation deltas', () => {
		const childAtBind = pose(10, 20, 20, 30, 5);
		const parentAtBind = pose(0, 0, 100, 100);
		const binding = createTransformParentBinding({
			childLocal: childAtBind,
			childWorld: childAtBind,
			parentItemId: 'parent',
			parentWorld: parentAtBind
		});

		const unchanged = applyTransformParentBinding(childAtBind, binding, parentAtBind);
		expect(unchanged.x).toBeCloseTo(10);
		expect(unchanged.y).toBeCloseTo(20);
		expect(unchanged.width).toBeCloseTo(20);
		expect(unchanged.height).toBeCloseTo(30);
		expect(unchanged.rotation).toBeCloseTo(5);

		const moved = applyTransformParentBinding(childAtBind, binding, pose(50, 0, 200, 200, 90));
		expect(moved.x).toBeCloseTo(10);
		expect(moved.y).toBeCloseTo(20);
		expect(moved.width).toBeCloseTo(40);
		expect(moved.height).toBeCloseTo(60);
		expect(moved.rotation).toBeCloseTo(95);
	});

	test('converts world edits back to the stored child-local space', () => {
		const local = pose(10, 0, 20, 20);
		const parentAtBind = pose(0, 0, 100, 100);
		const binding = createTransformParentBinding({
			childLocal: local,
			childWorld: local,
			parentItemId: 'parent',
			parentWorld: parentAtBind
		});
		const parentNow = pose(50, 0, 200, 200);
		const desiredWorld = pose(100, 30, 40, 40);
		const nextLocal = worldToLocalTransform(desiredWorld, binding, parentNow);
		const roundTrip = applyTransformParentBinding(nextLocal, binding, parentNow);

		expect(roundTrip.x).toBeCloseTo(desiredWorld.x);
		expect(roundTrip.y).toBeCloseTo(desiredWorld.y);
		expect(roundTrip.width).toBeCloseTo(desiredWorld.width);
		expect(roundTrip.height).toBeCloseTo(desiredWorld.height);
	});

	test('resolves keyframed parent motion through the shared animation path', () => {
		const parent = item('parent', pose(0, 0, 100, 100));
		parent.keyframes = { x: { frames: [0, 10], values: [0, 100] } };
		const child = item('child', pose(10, 0, 20, 20));
		child.transformParent = createTransformParentBinding({
			childLocal: pose(10, 0, 20, 20),
			childWorld: pose(10, 0, 20, 20),
			parentItemId: parent.id,
			parentWorld: pose(0, 0, 100, 100)
		});

		const resolved = resolveAnimatedItemAt(child, 5, {
			fps: 30,
			frameWidth: 1920,
			frameHeight: 1080,
			items: [parent, child]
		});

		expect(resolved.transform?.x).toBeCloseTo(60);
		expect(resolved.transform?.width).toBeCloseTo(20);
	});

	test('rejects cycles through parent and property-link dependency edges', () => {
		const first = item('first', pose(0, 0, 10, 10));
		const second = item('second', pose(0, 0, 10, 10));
		second.propertyLinks = [
			{
				type: 'link',
				targetProperty: 'position',
				sourceItemId: first.id,
				sourceProperty: 'position',
				enabled: true,
				timeOffsetFrames: 0
			}
		];
		const items = new Map([
			[first.id, first],
			[second.id, second]
		]);

		expect(wouldCreateTransformParentCycle(first.id, second.id, (id) => items.get(id))).toBe(true);
		expect(hasRedundantTransformParentLink(second.id, first.id, (id) => items.get(id))).toBe(true);
	});

	test('bounds malformed stored hierarchy cycles instead of recursing forever', () => {
		const first = item('first', pose(0, 0, 10, 10));
		const second = item('second', pose(20, 0, 10, 10));
		first.transformParent = createTransformParentBinding({
			childLocal: pose(0, 0, 10, 10),
			childWorld: pose(0, 0, 10, 10),
			parentItemId: second.id,
			parentWorld: pose(20, 0, 10, 10)
		});
		second.transformParent = createTransformParentBinding({
			childLocal: pose(20, 0, 10, 10),
			childWorld: pose(20, 0, 10, 10),
			parentItemId: first.id,
			parentWorld: pose(0, 0, 10, 10)
		});
		const items = new Map([
			[first.id, first],
			[second.id, second]
		]);
		const resolved = resolveTransformHierarchy(first, {
			getItem: (id) => items.get(id),
			resolveLocal: (candidate) =>
				candidate.id === first.id ? pose(0, 0, 10, 10) : pose(20, 0, 10, 10)
		});

		expect(Number.isFinite(resolved.x)).toBe(true);
		expect(Number.isFinite(resolved.rotation)).toBe(true);
	});
});
