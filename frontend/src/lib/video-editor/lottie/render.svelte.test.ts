import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { strToU8, zipSync } from 'fflate';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { editorSession } from '../editor.svelte';
import { mediaPool } from '../media/pool.svelte';
import { TimelineFrameRenderer } from '../media/render-export';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import PreviewLayer from '../components/preview-layer.svelte';
import { LottieRenderer, mapTimelineFrameToLottieFrame } from './frame-provider';

const SIZE = 64;
const FPS = 30;

function shapeLayer(name: string, color: [number, number, number, number], ip: number, op: number) {
	return {
		ddd: 0,
		ind: ip + 1,
		ty: 4,
		nm: name,
		sr: 1,
		ks: {
			o: { a: 0, k: 100 },
			r: { a: 0, k: 0 },
			p: { a: 0, k: [32, 32, 0] },
			a: { a: 0, k: [0, 0, 0] },
			s: { a: 0, k: [100, 100, 100] }
		},
		shapes: [
			{
				ty: 'rc',
				d: 1,
				s: { a: 0, k: [64, 64] },
				p: { a: 0, k: [0, 0] },
				r: { a: 0, k: 0 }
			},
			{ ty: 'fl', c: { a: 0, k: color }, o: { a: 0, k: 100 }, r: 1 }
		],
		ip,
		op,
		st: 0,
		bm: 0
	};
}

const animation = JSON.stringify({
	v: '5.12.2',
	fr: FPS,
	ip: 0,
	op: 2,
	w: SIZE,
	h: SIZE,
	nm: 'Frame proof',
	ddd: 0,
	assets: [],
	layers: [shapeLayer('Red', [1, 0, 0, 1], 0, 1), shapeLayer('Green', [0, 1, 0, 1], 1, 2)],
	markers: []
});
const animationBlob = new Blob([animation], { type: 'application/json' });

const track: TimelineTrack = {
	id: 'visuals',
	name: 'Visuals',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'animation',
	trackId: track.id,
	from: 0,
	durationInFrames: 2,
	label: 'Frame proof',
	type: 'lottie',
	mediaId: 'lottie-media',
	sourceStart: 0,
	sourceEnd: 2,
	sourceDuration: 2,
	sourceFps: FPS,
	sourceWidth: SIZE,
	sourceHeight: SIZE,
	lottieFrameRate: FPS,
	lottieTotalFrames: 2,
	lottieLoop: false,
	transform: { width: SIZE, height: SIZE }
};

function project(): Project {
	return {
		id: 'lottie-project',
		name: 'Lottie project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: 2 / FPS,
		metadata: {
			width: SIZE,
			height: SIZE,
			fps: FPS,
			backgroundColor: '#000000'
		},
		timeline: { tracks: [track], items: [item] }
	};
}

function registerAnimationMedia(blob: Blob = animationBlob): void {
	// SAFETY: resolveMediaBlob only calls getFile on linked handles in this browser test.
	const fileHandle = {
		getFile: async () => new File([blob], 'proof.json')
	} as FileSystemFileHandle;
	mediaPool.upsert(
		{
			id: 'lottie-media',
			storageType: 'handle',
			fileHandle,
			fileName: 'proof.json',
			fileSize: blob.size,
			mimeType: blob.type || 'application/json',
			duration: 2 / FPS,
			width: SIZE,
			height: SIZE,
			fps: FPS,
			codec: 'lottie',
			bitrate: 0,
			lottieTotalFrames: 2,
			tags: ['lottie']
		},
		'ready'
	);
	// SAFETY: linked media resolves through its file handle before any directory method is used.
	setWorkspaceRoot({ name: 'test' } as FileSystemDirectoryHandle);
}

function centerPixel(canvas: HTMLCanvasElement | OffscreenCanvas): Uint8ClampedArray {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return context.getImageData(SIZE / 2, SIZE / 2, 1, 1).data;
}

