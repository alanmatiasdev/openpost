import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { addEffectTemplates } from './effects';

function track(id: string, kind: TimelineTrack['kind'], order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(id: string, type: TimelineItem['type'], trackId: string): TimelineItem {
	return { id, trackId, from: 0, durationInFrames: 30, label: id, type };
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [
			item('video', 'video', 'video-track'),
			item('title', 'text', 'video-track'),
			item('audio', 'audio', 'audio-track')
		],
		fps: 30
	});
});

describe('addEffectTemplates', () => {
	it('applies fresh effect instances to visual clips as one undoable edit', () => {
		expect(
			addEffectTemplates(
				['video', 'title', 'audio'],
				[
					{ kind: 'css', effectType: 'brightness' },
					{ kind: 'gpu', effectId: 'gpu-gaussian-blur' }
				]
			)
		).toBe(true);

		const videoEffects = timelineStore.itemById.get('video')?.effects ?? [];
		const titleEffects = timelineStore.itemById.get('title')?.effects ?? [];
		expect(videoEffects).toHaveLength(2);
		expect(titleEffects).toHaveLength(2);
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(videoEffects.map((effect) => effect.id)).not.toEqual(
			titleEffects.map((effect) => effect.id)
		);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('ADD_EFFECTS');

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')?.effects).toBeUndefined();
		expect(timelineStore.itemById.get('title')?.effects).toBeUndefined();
	});
});
