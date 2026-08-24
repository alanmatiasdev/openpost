import { describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { collectPreviewPrewarmTargets } from './prewarm-plan';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function clip(id: string, from: number, mediaId = id): TimelineItem {
	return {
		id,
		trackId: track.id,
		from,
		durationInFrames: 30,
		label: id,
		type: 'video',
		mediaId,
		sourceStart: 60,
		sourceFps: 30
	};
}

describe('preview prewarm planner', () => {
	it('orders distinct upcoming video boundaries inside the lookahead window', () => {
		const targets = collectPreviewPrewarmTargets({
			items: [clip('late', 160), clip('nearest', 70), clip('same-source', 80, 'nearest')],
			tracks: [track],
			currentFrame: 30,
			fps: 30,
			lookaheadSeconds: 2,
			limit: 2
		});
		expect(targets.map((target) => target.itemId)).toEqual(['nearest']);
		expect(targets[0]?.timestampSeconds).toBe(2);
	});

	it('ignores hidden tracks and clips behind the playhead', () => {
		expect(
			collectPreviewPrewarmTargets({
				items: [clip('past', 20), clip('hidden', 40)],
				tracks: [{ ...track, visible: false }],
				currentFrame: 30,
				fps: 30
			})
		).toEqual([]);
	});
});
