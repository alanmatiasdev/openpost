import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineTrack } from '$lib/video-editor/project/types';
import TimelineTrackHeader from './timeline-track-header.svelte';

function track(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
	return {
		id: 'video-1',
		name: 'Video 1',
		kind: 'video',
		height: 64,
		locked: false,
		syncLock: true,
		visible: true,
		muted: false,
		solo: false,
		order: 0,
		...overrides
	};
}

describe('TimelineTrackHeader', () => {
	it('exposes every track state as a named control', async () => {
		const callbacks = {
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn()
		};
		const screen = await render(TimelineTrackHeader, {
			track: track(),
			itemCount: 3,
			canDelete: true,
			...callbacks
		});

		await expect.element(screen.getByText('Video 1')).toBeVisible();
		await expect.element(screen.getByText('3')).toBeVisible();
		for (const [name, callback] of [
			['Hide track', callbacks.onvisibility],
			['Disable sync lock', callbacks.onsynclock],
			['Mute track', callbacks.onmute],
			['Solo track', callbacks.onsolo],
			['Lock track', callbacks.onlock],
			['Delete track and clips', callbacks.ondelete]
		] as const) {
			await screen.getByRole('button', { name }).click();
			expect(callback).toHaveBeenCalledOnce();
		}
	});

	it('keeps the last remaining track', async () => {
		const screen = await render(TimelineTrackHeader, {
			track: track(),
			itemCount: 0,
			canDelete: false,
			onvisibility: vi.fn(),
			onmute: vi.fn(),
			onsolo: vi.fn(),
			onlock: vi.fn(),
			onsynclock: vi.fn(),
			ondelete: vi.fn()
		});

		await expect
			.element(screen.getByRole('button', { name: 'Delete track and clips' }))
			.toBeDisabled();
	});
});
