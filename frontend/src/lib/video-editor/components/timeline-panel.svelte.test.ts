import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { setEffectDragData } from '$lib/video-editor/timeline/effect-drop';
import TimelinePanel from './timeline-panel.svelte';

function track(id: string, kind: TimelineTrack['kind'], order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind,
		height: 64,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function item(overrides: Partial<TimelineItem>): TimelineItem {
	return {
		id: 'video',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 60,
		label: 'Video',
		type: 'video',
		sourceStart: 0,
		sourceEnd: 60,
		sourceDuration: 180,
		sourceFps: 30,
		...overrides
	};
}

function dispatchPointer(
	target: EventTarget,
	type: 'pointerdown' | 'pointermove' | 'pointerup',
	clientX: number,
	shiftKey = false,
	clientY = 0
): void {
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			buttons: type === 'pointerup' ? 0 : 1,
			clientX,
			clientY,
			pointerId: 7,
			shiftKey
		})
	);
}

async function nextAnimationFrame(): Promise<void> {
	await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.setAll([]);
	timelineStore.setAll({
		tracks: [track('video-track', 'video', 0), track('audio-track', 'audio', 1)],
		items: [
			item({}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		],
		fps: 30
	});
});

describe('TimelinePanel sync-lock ripple trim', () => {
	it('previews and applies a dropped effect to compatible selected clips', async () => {
		timelineStore._setTracks([
			track('video-track', 'video', 0),
			track('audio-track', 'audio', 1),
			{ ...track('locked-track', 'video', 2), locked: true }
		]);
		timelineStore._setItems([
			item({}),
			item({
				id: 'title',
				label: 'Title',
				type: 'text',
				from: 70,
				sourceStart: undefined,
				sourceEnd: undefined
			}),
			item({ id: 'locked-video', trackId: 'locked-track', label: 'Locked video', from: 140 }),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, {
			onedit,
			selectedItemId: 'video',
			selectedItemIds: ['video', 'title', 'music-bed', 'locked-video']
		});
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement!;
		const titleClip = screen.getByRole('button', { name: /^Title\./ }).element().parentElement!;
		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement!;
		const lockedClip = screen
			.getByRole('button', { name: /^Locked video\./ })
			.element().parentElement!;
		const payload = {
			type: 'timeline-effect' as const,
			label: 'Brightness',
			effects: [{ kind: 'css' as const, effectType: 'brightness' as const }]
		};
		setEffectDragData(payload);
		const dataTransfer = new DataTransfer();
		dataTransfer.setData('application/json', JSON.stringify(payload));

		videoClip.dispatchEvent(
			new DragEvent('dragover', { bubbles: true, clientX: 100, clientY: 100, dataTransfer })
		);
		await nextAnimationFrame();
		expect(videoClip.querySelector('[data-effect-drop-preview]')).not.toBeNull();
		expect(titleClip.querySelector('[data-effect-drop-preview]')).not.toBeNull();
		expect(musicClip.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(lockedClip.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(videoClip.textContent).toContain('2 clips');

		videoClip.dispatchEvent(
			new DragEvent('drop', { bubbles: true, clientX: 100, clientY: 100, dataTransfer })
		);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('video')?.effects).toEqual([
			expect.objectContaining({ type: 'brightness', amount: 1.2, enabled: true })
		]);
		expect(timelineStore.itemById.get('title')?.effects).toEqual([
			expect.objectContaining({ type: 'brightness', amount: 1.2, enabled: true })
		]);
		expect(timelineStore.itemById.get('music-bed')?.effects).toBeUndefined();
		expect(timelineStore.itemById.get('locked-video')?.effects).toBeUndefined();
		expect(document.querySelector('[data-effect-drop-preview]')).toBeNull();
		expect(commandHistory.getLastCommandType()).toBe('ADD_EFFECTS');
		expect(onedit).toHaveBeenCalledOnce();
	});

	it('marquee-selects every clip intersecting a background drag', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement!;
		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement!;
		const videoTrack = document.querySelector<HTMLElement>('[data-track="video-track"]');
		expect(videoTrack).not.toBeNull();
		const videoRect = videoClip.getBoundingClientRect();
		const musicRect = musicClip.getBoundingClientRect();

		dispatchPointer(
			videoTrack!,
			'pointerdown',
			Math.max(videoRect.right, musicRect.right) + 20,
			false,
			videoRect.top + videoRect.height / 2
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				buttons: 1,
				clientX: Math.min(videoRect.left, musicRect.left) - 5,
				clientY: musicRect.top + musicRect.height / 2,
				pointerId: 7
			})
		);
		await nextAnimationFrame();
		expect(document.querySelector('[data-timeline-marquee]')).not.toBeNull();
		dispatchPointer(window, 'pointerup', Math.min(videoRect.left, musicRect.left) - 5);
		await nextAnimationFrame();

		expect(videoClip.className).toContain('ring-1');
		expect(musicClip.className).toContain('ring-1');
		expect(document.querySelector('[data-timeline-marquee]')).toBeNull();
	});

	it('previews every touched track and commits the split as one undo entry', async () => {
		const onedit = vi.fn();
		const screen = await render(TimelinePanel, { onedit });
		const videoButton = screen.getByRole('button', { name: /^Video\./ }).element();
		const videoClip = videoButton.parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();

		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement;
		expect(musicClip?.style.width).toBe('440px');
		expect(timelineStore.itemById.get('music-bed')?.durationInFrames).toBe(120);

		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({ durationInFrames: 50 });
		expect(
			timelineStore.items
				.filter((candidate) => candidate.trackId === 'audio-track')
				.sort((left, right) => left.from - right.from)
				.map(({ from, durationInFrames, sourceStart, sourceEnd }) => ({
					from,
					durationInFrames,
					sourceStart,
					sourceEnd
				}))
		).toEqual([
			{ from: 0, durationInFrames: 50, sourceStart: 0, sourceEnd: 50 },
			{ from: 50, durationInFrames: 60, sourceStart: 60, sourceEnd: 120 }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('RIPPLE_EDIT');
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')).toMatchObject({ durationInFrames: 60 });
		expect(timelineStore.items.filter((candidate) => candidate.trackId === 'audio-track')).toEqual([
			expect.objectContaining({ id: 'music-bed', from: 0, durationInFrames: 120 })
		]);
	});

	it('returns to a normal trim when Shift is released during the drag', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
		await nextAnimationFrame();

		const musicClip = screen.getByRole('button', { name: /^Music\./ }).element().parentElement;
		expect(musicClip?.style.width).toBe('480px');
		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({ durationInFrames: 50 });
		expect(timelineStore.itemById.get('music-bed')).toMatchObject({
			from: 0,
			durationInFrames: 120
		});
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(commandHistory.getLastCommandType()).toBe('TRIM_ITEM_END');
	});

	it('restores the whole ripple preview on Escape without adding history', async () => {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();

		dispatchPointer(trimEnd!, 'pointerdown', 400, true);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		await nextAnimationFrame();

		expect(timelineStore.itemById.get('video')).toMatchObject({ durationInFrames: 60 });
		expect(timelineStore.items.filter((candidate) => candidate.trackId === 'audio-track')).toEqual([
			expect.objectContaining({ id: 'music-bed', from: 0, durationInFrames: 120 })
		]);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('hides and removes a transition when its clip edge is trimmed directly', async () => {
		timelineStore._setItems([
			item({}),
			item({
				id: 'next-video',
				from: 60,
				label: 'Next video',
				sourceStart: 10,
				sourceEnd: 70
			}),
			item({
				id: 'music-bed',
				trackId: 'audio-track',
				label: 'Music',
				type: 'audio',
				durationInFrames: 120,
				sourceEnd: 120
			})
		]);
		transitionsStore.setAll([
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'video',
				toItemId: 'next-video'
			}
		]);
		const ontransitionbreak = vi.fn();
		const screen = await render(TimelinePanel, { onedit: vi.fn(), ontransitionbreak });
		const videoClip = screen.getByRole('button', { name: /^Video\./ }).element().parentElement;
		const trimEnd = videoClip?.querySelector<HTMLButtonElement>(
			'button[aria-label="Trim clip end"]'
		);
		expect(trimEnd).not.toBeNull();
		expect(document.querySelector('[data-transition-id="transition"]')).not.toBeNull();
		dispatchPointer(trimEnd!, 'pointerdown', 400);
		dispatchPointer(window, 'pointerup', 400);
		await nextAnimationFrame();
		expect(transitionsStore.list).toHaveLength(1);
		expect(ontransitionbreak).not.toHaveBeenCalled();
		expect(commandHistory.undoStack).toHaveLength(0);

		dispatchPointer(trimEnd!, 'pointerdown', 400);
		dispatchPointer(window, 'pointermove', 360);
		await nextAnimationFrame();
		expect(document.querySelector('[data-transition-id="transition"]')).toBeNull();

		dispatchPointer(window, 'pointerup', 360);
		await nextAnimationFrame();
		expect(timelineStore.itemById.get('video')).toMatchObject({ durationInFrames: 50 });
		expect(transitionsStore.list).toEqual([]);
		expect(ontransitionbreak).toHaveBeenCalledOnce();
		expect(ontransitionbreak).toHaveBeenCalledWith(1);
		expect(commandHistory.getLastCommandType()).toBe('TRIM_ITEM_END');

		commandHistory.undo();
		expect(timelineStore.itemById.get('video')).toMatchObject({ durationInFrames: 60 });
		expect(transitionsStore.list).toEqual([
			expect.objectContaining({ id: 'transition', fromItemId: 'video', toItemId: 'next-video' })
		]);
	});
});
