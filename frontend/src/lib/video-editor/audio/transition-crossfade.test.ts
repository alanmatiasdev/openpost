import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack, TimelineTransition } from '../project/types';
import { planMixdown, sliceMixEntries } from '../media/render-plan';
import {
	audioCrossfadeGainAtFrame,
	buildTransitionGainCurve,
	equalPowerGain,
	isAudioTransitionParticipantAtFrame,
	transitionGainSpansForItem,
	type TransitionGainSpan
} from './transition-crossfade';

const FPS = 30;

function track(id: string, kind: 'video' | 'audio' = 'video', volume = 1): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: kind === 'video' ? 0 : 1,
		volume
	};
}

function clip(extra: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 60,
		label: '',
		type: 'video',
		mediaId: 'media-1',
		sourceStart: 0,
		sourceEnd: 60,
		sourceDuration: 90,
		sourceFps: FPS,
		...extra
	};
}

function transition(
	fromItemId: string,
	toItemId: string,
	durationInFrames = 20,
	extra: Partial<TimelineTransition> = {}
): TimelineTransition {
	return {
		id: `transition-${fromItemId}-${toItemId}`,
		type: 'crossfade',
		durationInFrames,
		fromItemId,
		toItemId,
		...extra
	};
}

function cutPair(durationInFrames = 20) {
	const left = clip({ id: 'left' });
	const right = clip({
		id: 'right',
		from: 60,
		mediaId: 'media-2',
		sourceStart: 10,
		sourceEnd: 70
	});
	return {
		left,
		right,
		transition: transition('left', 'right', durationInFrames),
		itemsById: new Map([
			['left', left],
			['right', right]
		])
	};
}

