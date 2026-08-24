import type {
	Project,
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import type { ExportPreflightResult } from '../media/export-preflight';
import type {
	RenderQueueJob,
	RenderQueueSettings,
	RenderQueueSnapshot
} from './render-queue-store';

function cloneTimeline<T>(value: T): T {
	return structuredClone(value);
}

export function captureRenderSnapshot(
	project: Project,
	tracks: readonly TimelineTrack[],
	items: readonly TimelineItem[],
	transitions: readonly TimelineTransition[],
	compositions: readonly SubComposition[]
): RenderQueueSnapshot {
	return {
		projectId: project.id,
		projectName: project.name,
		fps: project.metadata.fps,
		width: project.metadata.width,
		height: project.metadata.height,
		backgroundColor: project.metadata.backgroundColor,
		tracks: cloneTimeline([...tracks]),
		items: cloneTimeline([...items]),
		transitions: cloneTimeline([...transitions]),
		compositions: cloneTimeline([...compositions])
	};
}

export function buildRenderQueueJob(options: {
	project: Project;
	settings: Omit<RenderQueueSettings, 'range'>;
	preflight: ExportPreflightResult;
	tracks: readonly TimelineTrack[];
	items: readonly TimelineItem[];
	transitions: readonly TimelineTransition[];
	compositions: readonly SubComposition[];
}): RenderQueueJob {
	if (!options.preflight.canExport) throw new Error('Export preflight must pass before queueing.');
	const range = {
		startFrame: options.preflight.range.startFrame,
		endFrame: options.preflight.range.endFrame
	};
	return {
		id: crypto.randomUUID(),
		projectId: options.project.id,
		name: options.project.name,
		status: 'queued',
		progress: 0,
		settings: { ...options.settings, range },
		snapshot: captureRenderSnapshot(
			options.project,
			options.tracks,
			options.items,
			options.transitions,
			options.compositions
		),
		createdAt: Date.now()
	};
}
