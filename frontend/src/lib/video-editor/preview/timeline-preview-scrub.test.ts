import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
	formatTimelinePreviewTimecode,
	resolveTimelinePreviewFrame,
	timelinePreviewScrub
} from './timeline-preview-scrub';

describe('timeline preview scrub', () => {
	beforeEach(() => timelinePreviewScrub.__resetForTesting());

	it('keeps hover state separate from the committed frame', () => {
		expect(resolveTimelinePreviewFrame(get(timelinePreviewScrub), 12)).toBe(12);
		timelinePreviewScrub.setFrame(27.6);
		expect(get(timelinePreviewScrub).frame).toBe(28);
		expect(resolveTimelinePreviewFrame(get(timelinePreviewScrub), 12)).toBe(28);
		timelinePreviewScrub.clear();
		expect(resolveTimelinePreviewFrame(get(timelinePreviewScrub), 12)).toBe(12);
	});

	it('does not notify render subscribers when the rounded frame stays unchanged', () => {
		let updates = 0;
		const unsubscribe = timelinePreviewScrub.subscribe(() => {
			updates += 1;
		});
		try {
			timelinePreviewScrub.clear();
			timelinePreviewScrub.setFrame(12.1);
			timelinePreviewScrub.setFrame(12.4);
			timelinePreviewScrub.clear();
			timelinePreviewScrub.clear();
			expect(updates).toBe(3);
		} finally {
			unsubscribe();
		}
	});

	it('formats long timelines without wrapping hours into minutes', () => {
		expect(formatTimelinePreviewTimecode(30 * (3_600 + 2 * 60 + 3) + 4, 30)).toBe('01:02:03:04');
		expect(formatTimelinePreviewTimecode(1_798, 29.97)).toBe('00:00:59:28');
	});
});