describe('equal-power transition gain', () => {
	it('hits exact endpoints and keeps summed power constant', () => {
		for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
			const outgoing = equalPowerGain(progress, false);
			const incoming = equalPowerGain(progress, true);
			expect(outgoing * outgoing + incoming * incoming).toBeCloseTo(1, 12);
		}
		expect(equalPowerGain(0, false)).toBe(1);
		expect(equalPowerGain(0, true)).toBe(0);
		expect(equalPowerGain(1, false)).toBeCloseTo(0, 12);
		expect(equalPowerGain(1, true)).toBe(1);
	});

	it('builds exact full and partial sample-level curves', () => {
		const span: TransitionGainSpan = {
			startSeconds: 1,
			durationSeconds: 2,
			isIncoming: true,
			dipToSilence: false
		};
		const full = buildTransitionGainCurve(span, 1, 3, 4);
		expect(full).toHaveLength(9);
		expect(full[0]).toBe(0);
		expect(full[4]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(full[8]).toBe(1);

		const partial = buildTransitionGainCurve(span, 2, 3, 4);
		expect(partial[0]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(partial[partial.length - 1]).toBe(1);
	});

	it('dips to silence between outgoing and incoming halves', () => {
		const outgoing: TransitionGainSpan = {
			startSeconds: 0,
			durationSeconds: 1,
			isIncoming: false,
			dipToSilence: true
		};
		const incoming = { ...outgoing, isIncoming: true };
		const outCurve = buildTransitionGainCurve(outgoing, 0, 1, 4);
		const inCurve = buildTransitionGainCurve(incoming, 0, 1, 4);
		expect(outCurve[0]).toBe(1);
		expect(outCurve[2]).toBe(0);
		expect(outCurve[4]).toBe(0);
		expect(inCurve[0]).toBe(0);
		expect(inCurve[2]).toBe(0);
		expect(inCurve[4]).toBe(1);
	});
});

describe('preview crossfade', () => {
	it('hits exact first, middle, and last active frame values', () => {
		const pair = cutPair(21);
		const transitions = [pair.transition];
		expect(audioCrossfadeGainAtFrame(pair.left, 50, transitions, pair.itemsById)).toBe(1);
		expect(audioCrossfadeGainAtFrame(pair.right, 50, transitions, pair.itemsById)).toBe(0);
		expect(audioCrossfadeGainAtFrame(pair.left, 60, transitions, pair.itemsById)).toBeCloseTo(
			Math.SQRT1_2,
			12
		);
		expect(audioCrossfadeGainAtFrame(pair.right, 60, transitions, pair.itemsById)).toBeCloseTo(
			Math.SQRT1_2,
			12
		);
		expect(audioCrossfadeGainAtFrame(pair.left, 70, transitions, pair.itemsById)).toBeCloseTo(
			0,
			12
		);
		expect(audioCrossfadeGainAtFrame(pair.right, 70, transitions, pair.itemsById)).toBe(1);
		expect(audioCrossfadeGainAtFrame(pair.left, 71, transitions, pair.itemsById)).toBe(1);
	});

	it('keeps a middle clip mounted through both expanded windows', () => {
		const a = clip({ id: 'a' });
		const b = clip({
			id: 'b',
			from: 60,
			mediaId: 'media-b',
			sourceStart: 10,
			sourceEnd: 70,
			sourceDuration: 80
		});
		const c = clip({ id: 'c', from: 120, mediaId: 'media-c', sourceStart: 10 });
		const transitions = [transition('a', 'b'), transition('b', 'c')];
		const itemsById = new Map([
			['a', a],
			['b', b],
			['c', c]
		]);
		expect(isAudioTransitionParticipantAtFrame(b, 50, transitions, itemsById, FPS)).toBe(true);
		expect(isAudioTransitionParticipantAtFrame(b, 129, transitions, itemsById, FPS)).toBe(true);
		expect(isAudioTransitionParticipantAtFrame(b, 130, transitions, itemsById, FPS)).toBe(false);
		expect(audioCrossfadeGainAtFrame(b, 50, transitions, itemsById)).toBe(0);
		expect(audioCrossfadeGainAtFrame(b, 90, transitions, itemsById)).toBe(1);
	});

	it('deduplicates matching video and linked-audio transitions', () => {
		const leftVideo = clip({ id: 'left-video', linkedGroupId: 'left-group' });
		const rightVideo = clip({
			id: 'right-video',
			from: 60,
			mediaId: 'media-2',
			linkedGroupId: 'right-group'
		});
		const leftAudio = clip({
			id: 'left-audio',
			type: 'audio',
			trackId: 'audio',
			linkedGroupId: 'left-group'
		});
		const rightAudio = clip({
			id: 'right-audio',
			type: 'audio',
			trackId: 'audio',
			from: 60,
			mediaId: 'media-2',
			linkedGroupId: 'right-group',
			sourceStart: 10,
			sourceEnd: 70
		});
		const transitions = [
			transition('left-video', 'right-video'),
			transition('left-audio', 'right-audio')
		];
		const items = [leftVideo, rightVideo, leftAudio, rightAudio];
		const itemsById = new Map(items.map((item) => [item.id, item]));
		expect(transitionGainSpansForItem(rightAudio, transitions, itemsById, FPS)).toHaveLength(1);
		expect(audioCrossfadeGainAtFrame(rightAudio, 60, transitions, itemsById)).toBeCloseTo(
			Math.sin((10 / 19) * (Math.PI / 2)),
			12
		);
	});
});

describe('transition mix planning', () => {
	it('expands both clips across the full cut-centered window', () => {
		const pair = cutPair();
		const entries = planMixdown([pair.left, pair.right], [track('video')], FPS, [pair.transition]);
		const left = entries.find((entry) => entry.itemId === 'left')!;
		const right = entries.find((entry) => entry.itemId === 'right')!;
		expect(left.whenSeconds).toBe(0);
		expect(left.sourceOffsetSeconds).toBe(0);
		expect(left.durationSeconds).toBeCloseTo(70 / FPS);
		expect(right.whenSeconds).toBeCloseTo(50 / FPS);
		expect(right.sourceOffsetSeconds).toBe(0);
		expect(right.durationSeconds).toBeCloseTo(70 / FPS);
		expect(left.transitionGainSpans).toEqual([
			expect.objectContaining({
				startSeconds: 50 / FPS,
				durationSeconds: 20 / FPS,
				isIncoming: false
			})
		]);
		expect(right.transitionGainSpans).toEqual([
			expect.objectContaining({
				startSeconds: 50 / FPS,
				durationSeconds: 20 / FPS,
				isIncoming: true
			})
		]);
	});

	it('uses linked audio companions once', () => {
		const leftVideo = clip({ id: 'left-video', linkedGroupId: 'left-group' });
		const rightVideo = clip({
			id: 'right-video',
			from: 60,
			mediaId: 'media-2',
			linkedGroupId: 'right-group'
		});
		const leftAudio = clip({
			id: 'left-audio',
			type: 'audio',
			trackId: 'audio',
			linkedGroupId: 'left-group'
		});
		const rightAudio = clip({
			id: 'right-audio',
			type: 'audio',
			trackId: 'audio',
			from: 60,
			mediaId: 'media-2',
			linkedGroupId: 'right-group',
			sourceStart: 10,
			sourceEnd: 70
		});
		const entries = planMixdown(
			[leftVideo, rightVideo, leftAudio, rightAudio],
			[track('video'), track('audio', 'audio')],
			FPS,
			[transition('left-video', 'right-video')]
		);
		expect(entries.map((entry) => entry.itemId)).toEqual(['left-audio', 'right-audio']);
	});

	it('expands a middle clip before and after chained transitions', () => {
		const a = clip({ id: 'a' });
		const b = clip({
			id: 'b',
			from: 60,
			mediaId: 'media-b',
			sourceStart: 10,
			sourceEnd: 70,
			sourceDuration: 80
		});
		const c = clip({ id: 'c', from: 120, mediaId: 'media-c', sourceStart: 10 });
		const entries = planMixdown([a, b, c], [track('video')], FPS, [
			transition('a', 'b'),
			transition('b', 'c')
		]);
		const middle = entries.find((entry) => entry.itemId === 'b')!;
		expect(middle.whenSeconds).toBeCloseTo(50 / FPS);
		expect(middle.durationSeconds).toBeCloseTo(80 / FPS);
		expect(middle.transitionGainSpans).toHaveLength(2);
	});

	it('clamps extensions to available source handles', () => {
		const left = clip({ id: 'left', sourceEnd: 60, sourceDuration: 63 });
		const right = clip({
			id: 'right',
			from: 60,
			mediaId: 'media-2',
			sourceStart: 4,
			sourceEnd: 64,
			sourceDuration: 90
		});
		const entries = planMixdown([left, right], [track('video')], FPS, [
			transition('left', 'right')
		]);
		expect(entries.find((entry) => entry.itemId === 'left')?.durationSeconds).toBeCloseTo(63 / FPS);
		const rightEntry = entries.find((entry) => entry.itemId === 'right')!;
		expect(rightEntry.whenSeconds).toBeCloseTo(56 / FPS);
		expect(rightEntry.sourceOffsetSeconds).toBe(0);
		expect(rightEntry.durationSeconds).toBeCloseTo(64 / FPS);
	});

	it('keeps base and keyframed volume separate from transition gain', () => {
		const pair = cutPair();
		pair.left.volume = 0.8;
		pair.left.keyframes = { volume: { frames: [0, 60], values: [0.2, 1] } };
		const entries = planMixdown([pair.left, pair.right], [track('video', 'video', 0.5)], FPS, [
			pair.transition
		]);
		const left = entries.find((entry) => entry.itemId === 'left')!;
		expect(left.gainPoints.find((point) => point.whenSeconds === 0)?.value).toBeCloseTo(0.1);
		expect(left.gainPoints.find((point) => point.whenSeconds === 2)?.value).toBeCloseTo(0.5);
		expect(left.transitionGainSpans).toHaveLength(1);
	});

	it('preserves gain and transition progress in a partial export range', () => {
		const entry = {
			itemId: 'left',
			mediaId: 'media-1',
			whenSeconds: 0,
			sourceOffsetSeconds: 1,
			playbackRate: 2,
			reversed: false,
			durationSeconds: 4,
			gainPoints: [
				{ whenSeconds: 0, value: 0 },
				{ whenSeconds: 4, value: 1 }
			],
			transitionGainSpans: [
				{
					startSeconds: 1,
					durationSeconds: 2,
					isIncoming: true,
					dipToSilence: false
				}
			]
		};
		const sliced = sliceMixEntries([entry], 2, 3)[0]!;
		expect(sliced.whenSeconds).toBe(0);
		expect(sliced.sourceOffsetSeconds).toBe(5);
		expect(sliced.durationSeconds).toBe(1);
		expect(sliced.gainPoints[0]).toEqual({ whenSeconds: 0, value: 0.5 });
		expect(sliced.transitionGainSpans[0]?.startSeconds).toBe(-1);
		const curve = buildTransitionGainCurve(sliced.transitionGainSpans[0]!, 0, 1, 4);
		expect(curve[0]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(curve[curve.length - 1]).toBe(1);
	});
});
