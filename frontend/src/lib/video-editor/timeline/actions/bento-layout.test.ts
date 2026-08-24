import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { applyBentoLayout, eligibleBentoItemIds } from './bento-layout';
import { transitionsStore } from './transitions-store.svelte';

function track(id: string, order: number, locked = false): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 96,
		locked,
		visible: true,
		muted: false,
		solo: false,
		volume: 1,
		order
	};
}

function item(id: string, trackId = 'visual'): TimelineItem {
	return {
		id,
		trackId,
		from: 0,
		durationInFrames: 60,
		label: id,
		type: 'video',
		mediaId: `media-${id}`,
		sourceStart: 0,
		sourceEnd: 60,
		sourceWidth: 1920,
		sourceHeight: 1080,
		transform: { x: 40, y: 20, width: 800, height: 450, anchorX: 100, anchorY: 80 },
		keyframes: {
			x: { frames: [0], values: [40] },
			opacity: { frames: [0], values: [0.5] }
		},
		vectorKeyframes: {
			position: [{ id: `${id}-position`, frame: 0, value: { x: 40, y: 20 }, easing: 'linear' }],
			anchor: [{ id: `${id}-anchor`, frame: 0, value: { x: 100, y: 80 }, easing: 'linear' }]
		},
		propertyLinks: [
			{
				type: 'link',
				targetProperty: 'position',
				sourceItemId: 'source',
				sourceProperty: 'position',
				enabled: true,
				timeOffsetFrames: 0
			},
			{
				type: 'link',
				targetProperty: 'opacity',
				sourceItemId: 'source',
				sourceProperty: 'opacity',
				enabled: true,
				timeOffsetFrames: 0
			}
		],
		expressions: [
			{ type: 'expression', targetProperty: 'rotation', source: '12', enabled: true },
			{ type: 'expression', targetProperty: 'opacity', source: '0.8', enabled: true }
		],
		motionModifiers: [
			{
				id: `${id}-drift`,
				type: 'float-drift',
				enabled: true,
				amplitude: 1,
				frequency: 1,
				phaseFrames: 0,
				seed: 1,
				channelGains: { x: 1, y: 0 }
			},
			{
				id: `${id}-opacity`,
				type: 'breath-pulse',
				enabled: true,
				amplitude: 1,
				frequency: 1,
				phaseFrames: 0,
				seed: 2,
				channelGains: { width: 0, height: 0, opacity: 1 }
			}
		]
	};
}

describe('applyBentoLayout', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		transitionsStore.clear();
		timelineStore._setTracks([
			track('visual', 0),
			track('locked', 1, true),
			{ ...track('audio', 2), kind: 'audio' }
		]);
	});

	it('groups transition chains, clears conflicting drivers, and undoes atomically', () => {
		const a = item('a');
		const b = item('b');
		const c = item('c');
		const locked = item('locked-item', 'locked');
		const audio = { ...item('audio-item', 'audio'), type: 'audio' as const };
		const beforeA = structuredClone(a);
		const beforeB = structuredClone(b);
		timelineStore._setItems([a, b, c, locked, audio]);
		transitionsStore.setAll([
			{
				id: 'a-b',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'a',
				toItemId: 'b'
			}
		]);

		expect(eligibleBentoItemIds(['a', 'locked-item', 'audio-item', 'a', 'c'])).toEqual(['a', 'c']);
		const applied = applyBentoLayout({
			itemIds: ['a', 'b', 'c', 'locked-item', 'audio-item'],
			canvasWidth: 1280,
			canvasHeight: 720,
			config: { preset: 'row', gap: 20 }
		});
		expect(applied).toEqual(['a', 'b', 'c']);
		expect(timelineStore.itemById.get('a')?.transform).toEqual(
			timelineStore.itemById.get('b')?.transform
		);
		expect(timelineStore.itemById.get('a')?.transform?.x).toBeLessThan(
			timelineStore.itemById.get('c')?.transform?.x ?? 0
		);
		const arranged = timelineStore.itemById.get('a')!;
		expect(arranged.keyframes?.x).toBeUndefined();
		expect(arranged.keyframes?.opacity).toBeDefined();
		expect(arranged.vectorKeyframes).toBeUndefined();
		expect(arranged.propertyLinks?.map((link) => link.targetProperty)).toEqual(['opacity']);
		expect(arranged.expressions?.map((expression) => expression.targetProperty)).toEqual([
			'opacity'
		]);
		expect(arranged.motionModifiers?.map((modifier) => modifier.id)).toEqual(['a-opacity']);
		expect(arranged.transform?.anchorX).toBe((arranged.transform?.width ?? 0) / 2);
		expect(timelineStore.itemById.get('locked-item')?.transform).toEqual(locked.transform);
		expect(commandHistory.getLastCommandType()).toBe('APPLY_BENTO_LAYOUT');

		commandHistory.undo();
		expect(timelineStore.itemById.get('a')).toEqual(beforeA);
		expect(timelineStore.itemById.get('b')).toEqual(beforeB);
	});

	it('honors explicit cell order and rejects fewer than two eligible visuals', () => {
		timelineStore._setItems([item('a'), item('b'), item('locked-item', 'locked')]);
		expect(
			applyBentoLayout({
				itemIds: ['a', 'locked-item'],
				canvasWidth: 1280,
				canvasHeight: 720,
				config: { preset: 'auto' }
			})
		).toEqual([]);
		const applied = applyBentoLayout({
			itemIds: ['a', 'b'],
			canvasWidth: 1280,
			canvasHeight: 720,
			config: { preset: 'row' },
			orderedChains: [['b'], ['a']]
		});
		expect(applied).toEqual(['b', 'a']);
		expect(timelineStore.itemById.get('b')!.transform!.x!).toBeLessThan(
			timelineStore.itemById.get('a')!.transform!.x!
		);
	});
});
