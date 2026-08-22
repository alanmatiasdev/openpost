/**
 * Multi-track rendered export: flattens every visible/audible timeline item
 * into one composed video file.
 *
 * Ported from FreeCut (MIT) — features/export/utils/canvas-render-orchestrator.ts,
 * client-renderer.ts, and canvas-audio.ts — retargeted to OpenPost's
 * TimelineItem model and trimmed to a single main-thread render loop with a
 * whole-timeline OfflineAudioContext mixdown (48 kHz stereo).
 */

import {
	ALL_FORMATS,
	AudioSample,
	AudioSampleSink,
	AudioSampleSource,
	BlobSource,
	BufferTarget,
	CanvasSink,
	Input,
	MkvOutputFormat,
	MovOutputFormat,
	Mp4OutputFormat,
	Output,
	type OutputFormat,
	TextSubtitleSource,
	VideoSample,
	VideoSampleSource,
	WebMOutputFormat
} from 'mediabunny';
import { saveExportFile } from '../workspace-fs/exports';
import type { Project, TimelineItem } from '../project/types';
import { mediaPool } from './pool.svelte';
import { resolveMediaBlob } from './import.svelte';
import { resolveAnimatedItemAt } from '../timeline/animated-properties';
import { mediaDrawGeometry } from './render-geometry';
import { subtitleSidecarSrt, subtitleWebVtt } from '../transcript/subtitle-export';
import { incomingOpacity, outgoingOpacity } from '../timeline/actions/transitions.svelte';
import {
	frameToSourceSeconds,
	isVisibleAtFrame,
	outputDurationFrames,
	paintOrder,
	planMixdown,
	selectCuesAtFrame,
	transitionBlendAtFrame,
	type MixEntry
} from './render-plan';

export interface RenderExportProgress {
	phase: 'preparing' | 'mixing' | 'rendering' | 'finalizing';
	framesDone: number;
	totalFrames: number;
	progress: number;
}

export interface RenderExportOptions {
	format?: 'webm' | 'mp4' | 'mov' | 'mkv';
	quality?: 'draft' | 'standard' | 'high';
	width?: number;
	height?: number;
	range?: { startFrame: number; endFrame: number };
	burnSubtitles?: boolean;
	subtitleMode?: 'none' | 'burn' | 'sidecar' | 'embedded';
	signal?: AbortSignal;
	onProgress?: (progress: RenderExportProgress) => void;
}

export interface RenderExportResult {
	fileName: string;
	relPath: string;
	blob: Blob;
}

const MIX_SAMPLE_RATE = 48_000;
const MIX_CHANNELS = 2;
const AUDIO_ENCODE_CHUNK_FRAMES = 48_000;
const VIDEO_BITRATES = { draft: 4_000_000, standard: 8_000_000, high: 16_000_000 } as const;

interface VideoDecoder {
	input: Input;
	sink: CanvasSink;
}

function report(
	options: RenderExportOptions,
	phase: RenderExportProgress['phase'],
	framesDone: number,
	totalFrames: number
): void {
	options.onProgress?.({
		phase,
		framesDone,
		totalFrames,
		progress: totalFrames > 0 ? framesDone / totalFrames : 0
	});
}

/** Decode the primary audio track to an AudioBuffer at its native rate. */
async function decodeAudioBuffer(blob: Blob): Promise<AudioBuffer> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error('Clip has no audio to mix');
		const sink = new AudioSampleSink(track);
		const channels: Float32Array[][] = [];
		let totalFrames = 0;
		let sampleRate = track.sampleRate || MIX_SAMPLE_RATE;
		for await (const sample of sink.samples()) {
			try {
				sampleRate = sample.sampleRate || sampleRate;
				const frameCount = sample.numberOfFrames;
				const planes: Float32Array[] = [];
				for (let c = 0; c < sample.numberOfChannels; c++) {
					// SAFETY: copyTo fills a planar f32 view of the decoded sample.
					const plane = new Float32Array(frameCount);
					sample.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
					planes.push(plane);
				}
				channels.push(planes);
				totalFrames += frameCount;
			} finally {
				sample.close();
			}
		}
		const outChannels = Math.min(MIX_CHANNELS, Math.max(1, channels[0]?.length ?? 1));
		const context = new OfflineAudioContext(outChannels, Math.max(1, totalFrames), sampleRate);
		const buffer = context.createBuffer(outChannels, Math.max(1, totalFrames), sampleRate);
		for (let c = 0; c < outChannels; c++) {
			const data = buffer.getChannelData(c);
			let offset = 0;
			for (const planes of channels) {
				data.set(planes[c] ?? planes[0] ?? new Float32Array(0), offset);
				offset += planes[0]?.length ?? 0;
			}
		}
		return buffer;
	} finally {
		input.dispose?.();
	}
}

