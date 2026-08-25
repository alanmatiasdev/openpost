import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mediaTaskId, mediaTasks } from './media-tasks.svelte';

beforeEach(() => mediaTasks.reset());

describe('mediaTasks', () => {
	it('tracks bounded progress, counters, order, and settled removal', () => {
		const first = mediaTaskId('proxy', 'camera');
		const second = mediaTaskId('scene-analysis', 'b-roll');
		mediaTasks.start({
			id: first,
			kind: 'proxy',
			mediaId: 'camera',
			label: 'Camera.mov',
			status: 'queued',
			progress: -1
		});
		mediaTasks.start({
			id: second,
			kind: 'scene-analysis',
			mediaId: 'b-roll',
			label: 'B-roll.mp4',
			progress: null
		});

		expect(mediaTasks.list.map((task) => task.id)).toEqual([first, second]);
		expect(mediaTasks.get(first)?.progress).toBe(0);
		mediaTasks.update(first, {
			status: 'running',
			progress: 1.4,
			completed: 4,
			total: 8,
			etaSeconds: 12.5
		});
		expect(mediaTasks.get(first)).toMatchObject({
			status: 'running',
			progress: 1,
			completed: 4,
			total: 8,
			etaSeconds: 12.5
		});

		mediaTasks.finish(first);
		expect(mediaTasks.list.map((task) => task.id)).toEqual([second]);
	});

	it('marks cancellation before invoking its owner and cancels all on reset', () => {
		const cancelFirst = vi.fn();
		const cancelSecond = vi.fn();
		mediaTasks.start({
			id: 'first',
			kind: 'proxy',
			label: 'First.mov',
			onCancel: cancelFirst
		});
		mediaTasks.start({
			id: 'second',
			kind: 'transcription',
			label: 'Second.wav',
			onCancel: cancelSecond
		});

		expect(mediaTasks.cancel('first')).toBe(true);
		expect(mediaTasks.get('first')).toMatchObject({
			status: 'cancelling',
			stage: 'cancelling'
		});
		expect(cancelFirst).toHaveBeenCalledOnce();
		expect(mediaTasks.cancel('first')).toBe(false);

		mediaTasks.reset();
		expect(cancelFirst).toHaveBeenCalledOnce();
		expect(cancelSecond).toHaveBeenCalledOnce();
		expect(mediaTasks.list).toEqual([]);
	});

	it('does not let a replaced owner update or finish its successor', () => {
		const cancelFirst = vi.fn();
		const firstRevision = mediaTasks.start({
			id: 'proxy:camera',
			kind: 'proxy',
			label: 'Old camera.mov',
			progress: 0.2,
			onCancel: cancelFirst
		});
		const secondRevision = mediaTasks.start({
			id: 'proxy:camera',
			kind: 'proxy',
			label: 'New camera.mov',
			progress: 0.1
		});
		expect(cancelFirst).toHaveBeenCalledOnce();

		mediaTasks.update('proxy:camera', { progress: 0.9 }, firstRevision);
		mediaTasks.finish('proxy:camera', firstRevision);
		expect(mediaTasks.get('proxy:camera')).toMatchObject({
			revision: secondRevision,
			label: 'New camera.mov',
			progress: 0.1
		});

		mediaTasks.finish('proxy:camera', secondRevision);
		expect(mediaTasks.get('proxy:camera')).toBeUndefined();
	});
});
