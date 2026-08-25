import { beforeEach, describe, expect, it } from 'vitest';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import {
	addAdjustmentLayer,
	addMarker,
	addShapeItem,
	addTextItem,
	clearAllMarkers,
	joinItems,
	linkItems,
	removeItems,
	removeMarker,
	rippleDeleteItems,
	setCurrentFrame,
	setItemSpeed,
	setItemsReversed,
	updateItemProperties,
	updateMarker,
	unlinkItems
} from './items';
import { transitionsStore } from './transitions-store.svelte';

function clip(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'clip',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'video',
		mediaId: 'media',
		sourceStart: 0,
		sourceEnd: 30,
		...overrides
	};
}

describe('timeline marker actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	});

	it('adds, edits, removes, clears, and restores markers through history', () => {
		const first = addMarker(12);
		const second = addMarker(42);
		expect(timelineStore.markers).toMatchObject([
			{ id: first, frame: 12, color: '#d97746' },
			{ id: second, frame: 42, color: '#d97746' }
		]);

		expect(updateMarker(first, { frame: 18, label: 'Beat', color: '#22c55e' })).toBe(true);
		expect(timelineStore.markers[0]).toMatchObject({
			id: first,
			frame: 18,
			label: 'Beat',
			color: '#22c55e'
		});
		commandHistory.undo();
		expect(timelineStore.markers[0]).toMatchObject({ id: first, frame: 12 });

		timelineStore._setSelectedMarkerId(first);
		removeMarker(first);
		expect(timelineStore.selectedMarkerId).toBeNull();
		expect(timelineStore.markers.map((marker) => marker.id)).toEqual([second]);
		expect(clearAllMarkers()).toBe(true);
		expect(timelineStore.markers).toEqual([]);
		commandHistory.undo();
		expect(timelineStore.markers.map((marker) => marker.id)).toEqual([second]);
	});
});

describe('timeline navigation lock', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
	});

	it('blocks user seeks during a voiceover take and restores them after unlock', () => {
		setCurrentFrame(12);
		expect(timelineStore.currentFrame).toBe(12);

		timelineStore._setSeekLocked(true);
		setCurrentFrame(90);
		expect(timelineStore.currentFrame).toBe(12);
		editorSession.clock.seek(75);
		expect(timelineStore.currentFrame).toBe(12);

		timelineStore._setSeekLocked(false);
		setCurrentFrame(90);
		expect(timelineStore.currentFrame).toBe(90);
	});
});

describe('timeline delete actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('deletes without closing the gap and honors linked-selection mode', () => {
		timelineStore._setItems([
			clip({ id: 'video', from: 30, linkedGroupId: 'pair' }),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				from: 30,
				type: 'audio',
				linkedGroupId: 'pair'
			}),
			clip({ id: 'later', from: 60 })
		]);

		expect(removeItems(['video'], false)).toEqual(['video']);
		expect(timelineStore.items.map((item) => item.id)).toEqual(['audio', 'later']);
		expect(timelineStore.itemById.get('later')?.from).toBe(60);
		expect(commandHistory.getLastCommandType()).toBe('REMOVE_ITEMS');

		commandHistory.undo();
		expect(removeItems(['video'], true)).toEqual(['video', 'audio']);
		expect(timelineStore.items.map((item) => item.id)).toEqual(['later']);
	});

	it('does not delete items from locked tracks', () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-video-main' ? { ...track, locked: true } : track
			)
		);
		timelineStore._setItems([clip({ id: 'locked' })]);

		expect(removeItems(['locked'])).toEqual([]);
		expect(rippleDeleteItems(['locked'])).toEqual([]);
		expect(timelineStore.itemById.has('locked')).toBe(true);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('ripple deletes one range across edited and sync-locked tracks atomically', () => {
		timelineStore._setItems([
			clip({ id: 'before', from: 0 }),
			clip({ id: 'remove', from: 30, sourceStart: 30, sourceEnd: 60 }),
			clip({ id: 'after', from: 60, sourceStart: 60, sourceEnd: 90 }),
			clip({
				id: 'continuous-audio',
				trackId: 'track-audio',
				type: 'audio',
				from: 0,
				durationInFrames: 120,
				sourceStart: 0,
				sourceEnd: 120
			})
		]);

		const removedIds = rippleDeleteItems(['remove'], false);
		expect(removedIds).toContain('remove');
		expect(timelineStore.itemById.get('after')?.from).toBe(30);
		expect(
			timelineStore.items
				.filter((item) => item.trackId === 'track-audio')
				.sort((left, right) => left.from - right.from)
				.map(({ from, durationInFrames, sourceStart, sourceEnd }) => ({
					from,
					durationInFrames,
					sourceStart,
					sourceEnd
				}))
		).toEqual([
			{ from: 0, durationInFrames: 30, sourceStart: 0, sourceEnd: 30 },
			{ from: 30, durationInFrames: 60, sourceStart: 60, sourceEnd: 120 }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('RIPPLE_DELETE');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.id)).toEqual([
			'before',
			'remove',
			'after',
			'continuous-audio'
		]);
	});
});

