import type { TimelineItem, TimelineTrack } from '../project/types';
import { frameToSourceSeconds } from '../media/render-plan';

export interface PreviewPrewarmTarget {
	itemId: string;
	mediaId: string;
	timestampSeconds: number;
	boundaryFrame: number;
}

export function collectPreviewPrewarmTargets(input: {
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	currentFrame: number;
	fps: number;
	lookaheadSeconds?: number;
	limit?: number;
}): PreviewPrewarmTarget[] {
	const lookaheadFrames = Math.max(1, Math.round((input.lookaheadSeconds ?? 2.5) * input.fps));
	const limit = Math.max(0, Math.floor(input.limit ?? 2));
	const visibleTracks = new Set(
		input.tracks.filter((track) => track.visible).map((track) => track.id)
	);
	const seen = new Set<string>();
	const targets: PreviewPrewarmTarget[] = [];
	for (const item of [...input.items].sort((a, b) => a.from - b.from)) {
		if (
			item.type !== 'video' ||
			!item.mediaId ||
			!visibleTracks.has(item.trackId) ||
			item.from <= input.currentFrame ||
			item.from > input.currentFrame + lookaheadFrames
		)
			continue;
		const timestampSeconds = frameToSourceSeconds(item, item.from, input.fps);
		const key = `${item.mediaId}:${timestampSeconds.toFixed(6)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		targets.push({
			itemId: item.id,
			mediaId: item.mediaId,
			timestampSeconds,
			boundaryFrame: item.from
		});
		if (targets.length >= limit) break;
	}
	return targets;
}
