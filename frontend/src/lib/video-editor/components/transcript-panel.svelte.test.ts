import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '../project/types';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import TranscriptPanel from './transcript-panel.svelte';
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
	cues: [
		{
			id: 'cue',
			startFrame: 0,
			endFrame: 90,
			text: '{\\an8}<b>Ready</b>',
			words: [{ id: 'word', startFrame: 0, endFrame: 30, text: 'Ready' }]
		}
	]
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

describe('TranscriptPanel cue formatting', () => {
	it('hides markup and preserves cue-wide formatting through copy and word edits', async () => {
		const onedit = vi.fn();
		const screen = await render(TranscriptPanel, { onedit });
		const cueInput = screen.getByLabelText('Caption line');
		await expect.element(cueInput).toHaveValue('Ready');

		await screen.getByRole('button', { name: 'Italic', exact: true }).click();
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Ready</i></b>'
		);

		await cueInput.fill('Ship it');
		cueInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Ship it</i></b>'
		);

		const wordInput = screen.getByRole('textbox', {
			name: 'Transcript word',
			exact: true
		});
		await wordInput.fill('Shipped');
		wordInput.element().dispatchEvent(new FocusEvent('blur', { bubbles: true }));
		expect(timelineStore.itemById.get('subtitle')?.cues?.[0]?.text).toBe(
			'{\\an8}<b><i>Shipped</i></b>'
		);
		expect(commandHistory.undoStack).toHaveLength(3);
		expect(onedit).toHaveBeenCalledTimes(3);

		screen.container.style.width = '320px';
		expect(screen.container.scrollWidth).toBeLessThanOrEqual(320);
	});
});
