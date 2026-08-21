/**
 * Export pipeline v1.
 *
 * Fast path: a timeline whose audible/visible content is exactly one media
 * item exports losslessly via mediabunny Conversion stream-copy with an
 * in/out trim. Multi-item timelines require the frame renderer (next phase,
 * tracked on the export ticket).
 */

import {
	ALL_FORMATS,
	BlobSource,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	WebMOutputFormat
} from 'mediabunny';
import { saveExportFile } from '../workspace-fs/exports';
import type { Project, TimelineItem } from '../project/types';
import { mediaPool } from './pool.svelte';
import { resolveMediaBlob } from './import.svelte';

export interface ExportProgress {
	phase: 'preparing' | 'rendering' | 'finalizing';
	progress: number;
}

export interface ExportResult {
	fileName: string;
	relPath: string;
	blob: Blob;
}

function singleItemSelection(items: TimelineItem[]): TimelineItem | null {
	const mediaItems = items.filter((i) => i.type === 'video' || i.type === 'audio');
	return mediaItems.length === 1 ? (mediaItems[0] ?? null) : null;
}

/** Export the current timeline. Resolves with the saved file info. */
export async function exportProject(
	project: Project,
	options: {
		inFrame?: number | null;
		outFrame?: number | null;
		format?: 'mp4' | 'webm';
		onProgress?: (progress: ExportProgress) => void;
	} = {}
): Promise<ExportResult> {
	const fps = project.metadata.fps;
	const items = project.timeline?.items ?? [];
	const selectedItem = singleItemSelection(items);
	const selection = selectedItem;
	if (!selection || !selection.mediaId) {
		throw new Error('Only single-clip timelines can be exported in this build yet.');
	}
	options.onProgress?.({ phase: 'preparing', progress: 0 });

	const media = mediaPool.get(selection.mediaId);
	if (!media) throw new Error('Timeline media is missing from the pool');
	const blob = await resolveMediaBlob(media);

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
	const sourceFps =
		selection.sourceFps !== undefined && selection.sourceFps > 0 ? selection.sourceFps : fps;
	const speed = selection.speed ?? 1;
	const sourceStartSeconds = (selection.sourceStart ?? 0) / sourceFps;
	const relativeStart =
		(options.inFrame != null ? Math.max(options.inFrame - selection.from, 0) : 0) / fps;
	const relativeEnd =
		options.outFrame != null
			? Math.min(options.outFrame - selection.from, selection.durationInFrames) / fps
			: selection.durationInFrames / fps;

	const format = options.format ?? 'mp4';
	const outputFormat = format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
	const target = new BufferTarget();
	const conversion = await Conversion.init({
		input,
		output: new Output({ format: outputFormat, target }),
		trim: {
			start: sourceStartSeconds + relativeStart * speed,
			end: sourceStartSeconds + relativeEnd * speed
		},
		video: { forceTranscode: false },
		audio: { forceTranscode: false }
	});
	if (!conversion.isValid) throw new Error('This timeline cannot be exported directly.');

	conversion.onProgress = (progress) => {
		options.onProgress?.({ phase: 'rendering', progress });
	};
	await conversion.execute();
	options.onProgress?.({ phase: 'finalizing', progress: 1 });

	const buffer = target.buffer;
	if (!buffer) throw new Error('Export produced no data');
	const outBlob = new Blob([buffer], { type: format === 'webm' ? 'video/webm' : 'video/mp4' });
	const baseName = `${project.name.replace(/[\\/:*?"<>|]+/g, '_')}.${format}`;
	const saved = await saveExportFile(project.id, baseName, outBlob);
	input.dispose?.();
	return { ...saved, blob: outBlob };
}
