/**
 * Media probe worker: metadata extraction + thumbnail via mediabunny.
 *
 * One job per message: probe a File into MediaProbeResult (duration,
 * dimensions, fps estimate, keyframe timestamps, codecs) plus a JPEG
 * thumbnail blob. Heavy work stays off the main thread.
 *
 * Ported from FreeCut (MIT) — media-processor.worker.ts, trimmed to v1
 * (no ProRes live-decode registration, no AC-3 handling).
 */

import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input } from 'mediabunny';

export interface MediaProbeResult {
	durationSeconds: number;
	width: number;
	height: number;
	fps: number;
	videoCodec?: string;
	audioCodec?: string;
	bitrate?: number;
	keyframeTimestamps?: number[];
	gopInterval?: number;
	thumbnailBlob?: Blob;
	hasAudio: boolean;
	kind: 'video' | 'audio' | 'image';
}

const KEYFRAME_MAX_PACKETS = 5_000;
const FPS_MAX_PACKETS = 180;

async function estimateFps(track: {
	computePacketStats(count: number): Promise<{ averagePacketRate: number } | null>;
}): Promise<number> {
	try {
		const stats = await track.computePacketStats(FPS_MAX_PACKETS);
		const rate = stats?.averagePacketRate ?? 0;
		return Number.isFinite(rate) && rate > 0 ? Math.round(rate * 1000) / 1000 : 30;
	} catch {
		return 30;
	}
}

async function extractKeyframes(input: Input): Promise<number[] | undefined> {
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) return undefined;
		const sink = new EncodedPacketSink(track);
		const timestamps: number[] = [];
		let packet = await sink.getFirstKeyPacket({ metadataOnly: true });
		while (packet && timestamps.length < KEYFRAME_MAX_PACKETS) {
			timestamps.push(packet.timestamp);
			packet = await sink.getNextKeyPacket(packet, { metadataOnly: true });
		}
		if (timestamps.length < 2) return undefined;
		// Deduplicate near-identical timestamps (sub-ms jitter).
		// SAFETY: length >= 2 checked above.
		const deduped: number[] = [timestamps[0] as number];
		for (const ts of timestamps.slice(1)) {
			if (ts - deduped[deduped.length - 1]! > 0.001) deduped.push(ts);
		}
		return deduped.length >= 2 ? deduped : undefined;
	} catch {
		return undefined;
	}
}

async function generateThumbnail(input: Input, atSecond: number): Promise<Blob | undefined> {
	try {
		const track = await input.getPrimaryVideoTrack();
		if (!track) return undefined;
		const height = Math.min(320, track.displayHeight);
		const scale = track.displayHeight > 0 ? height / track.displayHeight : 1;
		const sink = new CanvasSink(track, {
			width: Math.round(track.displayWidth * scale),
			height: Math.round(track.displayHeight * scale)
		});
		const wrapped = await sink.getCanvas(Math.min(atSecond, 0.1));
		if (!wrapped) return undefined;
		const blob =
			wrapped.canvas instanceof OffscreenCanvas
				? await wrapped.canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
				: await new Promise<Blob | null>((resolve) =>
						// SAFETY: this branch is the HTMLCanvasElement half of the union.
						(wrapped.canvas as HTMLCanvasElement).toBlob(resolve, 'image/jpeg', 0.8)
					);
		return blob ?? undefined;
	} catch {
		return undefined;
	}
}

self.onmessage = async (event: MessageEvent<{ id: number; file: File }>) => {
	const { id, file } = event.data;
	try {
		const kind: MediaProbeResult['kind'] = file.type.startsWith('audio/')
			? 'audio'
			: file.type.startsWith('image/')
				? 'image'
				: 'video';

		if (kind === 'image') {
			const bitmap = await createImageBitmap(file);
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
			bitmap.close();
			const thumbnailBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
			const result: MediaProbeResult = {
				kind,
				durationSeconds: 0,
				width: bitmap.width,
				height: bitmap.height,
				fps: 0,
				thumbnailBlob,
				hasAudio: false
			};
			self.postMessage({ id, ok: true, result });
			return;
		}

		const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
		const duration = await input.computeDuration();
		const videoTrack = await input.getPrimaryVideoTrack();
		const audioTrack = await input.getPrimaryAudioTrack();

		let fps = 30;
		let width = 0;
		let height = 0;
		let videoCodec: string | undefined;
		let keyframeTimestamps: number[] | undefined;
		if (videoTrack) {
			fps = await estimateFps(videoTrack);
			width = videoTrack.displayWidth;
			height = videoTrack.displayHeight;
			videoCodec = videoTrack.codec ?? undefined;
			keyframeTimestamps = await extractKeyframes(input);
		}

		let gopInterval: number | undefined;
		if (keyframeTimestamps && keyframeTimestamps.length >= 2) {
			const span =
				// SAFETY: length >= 2 checked above.
				(keyframeTimestamps[keyframeTimestamps.length - 1] as number) - keyframeTimestamps[0]!;
			gopInterval = span / (keyframeTimestamps.length - 1);
		}

		const thumbnailBlob = videoTrack
			? await generateThumbnail(input, duration > 2 ? 1 : duration / 2)
			: undefined;

		const result: MediaProbeResult = {
			kind,
			durationSeconds: duration || 0,
			width,
			height,
			fps: kind === 'audio' ? 0 : fps,
			videoCodec: videoCodec ?? undefined,
			audioCodec: audioTrack?.codec ?? undefined,
			keyframeTimestamps,
			gopInterval,
			thumbnailBlob,
			hasAudio: Boolean(audioTrack)
		};
		self.postMessage({ id, ok: true, result });
		// SAFETY: probe inputs implement dispose when the build supports it.
		input.dispose?.();
	} catch (error) {
		self.postMessage({
			id,
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