function mixDurationSeconds(entries: MixEntry[]): number {
	return entries.reduce(
		(max, entry) => Math.max(max, entry.whenSeconds + entry.durationSeconds),
		0
	);
}

async function renderMixdown(
	entries: MixEntry[],
	decoded: Map<string, AudioBuffer>,
	durationSeconds: number
): Promise<AudioBuffer | null> {
	if (entries.length === 0) return null;
	const length = Math.max(1, Math.ceil(durationSeconds * MIX_SAMPLE_RATE));
	const context = new OfflineAudioContext(MIX_CHANNELS, length, MIX_SAMPLE_RATE);
	for (const entry of entries) {
		const buffer = decoded.get(entry.mediaId);
		if (!buffer) continue;
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value = entry.playbackRate;
		const gain = context.createGain();
		for (const point of entry.gainPoints) {
			gain.gain.setValueAtTime(Math.max(0, point.value), point.whenSeconds);
		}
		source.connect(gain).connect(context.destination);
		source.start(
			entry.whenSeconds,
			entry.sourceOffsetSeconds,
			entry.durationSeconds * entry.playbackRate
		);
	}
	return context.startRendering();
}

/** Ported from FreeCut (MIT) addAudioDataInChunks — feeds f32-planar chunks. */
async function feedEncodedAudio(
	audioSource: AudioSampleSource,
	buffer: AudioBuffer,
	onChunk?: () => void
): Promise<void> {
	const channelCount = buffer.numberOfChannels;
	const channelData: Float32Array[] = [];
	for (let c = 0; c < channelCount; c++) channelData.push(buffer.getChannelData(c));
	for (let offset = 0; offset < buffer.length; offset += AUDIO_ENCODE_CHUNK_FRAMES) {
		const frameCount = Math.min(AUDIO_ENCODE_CHUNK_FRAMES, buffer.length - offset);
		const planar = new Float32Array(frameCount * channelCount);
		for (let c = 0; c < channelCount; c++) {
			const samples = channelData[c];
			if (samples) planar.set(samples.subarray(offset, offset + frameCount), c * frameCount);
		}
		const sample = new AudioSample({
			data: planar,
			format: 'f32-planar',
			numberOfChannels: channelCount,
			sampleRate: buffer.sampleRate,
			timestamp: offset / buffer.sampleRate
		});
		try {
			await audioSource.add(sample);
			onChunk?.();
		} finally {
			sample.close();
		}
	}
}

function baseOpacity(item: TimelineItem): number {
	return Math.min(1, Math.max(0, item.transform?.opacity ?? 1));
}

function drawTransformed(
	ctx: OffscreenCanvasRenderingContext2D,
	image: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	item: TimelineItem,
	canvasWidth: number,
	canvasHeight: number,
	alpha: number
): void {
	const transform = item.transform ?? {};
	const geometry = mediaDrawGeometry(item, sourceWidth, sourceHeight, canvasWidth, canvasHeight);
	ctx.save();
	ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
	ctx.translate(geometry.centerX, geometry.centerY);
	ctx.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
	ctx.scale(transform.flipHorizontal === true ? -1 : 1, transform.flipVertical === true ? -1 : 1);
	const cornerRadius = Math.min(
		Math.max(0, transform.cornerRadius ?? 0),
		geometry.drawWidth / 2,
		geometry.drawHeight / 2
	);
	if (cornerRadius > 0) {
		ctx.beginPath();
		ctx.roundRect(
			-geometry.anchorX,
			-geometry.anchorY,
			geometry.drawWidth,
			geometry.drawHeight,
			cornerRadius
		);
		ctx.clip();
	}
	ctx.drawImage(
		image,
		geometry.sourceX,
		geometry.sourceY,
		geometry.sourceWidth,
		geometry.sourceHeight,
		-geometry.anchorX,
		-geometry.anchorY,
		geometry.drawWidth,
		geometry.drawHeight
	);
	ctx.restore();
}

