import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Project, TimelineItem } from '$lib/video-editor/project/types';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { TimelineFrameRenderer } from '$lib/video-editor/media/render-export';
import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
import { editorSession } from '$lib/video-editor/editor.svelte';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import PreviewLayer from './preview-layer.svelte';

const WIDTH = 96;
const HEIGHT = 64;

function textItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'title',
		trackId: 'visuals',
		from: 0,
		durationInFrames: 30,
		label: 'Test card',
		type: 'text',
		text: 'OpenPost',
		fontSize: 24,
		color: '#ffffff',
		backgroundColor: '#ff0000',
		transform: { width: WIDTH, height: HEIGHT },
		effects: [
			{
				id: 'invert',
				type: 'gpu',
				effectId: 'gpu-invert',
				enabled: true,
				params: {}
			}
		],
		...overrides
	};
}

function project(item: TimelineItem): Project {
	return {
		id: 'gpu-text-project',
		name: 'GPU text project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 1,
		metadata: { width: WIDTH, height: HEIGHT, fps: 30, backgroundColor: '#000000' },
		timeline: {
			tracks: [
				{
					id: 'visuals',
					name: 'Visuals',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				}
			],
			items: [item]
		}
	};
}

function nestedProject(): Project {
	const innerText = textItem({
		id: 'inner-text',
		effects: [],
		text: '',
		backgroundColor: '#ff0000'
	});
	const innerWrapper: TimelineItem = {
		id: 'inner-wrapper',
		trackId: 'visuals',
		from: 0,
		durationInFrames: 30,
		label: 'Inner',
		type: 'composition',
		compositionId: 'inner',
		sourceStart: 0,
		sourceEnd: 30,
		sourceFps: 30,
		speed: 1,
		transform: { width: WIDTH, height: HEIGHT, opacity: 1 }
	};
	const outerWrapper: TimelineItem = {
		...innerWrapper,
		id: 'outer-wrapper',
		label: 'Outer',
		compositionId: 'outer'
	};
	const visualTrack = {
		id: 'visuals',
		name: 'Visuals',
		kind: 'video' as const,
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	};
	return {
		...project(outerWrapper),
		id: 'nested-project',
		timeline: {
			tracks: [visualTrack],
			items: [outerWrapper],
			compositions: [
				{
					id: 'inner',
					name: 'Inner',
					items: [innerText],
					tracks: [visualTrack],
					transitions: [],
					fps: 30,
					width: WIDTH,
					height: HEIGHT,
					durationInFrames: 30
				},
				{
					id: 'outer',
					name: 'Outer',
					items: [innerWrapper],
					tracks: [visualTrack],
					transitions: [],
					fps: 30,
					width: WIDTH,
					height: HEIGHT,
					durationInFrames: 30
				}
			]
		}
	};
}

function projectWithAdjustment(item: TimelineItem): Project {
	const adjustment: TimelineItem = {
		id: 'grade',
		trackId: 'grade-track',
		from: 0,
		durationInFrames: 30,
		label: 'Adjustment layer',
		type: 'adjustment',
		effects: [
			{
				id: 'invert-grade',
				type: 'gpu',
				effectId: 'gpu-invert',
				enabled: true,
				params: {}
			}
		]
	};
	return {
		...project({ ...item, trackId: 'content-track', effects: [] }),
		timeline: {
			tracks: [
				{
					id: 'grade-track',
					name: 'Grade',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				},
				{
					id: 'content-track',
					name: 'Content',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 1
				}
			],
			items: [adjustment, { ...item, trackId: 'content-track', effects: [] }]
		}
	};
}

function subtitleItem(): TimelineItem {
	return {
		id: 'captions',
		trackId: 'visuals',
		from: 0,
		durationInFrames: 30,
		label: 'Captions',
		type: 'subtitle',
		transform: { width: WIDTH, height: HEIGHT },
		cues: [{ id: 'cue', startFrame: 0, endFrame: 30, text: 'Caption' }],
		effects: [
			{
				id: 'darken',
				type: 'gpu',
				effectId: 'gpu-brightness',
				enabled: true,
				params: { amount: -0.5 }
			}
		]
	};
}

function redImageUrl(): string {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('2D canvas unavailable');
	context.fillStyle = '#ff0000';
	context.fillRect(0, 0, WIDTH, HEIGHT);
	return canvas.toDataURL('image/png');
}

