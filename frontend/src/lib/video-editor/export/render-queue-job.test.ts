import { describe, expect, it } from 'vitest';
import type { Project, SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { captureRenderSnapshot } from './render-queue-job';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const nestedItem: TimelineItem = {
	id: 'nested-title',
	trackId: track.id,
	from: 0,
	durationInFrames: 30,
	label: 'Original title',
	type: 'text',
	text: 'Original title'
};

const composition: SubComposition = {
	id: 'intro',
	name: 'Intro',
	items: [nestedItem],
	tracks: [track],
	transitions: [],
	fps: 30,
	width: 1920,
	height: 1080,
	durationInFrames: 30
};

const project: Project = {
	id: 'project',
	name: 'Project',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	duration: 1,
	metadata: { width: 1920, height: 1080, fps: 30 },
	timeline: { tracks: [track], items: [], compositions: [composition] }
};

describe('captureRenderSnapshot', () => {
	it('freezes nested compositions with the active timeline', () => {
		const snapshot = captureRenderSnapshot(project, [track], [], [], [composition]);
		composition.items[0]!.label = 'Changed later';

		expect(snapshot.compositions[0]?.items[0]?.label).toBe('Original title');
	});
});