function drawTextItem(
	ctx: OffscreenCanvasRenderingContext2D,
	item: TimelineItem,
	canvasWidth: number,
	canvasHeight: number
): void {
	const transform = item.transform ?? {};
	const width = Math.max(1, transform.width ?? canvasWidth * 0.7);
	const height = Math.max(1, transform.height ?? canvasHeight * 0.3);
	const centerX = canvasWidth / 2 + (transform.x ?? 0);
	const centerY = canvasHeight / 2 + (transform.y ?? 0);
	const fontSize = item.fontSize ?? Math.round(canvasHeight / 15);
	ctx.save();
	ctx.globalAlpha = Math.min(1, Math.max(0, transform.opacity ?? 1));
	ctx.translate(centerX, centerY);
	ctx.rotate(((transform.rotation ?? 0) * Math.PI) / 180);
	ctx.textAlign = item.textAlign ?? 'center';
	ctx.textBaseline = 'middle';
	ctx.font = `${item.fontWeight ?? 600} ${fontSize}px ${item.fontFamily ?? 'sans-serif'}`;
	if (item.backgroundColor) {
		ctx.fillStyle = item.backgroundColor;
		ctx.beginPath();
		ctx.roundRect(-width / 2, -height / 2, width, height, item.borderRadius ?? 0);
		ctx.fill();
	}
	if (item.textShadow) {
		ctx.shadowColor = item.textShadow.color;
		ctx.shadowBlur = item.textShadow.blur;
		ctx.shadowOffsetX = item.textShadow.offsetX;
		ctx.shadowOffsetY = item.textShadow.offsetY;
	}
	ctx.lineWidth = item.strokeWidth ?? 0;
	ctx.strokeStyle = item.strokeColor ?? '#000000';
	ctx.fillStyle = item.color ?? '#ffffff';
	const lines = (item.text ?? item.label).split('\n');
	const lineHeight = fontSize * (item.lineHeight ?? 1.2);
	for (const [index, line] of lines.entries()) {
		const y = (index - (lines.length - 1) / 2) * lineHeight;
		if ((item.strokeWidth ?? 0) > 0) ctx.strokeText(line, 0, y, width);
		ctx.fillText(line, 0, y, width);
	}
	ctx.restore();
}

