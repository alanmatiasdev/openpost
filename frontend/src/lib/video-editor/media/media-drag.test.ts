import { describe, expect, it } from 'vitest';
import { mediaDragData, parseMediaDragData, serializeMediaDragData } from './media-drag';

describe('video editor media drag payload', () => {
	it('round-trips the versioned internal payload', () => {
		const payload = mediaDragData('media', 'media-1', 'Interview.mp4');
		expect(parseMediaDragData(serializeMediaDragData(payload))).toEqual(payload);
	});

	it.each([
		'',
		'{',
		'{}',
		'{"version":2,"source":"media","id":"one","label":"Clip"}',
		'{"version":1,"source":"effect","id":"one","label":"Clip"}',
		'{"version":1,"source":"media","id":"","label":"Clip"}',
		'{"version":1,"source":"media","id":"one","label":""}'
	])('rejects malformed or foreign payload %s', (raw) => {
		expect(parseMediaDragData(raw)).toBeNull();
	});
});
