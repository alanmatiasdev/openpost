import { describe, expect, it } from 'vitest';
import type { SubComposition, TimelineTrack } from '../project/types';
import type { MediaMetadata } from './types';
import { mediaDurationInFrames } from './media-drop-placement';
import {
	evaluateExactMediaPlacement,
	mediaDropAutoScrollDelta,
	planExactSequencePlacement
} from './media-drop-placement';

function track(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id: 'video',
		name: 'Video',
		kind: 'video',
		height: 96,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...overrides
	};
}

describe('exact media timeline placement', () => {
	it('accelerates auto-scroll only inside the timeline edges', () => {
		expect(mediaDropAutoScrollDelta(50, 0, 500)).toBeCloseTo(-5.5, 1);
		expect(mediaDropAutoScrollDelta(250, 0, 500)).toBe(0);
		expect(mediaDropAutoScrollDelta(500, 0, 500)).toBe(18);
	});

	it('uses real animation duration while still images get the editor default', () => {
		const base: MediaMetadata = {
			id: 'image',
			storageType: 'workspace',
			fileName: 'Still.png',
			fileSize: 1,
			mimeType: 'image/png',
			duration: 0,
			width: 100,
			height: 100,
			fps: 0,
			codec: '',
			bitrate: 0,
			tags: ['image']
		};
		expect(mediaDurationInFrames(base, 30)).toBe(90);
		expect(mediaDurationInFrames({ ...base, duration: 1.25, animationFrameCount: 12 }, 30)).toBe(
			38
		);
	});

	it('keeps the requested row and rounds the requested frame', () => {
		expect(
			evaluateExactMediaPlacement({
				trackId: 'video',
				from: 42.4,
				durationInFrames: 30,
				kind: 'video',
				tracks: [track()],
				items: []
			})
		).toEqual({
			valid: true,
			placement: { trackId: 'video', from: 42, durationInFrames: 30 }
		});
	});

	it('rejects an occupied exact row instead of silently choosing another', () => {
		const tracks = [track(), track({ id: 'overlay', name: 'Overlay', order: -1 })];
		expect(
			evaluateExactMediaPlacement({
				trackId: 'video',
				from: 29,
				durationInFrames: 10,
				kind: 'video',
				tracks,
				items: [{ trackId: 'video', from: 0, durationInFrames: 30 }]
			})
		).toEqual({ valid: false, reason: 'collision' });
	});

	it.each([
		[track({ kind: 'audio' }), 'wrong-kind'],
		[track({ locked: true }), 'locked'],
		[track({ visible: false }), 'hidden'],
		[track({ isGroup: true }), 'group-track']
	] as const)('rejects an invalid target row', (candidate, reason) => {
		expect(
			evaluateExactMediaPlacement({
				trackId: candidate.id,
				from: 0,
				durationInFrames: 30,
				kind: 'video',
				tracks: [candidate],
				items: []
			})
		).toEqual({ valid: false, reason });
	});
});

describe('exact sequence timeline placement', () => {
	const composition: SubComposition = {
		id: 'nested',
		name: 'Nested',
		items: [
			{
				id: 'video-item',
				trackId: 'inside',
				from: 0,
				durationInFrames: 60,
				label: 'Video',
				type: 'video'
			}
		],
		tracks: [track({ id: 'inside' })],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 60
	};

	it('plans the exact visual row and an open audio row for a mixed sequence', () => {
		expect(
			planExactSequencePlacement({
				composition,
				preferredTrackId: 'video',
				from: 90,
				tracks: [track(), track({ id: 'audio', name: 'Audio', kind: 'audio', order: 1 })],
				items: []
			})
		).toEqual({
			valid: true,
			placement: { visualTrackId: 'video', audioTrackId: 'audio' }
		});
	});

	it('rejects the whole mixed sequence when its required audio row is occupied', () => {
		expect(
			planExactSequencePlacement({
				composition,
				preferredTrackId: 'video',
				from: 90,
				tracks: [track(), track({ id: 'audio', name: 'Audio', kind: 'audio', order: 1 })],
				items: [{ trackId: 'audio', from: 100, durationInFrames: 10 }]
			})
		).toEqual({ valid: false, reason: 'collision' });
	});
});