function drawSubtitleText(
	ctx: OffscreenCanvasRenderingContext2D,
	text: string,
	canvasWidth: number,
	canvasHeight: number,
	scale: number
): void {
	const fontSize = Math.round((canvasHeight / 18) * Math.max(0.1, scale ?? 1));
	ctx.save();
	ctx.font = `600 ${fontSize}px sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'bottom';
	ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
	ctx.shadowBlur = fontSize / 6;
	ctx.fillStyle = '#ffffff';
	const lines = text.split('\n');
	const lineHeight = fontSize * 1.25;
	const bottomOffset = canvasHeight / 16;
	lines.forEach((line, index) => {
		const y = canvasHeight - bottomOffset - (lines.length - 1 - index) * lineHeight;
		ctx.fillText(line, canvasWidth / 2, y);
	});
	ctx.restore();
}

/** Render the full timeline into one composed file and save it to exports. */
export async function renderMultiTrackVideo(
	project: Project,
	options: RenderExportOptions = {}
): Promise<RenderExportResult> {
	const fps = project.metadata.fps;
	const width = options.width ?? project.metadata.width;
	const height = options.height ?? project.metadata.height;
	const timeline = project.timeline;
	const items = timeline?.items ?? [];
	if (items.length === 0) throw new Error('This timeline has nothing to render.');
	const tracks = timeline?.tracks ?? [];
	const transitions = timeline?.transitions ?? [];
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const fullDuration = outputDurationFrames(items);
	const startFrame = Math.max(0, Math.floor(options.range?.startFrame ?? 0));
	const endFrame = Math.min(fullDuration, Math.ceil(options.range?.endFrame ?? fullDuration));
	const totalFrames = Math.max(0, endFrame - startFrame);
	if (totalFrames === 0) throw new Error('The selected export range is empty.');

	report(options, 'preparing', 0, totalFrames);

	const mixEntries = sliceMixEntries(
		planMixdown(items, tracks, fps),
		startFrame / fps,
		endFrame / fps
	);
	const decodedAudio = new Map<string, AudioBuffer>();
	for (const mediaId of new Set(mixEntries.map((entry) => entry.mediaId))) {
		const media = mediaPool.get(mediaId);
		if (!media) continue;
		try {
			decodedAudio.set(mediaId, await decodeAudioBuffer(await resolveMediaBlob(media)));
		} catch {
			// Silent or unreadable audio drops out of the mix rather than failing export.
		}
	}
	report(options, 'mixing', 0, totalFrames);
	const mixed =
		mixEntries.length > 0
			? await renderMixdown(mixEntries, decodedAudio, mixDurationSeconds(mixEntries))
			: null;

	const format = options.format ?? 'webm';
	const outputFormat = outputFormatFor(format);
	const target = new BufferTarget();
	const output = new Output({ format: outputFormat, target });
	const videoSource = new VideoSampleSource({
		codec: format === 'webm' || format === 'mkv' ? 'vp9' : 'avc',
		bitrate: VIDEO_BITRATES[options.quality ?? 'standard'],
		keyFrameInterval: 2,
		latencyMode: 'quality'
	});
	output.addVideoTrack(videoSource, { frameRate: fps });
	const subtitleMode = options.subtitleMode ?? (options.burnSubtitles === false ? 'none' : 'burn');
	let subtitleSource: TextSubtitleSource | null = null;
	if (subtitleMode === 'embedded') {
		if (format === 'mov') throw new Error('MOV does not support embedded WebVTT subtitles.');
		subtitleSource = new TextSubtitleSource('webvtt');
		output.addSubtitleTrack(subtitleSource);
	}

	let audioSource: AudioSampleSource | null = null;
	if (mixed) {
		audioSource = new AudioSampleSource({
			codec: format === 'webm' || format === 'mkv' ? 'opus' : 'aac',
			bitrate: 192_000
		});
		output.addAudioTrack(audioSource);
	}

	await output.start();
	if (subtitleSource) {
		await subtitleSource.add(subtitleWebVtt(items, fps, startFrame, endFrame));
		subtitleSource.close();
	}

	async function runFeed(): Promise<void> {
		if (!mixed || !audioSource) return;
		const source = audioSource;
		try {
			await feedEncodedAudio(source, mixed);
		} finally {
			source.close();
			audioSource = null;
		}
	}
	const feedTask = runFeed();
	feedTask.catch(() => undefined);

	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Failed to create the render canvas context.');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';

	const backgroundColor = project.metadata.backgroundColor ?? '#000000';
	const orderedItems = paintOrder(items, tracks).filter(
		(item) => item.type === 'video' || item.type === 'image' || item.type === 'text'
	);
	const subtitleItems = items.filter((item) => item.type === 'subtitle');

	const decoders = new Map<string, VideoDecoder>();
	const imageCache = new Map<string, ImageBitmap>();
	const inputs: Input[] = [];

	async function getDecoder(mediaId: string): Promise<VideoDecoder | null> {
		const existing = decoders.get(mediaId);
		if (existing) return existing;
		const media = mediaPool.get(mediaId);
		if (!media) return null;
		const blob = await resolveMediaBlob(media);
		const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
		inputs.push(input);
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) return null;
		const decoder: VideoDecoder = {
			input,
			sink: new CanvasSink(videoTrack, { width, height, fit: 'contain' })
		};
		decoders.set(mediaId, decoder);
		return decoder;
	}

	try {
		for (let outputFrame = 0; outputFrame < totalFrames; outputFrame++) {
			throwIfAborted(options.signal);
			const frame = startFrame + outputFrame;
			ctx.globalAlpha = 1;
			ctx.fillStyle = backgroundColor;
			ctx.fillRect(0, 0, width, height);

			const blend = transitionBlendAtFrame(transitions, itemsById, frame);
			for (const item of orderedItems) {
				if (!isVisibleAtFrame(item, frame)) continue;
				const resolvedItem = resolveAnimatedItemAt(item, frame);
				if (resolvedItem.type === 'text') {
					drawTextItem(ctx, resolvedItem, width, height);
					continue;
				}
				if (!resolvedItem.mediaId) continue;
				let alpha = baseOpacity(resolvedItem);
				if (blend) {
					if (item.id === blend.outgoingId) {
						alpha *= outgoingOpacity(blend.type, blend.progress);
					} else if (item.id === blend.incomingId) {
						alpha *= incomingOpacity(blend.type, blend.progress);
					}
				}
				if (alpha <= 0) continue;

				if (resolvedItem.type === 'video') {
					const decoder = await getDecoder(resolvedItem.mediaId);
					if (!decoder) continue;
					const wrapped = await decoder.sink.getCanvas(frameToSourceSeconds(item, frame, fps));
					if (!wrapped) continue;
					drawTransformed(
						ctx,
						wrapped.canvas,
						wrapped.canvas.width,
						wrapped.canvas.height,
						resolvedItem,
						width,
						height,
						alpha
					);
				} else {
					let bitmap = imageCache.get(resolvedItem.mediaId);
					if (!bitmap) {
						const media = mediaPool.get(resolvedItem.mediaId);
						if (!media) continue;
						bitmap = await createImageBitmap(await resolveMediaBlob(media));
						imageCache.set(resolvedItem.mediaId, bitmap);
					}
					drawTransformed(
						ctx,
						bitmap,
						bitmap.width,
						bitmap.height,
						resolvedItem,
						width,
						height,
						alpha
					);
				}
			}

			for (const item of subtitleMode === 'burn' ? subtitleItems : []) {
				if (!isVisibleAtFrame(item, frame)) continue;
				const cue = selectCuesAtFrame(item.cues ?? [], frame)[0];
				if (cue) drawSubtitleText(ctx, cue.text, width, height, item.subtitleStyleScale ?? 1);
			}

			const sample = new VideoSample(canvas, {
				timestamp: outputFrame / fps,
				duration: 1 / fps
			});
			await videoSource.add(sample);
			sample.close();

			report(options, 'rendering', outputFrame + 1, totalFrames);
		}

		videoSource.close();
		await feedTask;
		report(options, 'finalizing', totalFrames, totalFrames);
		await output.finalize();
	} catch (error) {
		try {
			if (output.state === 'started') await output.cancel();
		} catch {
			// The original failure below matters more than cancel errors.
		}
		throw error;
	} finally {
		for (const input of inputs) input.dispose?.();
		for (const bitmap of imageCache.values()) bitmap.close();
		imageCache.clear();
	}

	const buffer = target.buffer;
	if (!buffer) throw new Error('Render produced no data.');
	const blob = new Blob([buffer], { type: outputFormat.mimeType });
	const baseName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${format}`;
	const saved = await saveExportFile(project.id, baseName, blob);
	if (subtitleMode === 'sidecar') {
		const srt = subtitleSidecarSrt(items, fps, startFrame, endFrame);
		if (srt)
			await saveExportFile(
				project.id,
				`${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.srt`,
				new Blob([srt], { type: 'application/x-subrip' })
			);
	}
	return { ...saved, blob };
}

