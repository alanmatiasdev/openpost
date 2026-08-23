import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import OnCanvasTools from './on-canvas-tools.svelte';
import '../../../routes/layout.css';

function imageItem(patch: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'clip',
		trackId: 'video',
		from: 0,
		durationInFrames: 30,
		label: 'Clip',
		type: 'image',
		sourceWidth: 400,
		sourceHeight: 200,
		transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
		...patch
	};
}

async function renderTools(item: TimelineItem) {
	await page.viewport(1200, 700);
	const callbacks = {
		ontransformdraft: vi.fn(),
		oncropdraft: vi.fn(),
		ontextdraft: vi.fn(),
		ontextediting: vi.fn(),
		oncommitvalues: vi.fn(() => true),
		oncommitposition: vi.fn(() => true),
		oncommittext: vi.fn(),
		onseek: vi.fn(),
		onedit: vi.fn()
	};
	const screen = await render(OnCanvasTools, {
		item,
		canvasWidth: 1000,
		canvasHeight: 500,
		currentFrame: 12,
		...callbacks
	});
	screen.container.style.position = 'relative';
	screen.container.style.containerType = 'size';
	screen.container.style.width = '1000px';
	screen.container.style.height = '500px';
	return { screen, callbacks };
}

function canvasRoot(container: HTMLElement): HTMLElement {
	const root = container.querySelector<HTMLElement>('[data-on-canvas-tools]');
	if (!root) throw new Error('canvas root missing');
	return root;
}

