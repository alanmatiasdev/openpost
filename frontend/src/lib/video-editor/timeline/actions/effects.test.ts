import { beforeEach, describe, expect, it } from 'vitest';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { timelineStore } from '../stores/timeline-store.svelte';
import {
	addEffectTemplates,
	addGpuEffect,
	replaceColorGradeEffects,
	setGpuEffectParam,
	upsertGpuEffectParams,
	upsertGpuEffectParamsOnItems
} from './effects';

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

describe('color grade actions', () => {
	it('lazily creates and then updates color wheels with one undo step per batch', () => {
		expect(
			upsertGpuEffectParams('video', 'gpu-color-wheels', {
				lift: -0.2,
				gain: 1.5,
				temperature: 20,
				tint: -10
			})
		).toBe(true);
		const created = timelineStore.itemById.get('video')?.effects?.[0];
		expect(created?.type === 'gpu' ? created.params : undefined).toMatchObject({
			lift: -0.2,
			gain: 1.5,
			temperature: 20,
			tint: -10
		});
		expect(commandHistory.undoStack).toHaveLength(1);

		expect(upsertGpuEffectParams('video', 'gpu-color-wheels', { gain: 2 })).toBe(true);
		const updated = timelineStore.itemById.get('video')?.effects?.[0];
		expect(updated?.id).toBe(created?.id);
		expect(updated?.type === 'gpu' ? updated.params.gain : undefined).toBe(2);
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('replaces grades on several clips atomically while retaining non-color effects', () => {
		expect(addGpuEffect('video', 'gpu-color-wheels')).toBe(true);
		expect(addGpuEffect('video', 'gpu-gaussian-blur')).toBe(true);
		expect(addGpuEffect('title', 'gpu-curves')).toBe(true);
		commandHistory.clearHistory();

		expect(
			replaceColorGradeEffects(
				['video', 'title', 'audio'],
				[
					{ effectId: 'gpu-color-wheels', params: { lift: -0.4 }, enabled: true },
					{ effectId: 'gpu-curves', params: { masterShadowY: 0.15 }, enabled: true }
				]
			)
		).toBe(true);
		for (const itemId of ['video', 'title']) {
			const effects = timelineStore.itemById.get(itemId)?.effects ?? [];
			expect(
				effects.filter((effect) =>
					effect.type === 'gpu'
						? ['gpu-color-wheels', 'gpu-curves'].includes(effect.effectId)
						: false
				)
			).toHaveLength(2);
		}
		expect(
			timelineStore.itemById
				.get('video')
				?.effects?.some(
					(effect) => effect.type === 'gpu' && effect.effectId === 'gpu-gaussian-blur'
				)
		).toBe(true);
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('auto-balances every selected visual item in one undo step', () => {
		expect(
			upsertGpuEffectParamsOnItems(['video', 'title', 'audio'], 'gpu-color-wheels', {
				lift: -0.1,
				gain: 1.2
			})
		).toBe(true);
		for (const itemId of ['video', 'title']) {
			const effect = timelineStore.itemById.get(itemId)?.effects?.[0];
			expect(effect?.type === 'gpu' ? effect.params : undefined).toMatchObject({
				lift: -0.1,
				gain: 1.2
			});
		}
		expect(timelineStore.itemById.get('audio')?.effects).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});
});
