import { describe, expect, it } from 'vitest';
import type { TimelineItem } from '../project/types';
import { updateTimelineItemSelection } from './selection';

function item(id: string, linkedGroupId?: string): TimelineItem {
	return {
		id,
		trackId: id.includes('audio') ? 'audio' : 'video',
		from: 0,
		durationInFrames: 30,
		label: id,
		type: id.includes('audio') ? 'audio' : 'video',
		linkedGroupId
	};
}

describe('timeline item selection', () => {
	it('selects an entire linked group when linked selection is enabled', () => {
		const items = [item('video', 'group'), item('audio', 'group')];
		expect(updateTimelineItemSelection(items, [], 'video', true, false)).toEqual({
			ids: ['video', 'audio'],
			primaryId: 'video'
		});
	});

	it('adds and removes linked groups with the additive modifier', () => {
		const items = [item('first-video', 'first'), item('first-audio', 'first'), item('second')];
		const added = updateTimelineItemSelection(items, ['second'], 'first-video', true, true);
		expect(added.ids).toEqual(['second', 'first-video', 'first-audio']);
		expect(updateTimelineItemSelection(items, added.ids, 'first-audio', true, true)).toEqual({
			ids: ['second'],
			primaryId: 'second'
		});
	});

	it('selects only the target when linked selection is disabled', () => {
		const items = [item('video', 'group'), item('audio', 'group')];
		expect(updateTimelineItemSelection(items, [], 'video', false, false)).toEqual({
			ids: ['video'],
			primaryId: 'video'
		});
	});
});
