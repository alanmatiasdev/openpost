import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { autoKeyframeStore } from '$lib/video-editor/timeline/stores/auto-keyframe-store.svelte';
import { colorPreviewStore } from '$lib/video-editor/effects/color-preview-store.svelte';
import { spatialEffectEditorStore } from '$lib/video-editor/preview/spatial-effect-editor.svelte';
import { buildEffectKeyframeProperty } from '$lib/video-editor/effects/effect-keyframes';
import SpatialEffectPointOverlay from './spatial-effect-point-overlay.svelte';

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

function item(patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: track.id,
		from: 0,
		durationInFrames: 60,
		label: 'Clip',
		type: 'video',
		transform: { width: 1000, height: 500 },
		effects: [
			{
				id: 'twirl',
				type: 'gpu',
				effectId: 'gpu-twirl',
				enabled: true,
				params: { amount: 1, radius: 0.5, centerX: 0.25, centerY: 0.75 }
			}
		],
		...patch
	};
}

async function renderOverlay(
	sourceItem: TimelineItem,
	resolvedItem = sourceItem,
	canvasWidth = 1000,
	canvasHeight = 500
) {
	const onedit = vi.fn();
	const screen = await render(SpatialEffectPointOverlay, {
		item: resolvedItem,
		sourceItem,
		canvasWidth,
		canvasHeight,
		currentFrame: 10,
		onedit
	});
	screen.container.style.width = `${canvasWidth}px`;
	screen.container.style.height = `${canvasHeight}px`;
	const root = screen.container.querySelector<HTMLElement>('[data-spatial-effect-overlay]');
	if (!root) throw new Error('spatial effect overlay missing');
	root.style.width = `${canvasWidth}px`;
	root.style.height = `${canvasHeight}px`;
	root.style.backgroundColor = '#171717';
	root.style.backgroundImage =
		'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)';
	root.style.backgroundSize = '32px 32px';
	vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(
		new DOMRect(0, 0, canvasWidth, canvasHeight)
	);
	return { screen, root, onedit };
}

function pointer(type: string, x: number, y: number, pointerId: number): PointerEvent {
	return new PointerEvent(type, {
		bubbles: true,
		button: type === 'pointerdown' ? 0 : undefined,
		buttons: type === 'pointermove' ? 1 : 0,
		clientX: x,
		clientY: y,
		pointerId,
		pointerType: 'mouse'
	});
}

beforeEach(async () => {
	await page.viewport(1280, 900);
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	autoKeyframeStore.reset();
	colorPreviewStore.__resetForTesting();
	spatialEffectEditorStore.__resetForTesting();
});

afterEach(() => {
	colorPreviewStore.__resetForTesting();
	spatialEffectEditorStore.__resetForTesting();
});

