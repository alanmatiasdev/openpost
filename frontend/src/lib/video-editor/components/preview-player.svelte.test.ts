import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { editorSession } from '../editor.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { TimelineFrameRenderer } from '../media/render-export';
import PreviewPlayer from './preview-player.svelte';
import { colorPreviewStore } from '../effects/color-preview-store.svelte';
import { scopeSamples } from '../effects/scope-samples.svelte';
import { adaptivePreviewQuality } from '../preview/adaptive-preview-quality.svelte';
import { previewPlaybackSettings } from '../preview/playback-settings.svelte';
import { previewDiagnostics } from '../preview/diagnostics.svelte';
import { timelinePreviewScrub } from '../preview/timeline-preview-scrub';

function track(id: string, order: number): TimelineTrack {
	return {
		id,
		name: id,
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order
	};
}

function colorLayer(id: string, trackId: string, backgroundColor: string): TimelineItem {
	return {
		id,
		trackId,
		from: 0,
		durationInFrames: 30,
		label: id,
		type: 'text',
		text: ' ',
		backgroundColor,
		transform: { width: 4, height: 4 }
	};
}

function blendProject(): Project {
	const bottom = colorLayer('bottom', 'bottom-track', '#808080');
	const top = {
		...colorLayer('top', 'top-track', '#808080'),
		blendMode: 'multiply' as const
	};
	return {
		id: 'blend-project',
		name: 'Blend project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 4, height: 4, fps: 30, backgroundColor: '#000000' },
		timeline: {
			tracks: [track('top-track', 0), track('bottom-track', 1)],
			items: [bottom, top]
		}
	};
}

function maskedProject(): Project {
	const content = colorLayer('content', 'content-track', '#ff0000');
	content.transform = { width: 8, height: 8 };
	const mask: TimelineItem = {
		id: 'mask',
		trackId: 'mask-track',
		from: 0,
		durationInFrames: 30,
		label: 'Mask',
		type: 'shape',
		shapeType: 'circle',
		isMask: true,
		maskType: 'clip',
		maskOpacity: 100,
		transform: { width: 4, height: 4 }
	};
	return {
		id: 'masked-project',
		name: 'Masked project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 8, height: 8, fps: 30, backgroundColor: '#0000ff' },
		timeline: {
			tracks: [track('mask-track', 0), track('content-track', 1)],
			items: [content, mask]
		}
	};
}

function cornerPinnedProject(): Project {
	const content = colorLayer('content', 'content-track', '#ff0000');
	content.transform = { width: 8, height: 8 };
	content.cornerPin = {
		topLeft: [2, 0],
		topRight: [0, 0],
		bottomRight: [0, 0],
		bottomLeft: [2, 0],
		referenceWidth: 8,
		referenceHeight: 8
	};
	return {
		id: 'corner-pin-project',
		name: 'Corner pin project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 8, height: 8, fps: 30, backgroundColor: '#0000ff' },
		timeline: { tracks: [track('content-track', 0)], items: [content] }
	};
}

function diagnosticVideoProject(): Project {
	const item: TimelineItem = {
		id: 'clip-12345678',
		trackId: 'video-track',
		from: 0,
		durationInFrames: 30,
		label: 'Private clip name',
		type: 'video',
		mediaId: 'private-media-id',
		sourceStart: 5,
		sourceEnd: 35,
		sourceDuration: 60,
		speed: 1.5
	};
	return {
		id: 'diagnostic-project',
		name: 'Private project name',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
		timeline: { tracks: [track('video-track', 0)], items: [item] }
	};
}

function centerPixel(canvas: HTMLCanvasElement | OffscreenCanvas): number[] {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return Array.from(
		context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
	);
}

afterEach(() => {
	colorPreviewStore.__resetForTesting();
	adaptivePreviewQuality.reset();
	previewPlaybackSettings.setPreviewQuality('auto');
	previewDiagnostics.setPerformanceOverlay(false);
	previewDiagnostics.setClipTimingOverlay(false);
	previewDiagnostics.resetCounters();
	previewDiagnostics.setPlaying(false);
	timelinePreviewScrub.__resetForTesting();
	editorSession.project = null;
	timelineStore.clear();
});

function gradedProject(): Project {
	const layer = {
		...colorLayer('graded', 'video-track', '#808080'),
		effects: [
			{
				id: 'grade',
				type: 'gpu' as const,
				effectId: 'gpu-brightness',
				enabled: true,
				params: { amount: 0.25 }
			}
		]
	};
	return {
		id: 'graded-project',
		name: 'Graded project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: 4, height: 4, fps: 30, backgroundColor: '#000000' },
		timeline: { tracks: [track('video-track', 0)], items: [layer] }
	};
}

