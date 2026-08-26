import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../../project/types';
import { sourceSecondsToTimelineFrame } from './media-item-frames';

describe('media item frame mapping', () => {
	it('maps reversed source seconds from the exclusive out point back across the timeline', () => {
		const item: TimelineItem = {
			id: 'reversed',
			trackId: 'video',
			from: 100,
			durationInFrames: 90,
			label: 'Reversed clip',
			type: 'video',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30,
			speed: 1,
			isReversed: true
		};

		expect(sourceSecondsToTimelineFrame(item, 3, 30)).toBe(100);
		expect(sourceSecondsToTimelineFrame(item, 2, 30)).toBe(130);
		expect(sourceSecondsToTimelineFrame(item, 1, 30)).toBe(160);
	});
});
