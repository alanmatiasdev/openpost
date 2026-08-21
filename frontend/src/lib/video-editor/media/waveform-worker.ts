/**
 * Ported from FreeCut (MIT) — features/timeline/services/waveform-worker.ts,
 * trimmed: no abort/AC-3/bin-streaming; emits one complete mono peak array.
 */

import { Input, AudioSampleSink, ALL_FORMATS, BlobSource } from 'mediabunny';

export interface WaveformRequest {
	file: File;
	samplesPerSecond: number;
}

export interface WaveformCompleteMessage {
	type: 'complete';
	peaks: Float32Array;
	durationSeconds: number;
}

export type WaveformWorkerResponse = WaveformCompleteMessage;

self.onmessage = async (event: MessageEvent<WaveformRequest>): Promise<void> => {
	const { file, samplesPerSecond } = event.data;
	try {
		const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
		const audioTrack = await input.getPrimaryAudioTrack();
		if (!audioTrack) throw new Error('No audio track found');
		const duration = await audioTrack.computeDuration();
		const sink = new AudioSampleSink(audioTrack);
		const count = Math.max(1, Math.ceil(duration * samplesPerSecond));
		const peaks = new Float32Array(count);
		for await (const sample of sink.samples()) {
			try {
				const frameCount = sample.numberOfFrames;
				const channelCount = Math.max(1, sample.numberOfChannels);
				// SAFETY: copyTo fills a planar f32 view of the decoded sample.
				const channel = new Float32Array(frameCount);
				for (let c = 0; c < channelCount; c++) {
					sample.copyTo(channel, { planeIndex: c, format: 'f32-planar' });
					for (let i = 0; i < frameCount; i++) {
						const time = (sample.timestamp ?? 0) + i / (sample.sampleRate || 48_000);
						const index = Math.min(count - 1, Math.floor(time * samplesPerSecond));
						const value = Math.abs(channel[i]!);
						if (value > peaks[index]!) peaks[index] = c === 0 ? value : (peaks[index]! + value) / 2;
					}
				}
			} finally {
				sample.close();
			}
		}
		const message: WaveformCompleteMessage = {
			type: 'complete',
			peaks,
			durationSeconds: duration
		};
		self.postMessage(message);
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
