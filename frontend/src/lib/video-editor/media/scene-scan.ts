/**
 * Scene scanning: decode a media file's video track at ~4 fps into a small
 * canvas grid, build per-sample frame histograms, and report detected cuts
 * as source-frame positions.
 *
 * Ported from FreeCut (MIT) — scene-sampling concept (histogram comparison
 * over sparsely decoded frames), retargeted to mediabunny + OpenPost's
 * FrameHistogram detection core.
 */

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';
import { ensureProResDecoderForCodec } from './prores-decoder';
import { resolveMediaBlob } from './import.svelte';
import { detectSceneCuts, type FrameHistogram } from './scene-detection';
import {
	SCENE_GRID_HEIGHT,
	SCENE_GRID_WIDTH,
	SCENE_SAMPLE_INTERVAL_SECONDS,
	lumaGridHistogram
} from './scene-math';
import type { MediaMetadata } from './types';

const FALLBACK_FPS = 30;

export interface SceneScanOptions {
	/** Source fps of the timeline item using this media; falls back to media.fps. */
	sourceFps?: number;
}

/**
 * Decode sampled frames and return scene-cut positions in the media's own
 * source frames. Callers map these onto a specific item with
 * `cutFramesForItem` before splitting.
 */
export async function scanSceneCuts(
	media: MediaMetadata,
	options: SceneScanOptions = {}
): Promise<number[]> {
	const blob = await resolveMediaBlob(media);
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) throw new Error(`No video track in ${media.fileName}`);
		await ensureProResDecoderForCodec(track.codec);
		const duration = await track.computeDuration();
		if (!(duration > 0)) return [];

		const sink = new CanvasSink(track, {
			width: SCENE_GRID_WIDTH,
			height: SCENE_GRID_HEIGHT,
			fit: 'fill'
		});
		const timestamps: number[] = [];
		for (let time = 0; time < duration; time += SCENE_SAMPLE_INTERVAL_SECONDS) {
			timestamps.push(time);
		}

		const histograms: FrameHistogram[] = [];
		for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
			if (!wrapped) continue;
			const context = wrapped.canvas.getContext('2d');
			if (!context || wrapped.canvas.width < 1 || wrapped.canvas.height < 1) continue;
			const { data } = context.getImageData(0, 0, wrapped.canvas.width, wrapped.canvas.height);
			histograms.push({
				timeSeconds: wrapped.timestamp,
				buckets: lumaGridHistogram(data, wrapped.canvas.width, wrapped.canvas.height)
			});
		}

		const effectiveFps =
			options.sourceFps && options.sourceFps > 0
				? options.sourceFps
				: media.fps > 0
					? media.fps
					: FALLBACK_FPS;
		return detectSceneCuts(histograms).map((cut) => Math.round(cut.timeSeconds * effectiveFps));
	} finally {
		input.dispose?.();
	}
}