describe('addTextItem', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('adds three seconds of text to the top visual track at the playhead and undoes it', () => {
		setCurrentFrame(75);

		const id = addTextItem('Add text');

		expect(timelineStore.itemById.get(id)).toMatchObject({
			id,
			trackId: 'track-video-overlay',
			from: 75,
			durationInFrames: 90,
			label: 'Add text',
			text: 'Add text',
			type: 'text'
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_TEXT_ITEM');

		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});
});

describe('addShapeItem', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('adds a fully styled primitive at the playhead', () => {
		setCurrentFrame(42);
		const id = addShapeItem('star');
		const shape = timelineStore.itemById.get(id);

		expect(shape).toMatchObject({
			trackId: 'track-video-overlay',
			from: 42,
			durationInFrames: 90,
			type: 'shape',
			shapeType: 'star',
			shapePoints: 5,
			shapeInnerRadius: 0.5,
			fillEnabled: true,
			fillColor: '#f97316',
			strokeEnabled: false
		});
		expect(shape?.transform?.width).toBeGreaterThan(0);
		expect(shape?.transform?.height).toBeGreaterThan(0);
		expect(commandHistory.getLastCommandType()).toBe('ADD_SHAPE_ITEM');
		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});

	it('skips a visual track locked by its group', () => {
		const [overlay, main, audio] = createDefaultTracks();
		if (!overlay || !main || !audio) throw new Error('Default tracks are required.');
		timelineStore._setTracks([
			{
				id: 'locked-group',
				name: 'Locked visuals',
				isGroup: true,
				height: 96,
				order: 0,
				locked: true,
				visible: true,
				muted: false,
				solo: false,
				volume: 1
			},
			{ ...overlay, order: 1, parentTrackId: 'locked-group' },
			{ ...main, order: 2 },
			{ ...audio, order: 3 }
		]);

		const id = addShapeItem('rectangle');
		expect(timelineStore.itemById.get(id)?.trackId).toBe(main.id);
	});

	it('starts a pen path across the full project canvas', () => {
		const id = addShapeItem('path');
		expect(timelineStore.itemById.get(id)).toMatchObject({
			type: 'shape',
			shapeType: 'path',
			fillEnabled: false,
			strokeEnabled: true,
			transform: {
				width: 1920,
				height: 1080,
				aspectRatioLocked: false
			}
		});
	});

	it('rejects topology patches while path vertex keys exist', () => {
		const id = addShapeItem('path');
		timelineStore._updateItems([
			{
				id,
				patch: {
					pathVertices: [
						{
							position: [0.2, 0.2],
							inHandle: [0, 0],
							outHandle: [0, 0]
						},
						{
							position: [0.8, 0.8],
							inHandle: [0, 0],
							outHandle: [0, 0]
						}
					],
					pathClosed: false,
					keyframes: {
						'pathVertex:0:positionX': { frames: [0], values: [0.2] }
					}
				}
			}
		]);
		commandHistory.clearHistory();
		updateItemProperties(id, { shapeType: 'rectangle' });
		updateItemProperties(id, { pathClosed: true });
		updateItemProperties(id, { pathVertices: [] });
		expect(timelineStore.itemById.get(id)).toMatchObject({
			shapeType: 'path',
			pathClosed: false
		});
		expect(timelineStore.itemById.get(id)?.pathVertices).toHaveLength(2);
		expect(commandHistory.canUndo).toBe(false);
	});
});

