import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import SubtitlePropertiesPanel from './subtitle-properties-panel.svelte';
import '../../../routes/layout.css';

const track: TimelineTrack = {
	id: 'captions',
	name: 'Captions',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'subtitle',
	trackId: track.id,
	from: 0,
	durationInFrames: 90,
	label: 'Captions',
	type: 'subtitle',
	transform: {
		x: 24,
		y: 0,
		width: 1600,
		height: 180,
		rotation: 3,
		opacity: 0.9
	},
	cues: [{ id: 'cue', startFrame: 0, endFrame: 90, text: 'Ship it' }]
};

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({
		tracks: [track],
		items: [item],
		currentFrame: 0,
		fps: 30
	});
});

describe('SubtitlePropertiesPanel', () => {
	it('applies each exact caption recipe as one undoable edit', async () => {
		const onedit = vi.fn();
		const screen = await render(SubtitlePropertiesPanel, {
			item: timelineStore.itemById.get('subtitle')!,
			canvasWidth: 1920,
			canvasHeight: 1080,
			onedit
		});

		expect(screen.container.querySelectorAll('.preset-strip > button[aria-pressed]')).toHaveLength(
			5
		);
		await screen.getByRole('button', { name: 'Bold Yellow', exact: true }).click();
		expect(timelineStore.itemById.get('subtitle')).toMatchObject({
			fontFamily: 'Roboto Slab',
			fontSize: 54,
			fontWeight: 700,
			color: '#FFD400',
			strokeWidth: 1.5,
			transform: {
				x: 24,
				y: 410,
				width: 1632,
				height: 194,
				rotation: 3,
				opacity: 0.9
			}
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get('subtitle')?.fontFamily).toBeUndefined();

		screen.container.style.width = '260px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(260);
	});
});
