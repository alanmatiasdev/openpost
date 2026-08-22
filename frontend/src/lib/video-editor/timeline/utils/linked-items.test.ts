import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import { getSynchronizedLinkedCounterpartPair, getSynchronizedLinkedItems } from './linked-items';

function mediaItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		mediaId: 'media',
		linkedGroupId: 'group',
		sourceStart: 0,
		sourceEnd: 60,
		speed: 1,
		...overrides
	};
}

describe('synchronized linked items', () => {
	it('keeps a frame-aligned audio companion in the edit group', () => {
		const video = mediaItem();
		const audio = mediaItem({ id: 'audio', trackId: 'audio-track', type: 'audio' });
		expect(getSynchronizedLinkedItems([video, audio], video.id).map((item) => item.id)).toEqual([
			'video',
			'audio'
		]);
	});

	it('drops a linked companion after its media window diverges', () => {
		const video = mediaItem();
		const audio = mediaItem({
			id: 'audio',
			trackId: 'audio-track',
			type: 'audio',
			sourceStart: 12,
			sourceEnd: 72
		});
		expect(getSynchronizedLinkedItems([video, audio], video.id)).toEqual([video]);
	});

	it('matches both sides of a cut on the companion track', () => {
		const leftVideo = mediaItem({ id: 'left-video', linkedGroupId: 'left' });
		const leftAudio = mediaItem({
			id: 'left-audio',
			trackId: 'audio-track',
			type: 'audio',
			linkedGroupId: 'left'
		});
		const rightVideo = mediaItem({
			id: 'right-video',
			from: 60,
			sourceStart: 60,
			sourceEnd: 120,
			linkedGroupId: 'right'
		});
		const rightAudio = mediaItem({
			id: 'right-audio',
			trackId: 'audio-track',
			type: 'audio',
			from: 60,
			sourceStart: 60,
			sourceEnd: 120,
			linkedGroupId: 'right'
		});

		expect(
			getSynchronizedLinkedCounterpartPair(
				[leftVideo, leftAudio, rightVideo, rightAudio],
				leftVideo.id,
				rightVideo.id
			)
		).toEqual({ leftCounterpart: leftAudio, rightCounterpart: rightAudio });
	});
});
