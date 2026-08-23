import { beforeEach, describe, expect, it } from 'vitest';
import type { MediaMetadata } from '../media/types';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { editorSession } from '../editor.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { transitionsStore } from '../timeline/actions/transitions.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { applySourceEdit, SourceEditError } from './source-edit';

const videoTrack: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 96,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const audioTrack: TimelineTrack = {
	id: 'audio',
	name: 'Audio',
	kind: 'audio',
	height: 72,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 1
};

const media: MediaMetadata = {
	id: 'source',
	storageType: 'workspace',
	fileName: 'source.mp4',
	fileSize: 1000,
	mimeType: 'video/mp4',
	duration: 10,
	width: 1920,
	height: 1080,
	fps: 30,
	codec: 'avc',
	bitrate: 800,
	audioCodec: 'aac',
	tags: ['video']
};

function clip(patch: Partial<TimelineItem>): TimelineItem {
	return {
		id: crypto.randomUUID(),
		trackId: videoTrack.id,
		from: 0,
		durationInFrames: 100,
		label: 'Existing',
		type: 'video',
		mediaId: 'existing',
		sourceStart: 0,
		sourceEnd: 100,
		sourceDuration: 300,
		sourceFps: 30,
		...patch
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	transitionsStore.setAll([]);
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [videoTrack, audioTrack], items: [], currentFrame: 0, fps: 30 });
	editorSession.clock.seek(0);
	editorSession.project = {
		id: 'project',
		name: 'Project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 0,
		metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
		timeline: { tracks: [videoTrack, audioTrack], items: [] }
	} satisfies Project;
});

describe('source monitor edits', () => {
	it('inserts a linked source range and shifts split material on both target tracks', () => {
		const visual = clip({ id: 'visual', from: 0, durationInFrames: 100 });
		const audio = clip({
			id: 'audio-existing',
			trackId: audioTrack.id,
			type: 'audio',
			from: 50,
			durationInFrames: 50
		});
		timelineStore.setAll({ items: [visual, audio] });

		const result = applySourceEdit({
			media,
			inFrame: 30,
			outFrame: 90,
			insertFrame: 60,
			videoEnabled: true,
			audioEnabled: true,
			videoTarget: videoTrack.id,
			audioTarget: audioTrack.id,
			mode: 'insert'
		});

		expect(result.endFrame).toBe(120);
		expect(timelineStore.currentFrame).toBe(120);
		const inserted = timelineStore.items.filter((item) => result.itemIds.includes(item.id));
		expect(inserted).toHaveLength(2);
		expect(inserted.map((item) => item.sourceStart)).toEqual([30, 30]);
		expect(inserted.map((item) => item.sourceEnd)).toEqual([90, 90]);
		expect(new Set(inserted.map((item) => item.linkedGroupId)).size).toBe(1);
		expect(
			timelineStore.items
				.filter((item) => !result.itemIds.includes(item.id))
				.map((item) => item.from)
		).toContain(120);
		expect(commandHistory.canUndo).toBe(true);
	});

	it('overwrites only the covered range and keeps both surrounding tails', () => {
		timelineStore.setAll({ items: [clip({ id: 'long', from: 0, durationInFrames: 180 })] });
		const result = applySourceEdit({
			media,
			inFrame: 0,
			outFrame: 60,
			insertFrame: 60,
			videoEnabled: true,
			audioEnabled: false,
			videoTarget: videoTrack.id,
			audioTarget: 'auto',
			mode: 'overwrite'
		});

		const items = timelineStore.items.toSorted((left, right) => left.from - right.from);
		expect(items.map((item) => [item.from, item.durationInFrames])).toEqual([
			[0, 60],
			[60, 60],
			[120, 60]
		]);
		expect(items.find((item) => result.itemIds.includes(item.id))?.volume).toBe(0);
	});

	it('creates a requested destination track and converts source frames across frame rates', () => {
		timelineStore.setAll({ tracks: [videoTrack], fps: 60 });
		const result = applySourceEdit({
			media,
			inFrame: 30,
			outFrame: 90,
			insertFrame: 10,
			videoEnabled: false,
			audioEnabled: true,
			videoTarget: 'auto',
			audioTarget: 'create',
			mode: 'insert'
		});

		expect(timelineStore.tracks.some((track) => track.kind === 'audio')).toBe(true);
		expect(timelineStore.itemById.get(result.itemIds[0]!)?.durationInFrames).toBe(120);
		commandHistory.undo();
		expect(timelineStore.tracks).toEqual([videoTrack]);
		expect(timelineStore.items).toHaveLength(0);
	});

	it('rejects a locked explicit destination instead of silently rerouting the edit', () => {
		timelineStore.setAll({
			tracks: [
				{ ...videoTrack, locked: true },
				{ ...videoTrack, id: 'fallback', order: 2 }
			]
		});

		expect(() =>
			applySourceEdit({
				media,
				inFrame: 0,
				outFrame: 30,
				insertFrame: 0,
				videoEnabled: true,
				audioEnabled: false,
				videoTarget: videoTrack.id,
				audioTarget: 'auto',
				mode: 'insert'
			})
		).toThrowError(new SourceEditError('target-locked'));
		expect(timelineStore.items).toHaveLength(0);
	});

	it('removes a transition whose cut is broken by an insert edit', () => {
		const first = clip({ id: 'first', from: 0, durationInFrames: 100 });
		const second = clip({ id: 'second', from: 100, durationInFrames: 100 });
		timelineStore.setAll({ items: [first, second] });
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				presentation: 'fade',
				timing: 'linear',
				durationInFrames: 10,
				alignment: 0.5,
				fromItemId: first.id,
				toItemId: second.id
			}
		]);

		applySourceEdit({
			media,
			inFrame: 0,
			outFrame: 30,
			insertFrame: 60,
			videoEnabled: true,
			audioEnabled: false,
			videoTarget: videoTrack.id,
			audioTarget: 'auto',
			mode: 'insert'
		});

		expect(transitionsStore.list).toHaveLength(0);
	});
});
