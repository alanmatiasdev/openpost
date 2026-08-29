import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ColorPrimaryControls from './color-primary-controls.svelte';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'video',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Interview',
	type: 'video'
};

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], fps: 30 });
	commandHistory.clearHistory();
});

test('creates the real color-wheel effect from a keyboard wheel edit as one undo step', async () => {
	const onedit = vi.fn();
	const screen = await render(ColorPrimaryControls, { itemId: item.id, onedit });
	const wheels = screen.getByRole('slider', { name: /color wheel$/ }).elements();

	expect(wheels).toHaveLength(4);
	wheels[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));

	await vi.waitFor(() => {
		const effect = timelineStore.itemById
			.get(item.id)
			?.effects?.find(
				(candidate) => candidate.type === 'gpu' && candidate.effectId === 'gpu-color-wheels'
			);
		expect(effect?.type === 'gpu' ? effect.params.shadowsAmount : null).toBeCloseTo(0.01);
	});
	expect(onedit).toHaveBeenCalledOnce();
	expect(commandHistory.undoStack).toHaveLength(1);

	commandHistory.undo();
	expect(timelineStore.itemById.get(item.id)?.effects).toBeUndefined();
});
