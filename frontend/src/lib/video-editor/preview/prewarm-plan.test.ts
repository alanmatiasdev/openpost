import { describe, expect, it } from 'vitest';
import type {
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition
} from '../project/types';
import { collectPreviewPrewarmTargets, previewPrewarmPlanningFrame } from './prewarm-plan';

const track: TimelineTrack = {
	id: 'video',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function clip(id: string, from: number, mediaId = id): TimelineItem {
	return {
		id,
		trackId: track.id,
		from,
		durationInFrames: 30,
		label: id,
		type: 'video',
		mediaId,
		sourceStart: 60,
		sourceFps: 30
	};
}

function composition(
	id: string,
	items: TimelineItem[],
	transitions: TimelineTransition[] = []
): SubComposition {
	return {
		id,
		name: id,
		items,
		tracks: [track],
		transitions,
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 300
	};
}

function wrapper(
	id: string,
	compositionId: string,
	from: number,
	durationInFrames = 120
): TimelineItem {
	return {
		id,
		compositionId,
		trackId: track.id,
		from,
		durationInFrames,
		label: id,
		type: 'composition',
		sourceFps: 30
	};
}

describe('preview prewarm planner', () => {
	it('coalesces playback planning to five updates per second', () => {
		expect([0, 1, 5, 6, 11, 12].map((frame) => previewPrewarmPlanningFrame(frame, 30))).toEqual([
			0, 0, 0, 6, 6, 12
		]);
		expect(previewPrewarmPlanningFrame(Number.NaN, 0)).toBe(0);
		expect(
			collectPreviewPrewarmTargets({
				items: [clip('passed', 3), clip('next', 10)],
				tracks: [track],
				currentFrame: 0,
				minimumBoundaryFrame: 5,
				fps: 30,
				limit: 1
			}).map((target) => target.itemId)
		).toEqual(['next']);
	});
	it('orders distinct upcoming video boundaries inside the lookahead window', () => {
		const targets = collectPreviewPrewarmTargets({
			items: [clip('late', 160), clip('nearest', 70), clip('same-source', 80, 'nearest')],
			tracks: [track],
			currentFrame: 30,
			fps: 30,
			lookaheadSeconds: 2,
			limit: 2
		});
		expect(targets.map((target) => target.itemId)).toEqual(['nearest']);
		expect(targets[0]?.timestampSeconds).toBe(2);
	});

	it('retains only the nearest targets from a 30,000-clip dense window', () => {
		const items = Array.from({ length: 30_000 }, (_, index) =>
			clip(`dense-${String(index).padStart(5, '0')}`, 1 + (index % 60))
		);
		const targets = collectPreviewPrewarmTargets({
			items,
			tracks: [track],
			currentFrame: 0,
			fps: 30,
			lookaheadSeconds: 2,
			limit: 2
		});
		expect(targets.map((target) => target.itemId)).toEqual(['dense-00000', 'dense-00060']);
	});

	it('ignores hidden tracks and clips behind the playhead', () => {
		expect(
			collectPreviewPrewarmTargets({
				items: [clip('past', 20), clip('hidden', 40)],
				tracks: [{ ...track, visible: false }],
				currentFrame: 30,
				fps: 30
			})
		).toEqual([]);
	});

	it('warms an incoming transition at its first rendered handle frame', () => {
		const outgoing = clip('outgoing', 0);
		outgoing.durationInFrames = 60;
		const incoming = clip('incoming', 60);
		incoming.sourceStart = 30;
		const transition: TimelineTransition = {
			id: 'crossfade',
			type: 'crossfade',
			durationInFrames: 20,
			alignment: 0.5,
			fromItemId: outgoing.id,
			toItemId: incoming.id
		};
		const targets = collectPreviewPrewarmTargets({
			items: [outgoing, incoming],
			tracks: [track],
			transitions: [transition],
			currentFrame: 45,
			fps: 30,
			lookaheadSeconds: 1
		});
		expect(targets).toEqual([
			{
				itemId: 'incoming',
				mediaId: 'incoming',
				timestampSeconds: 20 / 30,
				boundaryFrame: 50
			}
		]);
	});

	it('warms the leaf visible on the first frame of an upcoming composition', () => {
		const nestedClip = clip('nested-video', 0, 'nested-media');
		nestedClip.durationInFrames = 180;
		nestedClip.sourceStart = 15;
		const nested = composition('nested', [nestedClip]);
		const targets = collectPreviewPrewarmTargets({
			items: [wrapper('wrapper', nested.id, 100)],
			tracks: [track],
			compositions: [nested],
			currentFrame: 90,
			fps: 30,
			lookaheadSeconds: 1
		});
		expect(targets).toEqual([
			{
				itemId: 'wrapper/nested-video',
				mediaId: 'nested-media',
				timestampSeconds: 0.5,
				boundaryFrame: 100
			}
		]);
	});

	it('maps internal and recursively nested boundaries back to root time', () => {
		const leaf = composition('leaf', [clip('leaf-video', 30, 'leaf-media')]);
		const middleWrapper = wrapper('middle-wrapper', leaf.id, 90, 120);
		const middle = composition('middle', [middleWrapper]);
		const rootWrapper = wrapper('root-wrapper', middle.id, 0, 300);
		const targets = collectPreviewPrewarmTargets({
			items: [rootWrapper],
			tracks: [track],
			compositions: [middle, leaf],
			currentFrame: 100,
			fps: 30,
			lookaheadSeconds: 1,
			limit: 4
		});
		expect(targets).toEqual([
			{
				itemId: 'root-wrapper/middle-wrapper/leaf-video',
				mediaId: 'leaf-media',
				timestampSeconds: 2,
				boundaryFrame: 120
			}
		]);
	});

	it('respects a composition source window and playback speed', () => {
		const beforeWindow = clip('before-window', 30, 'ignored-media');
		const insideWindow = clip('inside-window', 90, 'inside-media');
		const nested = composition('trimmed', [beforeWindow, insideWindow]);
		const rootWrapper = wrapper('trimmed-wrapper', nested.id, 100, 120);
		rootWrapper.sourceStart = 60;
		rootWrapper.sourceEnd = 180;
		rootWrapper.speed = 2;
		const targets = collectPreviewPrewarmTargets({
			items: [rootWrapper],
			tracks: [track],
			compositions: [nested],
			currentFrame: 100,
			fps: 30,
			lookaheadSeconds: 1,
			limit: 4
		});
		expect(targets).toEqual([
			{
				itemId: 'trimmed-wrapper/inside-window',
				mediaId: 'inside-media',
				timestampSeconds: 2,
				boundaryFrame: 115
			}
		]);
	});

	it('stops cyclic composition references and honors hidden wrapper tracks', () => {
		const cycleA = composition('cycle-a', [wrapper('to-b', 'cycle-b', 0)]);
		const cycleB = composition('cycle-b', [wrapper('to-a', 'cycle-a', 0)]);
		expect(
			collectPreviewPrewarmTargets({
				items: [wrapper('root-cycle', cycleA.id, 30)],
				tracks: [track],
				compositions: [cycleA, cycleB],
				currentFrame: 0,
				fps: 30
			})
		).toEqual([]);
		expect(
			collectPreviewPrewarmTargets({
				items: [wrapper('hidden-wrapper', 'visible-leaf', 30)],
				tracks: [{ ...track, visible: false }],
				compositions: [composition('visible-leaf', [clip('leaf', 0)])],
				currentFrame: 0,
				fps: 30
			})
		).toEqual([]);
	});
});