describe('SpatialEffectPointOverlay', () => {
	it('previews one transformed point per animation frame and commits both keyframe lanes once', async () => {
		const xProperty = buildEffectKeyframeProperty('gpu-twirl', 'twirl', 'centerX');
		const yProperty = buildEffectKeyframeProperty('gpu-twirl', 'twirl', 'centerY');
		const source = item({
			keyframes: {
				[xProperty]: {
					frames: [10],
					values: [0.8],
					ids: ['x-10'],
					easings: ['linear'],
					easingConfigs: [null]
				},
				[yProperty]: {
					frames: [10],
					values: [0.2],
					ids: ['y-10'],
					easings: ['linear'],
					easingConfigs: [null]
				}
			}
		});
		const resolved = item({
			...source,
			effects: [
				{
					id: 'twirl',
					type: 'gpu',
					effectId: 'gpu-twirl',
					enabled: true,
					params: { amount: 1, radius: 0.5, centerX: 0.8, centerY: 0.2 }
				}
			]
		});
		timelineStore.setAll({ tracks: [track], items: [source], fps: 30, currentFrame: 10 });
		spatialEffectEditorStore.startEditing(source.id, 'twirl');
		const { screen, root, onedit } = await renderOverlay(source, resolved);
		const handle = screen.container.querySelector<HTMLButtonElement>(
			'[data-spatial-effect-handle="twirl"]'
		)!;
		expect(handle.style.left).toBe('80%');
		expect(handle.style.top).toBe('20%');
		await page.screenshot({
			element: root,
			path: '../../../../.svelte-kit/openpost-spatial-effect-point.png'
		});

		handle.dispatchEvent(pointer('pointerdown', 800, 100, 1));
		window.dispatchEvent(pointer('pointermove', 600, 180, 1));
		window.dispatchEvent(pointer('pointermove', 400, 250, 1));
		await vi.waitFor(() => {
			expect(colorPreviewStore.effectDraft?.params.centerX).toBeCloseTo(0.4, 3);
			expect(colorPreviewStore.effectDraft?.params.centerY).toBeCloseTo(0.5, 3);
		});
		expect(commandHistory.undoStack).toHaveLength(0);

		window.dispatchEvent(pointer('pointerup', 400, 250, 1));
		await vi.waitFor(() => expect(colorPreviewStore.effectDraft).toBeNull());
		const updated = timelineStore.itemById.get(source.id);
		expect(updated?.keyframes?.[xProperty]?.values).toEqual([0.4]);
		expect(updated?.keyframes?.[yProperty]?.values).toEqual([0.5]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledTimes(1);
	});

	it('cancels drafts on Escape and lost capture without a late commit', async () => {
		const source = item({
			effects: [
				{
					id: 'twirl',
					type: 'gpu',
					effectId: 'gpu-twirl',
					enabled: true,
					params: { amount: 1, radius: 0.5, centerX: 0.5, centerY: 0.5 }
				}
			]
		});
		timelineStore.setAll({ tracks: [track], items: [source], fps: 30, currentFrame: 10 });
		spatialEffectEditorStore.startEditing(source.id, 'twirl');
		const { screen, onedit } = await renderOverlay(source);
		let handle = screen.container.querySelector<HTMLButtonElement>(
			'[data-spatial-effect-handle="twirl"]'
		)!;
		handle.dispatchEvent(pointer('pointerdown', 500, 250, 2));
		window.dispatchEvent(pointer('pointermove', 900, 100, 2));
		await vi.waitFor(() => expect(colorPreviewStore.effectDraft).not.toBeNull());
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(colorPreviewStore.effectDraft).toBeNull();
		expect(spatialEffectEditorStore.isEditing).toBe(false);
		window.dispatchEvent(pointer('pointerup', 900, 100, 2));
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(onedit).not.toHaveBeenCalled();
		expect(timelineStore.itemById.get(source.id)?.effects?.[0]?.params.centerX).toBe(0.5);

		spatialEffectEditorStore.startEditing(source.id, 'twirl');
		await vi.waitFor(() => {
			handle = screen.container.querySelector<HTMLButtonElement>(
				'[data-spatial-effect-handle="twirl"]'
			)!;
			expect(handle).not.toBeNull();
		});
		handle.dispatchEvent(pointer('pointerdown', 500, 250, 3));
		window.dispatchEvent(pointer('pointermove', 700, 300, 3));
		await vi.waitFor(() => expect(colorPreviewStore.effectDraft).not.toBeNull());
		handle.dispatchEvent(pointer('lostpointercapture', 700, 300, 3));
		expect(colorPreviewStore.effectDraft).toBeNull();
		window.dispatchEvent(pointer('pointerup', 700, 300, 3));
		expect(commandHistory.undoStack).toHaveLength(0);
		expect(spatialEffectEditorStore.isEditing).toBe(true);
	});

	it('provides a 44px keyboard handle at 320px and respects effective track locks', async () => {
		await page.viewport(320, 720);
		const source = item({ transform: { width: 320, height: 180 } });
		timelineStore.setAll({ tracks: [track], items: [source], fps: 30, currentFrame: 10 });
		spatialEffectEditorStore.startEditing(source.id, 'twirl');
		const { screen, root, onedit } = await renderOverlay(source, source, 320, 180);
		const handle = screen.container.querySelector<HTMLButtonElement>(
			'[data-spatial-effect-handle="twirl"]'
		)!;
		expect(handle.offsetWidth).toBeGreaterThanOrEqual(44);
		expect(handle.offsetHeight).toBeGreaterThanOrEqual(44);
		handle.focus();
		handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		handle.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })
		);
		await vi.waitFor(() => expect(commandHistory.undoStack).toHaveLength(2));
		const effect = timelineStore.itemById.get(source.id)?.effects?.[0];
		expect(effect?.params.centerX).toBeCloseTo(0.26, 5);
		expect(effect?.params.centerY).toBeCloseTo(0.85, 5);
		expect(onedit).toHaveBeenCalledTimes(2);
		await page.screenshot({
			element: root,
			path: '../../../../.svelte-kit/openpost-spatial-effect-point-320.png'
		});

		timelineStore._setTracks([{ ...track, locked: true }]);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-spatial-effect-handle]')).toBeNull();
		});
		expect(spatialEffectEditorStore.isEditing).toBe(false);
	});
});