function expectCyan(pixel: Uint8ClampedArray | Uint8Array): void {
	expect(pixel[0]).toBeLessThan(20);
	expect(pixel[1]).toBeGreaterThan(235);
	expect(pixel[2]).toBeGreaterThan(235);
	expect(pixel[3]).toBeGreaterThan(235);
}

afterEach(() => {
	timelineStore.clear();
	sequenceStore.reset();
	editorSession.project = null;
	if (scopeSamples.current) scopeSamples.clear(scopeSamples.current.itemId);
});

describe('PreviewLayer GPU rendering', () => {
	it('renders live motion from the shared frame evaluator', async () => {
		const title = textItem({
			effects: [],
			motionModifiers: [
				{
					id: 'sway',
					type: 'sway',
					enabled: true,
					amplitude: 1,
					frequency: 0.5,
					phaseFrames: 0,
					seed: 1
				}
			]
		});
		editorSession.project = project(title);
		timelineStore.setAll({
			items: [title],
			tracks: editorSession.project.timeline?.tracks,
			fps: 30,
			currentFrame: 15
		});
		await render(PreviewLayer, {
			item: title,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const layer = document.querySelector<HTMLElement>('[data-preview-item="title"]');
		expect(layer).not.toBeNull();
		expect(layer?.style.transform).toContain('rotate(4deg)');
	});

	it('mutes embedded video audio when a synced audio companion owns playback', async () => {
		const video: TimelineItem = {
			...textItem({
				id: 'video',
				type: 'video',
				text: undefined,
				effects: [],
				mediaId: 'media',
				linkedGroupId: 'linked-media'
			}),
			trackId: 'visuals'
		};
		const audio: TimelineItem = {
			...video,
			id: 'audio',
			type: 'audio',
			trackId: 'audio'
		};
		timelineStore.setAll({
			items: [video, audio],
			tracks: [
				{
					id: 'visuals',
					name: 'Visuals',
					kind: 'video',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 0
				},
				{
					id: 'audio',
					name: 'Audio',
					kind: 'audio',
					height: 64,
					locked: false,
					visible: true,
					muted: false,
					solo: false,
					order: 1
				}
			],
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewLayer, {
			item: video,
			url: 'data:video/mp4;base64,',
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const element = screen.container.querySelector('video');
		expect(element).not.toBeNull();
		await vi.waitFor(() => expect(element?.volume).toBe(0));
	});

	it('plays proxy visuals with the original source audio', async () => {
		const video: TimelineItem = {
			...textItem({
				id: 'proxy-video',
				type: 'video',
				text: undefined,
				effects: [],
				mediaId: 'heavy-media'
			}),
			trackId: 'visuals'
		};
		timelineStore.setAll({
			items: [video],
			tracks: project(video).timeline?.tracks,
			currentFrame: 0,
			fps: 30
		});
		const screen = await render(PreviewLayer, {
			item: video,
			url: 'blob:preview-proxy',
			audioUrl: 'blob:original-source',
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});

		const visual = screen.container.querySelector<HTMLVideoElement>('video');
		const audio = screen.container.querySelector<HTMLAudioElement>('audio');
		expect(visual?.dataset.proxyPreview).toBe('true');
		expect(visual?.src).toContain('blob:preview-proxy');
		expect(audio?.src).toContain('blob:original-source');
		await vi.waitFor(() => {
			expect(visual?.volume).toBe(0);
			expect(audio?.volume).toBe(1);
		});
	});

	it('rasterizes text before applying its GPU effect in the live preview', async () => {
		const item = textItem();
		timelineStore.setAll({ items: [item], currentFrame: 0, fps: 30 });
		const screen = await render(PreviewLayer, {
			item,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});

		const source = screen.container.querySelector<HTMLCanvasElement>(
			'[role="img"][aria-label="OpenPost"] canvas'
		);
		const output = screen.container.querySelector<HTMLCanvasElement>('canvas[data-gpu-preview]');
		expect(source).not.toBeNull();
		expect(output).not.toBeNull();
		if (!source || !output) return;

		await vi.waitFor(() => {
			expect(output.hidden).toBe(false);
			expect(source.style.visibility).toBe('hidden');
		});
		const gl = output.getContext('webgl2');
		expect(gl).not.toBeNull();
		if (!gl) return;
		const pixel = new Uint8Array(4);
		gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
		expectCyan(pixel);
	});

	it('keeps the accessible text raster visible when no GPU effect is active', async () => {
		const item = textItem({ effects: [] });
		timelineStore.setAll({ items: [item], currentFrame: 0, fps: 30 });
		const screen = await render(PreviewLayer, {
			item,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});

		await expect.element(screen.getByRole('img', { name: 'OpenPost' })).toBeVisible();
		expect(screen.container.querySelector('canvas[data-gpu-preview]')).toBeNull();
		const source = screen.container.querySelector<HTMLCanvasElement>('[role="img"] canvas');
		expect(source).not.toBeNull();
		if (!source) return;
		const context = source.getContext('2d', { willReadFrequently: true });
		expect(context).not.toBeNull();
		if (!context) return;
		expect(Array.from(context.getImageData(4, 4, 1, 1).data)).toEqual([255, 0, 0, 255]);
	});

	it('applies the same text GPU effect during full-resolution export', async () => {
		const renderer = new TimelineFrameRenderer(project(textItem()));
		try {
			const frame = await renderer.render(0);
			const context = frame.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			const pixel = context.getImageData(4, HEIGHT - 5, 1, 1).data;
			expectCyan(pixel);
		} finally {
			renderer.dispose();
		}
	});

	it('renders two nested composition levels in live preview and export', async () => {
		const nested = nestedProject();
		const wrapper = nested.timeline?.items[0];
		expect(wrapper).toBeDefined();
		if (!wrapper || !nested.timeline) return;
		editorSession.project = nested;
		sequenceStore.load(nested.timeline, nested.metadata);
		const screen = await render(PreviewLayer, {
			item: wrapper,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const preview = screen.container.querySelector<HTMLCanvasElement>('canvas');
		expect(preview).not.toBeNull();
		if (!preview) return;
		await vi.waitFor(() => {
			const context = preview.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			expect(Array.from(context.getImageData(4, 4, 1, 1).data)).toEqual([255, 0, 0, 255]);
		});

		const renderer = new TimelineFrameRenderer(nested);
		try {
			const frame = await renderer.render(0);
			const context = frame.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			expect(Array.from(context.getImageData(4, HEIGHT - 5, 1, 1).data)).toEqual([255, 0, 0, 255]);
		} finally {
			renderer.dispose();
		}
	});

	it('applies an active adjustment layer in preview and full-resolution export', async () => {
		const item = textItem({ effects: [] });
		const effectiveEffects = textItem().effects;
		timelineStore.setAll({ items: [item], currentFrame: 0, fps: 30 });
		const screen = await render(PreviewLayer, {
			item,
			effectiveEffects,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const output = screen.container.querySelector<HTMLCanvasElement>('canvas[data-gpu-preview]');
		expect(output).not.toBeNull();
		if (!output) return;
		await vi.waitFor(() => expect(output.hidden).toBe(false));
		const gl = output.getContext('webgl2');
		expect(gl).not.toBeNull();
		if (!gl) return;
		const previewPixel = new Uint8Array(4);
		gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, previewPixel);
		expectCyan(previewPixel);

		const renderer = new TimelineFrameRenderer(projectWithAdjustment(item));
		try {
			const frame = await renderer.render(0);
			const context = frame.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			expectCyan(context.getImageData(4, HEIGHT - 5, 1, 1).data);
		} finally {
			renderer.dispose();
		}
	});

	it('uses an image element as the GPU source in the live preview', async () => {
		const item = textItem({
			id: 'image',
			label: 'Red image',
			type: 'image',
			text: undefined,
			backgroundColor: undefined
		});
		timelineStore.setAll({ items: [item], currentFrame: 0, fps: 30 });
		const screen = await render(PreviewLayer, {
			item,
			url: redImageUrl(),
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			selected: true,
			onselect: vi.fn()
		});
		const source = screen.container.querySelector<HTMLImageElement>('img');
		const output = screen.container.querySelector<HTMLCanvasElement>('canvas[data-gpu-preview]');
		expect(source).not.toBeNull();
		expect(output).not.toBeNull();
		if (!source || !output) return;

		await vi.waitFor(() => {
			expect(output.hidden).toBe(false);
			expect(source.style.visibility).toBe('hidden');
		});
		await vi.waitFor(() => expect(scopeSamples.current?.itemId).toBe('image'));
		const sample = scopeSamples.current?.image;
		expect(sample).toBeDefined();
		if (!sample) return;
		const centerOffset = (Math.floor(sample.height / 2) * sample.width + sample.width / 2) * 4;
		expectCyan(sample.data.slice(centerOffset, centerOffset + 4));
	});

	it('rasterizes the active subtitle before its GPU effect in preview and export', async () => {
		const item = subtitleItem();
		timelineStore.setAll({ items: [item], currentFrame: 0, fps: 30 });
		const screen = await render(PreviewLayer, {
			item,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		const source = screen.container.querySelector<HTMLCanvasElement>(
			'[role="img"][aria-label="Caption"] canvas'
		);
		const output = screen.container.querySelector<HTMLCanvasElement>('canvas[data-gpu-preview]');
		expect(source).not.toBeNull();
		expect(output).not.toBeNull();
		if (!source || !output) return;

		await vi.waitFor(() => expect(output.hidden).toBe(false));
		const gl = output.getContext('webgl2');
		expect(gl).not.toBeNull();
		if (!gl) return;
		const previewPixels = new Uint8Array(WIDTH * HEIGHT * 4);
		gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, previewPixels);
		const previewMaximum = Math.max(
			...Array.from({ length: WIDTH * HEIGHT }, (_, index) => previewPixels[index * 4] ?? 0)
		);
		expect(previewMaximum).toBeGreaterThan(100);
		expect(previewMaximum).toBeLessThan(150);

		const renderer = new TimelineFrameRenderer(project(item));
		try {
			const frame = await renderer.render(0);
			const context = frame.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			const exportPixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
			const exportMaximum = Math.max(
				...Array.from({ length: WIDTH * HEIGHT }, (_, index) => exportPixels[index * 4] ?? 0)
			);
			expect(exportMaximum).toBeGreaterThan(100);
			expect(exportMaximum).toBeLessThan(150);
		} finally {
			renderer.dispose();
		}
	});

	it('clears the subtitle raster when no cue is active', async () => {
		const item = { ...subtitleItem(), durationInFrames: 60, effects: [] };
		timelineStore.setAll({ items: [item], currentFrame: 31, fps: 30 });
		const screen = await render(PreviewLayer, {
			item,
			url: null,
			canvasWidth: WIDTH,
			canvasHeight: HEIGHT,
			onselect: vi.fn()
		});
		await expect.element(screen.getByRole('img', { name: 'Captions' })).toBeVisible();
		const source = screen.container.querySelector<HTMLCanvasElement>('[role="img"] canvas');
		expect(source).not.toBeNull();
		if (!source) return;
		const context = source.getContext('2d', { willReadFrequently: true });
		expect(context).not.toBeNull();
		if (!context) return;
		const pixels = context.getImageData(0, 0, WIDTH, HEIGHT).data;
		const maximumAlpha = Math.max(
			...Array.from({ length: WIDTH * HEIGHT }, (_, index) => pixels[index * 4 + 3] ?? 0)
		);
		expect(maximumAlpha).toBe(0);
	});

	it('keeps burned subtitles in their track paint order', async () => {
		const stackedProject = project(subtitleItem());
		const timeline = stackedProject.timeline;
		expect(timeline).toBeDefined();
		if (!timeline) return;
		const subtitleTrack = timeline.tracks[0];
		expect(subtitleTrack).toBeDefined();
		if (!subtitleTrack) return;
		subtitleTrack.order = 1;
		timeline.tracks.push({
			id: 'overlay',
			name: 'Overlay',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		});
		timeline.items.push(
			textItem({
				id: 'cover',
				trackId: 'overlay',
				text: '',
				backgroundColor: '#ff0000',
				effects: []
			})
		);

		const renderer = new TimelineFrameRenderer(stackedProject);
		try {
			const frame = await renderer.render(0);
			const context = frame.getContext('2d', { willReadFrequently: true });
			expect(context).not.toBeNull();
			if (!context) return;
			const pixels = context.getImageData(0, HEIGHT * 0.7, WIDTH, HEIGHT * 0.3).data;
			const allRed = Array.from(
				{ length: pixels.length / 4 },
				(_, index) =>
					pixels[index * 4] === 255 &&
					pixels[index * 4 + 1] === 0 &&
					pixels[index * 4 + 2] === 0 &&
					pixels[index * 4 + 3] === 255
			).every(Boolean);
			expect(allRed).toBe(true);
		} finally {
			renderer.dispose();
		}
	});
});