describe('OnCanvasTools', () => {
	it('commits a rotated crop drag in clip-local coordinates', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({ transform: { x: 0, y: 0, width: 100, height: 100, rotation: 90 } })
		);
		await screen.getByRole('button', { name: 'Crop' }).click();
		await page.screenshot({
			element: canvasRoot(screen.container),
			path: '../../../../.svelte-kit/openpost-on-canvas-crop.png'
		});
		const handle = screen.container.querySelector<HTMLButtonElement>(
			'[aria-label="Crop left edge"]'
		);
		if (!handle) throw new Error('left crop handle missing');
		const root = canvasRoot(screen.container);
		const rect = root.getBoundingClientRect();
		const start = {
			bubbles: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			pointerId: 1
		};
		const endY = start.clientY + (25 / 500) * rect.height;
		handle.dispatchEvent(new PointerEvent('pointerdown', start));
		window.dispatchEvent(new PointerEvent('pointerup', { ...start, pointerId: 99 }));
		expect(callbacks.oncommitvalues).not.toHaveBeenCalled();
		window.dispatchEvent(new PointerEvent('pointermove', { ...start, clientY: endY, buttons: 1 }));
		window.dispatchEvent(new PointerEvent('pointerup', { ...start, clientY: endY }));
		expect(callbacks.oncommitvalues).toHaveBeenCalledWith(12, { cropLeft: 0.25 });
		expect(callbacks.onedit).toHaveBeenCalledTimes(1);
	});

	it('cancels or atomically commits direct text editing', async () => {
		const item = imageItem({
			type: 'text',
			text: 'Original',
			label: 'Original',
			sourceWidth: undefined,
			sourceHeight: undefined
		});
		const { screen, callbacks } = await renderTools(item);
		const box = screen.container.querySelector<HTMLElement>('[data-canvas-item-box]');
		if (!box) throw new Error('item box missing');
		box.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await vi.waitFor(() =>
			expect(screen.container.querySelector('[aria-label^="Edit text on canvas"]')).not.toBeNull()
		);
		await page.screenshot({
			element: canvasRoot(screen.container),
			path: '../../../../.svelte-kit/openpost-on-canvas-text.png'
		});
		const editor = screen.container.querySelector<HTMLDivElement>(
			'[aria-label^="Edit text on canvas"]'
		);
		if (!editor) throw new Error('text editor missing');
		editor.textContent = 'Cancelled';
		editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
		editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(callbacks.oncommittext).not.toHaveBeenCalled();

		await screen.getByRole('button', { name: 'Text' }).click();
		const committedEditor = screen.container.querySelector<HTMLDivElement>(
			'[aria-label^="Edit text on canvas"]'
		);
		if (!committedEditor) throw new Error('text editor did not reopen');
		committedEditor.textContent = 'Committed';
		committedEditor.dispatchEvent(new InputEvent('input', { bubbles: true }));
		committedEditor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
		);
		expect(callbacks.oncommittext).toHaveBeenCalledOnce();
		expect(callbacks.oncommittext).toHaveBeenCalledWith('Committed');
		expect(callbacks.onedit).toHaveBeenCalledOnce();
	});

	it('keeps direct canvas moves coupled when position animation exists', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({ keyframes: { x: { frames: [0, 20], values: [-100, 100] } } })
		);
		const root = canvasRoot(screen.container);
		const rect = root.getBoundingClientRect();
		const box = screen.container.querySelector<HTMLElement>('[data-canvas-item-box]');
		if (!box) throw new Error('item box missing');
		const start = {
			bubbles: true,
			clientX: rect.left + rect.width / 2,
			clientY: rect.top + rect.height / 2,
			pointerId: 3
		};
		box.dispatchEvent(new PointerEvent('pointerdown', start));
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				...start,
				clientX: start.clientX + (20 / 1000) * rect.width,
				clientY: start.clientY + (10 / 500) * rect.height
			})
		);
		expect(callbacks.oncommitposition).toHaveBeenCalledWith(12, 20, 10);
		expect(callbacks.oncommitvalues).not.toHaveBeenCalled();
	});

	it('edits both axes of a motion keyframe with one path gesture', async () => {
		const { screen, callbacks } = await renderTools(
			imageItem({
				keyframes: {
					x: { frames: [0, 20], values: [-100, 100] },
					y: { frames: [0, 20], values: [0, 100] }
				}
			})
		);
		await screen.getByRole('button', { name: 'Motion' }).click();
		await page.screenshot({
			element: canvasRoot(screen.container),
			path: '../../../../.svelte-kit/openpost-on-canvas-motion.png'
		});
		const point = screen.container.querySelector<SVGCircleElement>(
			'[aria-label="Position keyframe at frame 0"]'
		);
		if (!point) throw new Error('motion keyframe missing');
		const root = canvasRoot(screen.container);
		const rect = root.getBoundingClientRect();
		const start = {
			bubbles: true,
			clientX: rect.left + (400 / 1000) * rect.width,
			clientY: rect.top + (250 / 500) * rect.height,
			pointerId: 2
		};
		const endX = start.clientX + (20 / 1000) * rect.width;
		const endY = start.clientY + (30 / 500) * rect.height;
		point.dispatchEvent(new PointerEvent('pointerdown', start));
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				...start,
				clientX: endX,
				clientY: endY,
				buttons: 1
			})
		);
		window.dispatchEvent(new PointerEvent('pointerup', { ...start, clientX: endX, clientY: endY }));
		expect(callbacks.onseek).toHaveBeenCalledWith(0);
		expect(callbacks.oncommitposition).toHaveBeenCalledWith(0, -80, 30);
		expect(callbacks.onedit).toHaveBeenCalledOnce();
	});

	it('supports precise keyboard anchor nudging', async () => {
		const { screen, callbacks } = await renderTools(imageItem());
		await screen.getByRole('button', { name: 'Anchor' }).click();
		const anchor = screen.container.querySelector<HTMLButtonElement>(
			'[aria-label="Move anchor point"]'
		);
		if (!anchor) throw new Error('anchor handle missing');
		anchor.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
		);
		expect(callbacks.oncommitvalues).toHaveBeenCalledWith(12, {
			x: 0,
			y: 0,
			anchorX: 60,
			anchorY: 50
		});
	});
});
