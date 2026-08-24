export interface PeriodicAutosaveScheduler {
	setInterval(callback: () => void, delayMs: number): unknown;
	clearInterval(id: unknown): void;
	requestIdle(callback: () => void): () => void;
}

const browserScheduler: PeriodicAutosaveScheduler = {
	setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
	clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
	requestIdle: (callback) => {
		if (globalThis.requestIdleCallback) {
			const id = globalThis.requestIdleCallback(callback, { timeout: 10_000 });
			return () => globalThis.cancelIdleCallback(id);
		}
		const id = globalThis.setTimeout(callback, 0);
		return () => globalThis.clearTimeout(id);
	}
};

export class PeriodicAutosaveController {
	private intervalId: unknown;
	private cancelIdle: (() => void) | undefined;
	private saving = false;

	constructor(
		private readonly isDirty: () => boolean,
		private readonly save: () => Promise<void>,
		private readonly onError: (error: unknown) => void,
		private readonly scheduler: PeriodicAutosaveScheduler = browserScheduler
	) {}

	configure(intervalMinutes: number): void {
		this.stop();
		if (intervalMinutes <= 0) return;
		this.intervalId = this.scheduler.setInterval(
			() => this.queueIdleSave(),
			intervalMinutes * 60 * 1000
		);
	}

	stop(): void {
		if (this.intervalId !== undefined) this.scheduler.clearInterval(this.intervalId);
		this.intervalId = undefined;
		this.cancelIdle?.();
		this.cancelIdle = undefined;
	}

	private queueIdleSave(): void {
		if (!this.isDirty() || this.saving || this.cancelIdle) return;
		this.cancelIdle = this.scheduler.requestIdle(() => {
			this.cancelIdle = undefined;
			if (!this.isDirty() || this.saving) return;
			this.saving = true;
			void this.save()
				.catch((error) => this.onError(error))
				.finally(() => {
					this.saving = false;
				});
		});
	}
}
