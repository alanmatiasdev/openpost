import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Clock, type ClockTimeSource } from './clock';

class FakeTimeSource implements ClockTimeSource {
	seconds = 0;
	now(): number {
		return this.seconds;
	}
	advance(seconds: number): void {
		this.seconds += seconds;
	}
}

interface RafHarness {
	flush: (count?: number) => void;
}

function rafHarness(): RafHarness {
	const callbacks: Array<() => void> = [];
	vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
		callbacks.push(cb);
		return callbacks.length;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
	return {
		flush(count = 1) {
			for (let i = 0; i < count; i++) {
				const cb = callbacks.shift();
				cb?.();
			}
		}
	};
}

describe('Clock', () => {
	let time: FakeTimeSource;
	let raf: ReturnType<typeof rafHarness>;

	beforeEach(() => {
		time = new FakeTimeSource();
		raf = rafHarness();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('stays paused and seekable without playing', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.seek(45);
		expect(clock.currentFrame).toBe(45);
		expect(clock.isPlaying).toBe(false);
		clock.dispose();
	});

	it('advances frames at fps × rate while playing', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const frames: number[] = [];
		clock.on('framechange', (f) => frames.push(f));

		clock.play();
		time.advance(1); // one second
		raf.flush(2);
		expect(clock.currentFrame).toBe(30);

		clock.setRate(2);
		time.advance(0.5); // half second at 2x
		raf.flush(2);
		expect(clock.currentFrame).toBe(60);

		clock.dispose();
	});

	it('stops at range end and emits ended', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const ended = vi.fn();
		clock.on('ended', ended);

		clock.play({ range: { start: 10, end: 40 } });
		time.advance(5); // would be frame 160 unbounded
		raf.flush(2);

		expect(ended).toHaveBeenCalledWith(40);
		expect(clock.isPlaying).toBe(false);
		clock.dispose();
	});

	it('loops back to range start', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play({ range: { start: 10, end: 40 }, loop: true });
		time.advance(5);
		raf.flush(1);
		expect(clock.currentFrame).toBeLessThan(40);
		clock.dispose();
	});

	it('seek pauses and resumes playback', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play();
		clock.seek(100);
		expect(clock.currentFrame).toBe(100);
		expect(clock.isPlaying).toBe(true);
		clock.dispose();
	});

	it('setFps re-anchors without jumping', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		clock.play();
		time.advance(1);
		raf.flush(1);
		const before = clock.currentFrame;
		clock.setFps(60);
		expect(clock.currentFrame).toBe(before);
		clock.dispose();
	});

	it('throttles timeupdate events', () => {
		const clock = new Clock({ fps: 30, timeSource: time });
		const updates = vi.fn();
		clock.on('timeupdate', updates);
		clock.play();
		time.advance(0.05);
		raf.flush(1);
		time.advance(0.05);
		raf.flush(1);
		time.advance(0.3);
		raf.flush(1);
		expect(updates.mock.calls.length).toBeLessThanOrEqual(2);
		clock.dispose();
	});
});