describe('addAdjustmentLayer', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
	});

	it('adds an empty grade layer to the top visual track as one undoable step', () => {
		setCurrentFrame(45);

		const id = addAdjustmentLayer('Adjustment layer');

		expect(timelineStore.itemById.get(id)).toMatchObject({
			trackId: 'track-video-overlay',
			from: 45,
			durationInFrames: 90,
			label: 'Adjustment layer',
			type: 'adjustment',
			effects: []
		});
		expect(commandHistory.getLastCommandType()).toBe('ADD_ADJUSTMENT_LAYER');
		commandHistory.undo();
		expect(timelineStore.itemById.has(id)).toBe(false);
	});

	it('creates a higher visual track when the top track is occupied at the playhead', () => {
		timelineStore._setItems([
			clip({
				id: 'overlay',
				trackId: 'track-video-overlay',
				from: 30,
				durationInFrames: 90
			})
		]);
		setCurrentFrame(45);

		const id = addAdjustmentLayer('Adjustment layer');
		const adjustment = timelineStore.itemById.get(id);
		const adjustmentTrack = timelineStore.tracks.find((track) => track.id === adjustment?.trackId);

		expect(adjustmentTrack?.order).toBe(-1);
		expect(adjustmentTrack?.name).toBe('Adjustment layer');
		expect(timelineStore.tracks).toHaveLength(4);
		commandHistory.undo();
		expect(timelineStore.tracks).toHaveLength(3);
		expect(timelineStore.items).toHaveLength(1);
	});
});