describe('PreviewPlayer backdrop composition', () => {
	it('renders the hover-preview frame while leaving the committed frame unchanged', async () => {
		const layer = {
			...colorLayer('hover-only', 'video-track', '#ff0000'),
			from: 30,
			durationInFrames: 30
		};
		const project: Project = {
			id: 'hover-preview-project',
			name: 'Hover preview project',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 2,
			metadata: { width: 4, height: 4, fps: 30, backgroundColor: '#000000' },
			timeline: { tracks: [track('video-track', 0)], items: [layer] }
		};
		editorSession.project = project;
		timelineStore.setAll({
			items: [layer],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, { onedit: vi.fn() });
		expect(screen.container.querySelector('[data-preview-item="hover-only"]')).toBeNull();

		timelinePreviewScrub.setFrame(30);
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-preview-item="hover-only"]')).not.toBeNull();
		});
		expect(timelineStore.currentFrame).toBe(0);

		timelinePreviewScrub.clear();
		await vi.waitFor(() => {
			expect(screen.container.querySelector('[data-preview-item="hover-only"]')).toBeNull();
		});
	});

	it('shows opt-in live and clip timing overlays without project or media names', async () => {
		const project = diagnosticVideoProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		previewDiagnostics.setPerformanceOverlay(true);
		previewDiagnostics.setClipTimingOverlay(true);
		const screen = await render(PreviewPlayer, {
			selectedItemId: 'clip-12345678',
			onedit: vi.fn()
		});

		await expect.element(screen.getByTestId('preview-performance-diagnostics')).toBeVisible();
		const clipOverlay = screen.getByTestId('preview-clip-diagnostics');
		await expect.element(clipOverlay).toBeVisible();
		await expect.element(screen.getByText(/clip-123 · 0-30f/)).toBeVisible();
		expect(clipOverlay.element().textContent).toContain('Source 5-35f');
		expect(clipOverlay.element().textContent).toContain('1.50x');
		expect(screen.container.textContent).not.toContain('Private clip name');
		expect(screen.container.textContent).not.toContain('Private project name');
		expect(screen.container.textContent).not.toContain('private-media-id');
	});

	it('reduces real stacked preview pixels when Auto quality adapts down', async () => {
		const project = maskedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		previewPlaybackSettings.setPreviewQuality('auto');
		adaptivePreviewQuality.__setScaleForTesting(0.5);
		const screen = await render(PreviewPlayer, { selectedItemId: 'mask', onedit: vi.fn() });
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;
		await vi.waitFor(() => {
			expect(preview.width).toBe(4);
			expect(preview.height).toBe(4);
		});
		previewPlaybackSettings.setPreviewQuality('full');
		await vi.waitFor(() => {
			expect(preview.width).toBe(8);
			expect(preview.height).toBe(8);
		});
	});

	it('matches export pixels for a projective corner pin', async () => {
		const project = cornerPinnedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, { selectedItemId: 'content', onedit: vi.fn() });
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;
		await vi.waitFor(() => {
			const context = preview.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('2D canvas unavailable');
			expect([...context.getImageData(0, 4, 1, 1).data]).toEqual([0, 0, 255, 255]);
			expect([...context.getImageData(4, 4, 1, 1).data]).toEqual([255, 0, 0, 255]);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const context = exported.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('2D canvas unavailable');
			expect([...context.getImageData(0, 4, 1, 1).data]).toEqual([0, 0, 255, 255]);
			expect([...context.getImageData(4, 4, 1, 1).data]).toEqual([255, 0, 0, 255]);
		} finally {
			renderer.dispose();
		}
	});

	it('matches export pixels for a track-scoped shape mask', async () => {
		const project = maskedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, { selectedItemId: 'mask', onedit: vi.fn() });
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;

		await vi.waitFor(() => {
			const context = preview.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			const center = [...context.getImageData(4, 4, 1, 1).data];
			const outside = [...context.getImageData(0, 0, 1, 1).data];
			expect(center).toEqual([255, 0, 0, 255]);
			expect(outside).toEqual([0, 0, 255, 255]);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const context = exported.getContext('2d', { willReadFrequently: true });
			if (!context) throw new Error('2D canvas unavailable');
			expect([...context.getImageData(4, 4, 1, 1).data]).toEqual([255, 0, 0, 255]);
			expect([...context.getImageData(0, 0, 1, 1).data]).toEqual([0, 0, 255, 255]);
		} finally {
			renderer.dispose();
		}
	});

	it('matches export pixels when a top layer multiplies the finished layer below', async () => {
		const project = blendProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		expect(timelineStore.tracks).toHaveLength(2);
		const screen = await render(PreviewPlayer, { onedit: vi.fn() });
		const preview = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		expect(preview).not.toBeNull();
		if (!preview) return;

		await vi.waitFor(() => {
			const [red, green, blue, alpha] = centerPixel(preview);
			expect(red).toBeGreaterThanOrEqual(62);
			expect(red).toBeLessThanOrEqual(66);
			expect(green).toBe(red);
			expect(blue).toBe(red);
			expect(alpha).toBe(255);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const [red, green, blue, alpha] = centerPixel(exported);
			expect(red).toBeGreaterThanOrEqual(62);
			expect(red).toBeLessThanOrEqual(66);
			expect(green).toBe(red);
			expect(blue).toBe(red);
			expect(alpha).toBe(255);
		} finally {
			renderer.dispose();
		}
	});

	it('renders a split before surface without changing the graded export', async () => {
		const project = gradedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		colorPreviewStore.setComparisonMode('split');
		const screen = await render(PreviewPlayer, { selectedItemId: 'graded', onedit: vi.fn() });
		const after = screen.container.querySelector<HTMLCanvasElement>('[data-stacked-preview]');
		const before = screen.container.querySelector<HTMLCanvasElement>('[data-color-before-preview]');
		expect(after).not.toBeNull();
		expect(before).not.toBeNull();
		if (!after || !before) return;

		await vi.waitFor(() => {
			const [afterRed] = centerPixel(after);
			const [beforeRed] = centerPixel(before);
			expect(afterRed).toBeGreaterThanOrEqual(190);
			expect(afterRed).toBeLessThanOrEqual(194);
			expect(beforeRed).toBeGreaterThanOrEqual(126);
			expect(beforeRed).toBeLessThanOrEqual(130);
		});

		const renderer = new TimelineFrameRenderer(project);
		try {
			const exported = await renderer.render(0);
			const [red] = centerPixel(exported);
			expect(red).toBeGreaterThanOrEqual(190);
			expect(red).toBeLessThanOrEqual(194);
		} finally {
			renderer.dispose();
		}
	});

	it('samples the visible preview with a keyboard-cancellable loupe picker', async () => {
		const project = gradedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewPlayer, { selectedItemId: 'graded', onedit: vi.fn() });
		const picked = colorPreviewStore.requestPick('graded', 'white-balance');
		await vi.waitFor(() => {
			expect(
				screen.container.querySelector<HTMLButtonElement>(
					'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
				)
			).not.toBeNull();
		});
		const overlay = screen.container.querySelector<HTMLButtonElement>(
			'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
		);
		if (!overlay) throw new Error('picker overlay missing');
		scopeSamples.publish('graded', new ImageData(new Uint8ClampedArray([51, 102, 153, 255]), 1, 1));
		const rect = overlay.getBoundingClientRect();
		const pointer = {
			bubbles: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2
		};
		overlay.dispatchEvent(new PointerEvent('pointermove', pointer));
		await expect.element(screen.getByText('#336699', { exact: true })).toBeVisible();
		overlay.dispatchEvent(new PointerEvent('pointerdown', pointer));
		expect(await picked).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
		expect(colorPreviewStore.activePicker).toBeNull();

		const cancelled = colorPreviewStore.requestPick('graded', 'black-point');
		await vi.waitFor(() => {
			expect(
				screen.container.querySelector<HTMLButtonElement>(
					'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
				)
			).not.toBeNull();
		});
		screen.container
			.querySelector<HTMLButtonElement>(
				'[aria-label="Choose a color in the preview. Press Escape to cancel."]'
			)
			?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(await cancelled).toBeNull();
		expect(colorPreviewStore.activePicker).toBeNull();
	});

	it('captures the finished preview frame for auto balance without touching export state', async () => {
		const project = gradedProject();
		editorSession.project = project;
		timelineStore.setAll({
			items: project.timeline?.items ?? [],
			tracks: project.timeline?.tracks ?? [],
			currentFrame: 0,
			fps: 30
		});
		await render(PreviewPlayer, { selectedItemId: 'graded', onedit: vi.fn() });
		const image = await colorPreviewStore.requestFrameCapture('graded');
		expect(image).not.toBeNull();
		if (!image) return;
		const center = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
		expect(image.data[center]).toBeGreaterThanOrEqual(190);
		expect(image.data[center]).toBeLessThanOrEqual(194);
		expect(colorPreviewStore.frameCaptureItemId).toBeNull();
	});
});
