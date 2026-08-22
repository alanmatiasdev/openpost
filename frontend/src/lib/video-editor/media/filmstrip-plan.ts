/**
 * Ported from FreeCut (MIT) — timeline/services/filmstrip-cache-config.ts and
 * the pure target-planning helpers of filmstrip-cache.ts, plus
 * timeline/utils/fit-filmstrip-frame-size.ts.
 *
 * Filmstrips extract at 1 source frame per second; these helpers decide WHICH
 * seconds get extracted so a clip shows a bounded number of thumbnails no
 * matter its duration, with denser sampling near the playhead window.
 */

/** Frames (seconds) per filmstrip thumbnail — must match the extraction worker. */
export const FILMSTRIP_FRAME_RATE = 1;

/** Extraction pixel budget: thumbnails render at track height, extract larger for zoom headroom. */
export const FILMSTRIP_EXTRACT_HEIGHT = 100;
export const FILMSTRIP_EXTRACT_WIDTH = Math.round(FILMSTRIP_EXTRACT_HEIGHT * (16 / 9));

export const MIN_FILMSTRIP_TARGET_FRAMES = 40;
export const MAX_FILMSTRIP_TARGET_FRAMES = 72;
export const TARGET_FRAME_BUDGET_SCALE = 4;

export const BACKGROUND_STRIDE_MEDIUM = 2;
export const BACKGROUND_STRIDE_LONG = 3;
export const BACKGROUND_STRIDE_VERY_LONG = 4;
export const MEDIUM_CLIP_FRAME_THRESHOLD = 300;
export const LONG_CLIP_FRAME_THRESHOLD = 1200;
export const VERY_LONG_CLIP_FRAME_THRESHOLD = 2400;

export interface FrameRange {
	startIndex: number;
	endIndex: number;
}

function normalizeTargetFrameCount(targetFrameCount?: number | null): number | null {
	if (targetFrameCount == null) return null;
	if (!Number.isFinite(targetFrameCount) || targetFrameCount <= 0) return null;
	return Math.max(1, Math.ceil(targetFrameCount));
}

export interface FilmstripFrameSize {
	width: number;
	height: number;
}

/** Fits a filmstrip frame inside the budget without changing its aspect ratio. */
export function fitFilmstripFrameSize(
	sourceWidth: number,
	sourceHeight: number,
	maxWidth: number,
	maxHeight: number
): FilmstripFrameSize {
	if (sourceWidth <= 0 || sourceHeight <= 0) return { width: maxWidth, height: maxHeight };

	const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
	return {
		width: Math.max(1, Math.round(sourceWidth * scale)),
		height: Math.max(1, Math.round(sourceHeight * scale))
	};
}

/** Upper bound on thumbnails for a clip of `totalFrames` source seconds. */
export function getTargetFrameBudget(
	totalFrames: number,
	targetFrameCount?: number | null
): number {
	if (totalFrames <= 0) return 0;

	const normalizedTargetFrameCount = normalizeTargetFrameCount(targetFrameCount);

	const defaultBudget =
		totalFrames <= MIN_FILMSTRIP_TARGET_FRAMES
			? totalFrames
			: Math.max(
					MIN_FILMSTRIP_TARGET_FRAMES,
					Math.min(
						totalFrames,
						Math.min(
							MAX_FILMSTRIP_TARGET_FRAMES,
							Math.round(Math.sqrt(totalFrames) * TARGET_FRAME_BUDGET_SCALE)
						)
					)
				);

	if (normalizedTargetFrameCount === null) {
		return defaultBudget;
	}

	return Math.max(1, Math.min(totalFrames, Math.min(defaultBudget, normalizedTargetFrameCount)));
}

/** Duration-based stride for sampling the non-priority tail of long clips. */
export function getBackgroundStride(totalFrames: number): number {
	if (totalFrames <= MEDIUM_CLIP_FRAME_THRESHOLD) return 1;
	if (totalFrames <= LONG_CLIP_FRAME_THRESHOLD) return BACKGROUND_STRIDE_MEDIUM;
	if (totalFrames <= VERY_LONG_CLIP_FRAME_THRESHOLD) return BACKGROUND_STRIDE_LONG;
	return BACKGROUND_STRIDE_VERY_LONG;
}

/**
 * Which frame indices to extract: always the first and last second, dense
 * inside the priority range (the visible window), then adaptive stride
 * sampling of the remainder within the budget.
 */
