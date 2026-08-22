import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { collectSubtitleCues, subtitleSidecarSrt, subtitleWebVtt } from './subtitle-export';

const subtitles: TimelineItem[] = [
	{
		id: 's',
		trackId: 't',
		from: 0,
		durationInFrames: 100,
		label: 'Subtitles',
		type: 'subtitle',
		cues: [{ id: 'c', startFrame: 20, endFrame: 50, text: 'Hello' }]
	}
];

describe('subtitle export', () => {
	it('clips and rebases cues to the selected range', () => {
		expect(collectSubtitleCues(subtitles, 10, 30, 60)).toEqual([
			{ startSeconds: 0, endSeconds: 2, text: 'Hello' }
		]);
	});

	it('writes SRT and WebVTT timestamp forms', () => {
		expect(subtitleSidecarSrt(subtitles, 10)).toContain('00:00:02,000 --> 00:00:05,000');
		expect(subtitleWebVtt(subtitles, 10)).toContain('00:00:02.000 --> 00:00:05.000');
	});
});
