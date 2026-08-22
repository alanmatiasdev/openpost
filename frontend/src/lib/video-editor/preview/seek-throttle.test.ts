import { describe, expect, it } from 'vitest';
import {
	SeekScheduler,
	seekDriftExceeded,
	supportsVideoFrameCallback,
	type ScheduledFlush
} from './seek-throttle';

class FakeClock {
	private time = 0;
	private callbacks: Array<{ fn: () => void; at: number }> = [];

	now(): number {
		return this.time;
	}

	advance(ms: number): void {
		this.time += ms;
		const due = this.callbacks.filter((entry) => entry.at <= this.time);
		this.callbacks = this.callbacks.filter((entry) => entry.at > this.time);
		for (const entry of due) entry.fn();
	}

	schedule = (fn: () => void, delayMs: number): ScheduledFlush => {
		const entry = { fn, at: this.time + delayMs };
		this.callbacks.push(entry);
		return {
			cancel: () => {
				const index = this.callbacks.indexOf(entry);
				if (index !== -1) this.callbacks.splice(index, 1);
			}
		};
	};
}

function makeScheduler(clock: FakeClock, minIntervalMs = 32) {
	const applied: number[] = [];
	const scheduler = new SeekScheduler(
		(target) => {
			applied.push(target);
		},
		{
			minIntervalMs,
			now: () => clock.now(),
			schedule: clock.schedule
		}
	);
	return { scheduler, applied };
}

describe('seekDriftExceeded', () => {
	it('flags drift beyond tolerance only', () => {
		expect(seekDriftExceeded(1.0, 1.05, 0.08)).toBe(false);
		expect(seekDriftExceeded(1.0, 1.09, 0.08)).toBe(true);
	});
});

describe('SeekScheduler', () => {
	it('applies immediately when the interval window is open', () => {
		const clock = new FakeClock();
		const { scheduler, applied } = makeScheduler(clock);
		scheduler.request(2.5);
		expect(applied).toEqual([2.5]);
	});

	it('coalesces a burst into the latest target after the interval', () => {
		const clock = new FakeClock();
		const { scheduler, applied } = makeScheduler(clock);
		scheduler.request(1);
		clock.advance(10);
		scheduler.request(2);
		clock.advance(10);
		scheduler.request(3);
		expect(applied).toEqual([1]);
		clock.advance(32);
		expect(applied).toEqual([1, 3]);
	});

	it('does not double-apply after the trailing flush', () => {
		const clock = new FakeClock();
		const { scheduler, applied } = makeScheduler(clock);
		scheduler.request(1);
		clock.advance(100);
		scheduler.request(2);
		clock.advance(100);
		clock.advance(100);
		expect(applied).toEqual([1, 2]);
	});

	it('requestImmediate bypasses the window and drops pending targets', () => {
		const clock = new FakeClock();
		const { scheduler, applied } = makeScheduler(clock);
		scheduler.request(1);
		clock.advance(5);
		scheduler.request(2);
		scheduler.requestImmediate(9);
		expect(applied).toEqual([1, 9]);
		clock.advance(100);
		expect(applied).toEqual([1, 9]);
	});

	it('detach cancels pending work without applying', () => {
		const clock = new FakeClock();
		const { scheduler, applied } = makeScheduler(clock);
		scheduler.request(1);
		clock.advance(5);
		scheduler.request(2);
		scheduler.detach();
		clock.advance(100);
		expect(applied).toEqual([1]);
	});
});

describe('supportsVideoFrameCallback', () => {
	it('detects support by function presence', () => {
		expect(supportsVideoFrameCallback({ requestVideoFrameCallback: () => 1 })).toBe(true);
		// SAFETY: an empty stub models a browser lacking rVFC support.
		const without = {} as Pick<HTMLVideoElement, 'requestVideoFrameCallback'>;
		expect(supportsVideoFrameCallback(without)).toBe(false);
	});
});
