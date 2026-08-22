import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import { addEffectTemplates, addGpuEffect, setGpuEffectParam } from './effects';

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

describe('setGpuEffectParam', () => {
	it('stores typed ASCII controls and rejects values outside the schema', () => {
		expect(addGpuEffect('video', 'gpu-ascii')).toBe(true);
		const effect = timelineStore.itemById
			.get('video')
			?.effects?.find((entry) => entry.type === 'gpu');
		if (!effect || effect.type !== 'gpu') throw new Error('ASCII effect missing');

		expect(setGpuEffectParam('video', effect.id, 'matchSourceColor', false)).toBe(true);
		expect(setGpuEffectParam('video', effect.id, 'charSet', 'custom')).toBe(true);
		expect(
			setGpuEffectParam(
				'video',
				effect.id,
				'customChars',
				'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
			)
		).toBe(true);
		expect(setGpuEffectParam('video', effect.id, 'font', 'comic-sans')).toBe(false);

		const updated = timelineStore.itemById
			.get('video')
			?.effects?.find((entry) => entry.id === effect.id);
		if (!updated || updated.type !== 'gpu') throw new Error('updated ASCII effect missing');
		expect(updated.params.matchSourceColor).toBe(false);
		expect(updated.params.charSet).toBe('custom');
		expect([...String(updated.params.customChars)]).toHaveLength(64);
		expect(updated.params.font).toBe('monospace');
	});
});