describe('linked item actions', () => {
	beforeEach(() => {
		timelineStore.__resetForTesting();
		timelineStore._setTracks(createDefaultTracks());
		commandHistory.clearHistory();
		transitionsStore.clear();
	});

	it('links the full existing groups behind a multi-item selection', () => {
		const video = clip({ id: 'video', linkedGroupId: 'old-group' });
		const audio = clip({
			id: 'audio',
			trackId: 'track-audio',
			type: 'audio',
			linkedGroupId: 'old-group'
		});
		const secondAudio = clip({
			id: 'second-audio',
			trackId: 'track-audio',
			type: 'audio'
		});
		timelineStore._setItems([video, audio, secondAudio]);

		expect(linkItems(['video', 'second-audio'])).toBe(true);
		const group = timelineStore.itemById.get('video')?.linkedGroupId;
		expect(group).toBeTruthy();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([group, group, group]);
		expect(commandHistory.getLastCommandType()).toBe('LINK_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([
			'old-group',
			'old-group',
			undefined
		]);
	});

	it('does not create a link for one selected clip', () => {
		timelineStore._setItems([clip({ id: 'video' })]);

		expect(linkItems(['video'])).toBe(false);
		expect(commandHistory.canUndo).toBe(false);
	});

	it('unlinks every member of a selected clip group as one undo step', () => {
		timelineStore._setItems([
			clip({ id: 'video', linkedGroupId: 'group' }),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group'
			})
		]);

		expect(unlinkItems(['video'])).toBe(true);
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual([undefined, undefined]);
		expect(commandHistory.getLastCommandType()).toBe('UNLINK_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.linkedGroupId)).toEqual(['group', 'group']);
	});

	it('reverses linked video and audio together as one undo step', () => {
		timelineStore._setItems([
			clip({ id: 'video', linkedGroupId: 'group' }),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group'
			})
		]);

		expect(setItemsReversed(['video'], true)).toEqual(['video', 'audio']);
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([true, true]);
		expect(commandHistory.getLastCommandType()).toBe('SET_ITEMS_REVERSED');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.isReversed)).toEqual([undefined, undefined]);
	});

	it('does not reverse clips on locked tracks', () => {
		timelineStore._setTracks(
			timelineStore.tracks.map((track) =>
				track.id === 'track-video-main' ? { ...track, locked: true } : track
			)
		);
		timelineStore._setItems([clip({ id: 'video' })]);

		expect(setItemsReversed(['video'], true)).toEqual([]);
		expect(timelineStore.itemById.get('video')?.isReversed).toBeUndefined();
		expect(commandHistory.canUndo).toBe(false);
	});

	it('retimes linked A/V from the exact source span and scales animation in one undo step', () => {
		timelineStore._setItems([
			clip({
				id: 'video',
				linkedGroupId: 'group',
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 180,
				sourceFps: 60,
				speed: 2,
				keyframes: { opacity: { frames: [0, 29], values: [0, 1] } }
			}),
			clip({
				id: 'audio',
				trackId: 'track-audio',
				type: 'audio',
				linkedGroupId: 'group',
				durationInFrames: 30,
				sourceStart: 60,
				sourceEnd: 180,
				sourceFps: 60,
				speed: 2,
				keyframes: { volume: { frames: [0, 29], values: [0, 1] } }
			})
		]);

		expect(setItemSpeed('video', 1)).toBe(true);
		expect(
			timelineStore.items.map((item) => ({
				id: item.id,
				speed: item.speed,
				duration: item.durationInFrames
			}))
		).toEqual([
			{ id: 'video', speed: 1, duration: 60 },
			{ id: 'audio', speed: 1, duration: 60 }
		]);
		expect(timelineStore.itemById.get('video')?.keyframes?.opacity?.frames).toEqual([0, 58]);
		expect(timelineStore.itemById.get('audio')?.keyframes?.volume?.frames).toEqual([0, 58]);
		expect(commandHistory.getLastCommandType()).toBe('SET_ITEM_SPEED');

		commandHistory.undo();
		expect(timelineStore.items.map((item) => item.durationInFrames)).toEqual([30, 30]);
		expect(timelineStore.items.map((item) => item.speed)).toEqual([2, 2]);
	});

	it('joins linked split siblings and repairs transition endpoints as one undo step', () => {
		const linkedGroupId = 'linked';
		const originId = 'source-edit';
		const videoLeft = clip({ id: 'video-left', originId, linkedGroupId, sourceEnd: 30 });
		const videoRight = clip({
			id: 'video-right',
			originId,
			linkedGroupId,
			from: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		const audioLeft = clip({
			id: 'audio-left',
			originId,
			linkedGroupId,
			trackId: 'track-audio',
			type: 'audio',
			sourceEnd: 30
		});
		const audioRight = clip({
			id: 'audio-right',
			originId,
			linkedGroupId,
			trackId: 'track-audio',
			type: 'audio',
			from: 30,
			sourceStart: 30,
			sourceEnd: 60
		});
		const next = clip({
			id: 'next',
			originId: 'next-origin',
			from: 60,
			sourceStart: 60,
			sourceEnd: 90
		});
		timelineStore._setItems([videoLeft, videoRight, audioLeft, audioRight, next]);
		transitionsStore.setAll([
			{
				id: 'internal',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video-left',
				toItemId: 'video-right'
			},
			{
				id: 'external',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video-right',
				toItemId: 'next'
			}
		]);

		expect(joinItems(['video-left', 'video-right'])).toEqual(['video-left', 'audio-left']);
		expect(timelineStore.items.map((item) => item.id)).toEqual([
			'video-left',
			'audio-left',
			'next'
		]);
		expect(timelineStore.itemById.get('video-left')).toMatchObject({
			durationInFrames: 60,
			sourceStart: 0,
			sourceEnd: 60
		});
		expect(transitionsStore.list).toEqual([
			expect.objectContaining({
				id: 'external',
				fromItemId: 'video-left',
				toItemId: 'next'
			})
		]);
		expect(commandHistory.getLastCommandType()).toBe('JOIN_ITEMS');

		commandHistory.undo();
		expect(timelineStore.items).toHaveLength(5);
		expect(transitionsStore.list).toHaveLength(2);
	});
});
