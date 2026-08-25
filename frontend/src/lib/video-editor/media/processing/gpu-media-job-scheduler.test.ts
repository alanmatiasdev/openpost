// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { gpuMediaJobScheduler } from './gpu-media-job-scheduler';

describe('gpuMediaJobScheduler', () => {
	it('runs one GPU-heavy job at a time and advances on release', async () => {
		const first = new AbortController();
		const second = new AbortController();
		const releaseFirst = await gpuMediaJobScheduler.acquire(first.signal);
		let secondStarted = false;
		const secondLease = gpuMediaJobScheduler.acquire(second.signal).then((release) => {
			secondStarted = true;
			return release;
		});

		await Promise.resolve();
		expect(secondStarted).toBe(false);
		releaseFirst();
		const releaseSecond = await secondLease;
		expect(secondStarted).toBe(true);
		releaseSecond();
	});

	it('removes a cancelled waiter without blocking the next job', async () => {
		const active = new AbortController();
		const cancelled = new AbortController();
		const final = new AbortController();
		const releaseActive = await gpuMediaJobScheduler.acquire(active.signal);
		const cancelledLease = gpuMediaJobScheduler.acquire(cancelled.signal);
		const finalLease = gpuMediaJobScheduler.acquire(final.signal);
		cancelled.abort();
		await expect(cancelledLease).rejects.toMatchObject({ name: 'AbortError' });
		releaseActive();
		const releaseFinal = await finalLease;
		releaseFinal();
	});
});
