import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import CornerPinOverlay from './corner-pin-overlay.svelte';

function item(): TimelineItem {
	return {
		id: 'image',
		trackId: 'visual',
		from: 0,
		durationInFrames: 30,
		label: 'Image',
		type: 'image',
		transform: { width: 400, height: 200 }
	};
}

describe('CornerPinOverlay', () => {
	it('drags and keyboard-nudges local corner offsets', async () => {
		const onpreview = vi.fn();
		const oncommit = vi.fn();
		const screen = await render(CornerPinOverlay, {
			item: item(),
			canvasWidth: 400,
			canvasHeight: 200,
			boxStyle: 'left:0;top:0;width:400px;height:200px;transform:none',
			screenScale: 1,
			onpreview,
			oncommit
		});
		screen.container.style.width = '400px';
		screen.container.style.height = '220px';
		screen.container.style.position = 'relative';
		const svg = screen.container.querySelector('svg');
		const topLeft = screen.getByRole('button', { name: 'Move topLeft corner' }).query();
		if (!(svg instanceof SVGSVGElement) || !(topLeft instanceof SVGCircleElement)) {
			throw new Error('corner pin handles did not render');
		}
		const matrix = svg.getScreenCTM();
		if (!matrix) throw new Error('corner pin SVG has no screen transform');
		const destination = new DOMPoint(40, 20).matrixTransform(matrix);
		topLeft.dispatchEvent(
			new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: 0, clientY: 0 })
		);
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				pointerId: 7,
				clientX: destination.x,
				clientY: destination.y
			})
		);
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				pointerId: 7,
				clientX: destination.x,
				clientY: destination.y
			})
		);

		expect(onpreview).toHaveBeenCalled();
		expect(onpreview).toHaveBeenLastCalledWith(null);
		expect(oncommit).toHaveBeenCalledWith(
			expect.objectContaining({ topLeft: [40, 20], referenceWidth: 400, referenceHeight: 200 })
		);

		const topRight = screen.getByRole('button', { name: 'Move topRight corner' }).query();
		if (!(topRight instanceof SVGCircleElement)) throw new Error('top-right handle did not render');
		topRight.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
		expect(oncommit).toHaveBeenLastCalledWith(
			expect.objectContaining({ topRight: [-1, 0], referenceWidth: 400, referenceHeight: 200 })
		);
	});
});
