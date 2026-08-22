/**
 * Ported from FreeCut (MIT) — maps a decoded peak array onto the pixel
 * width of a timeline clip for the item's source window.
 */

import type { WaveformData } from './waveform-client';

export interface WindowedPeaks {
	/** Interleaved min/max pairs, one pair per output column. */
	columns: Float32Array;
}

export function peaksForWindow(
	waveform: WaveformData,
	startSourceFrame: number,
	endSourceFrame: number,
	fps: number,
	widthPx: number
): Float32Array {
	const columns = Math.max(1, Math.floor(widthPx));
	const output = new Float32Array(columns * 2);
	const sourceDurationFrames = Math.max(1, endSourceFrame - startSourceFrame);
	for (let column = 0; column < columns; column++) {
		const windowStart = (startSourceFrame + (column / columns) * sourceDurationFrames) / fps;
		const windowEnd = (startSourceFrame + ((column + 1) / columns) * sourceDurationFrames) / fps;
		let max = 0;
		const firstBucket = Math.floor(windowStart * waveform.samplesPerSecond);
		const lastBucket = Math.ceil(windowEnd * waveform.samplesPerSecond) - 1;
		if (lastBucket >= 0 && firstBucket <= waveform.peaks.length - 1) {
			const from = Math.max(0, firstBucket);
			const to = Math.min(waveform.peaks.length - 1, lastBucket);
			for (let bucket = from; bucket <= to; bucket++) {
				const value = waveform.peaks[bucket] ?? 0;
				if (value > max) max = value;
			}
		}
		output[column * 2] = -max;
		output[column * 2 + 1] = max;
	}
	return output;
}