export function buildTargetIndices(
	totalFrames: number,
	priorityRange: FrameRange | null,
	targetFrameCount?: number | null
): number[] {
	if (totalFrames <= 0) return [];

	const target = new Set<number>();
	target.add(0);
	target.add(totalFrames - 1);

	for (const index of buildPriorityIndices(totalFrames, priorityRange)) {
		target.add(index);
	}

	if (totalFrames <= MIN_FILMSTRIP_TARGET_FRAMES) {
		for (let i = 0; i < totalFrames; i++) target.add(i);
		return [...target].sort((a, b) => a - b);
	}

	const budget = getTargetFrameBudget(totalFrames, targetFrameCount);
	if (budget >= totalFrames) {
		for (let i = 0; i < totalFrames; i++) target.add(i);
		return [...target].sort((a, b) => a - b);
	}

	const stride = getBackgroundStride(totalFrames);
	const backgroundCandidates: number[] = [];
	for (let i = 0; i < totalFrames; i += stride) {
		if (!target.has(i)) backgroundCandidates.push(i);
	}

	const remainingBudget = Math.max(0, budget - target.size);
	if (remainingBudget === 0 || backgroundCandidates.length === 0) {
		return [...target].sort((a, b) => a - b);
	}

	if (backgroundCandidates.length <= remainingBudget) {
		for (const index of backgroundCandidates) target.add(index);
	} else {
		const step = backgroundCandidates.length / remainingBudget;
		for (let i = 0; i < remainingBudget; i++) {
			const outsideIndex = Math.floor(i * step);
			const chosen = backgroundCandidates[Math.min(backgroundCandidates.length - 1, outsideIndex)];
			if (chosen !== undefined) target.add(chosen);
		}
	}

	return [...target].sort((a, b) => a - b);
}

/**
 * Dense (capped) indices for the priority range — the window around the
 * playhead or viewport that should fill in first.
 */
export function buildPriorityIndices(
	totalFrames: number,
	priorityRange: FrameRange | null,
	maxPriorityDenseFrames = 180
): number[] {
	if (!priorityRange || totalFrames <= 0) return [];

	const rangeStart = Math.max(0, Math.min(totalFrames - 1, priorityRange.startIndex));
	const rangeEnd = Math.max(rangeStart + 1, Math.min(totalFrames, priorityRange.endIndex));
	const rangeLength = Math.max(0, rangeEnd - rangeStart);
	if (rangeLength === 0) return [];

	if (rangeLength <= maxPriorityDenseFrames) {
		const dense: number[] = [];
		for (let i = rangeStart; i < rangeEnd; i++) dense.push(i);
		return dense;
	}

	const sampled = new Set<number>();
	const stride = Math.ceil(rangeLength / maxPriorityDenseFrames);
	for (let i = rangeStart; i < rangeEnd; i += stride) sampled.add(i);
	sampled.add(rangeStart);
	sampled.add(rangeEnd - 1);
	return [...sampled].sort((a, b) => a - b);
}

export interface FilmstripFrameRef {
	index: number;
	url: string | null;
}

export interface FilmstripTile {
	index: number;
	url: string | null;
	x: number;
	width: number;
}

/**
 * Layout for one-second thumbnail tiles across a clip's visible span. Each
 * frame `i` covers source seconds [i, i+1); tiles are clipped to the trimmed
 * window [sourceStartSeconds, sourceStartSeconds + clipSpanSeconds] and sized
 * against `clipWidthPx`.
 */
export function computeFilmstripTiles(
	frames: readonly FilmstripFrameRef[],
	sourceStartSeconds: number,
	clipSpanSeconds: number,
	clipWidthPx: number
): FilmstripTile[] {
	if (!(clipSpanSeconds > 0) || !(clipWidthPx > 0)) return [];

	const pxPerSecond = clipWidthPx / clipSpanSeconds;
	const endSeconds = sourceStartSeconds + clipSpanSeconds;
	const tiles: FilmstripTile[] = [];

	for (const frame of frames) {
		const visibleStart = Math.max(frame.index, sourceStartSeconds);
		const visibleEnd = Math.min(frame.index + 1, endSeconds);
		const span = visibleEnd - visibleStart;
		if (span <= 0) continue;
		tiles.push({
			index: frame.index,
			url: frame.url,
			x: (visibleStart - sourceStartSeconds) * pxPerSecond,
			width: span * pxPerSecond
		});
	}

	return tiles;
}
