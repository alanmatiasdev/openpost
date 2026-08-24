/** Pure export readiness checks shared by the dialog and render queue. */

import type { VideoCodec } from 'mediabunny';
import type { TimelineItem, TimelineTrack } from '../project/types';
import type { MediaPreparationStatus } from './pool.svelte';

export type ExportPreflightSeverity = 'ok' | 'info' | 'warning' | 'error';
export type ExportPreflightCheckId =
	| 'empty-range'
	| 'export-range-ready'
	| 'no-renderable-content'
	| 'no-audible-content'
	| 'missing-media'
	| 'media-ready'
	| 'video-codec-checking'
	| 'video-codec-supported'
	| 'video-codec-unavailable'
	| 'subtitle-burn-fallback'
	| 'main-thread-render'
	| 'long-render'
	| 'output-too-large';

export interface ExportPreflightCheck {
	id: ExportPreflightCheckId;
	severity: ExportPreflightSeverity;
	count?: number;
	frames?: number;
	seconds?: number;
	minutes?: number;
	sizeBytes?: number;
}

export interface ExportPreflightSettings {
	format: 'webm' | 'mp4' | 'mov' | 'mkv' | 'mp3' | 'aac' | 'wav';
	codec?: VideoCodec;
	quality: 'draft' | 'standard' | 'high';
	width: number;
	height: number;
	subtitleMode: 'none' | 'burn' | 'sidecar' | 'embedded';
	range?: { startFrame: number; endFrame: number };
}

export interface ExportPreflightInput {
	settings: ExportPreflightSettings;
	fps: number;
	items: readonly TimelineItem[];
	tracks: readonly TimelineTrack[];
	codecSupported: boolean | undefined;
	mediaStatuses: Readonly<Record<string, MediaPreparationStatus | undefined>>;
}

export interface ExportPreflightRange {
	startFrame: number;
	endFrame: number;
	frameCount: number;
}

export interface ExportPreflightResult {
	canExport: boolean;
	pending: boolean;
	checks: ExportPreflightCheck[];
	range: ExportPreflightRange;
	predictedRenderPath: 'main-thread';
	estimatedDurationSeconds: number;
	estimatedFileSizeBytes: number;
}

const VIDEO_BITRATES = {
	draft: 4_000_000,
	standard: 8_000_000,
	high: 16_000_000
} as const;
const AUDIO_BITRATE = 192_000;
const WAV_BITRATE = 48_000 * 2 * 16;
const IN_MEMORY_OUTPUT_LIMIT = 2 * 1024 ** 3;
const LONG_RENDER_SECONDS = 30 * 60;

function isAudioFormat(format: ExportPreflightSettings['format']): boolean {
	return format === 'mp3' || format === 'aac' || format === 'wav';
}

function projectEnd(items: readonly TimelineItem[]): number {
	return items.reduce((maximum, item) => Math.max(maximum, item.from + item.durationInFrames), 0);
}

function resolveRange(
	items: readonly TimelineItem[],
	range: ExportPreflightSettings['range']
): ExportPreflightRange {
	const startFrame = Math.max(0, Math.floor(range?.startFrame ?? 0));
	const endFrame = Math.max(0, Math.floor(range?.endFrame ?? projectEnd(items)));
	return { startFrame, endFrame, frameCount: Math.max(0, endFrame - startFrame) };
}

function overlapsRange(item: TimelineItem, range: ExportPreflightRange): boolean {
	return item.from < range.endFrame && range.startFrame < item.from + item.durationInFrames;
}

function activeTrackIds(tracks: readonly TimelineTrack[]): Set<string> {
	const solo = tracks.filter((track) => track.solo);
	return new Set((solo.length > 0 ? solo : tracks).map((track) => track.id));
}

function visibleItems(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[],
	range: ExportPreflightRange
): TimelineItem[] {
	const byId = new Map(tracks.map((track) => [track.id, track]));
	const activeIds = activeTrackIds(tracks);
	return items.filter((item) => {
		const track = byId.get(item.trackId);
		return Boolean(track && activeIds.has(track.id) && track.visible && overlapsRange(item, range));
	});
}

function hasRenderableContent(items: readonly TimelineItem[]): boolean {
	return items.some((item) => item.type !== 'adjustment');
}

function hasAudibleContent(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[]
): boolean {
	const byId = new Map(tracks.map((track) => [track.id, track]));
	return items.some((item) => {
		if (item.type !== 'audio' && item.type !== 'video') return false;
		const track = byId.get(item.trackId);
		return Boolean(track && !track.muted && (track.volume ?? 1) > 0 && (item.volume ?? 1) > 0);
	});
}

