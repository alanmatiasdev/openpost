import { describe, expect, it, vi } from 'vitest';
import { PeriodicAutosaveController, type PeriodicAutosaveScheduler } from './periodic-autosave';

function scheduler() {
	let interval: (() => void) | undefined;
	let idle: (() => void) | undefined;
	const value: PeriodicAutosaveScheduler = {
		setInterval: vi.fn((callback) => {
			interval = callback;
			return 'interval';
		}),
		clearInterval: vi.fn(),
		requestIdle: vi.fn((callback) => {
			idle = callback;
			return vi.fn();
		})
	};
	return { value, interval: () => interval, idle: () => idle };
}

describe('periodic autosave', () => {
	it('runs one dirty save at idle and restarts when the interval changes', async () => {
		const timing = scheduler();
		let dirty = false;
		let resolveSave = (): void => undefined;
		const save = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				})
		);
		const onError = vi.fn();
		const controller = new PeriodicAutosaveController(() => dirty, save, onError, timing.value);

		controller.configure(5);
		expect(timing.value.setInterval).toHaveBeenCalledWith(expect.any(Function), 300_000);
		timing.interval()?.();
		expect(timing.value.requestIdle).not.toHaveBeenCalled();

		dirty = true;
		timing.interval()?.();
		expect(timing.value.requestIdle).toHaveBeenCalledOnce();
		timing.idle()?.();
		expect(save).toHaveBeenCalledOnce();
		timing.interval()?.();
		expect(save).toHaveBeenCalledOnce();
		resolveSave();
		await Promise.resolve();

		controller.configure(10);
		expect(timing.value.clearInterval).toHaveBeenCalledWith('interval');
		expect(timing.value.setInterval).toHaveBeenLastCalledWith(expect.any(Function), 600_000);
		expect(onError).not.toHaveBeenCalled();
	});

	it('supports disabled mode and reports failed saves', async () => {
		const timing = scheduler();
		const failure = new Error('write failed');
		const onError = vi.fn();
		const controller = new PeriodicAutosaveController(
			() => true,
			async () => {
				throw failure;
			},
			onError,
			timing.value
		);

		controller.configure(0);
		expect(timing.value.setInterval).not.toHaveBeenCalled();
		controller.configure(5);
		timing.interval()?.();
		timing.idle()?.();
		await Promise.resolve();
		await Promise.resolve();
		expect(onError).toHaveBeenCalledWith(failure);
	});
});
