import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import PathEditorOverlay from './path-editor-overlay.svelte';

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

function pathItem(): TimelineItem {
	return {
		id: 'path',
		trackId: track.id,
		from: 0,
		durationInFrames: 90,
		label: 'Pen',
		type: 'shape',
		shapeType: 'path',
		fillEnabled: false,
		strokeEnabled: true,
		strokeWidth: 8,
		strokeColor: '#ffffff',
		pathVertices: [],
		pathClosed: false,
		transform: { width: 400, height: 200, aspectRatioLocked: false }
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore.setAll({ fps: 30, currentFrame: 0, tracks: [track], items: [pathItem()] });
});

function drawPoint(svg: SVGSVGElement, x: number, y: number, dragX = x, dragY = y): void {
	const pointerId = Math.round(x + y + 1);
	svg.dispatchEvent(
		new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId })
	);
	window.dispatchEvent(
		new PointerEvent('pointermove', {
			bubbles: true,
			clientX: dragX,
			clientY: dragY,
			pointerId
		})
	);
	window.dispatchEvent(
		new PointerEvent('pointerup', {
			bubbles: true,
			clientX: dragX,
			clientY: dragY,
			pointerId
		})
	);
}

describe('PathEditorOverlay', () => {
	it('draws curved points and finishes an open path with fitted bounds', async () => {
		const onedit = vi.fn();
		const screen = await render(PathEditorOverlay, {
			item: timelineStore.itemById.get('path')!,
			canvasWidth: 400,
			canvasHeight: 200,
			boxStyle: 'left:0;top:0;width:400px;height:200px;transform:none',
			screenScale: 1,
			onedit
		});
		screen.container.style.width = '400px';
		screen.container.style.height = '240px';
		screen.container.style.position = 'relative';
		const svg = screen.container.querySelector('svg');
		expect(svg).not.toBeNull();

		drawPoint(svg!, 40, 50, 80, 25);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		drawPoint(svg!, 330, 150);
		await screen.rerender({ item: timelineStore.itemById.get('path')! });
		await screen.getByRole('button', { name: 'Finish open' }).click();

		const item = timelineStore.itemById.get('path');
		expect(item?.pathVertices).toHaveLength(2);
		expect(item?.pathVertices?.[0]?.tangentMode).toBe('continuous');
		expect(item?.pathVertices?.[0]?.outHandle).not.toEqual([0, 0]);
		expect(item?.pathClosed).toBe(false);
		expect(item?.transform?.width).toBeLessThan(400);
		expect(item?.transform?.height).toBeLessThan(200);
		expect(onedit).toHaveBeenCalledTimes(3);
	});
});
