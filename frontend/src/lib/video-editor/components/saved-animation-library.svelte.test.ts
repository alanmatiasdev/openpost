import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { AnimationPreset, TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import SavedAnimationLibrary from './saved-animation-library.svelte';

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

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: 'Launch card',
		type: 'video',
		...overrides
	};
}

function preset(overrides: Partial<AnimationPreset> = {}): AnimationPreset {
	return {
		id: 'preset',
		name: 'Soft reveal',
		sourceItemType: 'video',
		properties: [
			{
				property: 'opacity',
				keyframes: [
					{ id: 'a', frame: 0, value: 0, easing: 'ease-in' },
					{ id: 'b', frame: 29, value: 1, easing: 'linear' }
				]
			}
		],
		effects: [],
		sourceDurationInFrames: 30,
		createdAt: 1,
		...overrides
	};
}

interface LibraryTestProps {
	itemId: string | null;
	itemIds: string[];
	presets: AnimationPreset[];
	mode: 'replace' | 'add';
	onsavepreset: Mock<(preset: AnimationPreset) => void>;
	ondeletepreset: Mock<(presetId: string) => void>;
	onedit: Mock<() => void>;
}

function props(overrides: Partial<LibraryTestProps> = {}): LibraryTestProps {
	return {
		itemId: 'clip',
		itemIds: ['clip'],
		presets: [preset()],
		mode: 'replace' as const,
		onsavepreset: vi.fn<(preset: AnimationPreset) => void>(),
		ondeletepreset: vi.fn<(presetId: string) => void>(),
		onedit: vi.fn<() => void>(),
		...overrides
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.clear();
	timelineStore.setAll({ tracks: [track], items: [item()], fps: 30 });
});

describe('SavedAnimationLibrary', () => {
	it('saves authored and live animation with a project-scoped name', async () => {
		timelineStore.setAll({
			items: [
				item({
					keyframes: { opacity: { frames: [5, 20], values: [0, 1] } }
				})
			]
		});
		const input = props({ presets: [] });
		const screen = await render(SavedAnimationLibrary, input);
		await screen.getByRole('button', { name: 'Save animation' }).click();
		const name = screen.getByLabelText('Animation name');
		await name.fill('Reusable reveal');
		await screen.getByRole('button', { name: 'Save to project' }).click();
		expect(input.onsavepreset).toHaveBeenCalledTimes(1);
		expect(input.onsavepreset.mock.calls[0]?.[0]).toMatchObject({
			name: 'Reusable reveal',
			sourceItemType: 'video',
			properties: [{ property: 'opacity', keyframes: [{ frame: 0 }, { frame: 15 }] }]
		});
		expect(screen.getByText('Saved Reusable reveal to this project.')).toBeVisible();
	});

	it('applies at the playhead with the shared Replace mode and fit setting', async () => {
		timelineStore._setCurrentFrame(10);
		const input = props();
		const screen = await render(SavedAnimationLibrary, input);
		await screen.getByRole('button', { name: 'Replace' }).click();
		await vi.waitFor(() => {
			expect(timelineStore.itemById.get('clip')?.keyframes?.opacity?.frames).toEqual([10, 59]);
		});
		expect(input.onedit).toHaveBeenCalledTimes(1);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(screen.getByText('Applied Soft reveal to 1 clips with 2 keyframes.')).toBeVisible();
	});

	it('filters and confirms deletion without touching the timeline', async () => {
		const input = props({ presets: [preset(), preset({ id: 'other', name: 'Hard cut' })] });
		const screen = await render(SavedAnimationLibrary, input);
		await screen.getByPlaceholder('Search saved animations').fill('soft');
		expect(screen.getByText('Soft reveal', { exact: true })).toBeVisible();
		expect(document.body.textContent).not.toContain('Hard cut');
		await screen.getByRole('button', { name: 'Delete saved animation Soft reveal' }).click();
		expect(screen.getByText(/Delete this saved animation/)).toBeVisible();
		await screen.getByRole('button', { name: 'Delete', exact: true }).click();
		expect(input.ondeletepreset).toHaveBeenCalledWith('preset');
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('disables a recipe saved from a different clip type', async () => {
		const screen = await render(
			SavedAnimationLibrary,
			props({ presets: [preset({ sourceItemType: 'image' })] })
		);
		const apply = screen.getByRole('button', { name: 'Replace' });
		expect(apply).toBeDisabled();
		expect(apply).toHaveAttribute('title', 'This animation was saved from a different clip type.');
	});
});
