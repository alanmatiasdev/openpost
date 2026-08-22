import { describe, expect, it } from 'vitest';
import type {
	SubtitleCue,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import {
	frameToSourceSeconds,
	isVisibleAtFrame,
	outputDurationFrames,
	paintOrder,
	planMixdown,
	selectCuesAtFrame,
	transitionBlendAtFrame
} from './render-plan';

function track(
	id: string,
	kind: 'video' | 'audio',
	order: number,
	extra: Partial<TimelineTrack> = {}
): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order,
		...extra
	};
}

function item(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'item',
		trackId: 'track-video-main',
		from: 0,
		durationInFrames: 100,
		label: '',
		type: 'video',
		...extra
	};
}

describe('outputDurationFrames', () => {
	it('returns the max item end frame', () => {
		expect(
			outputDurationFrames([
				item({ from: 10, durationInFrames: 40 }),
				item({ durationInFrames: 200 })
			])
		).toBe(200);
	});

	it('returns zero for an empty timeline', () => {
		expect(outputDurationFrames([])).toBe(0);
	});
});

describe('isVisibleAtFrame', () => {
	it('includes the start frame and excludes the end frame', () => {
		const clip = item({ from: 30, durationInFrames: 20 });
		expect(isVisibleAtFrame(clip, 29)).toBe(false);
		expect(isVisibleAtFrame(clip, 30)).toBe(true);
		expect(isVisibleAtFrame(clip, 49)).toBe(true);
		expect(isVisibleAtFrame(clip, 50)).toBe(false);
	});
});

describe('frameToSourceSeconds', () => {
	it('maps timeline frames to source time at matching fps', () => {
		const clip = item({ sourceStart: 30, sourceFps: 30 });
		expect(frameToSourceSeconds(clip, 0, 30)).toBeCloseTo(1);
		expect(frameToSourceSeconds(clip, 30, 30)).toBeCloseTo(2);
	});

	it('scales by speed and respects a different source fps', () => {
		const clip = item({ sourceStart: 0, sourceFps: 60, speed: 2 });
		expect(frameToSourceSeconds(clip, 30, 30)).toBeCloseTo(2);
		expect(frameToSourceSeconds(clip, 15, 30)).toBeCloseTo(1);
	});
});

describe('planMixdown', () => {
	it('schedules clips at their timeline offsets with volume gain', () => {
		const entries = planMixdown(
			[
				item({
					id: 'a',
					type: 'audio',
					trackId: 'track-audio',
					mediaId: 'media-a',
					from: 60,
					durationInFrames: 90,
					sourceStart: 45,
					sourceFps: 30,
					volume: 0.5
				})
			],
			[track('track-audio', 'audio', 2, { volume: 0.8 })],
			30
		);
		expect(entries.length).toBe(1);
		const entry = entries[0]!;
		expect(entry.mediaId).toBe('media-a');
		expect(entry.whenSeconds).toBe(2);
		expect(entry.sourceOffsetSeconds).toBe(1.5);
		expect(entry.playbackRate).toBe(1);
		expect(entry.durationSeconds).toBe(3);
		expect(entry.gainPoints[0]?.value).toBeCloseTo(0.4);
	});

	it('drops muted tracks and items without media', () => {
		const entries = planMixdown(
			[
				item({ mediaId: 'muted-clip' }),
				item({ id: 'no-media', type: 'audio' }),
				item({ id: 'subtitle-only', type: 'subtitle', mediaId: 'captions' })
			],
			[track('track-video-main', 'video', 1, { muted: true })],
			30
		);
		expect(entries).toEqual([]);
	});

	it('drops audio from hidden video tracks', () => {
		const entries = planMixdown(
			[item({ mediaId: 'hidden-video-audio' })],
			[track('track-video-main', 'video', 1, { visible: false })],
			30
		);
		expect(entries).toEqual([]);
	});

	it('mutes non-soloed tracks when any track is soloed', () => {
		const tracks = [
			track('track-video-main', 'video', 1),
			track('track-audio', 'audio', 2, { solo: true })
		];
		const entries = planMixdown(
			[
				item({ mediaId: 'main-audio' }),
				item({ id: 'soloed', trackId: 'track-audio', mediaId: 'solo-audio' })
			],
			tracks,
			30
		);
		expect(entries.map((entry) => entry.mediaId)).toEqual(['solo-audio']);
	});

	it('applies speed as playback rate and shrinks real duration', () => {
		const entries = planMixdown(
			[item({ mediaId: 'fast', speed: 2, durationInFrames: 60 })],
			[track('track-video-main', 'video', 1)],
			30
		);
		expect(entries[0]?.playbackRate).toBe(2);
		expect(entries[0]?.durationSeconds).toBeCloseTo(2);
	});

	it('emits keyframed volume automation points in mix time', () => {
		const entries = planMixdown(
			[
				item({
					id: 'fade',
					type: 'audio',
					trackId: 'track-audio',
					mediaId: 'faded',
					from: 30,
					durationInFrames: 60,
					keyframes: { volume: { frames: [0, 60], values: [0, 1] } }
				})
			],
			[track('track-audio', 'audio', 2)],
			30
		);
		const points = entries[0]?.gainPoints ?? [];
		expect(points.length).toBeGreaterThanOrEqual(2);
		expect(points[0]).toMatchObject({ whenSeconds: 1, value: 0 });
		expect(points[points.length - 1]).toMatchObject({ whenSeconds: 3, value: 1 });
	});
});

