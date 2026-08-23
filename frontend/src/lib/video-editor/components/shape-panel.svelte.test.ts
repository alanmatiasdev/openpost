import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createDefaultTracks } from '$lib/video-editor/project/defaults';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import ShapePanel from './shape-panel.svelte';

beforeEach(() => {
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
});

describe('ShapePanel', () => {
	it('shows all primitives and the pen tool, then inserts the chosen shape', async () => {
		const oninserted = vi.fn();
		const screen = await render(ShapePanel, { oninserted });

		for (const label of [
			'Rectangle',
			'Circle',
			'Ellipse',
			'Triangle',
			'Star',
			'Polygon',
			'Heart',
			'Pen'
		]) {
			await expect.element(screen.getByRole('button', { name: label })).toBeVisible();
		}

		await screen.getByRole('button', { name: 'Star' }).click();
		const star = timelineStore.items[0];
		expect(star).toMatchObject({ type: 'shape', shapeType: 'star', shapePoints: 5 });
		expect(oninserted).toHaveBeenCalledWith(star?.id);
	});

	it('does not overflow a 260 pixel asset panel', async () => {
		const screen = await render(ShapePanel, { oninserted: vi.fn() });
		// SAFETY: ShapePanel always renders one root div.
		const host = screen.container.firstElementChild as HTMLElement;
		screen.container.style.width = '260px';
		expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
	});
});