function expectColor(pixel: Uint8ClampedArray, channel: 0 | 1 | 2): void {
	expect(pixel[channel]).toBeGreaterThan(240);
	for (const other of [0, 1, 2] as const) {
		if (other !== channel) expect(pixel[other]).toBeLessThan(15);
	}
	expect(pixel[3]).toBeGreaterThan(240);
}

afterEach(() => {
	mediaPool.clear();
	timelineStore.clear();
	editorSession.project = null;
	setWorkspaceRoot(null);
});

describe('Lottie timeline rendering', () => {
	it('maps loop, ping-pong, reverse, and source segments without skipping endpoints', () => {
		expect(
			mapTimelineFrameToLottieFrame({
				localFrame: 3,
				projectFps: 1,
				speed: 1,
				totalFrames: 4,
				frameRate: 1,
				loop: true
			})
		).toBe(3);
		expect(
			mapTimelineFrameToLottieFrame({
				localFrame: 4,
				projectFps: 1,
				speed: 1,
				totalFrames: 4,
				frameRate: 1,
				loop: true
			})
		).toBe(0);
		expect(
			mapTimelineFrameToLottieFrame({
				localFrame: 4,
				projectFps: 1,
				speed: 1,
				totalFrames: 8,
				frameRate: 1,
				loop: true,
				loopMode: 'pingpong',
				reversed: true,
				segmentStart: 2,
				segmentEnd: 5
			})
		).toBe(3);
	});

	it('renders packaged dotLottie archives with the same frame-addressed player', async () => {
		const archive = zipSync({
			'manifest.json': strToU8(
				JSON.stringify({
					version: '1.0',
					generator: 'OpenPost test',
					animations: [{ id: 'proof' }]
				})
			),
			'animations/proof.json': strToU8(animation)
		});
		const url = URL.createObjectURL(
			// SAFETY: Uint8Array.slice creates a standalone ArrayBuffer-backed copy.
			new Blob([archive.slice().buffer as ArrayBuffer], { type: 'application/zip' })
		);
		const renderer = new LottieRenderer(new OffscreenCanvas(SIZE, SIZE), { src: url });
		try {
			await renderer.ready;
			expect(renderer.isLoaded).toBe(true);
			renderer.renderFrame(1);
			expectColor(centerPixel(renderer.canvas), 1);
		} finally {
			renderer.destroy();
			URL.revokeObjectURL(url);
		}
	});

	it('renders a selected animation from a multi-animation archive', async () => {
		const alternate = JSON.stringify({
			v: '5.12.2',
			fr: FPS,
			ip: 0,
			op: 2,
			w: SIZE,
			h: SIZE,
			assets: [],
			layers: [shapeLayer('Blue', [0, 0, 1, 1], 0, 2)],
			markers: []
		});
		const archive = zipSync({
			'manifest.json': strToU8(
				JSON.stringify({ animations: [{ id: 'proof' }, { id: 'alternate' }] })
			),
			'animations/proof.json': strToU8(animation),
			'animations/alternate.json': strToU8(alternate)
		});
		// SAFETY: Uint8Array.slice creates a standalone ArrayBuffer-backed copy.
		const archiveBlob = new Blob([archive.slice().buffer as ArrayBuffer], {
			type: 'application/zip'
		});
		const selectedItem: TimelineItem = { ...item, lottieAnimationId: 'alternate' };
		const sourceUrl = URL.createObjectURL(archiveBlob);
		const currentProject = project();
		currentProject.timeline!.items = [selectedItem];
		editorSession.project = currentProject;
		timelineStore.setAll({ items: [selectedItem], tracks: [track], currentFrame: 0, fps: FPS });
		registerAnimationMedia(archiveBlob);
		try {
			const screen = await render(PreviewLayer, {
				item: selectedItem,
				url: sourceUrl,
				canvasWidth: SIZE,
				canvasHeight: SIZE,
				onselect: vi.fn()
			});
			const preview = screen.container.querySelector<HTMLCanvasElement>('canvas');
			expect(preview).not.toBeNull();
			if (!preview) return;
			await vi.waitFor(() => expectColor(centerPixel(preview), 2), { timeout: 15_000 });

			const exporter = new TimelineFrameRenderer(currentProject);
			try {
				expectColor(centerPixel(await exporter.render(0)), 2);
			} finally {
				exporter.dispose();
			}
		} finally {
			URL.revokeObjectURL(sourceUrl);
		}
	}, 30_000);

	it('renders exact source frames in Chromium preview and export', async () => {
		const sourceUrl = URL.createObjectURL(animationBlob);
		const currentProject = project();
		editorSession.project = currentProject;
		timelineStore.setAll({
			items: [item],
			tracks: [track],
			currentFrame: 0,
			fps: FPS
		});
		registerAnimationMedia();

		try {
			const screen = await render(PreviewLayer, {
				item,
				url: sourceUrl,
				canvasWidth: SIZE,
				canvasHeight: SIZE,
				onselect: vi.fn()
			});
			const preview = screen.container.querySelector<HTMLCanvasElement>('canvas');
			expect(preview).not.toBeNull();
			if (!preview) return;

			await vi.waitFor(() => expectColor(centerPixel(preview), 0), {
				timeout: 15_000
			});
			const exporter = new TimelineFrameRenderer(currentProject);
			try {
				const first = await exporter.render(0);
				expectColor(centerPixel(first), 0);

				timelineStore.setAll({ currentFrame: 1 });
				await vi.waitFor(() => expectColor(centerPixel(preview), 1), {
					timeout: 15_000
				});
				const second = await exporter.render(1);
				expectColor(centerPixel(second), 1);
			} finally {
				exporter.dispose();
			}
		} finally {
			URL.revokeObjectURL(sourceUrl);
		}
	}, 30_000);

	it('applies the same authored color override in Chromium preview and export', async () => {
		const editedItem: TimelineItem = {
			...item,
			lottieColorOverrides: { c0: '#0000ff' }
		};
		const sourceUrl = URL.createObjectURL(animationBlob);
		const currentProject = project();
		currentProject.timeline!.items = [editedItem];
		editorSession.project = currentProject;
		timelineStore.setAll({
			items: [editedItem],
			tracks: [track],
			currentFrame: 0,
			fps: FPS
		});
		registerAnimationMedia();

		try {
			const screen = await render(PreviewLayer, {
				item: editedItem,
				url: sourceUrl,
				canvasWidth: SIZE,
				canvasHeight: SIZE,
				onselect: vi.fn()
			});
			const preview = screen.container.querySelector<HTMLCanvasElement>('canvas');
			expect(preview).not.toBeNull();
			if (!preview) return;
			await vi.waitFor(() => expectColor(centerPixel(preview), 2), { timeout: 15_000 });

			const exporter = new TimelineFrameRenderer(currentProject);
			try {
				expectColor(centerPixel(await exporter.render(0)), 2);
			} finally {
				exporter.dispose();
			}
		} finally {
			URL.revokeObjectURL(sourceUrl);
		}
	}, 30_000);

	it('keeps Lottie frame timing inside a nested sequence', async () => {
		registerAnimationMedia();
		const wrapper: TimelineItem = {
			id: 'wrapper',
			trackId: track.id,
			from: 0,
			durationInFrames: 2,
			label: 'Nested animation',
			type: 'composition',
			compositionId: 'inner',
			sourceStart: 0,
			sourceEnd: 2,
			sourceFps: FPS,
			transform: { width: SIZE, height: SIZE }
		};
		const nested = project();
		nested.timeline = {
			tracks: [track],
			items: [wrapper],
			compositions: [
				{
					id: 'inner',
					name: 'Inner',
					items: [item],
					tracks: [track],
					transitions: [],
					fps: FPS,
					width: SIZE,
					height: SIZE,
					durationInFrames: 2
				}
			]
		};
		const renderer = new TimelineFrameRenderer(nested);
		try {
			expectColor(centerPixel(await renderer.render(1)), 1);
		} finally {
			renderer.dispose();
		}
	});
});