function needsSourceMedia(item: TimelineItem): boolean {
	return (
		item.type === 'video' ||
		item.type === 'audio' ||
		item.type === 'image' ||
		item.type === 'lottie'
	);
}

function referencedMediaIds(items: readonly TimelineItem[]): Set<string> {
	return new Set(
		items
			.filter((item) => needsSourceMedia(item) && Boolean(item.mediaId))
			.flatMap((item) => (item.mediaId ? [item.mediaId] : []))
	);
}

function estimateFileSize(
	settings: ExportPreflightSettings,
	durationSeconds: number,
	audible: boolean
): number {
	let bitsPerSecond: number;
	if (settings.format === 'wav') bitsPerSecond = WAV_BITRATE;
	else if (isAudioFormat(settings.format)) bitsPerSecond = AUDIO_BITRATE;
	else bitsPerSecond = VIDEO_BITRATES[settings.quality] + (audible ? AUDIO_BITRATE : 0);
	return Math.ceil((bitsPerSecond * durationSeconds) / 8);
}

export function assessExportPreflight(input: ExportPreflightInput): ExportPreflightResult {
	const checks: ExportPreflightCheck[] = [];
	const range = resolveRange(input.items, input.settings.range);
	const estimatedDurationSeconds = range.frameCount / Math.max(1, input.fps);
	const activeItems = visibleItems(input.items, input.tracks, range);
	const audioFormat = isAudioFormat(input.settings.format);
	const audible = hasAudibleContent(activeItems, input.tracks);

	if (range.frameCount === 0) {
		checks.push({ id: 'empty-range', severity: 'error' });
	} else {
		checks.push({
			id: 'export-range-ready',
			severity: 'ok',
			frames: range.frameCount,
			seconds: estimatedDurationSeconds
		});
	}

	if (!audioFormat && range.frameCount > 0 && !hasRenderableContent(activeItems)) {
		checks.push({ id: 'no-renderable-content', severity: 'error' });
	}
	if (audioFormat && range.frameCount > 0 && !audible) {
		checks.push({ id: 'no-audible-content', severity: 'error' });
	}

	const mediaIds = referencedMediaIds(input.items);
	const missingCount = [...mediaIds].filter((id) => input.mediaStatuses[id] !== 'ready').length;
	if (missingCount > 0) {
		checks.push({ id: 'missing-media', severity: 'error', count: missingCount });
	} else if (mediaIds.size > 0) {
		checks.push({ id: 'media-ready', severity: 'ok', count: mediaIds.size });
	}

	let pending = false;
	if (!audioFormat) {
		if (input.codecSupported === undefined) {
			pending = true;
			checks.push({ id: 'video-codec-checking', severity: 'info' });
		} else if (!input.codecSupported) {
			checks.push({ id: 'video-codec-unavailable', severity: 'error' });
		} else {
			checks.push({ id: 'video-codec-supported', severity: 'ok' });
		}
		if (
			input.settings.subtitleMode === 'embedded' &&
			input.settings.format !== 'webm' &&
			input.settings.format !== 'mkv'
		) {
			checks.push({ id: 'subtitle-burn-fallback', severity: 'warning' });
		}
	}

	checks.push({ id: 'main-thread-render', severity: 'ok' });
	const estimatedFileSizeBytes = estimateFileSize(
		input.settings,
		estimatedDurationSeconds,
		audible
	);
	if (estimatedDurationSeconds >= LONG_RENDER_SECONDS) {
		checks.push({
			id: 'long-render',
			severity: 'warning',
			minutes: Math.round(estimatedDurationSeconds / 60)
		});
	}
	if (estimatedFileSizeBytes >= IN_MEMORY_OUTPUT_LIMIT) {
		checks.push({
			id: 'output-too-large',
			severity: 'error',
			sizeBytes: estimatedFileSizeBytes
		});
	}

	return {
		canExport: !pending && !checks.some((check) => check.severity === 'error'),
		pending,
		checks,
		range,
		predictedRenderPath: 'main-thread',
		estimatedDurationSeconds,
		estimatedFileSizeBytes
	};
}

export function summarizePreflightSeverity(
	checks: readonly ExportPreflightCheck[]
): ExportPreflightSeverity {
	if (checks.some((check) => check.severity === 'error')) return 'error';
	if (checks.some((check) => check.severity === 'warning')) return 'warning';
	if (checks.some((check) => check.severity === 'info')) return 'info';
	return 'ok';
}