describe('transitionBlendAtFrame', () => {
	const clips = new Map([
		['left', item({ id: 'left', from: 0, durationInFrames: 100 })],
		['right', item({ id: 'right', from: 100, durationInFrames: 100 })]
	]);
	const transitions: TimelineTransition[] = [
		{ id: 't', type: 'crossfade', durationInFrames: 20, fromItemId: 'left', toItemId: 'right' }
	];

	it('returns null outside the transition window', () => {
		expect(transitionBlendAtFrame(transitions, clips, 79)).toBeNull();
		expect(transitionBlendAtFrame(transitions, clips, 100)).toBeNull();
	});

	it('reports progress across the window', () => {
		expect(transitionBlendAtFrame(transitions, clips, 80)).toMatchObject({
			outgoingId: 'left',
			incomingId: 'right',
			progress: 0
		});
		expect(transitionBlendAtFrame(transitions, clips, 90)).toMatchObject({ progress: 0.5 });
		expect(transitionBlendAtFrame(transitions, clips, 99)).toMatchObject({ progress: 0.95 });
	});

	it('ignores transitions whose items are gone', () => {
		const orphaned: TimelineTransition[] = [{ ...transitions[0]!, toItemId: 'missing' }];
		expect(transitionBlendAtFrame(orphaned, clips, 90)).toBeNull();
	});
});

describe('paintOrder', () => {
	it('paints higher-order tracks first so overlays end up on top', () => {
		const tracks = [track('overlay', 'video', 0), track('main', 'video', 1)];
		const ordered = paintOrder(
			[item({ id: 'base', trackId: 'main' }), item({ id: 'top', trackId: 'overlay' })],
			tracks
		);
		expect(ordered.map((entry) => entry.id)).toEqual(['base', 'top']);
	});

	it('omits items on hidden tracks from the visual plan', () => {
		const tracks = [track('shown', 'video', 0), track('hidden', 'video', 1, { visible: false })];
		const ordered = paintOrder(
			[
				item({ id: 'shown-item', trackId: 'shown' }),
				item({ id: 'hidden-item', trackId: 'hidden' })
			],
			tracks
		);
		expect(ordered.map((entry) => entry.id)).toEqual(['shown-item']);
	});
});

describe('selectCuesAtFrame', () => {
	const cues: SubtitleCue[] = [
		{ id: 'a', startFrame: 0, endFrame: 30, text: 'Hello' },
		{ id: 'b', startFrame: 30, endFrame: 60, text: 'World' }
	];

	it('selects only the active cue', () => {
		expect(selectCuesAtFrame(cues, 10).map((cue) => cue.id)).toEqual(['a']);
		expect(selectCuesAtFrame(cues, 30).map((cue) => cue.id)).toEqual(['b']);
	});

	it('returns nothing between cues or past the end', () => {
		expect(selectCuesAtFrame(cues, -1)).toEqual([]);
		expect(selectCuesAtFrame(cues, 60)).toEqual([]);
	});
});
