import { describe, expect, it } from 'vitest';
import type { RenderQueueJob, RenderQueueSnapshot } from './render-queue-store';
import { restoreRenderQueue, serializeRenderQueue } from './render-queue-persistence';

const snapshot: RenderQueueSnapshot = {
	projectId: 'project',
	projectName: 'Project',
	fps: 30,
	width: 1920,
	height: 1080,
	tracks: [],
	items: [],
	transitions: [],
	compositions: []
};

function job(id: string, status: RenderQueueJob['status']): RenderQueueJob {
	return {
		id,
		projectId: 'project',
		name: id,
		status,
		progress: status === 'rendering' ? 0.5 : 0,
		settings: {
			format: 'webm',
			codec: 'vp9',
			quality: 'standard',
			width: 1920,
			height: 1080,
			subtitleMode: 'burn',
			range: { startFrame: 0, endFrame: 30 }
		},
		snapshot,
		createdAt: 1
	};
}

describe('render queue persistence', () => {
	it('deduplicates shared snapshots and pauses restored in-flight work', () => {
		const document = serializeRenderQueue([job('a', 'rendering'), job('b', 'queued')], false);
		expect(Object.keys(document.snapshots)).toHaveLength(1);
		expect(document.jobs.map(({ snapshotId }) => snapshotId)).toEqual(['snapshot-1', 'snapshot-1']);

		const restored = restoreRenderQueue(document);
		expect(restored.isPaused).toBe(true);
		expect(restored.jobs[0]?.snapshot).toBe(restored.jobs[1]?.snapshot);
	});

	it('rejects unsupported documents without guessing', () => {
		// SAFETY: this deliberately invalid schema version exercises the runtime compatibility guard.
		expect(
			restoreRenderQueue({
				...serializeRenderQueue([], false),
				schemaVersion: 2
			} as never)
		).toEqual({ jobs: [], isPaused: false });
	});
});
