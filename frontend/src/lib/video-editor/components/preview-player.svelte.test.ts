import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { editorSession } from '../editor.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { TimelineFrameRenderer } from '../media/render-export';
import PreviewPlayer from './preview-player.svelte';

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

function centerPixel(canvas: HTMLCanvasElement | OffscreenCanvas): number[] {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('2D canvas unavailable');
	return Array.from(
		context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
	);
}

afterEach(() => {
	editorSession.project = null;
	timelineStore.clear();
});

describe('PreviewPlayer backdrop composition', () => {
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
});