function outputFormatFor(format: NonNullable<RenderExportOptions['format']>): OutputFormat {
	switch (format) {
		case 'webm':
			return new WebMOutputFormat();
		case 'mp4':
			return new Mp4OutputFormat();
		case 'mov':
			return new MovOutputFormat();
		case 'mkv':
			return new MkvOutputFormat();
	}
}

function sliceMixEntries(
	entries: MixEntry[],
	startSeconds: number,
	endSeconds: number
): MixEntry[] {
	return entries.flatMap((entry) => {
		const entryEnd = entry.whenSeconds + entry.durationSeconds;
		const overlapStart = Math.max(startSeconds, entry.whenSeconds);
		const overlapEnd = Math.min(endSeconds, entryEnd);
		if (overlapEnd <= overlapStart) return [];
		const skipped = overlapStart - entry.whenSeconds;
		return [
			{
				...entry,
				whenSeconds: overlapStart - startSeconds,
				sourceOffsetSeconds: entry.sourceOffsetSeconds + skipped * entry.playbackRate,
				durationSeconds: overlapEnd - overlapStart,
				gainPoints: entry.gainPoints
					.filter((point) => point.whenSeconds >= overlapStart && point.whenSeconds <= overlapEnd)
					.map((point) => ({ ...point, whenSeconds: point.whenSeconds - startSeconds }))
			}
		];
	});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}
