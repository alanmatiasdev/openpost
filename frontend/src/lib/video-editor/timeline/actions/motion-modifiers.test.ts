import { beforeEach, describe, expect, it } from 'vitest';
import type { MotionModifier, TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import {
	applyMotionModifierToItems,
	bakeMotionToKeyframes,
	beginMotionModifierEdit,
	commitMotionModifierEdit,
	removeMotionModifierFromItems,
	updateMotionModifiersLive
} from './motion-modifiers';

function item(id: string, motionModifiers?: MotionModifier[]): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: id,
		type: 'video',
		motionModifiers
	};
}

function modifier(type: MotionModifier['type'], amplitude = 1): MotionModifier {
	return {
		version: 2,
		id: `${type}-${amplitude}`,
		type,
		enabled: true,
		amplitude,
		frequency: 1,
		phaseFrames: 0,
		seed: 1
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.clear();
	timelineStore._setItems([item('one'), item('two')]);
});

describe('motion modifier actions', () => {
	it('applies or replaces one type across a selection in one undo step', () => {
		expect(
			applyMotionModifierToItems([
				{ itemId: 'one', modifier: modifier('float-drift') },
				{ itemId: 'two', modifier: modifier('float-drift') }
			])
		).toBe(2);
		expect(commandHistory.undoStack).toHaveLength(1);

		applyMotionModifierToItems([{ itemId: 'one', modifier: modifier('float-drift', 0.4) }]);
		expect(timelineStore.itemById.get('one')?.motionModifiers).toMatchObject([
			{ type: 'float-drift', amplitude: 0.4 }
		]);
		expect(timelineStore.itemById.get('one')?.motionModifiers).toHaveLength(1);
	});

	it('removes one behavior without touching the others', () => {
		timelineStore._setItems([
			item('one', [modifier('float-drift'), modifier('spin')]),
			item('two', [modifier('float-drift')])
		]);
		expect(removeMotionModifierFromItems(['one', 'two'], 'float-drift')).toBe(2);
		expect(timelineStore.itemById.get('one')?.motionModifiers).toMatchObject([{ type: 'spin' }]);
		expect(timelineStore.itemById.get('two')?.motionModifiers).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('coalesces a stream of live slider changes into one undo step', () => {
		applyMotionModifierToItems([{ itemId: 'one', modifier: modifier('sway') }]);
		commandHistory.clearHistory();
		const before = beginMotionModifierEdit();
		updateMotionModifiersLive([{ itemId: 'one', modifier: modifier('sway', 0.8) }]);
		updateMotionModifiersLive([{ itemId: 'one', modifier: modifier('sway', 0.35) }]);
		commitMotionModifierEdit(before, 'sway', ['one']);
		expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]?.amplitude).toBe(0.35);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]?.amplitude).toBe(1);
	});

	it('bakes a multi-clip selection into editable lanes in one undo step', () => {
		timelineStore._setItems([
			{
				...item('one', [modifier('sway')]),
				transform: { x: 10, y: 20, rotation: 5, width: 300, height: 200, opacity: 1 }
			},
			{
				...item('two', [modifier('spin')]),
				transform: { x: 30, y: 40, rotation: 0, width: 400, height: 250, opacity: 1 }
			}
		]);
		const result = bakeMotionToKeyframes({
			itemIds: ['one', 'two'],
			fps: 30,
			frameWidth: 1920,
			frameHeight: 1080
		});
		expect(result).toMatchObject({ ok: true, bakedItems: 2 });
		expect(timelineStore.itemById.get('one')?.motionModifiers).toBeUndefined();
		expect(timelineStore.itemById.get('one')?.keyframes?.rotation?.frames).toEqual([
			0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 89
		]);
		expect(timelineStore.itemById.get('two')?.keyframes?.rotation?.frames.at(-1)).toBe(89);
		expect(commandHistory.undoStack).toHaveLength(1);
		commandHistory.undo();
		expect(timelineStore.itemById.get('one')?.motionModifiers?.[0]?.type).toBe('sway');
	});

	it('keeps position coupled while baking one active axis', () => {
		const drift = modifier('float-drift');
		drift.channelGains = { x: 1, y: 0, rotation: 0 };
		timelineStore._setItems([
			{
				...item('one', [drift]),
				transform: { x: 10, y: 20 },
				vectorKeyframes: {
					position: [
						{ id: 'start', frame: 0, value: { x: 10, y: 20 }, easing: 'linear' },
						{ id: 'end', frame: 89, value: { x: 100, y: 200 }, easing: 'linear' }
					]
				}
			}
		]);
		expect(
			bakeMotionToKeyframes({
				itemIds: ['one'],
				fps: 30,
				frameWidth: 1920,
				frameHeight: 1080
			}).ok
		).toBe(true);
		const baked = timelineStore.itemById.get('one');
		expect(baked?.vectorKeyframes?.position?.length).toBeGreaterThan(2);
		expect(baked?.keyframes?.x).toBeUndefined();
		expect(baked?.keyframes?.y).toBeUndefined();
		expect(baked?.vectorKeyframes?.position?.at(-1)?.value.y).toBe(200);
	});

	it('aborts the whole bake before clearing any clip when a transition owns a sample', () => {
		timelineStore._setItems([
			item('one', [modifier('sway')]),
			{ ...item('two', [modifier('spin')]), from: 90 }
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'one',
				toItemId: 'two'
			}
		]);
		expect(
			bakeMotionToKeyframes({
				itemIds: ['one', 'two'],
				fps: 30,
				frameWidth: 1920,
				frameHeight: 1080
			})
		).toEqual({ ok: false, reason: 'transition-blocked' });
		expect(timelineStore.itemById.get('one')?.motionModifiers).toHaveLength(1);
		expect(timelineStore.itemById.get('two')?.motionModifiers).toHaveLength(1);
		expect(timelineStore.itemById.get('one')?.keyframes).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
