import { describe, expect, it } from 'vitest';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import type { MediaMetadata } from './types';
import { assessSmartCopy } from './smart-copy-plan';

const videoTrack: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const audioTrack: TimelineTrack = {
	...videoTrack,
	id: 'audio-track',
	name: 'Audio',
	kind: 'audio',
	order: 1
};

const video: TimelineItem = {
	id: 'video',
	trackId: videoTrack.id,
	from: 0,
	durationInFrames: 300,
	label: 'Interview',
	type: 'video',
	mediaId: 'source',
	linkedGroupId: 'linked',
	sourceStart: 0,
	sourceEnd: 300,
	sourceDuration: 300,
	sourceFps: 30,
	sourceWidth: 1920,
	sourceHeight: 1080,
	volume: 0,
	transform: { x: 0, y: 0, width: 1920, height: 1080, rotation: 0 }
};

const audio: TimelineItem = {
	id: 'audio',
	trackId: audioTrack.id,
	from: 0,
	durationInFrames: 300,
	label: 'Interview',
	type: 'audio',
	mediaId: 'source',
	linkedGroupId: 'linked',
	sourceStart: 0,
	sourceEnd: 300,
	sourceDuration: 300,
	sourceFps: 30,
	volume: 1
};

const media: MediaMetadata = {
	id: 'source',
	storageType: 'workspace',
	fileName: 'interview.webm',
	fileSize: 10_000_000,
	mimeType: 'video/webm',
	duration: 10,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'vp9',
	audioCodec: 'opus',
	bitrate: 8_000_000,
	keyframeTimestamps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	tags: ['video']
};

function project(items: TimelineItem[] = [video, audio]): Project {
	return {
		id: 'project',
		name: 'Project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 10,
		metadata: { width: 1920, height: 1080, fps: 30 },
		timeline: { tracks: [videoTrack, audioTrack], items, transitions: [] }
	};
}

describe('assessSmartCopy', () => {
	it('plans a keyframe-aligned range for an untouched linked video and audio pair', () => {
		const result = assessSmartCopy(
			project(),
			{
				format: 'webm',
				codec: 'vp9',
				width: 1920,
				height: 1080,
				range: { startFrame: 30, endFrame: 90 },
				subtitleMode: 'burn'
			},
			[media]
		);

		expect(result).toMatchObject({
			eligible: true,
			plan: {
				videoCodec: 'vp9',
				audioCodec: 'opus',
				includeAudio: true,
				sourceStartSeconds: 1,
				sourceEndSeconds: 3,
				durationSeconds: 2
			}
		});
	});

	it('rejects non-keyframe starts and any visual or audio edit', () => {
		expect(
			assessSmartCopy(
				project(),
				{
					format: 'webm',
					codec: 'vp9',
					width: 1920,
					height: 1080,
					range: { startFrame: 15, endFrame: 90 }
				},
				[media]
			)
		).toEqual({ eligible: false, blocker: 'keyframe' });

		expect(
			assessSmartCopy(
				project([
					{ ...video, effects: [{ id: 'blur', type: 'blur', enabled: true, amount: 2 }] },
					audio
				]),
				{ format: 'webm', codec: 'vp9', width: 1920, height: 1080 },
				[media]
			)
		).toEqual({ eligible: false, blocker: 'edited-video' });

		expect(
			assessSmartCopy(
				project([video, { ...audio, volume: 0.5 }]),
				{ format: 'webm', codec: 'vp9', width: 1920, height: 1080 },
				[media]
			)
		).toEqual({ eligible: false, blocker: 'edited-audio' });

		for (const editedAudio of [
			{ ...audio, audioPitchSemitones: 3 },
			{ ...audio, audioEqEnabled: true, audioEqHighMidGainDb: 4 }
		]) {
			expect(
				assessSmartCopy(
					project([video, editedAudio]),
					{ format: 'webm', codec: 'vp9', width: 1920, height: 1080 },
					[media]
				)
			).toEqual({ eligible: false, blocker: 'edited-audio' });
		}
	});

	it('rejects a codec, container, or canvas-size change', () => {
		expect(
			assessSmartCopy(project(), { format: 'mp4', codec: 'avc', width: 1920, height: 1080 }, [
				media
			])
		).toEqual({ eligible: false, blocker: 'video-codec' });

		expect(
			assessSmartCopy(project(), { format: 'webm', codec: 'vp9', width: 1280, height: 720 }, [
				media
			])
		).toEqual({ eligible: false, blocker: 'dimensions' });
	});
});
