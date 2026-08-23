import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import LottiePropertiesPanel from './lottie-properties-panel.svelte';

const track: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'lottie',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Animation',
	type: 'lottie',
	lottieTotalFrames: 60,
	lottieFrameRate: 30,
	lottieLoop: true,
	lottieMarkers: [{ name: 'Action', start: 10, duration: 10 }],
	transform: { width: 320, height: 180 }
};

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], currentFrame: 0, fps: 30 });
});

describe('LottiePropertiesPanel', () => {
	it('commits playback and named-marker controls without overflowing the inspector', async () => {
		const onedit = vi.fn();
		const screen = await render(LottiePropertiesPanel, {
			item: timelineStore.itemById.get(item.id)!,
			onedit
		});

		await screen.getByRole('checkbox', { name: 'Reverse' }).click();
		await screen.getByRole('combobox', { name: 'Named marker' }).selectOptions('Action');
		expect(timelineStore.itemById.get(item.id)).toMatchObject({
			lottieReversed: true,
			lottieSegmentStart: 10,
			lottieSegmentEnd: 20
		});
		expect(commandHistory.canUndo).toBe(true);
		expect(onedit).toHaveBeenCalledTimes(2);

		screen.container.style.width = '260px';
		const panel = screen.container.querySelector('section');
		expect(panel).not.toBeNull();
		if (panel) expect(panel.scrollWidth).toBeLessThanOrEqual(260);
	});
});
