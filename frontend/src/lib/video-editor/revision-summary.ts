import {
	projectDurationUS,
	type AudioTrackItem,
	type CaptionCue,
	type VideoProjectDocumentV1,
	type VideoSource,
	type VisualTrackItem
} from '@openpost/video-project';
import {
	compareRevisionItems as compareItems,
	sameRevisionValue,
	type RevisionCollectionChanges
} from '$lib/revision-comparison';

export interface VideoEditorRevisionChanges {
	titleChanged: boolean;
	coverChanged: boolean;
	editingModeChanged: boolean;
	durationChanged: boolean;
	exportSettingsChanged: boolean;
	variantsChanged: number;
	sourcesAdded: number;
	sourcesRemoved: number;
	sourcesChanged: number;
	primaryItemsAdded: number;
	primaryItemsRemoved: number;
	primaryItemsChanged: number;
	visualItemsAdded: number;
	visualItemsRemoved: number;
	visualItemsChanged: number;
	audioItemsAdded: number;
	audioItemsRemoved: number;
	audioItemsChanged: number;
	captionCuesAdded: number;
	captionCuesRemoved: number;
	captionCuesChanged: number;
}

export interface VideoEditorRevisionContext {
	currentCoverSourceID?: string;
	targetCoverSourceID?: string;
}

export function summarizeVideoEditorRevision(
	current: VideoProjectDocumentV1,
	target: VideoProjectDocumentV1,
	context: VideoEditorRevisionContext = {}
): VideoEditorRevisionChanges {
	const sources = compareRecords(current.sources, target.sources);
	const primary = compareItems(current.primary_sequence, target.primary_sequence);
	const visual = compareItems(flattenVisualItems(current), flattenVisualItems(target));
	const audio = compareItems(flattenAudioItems(current), flattenAudioItems(target));
	const captions = compareItems(flattenCaptionCues(current), flattenCaptionCues(target));
	const variants = compareItems(current.variants, target.variants);
	const markers = compareItems(current.markers, target.markers);
	const visualTracks = compareItems(
		current.visual_tracks.map(({ items: _items, ...track }) => track),
		target.visual_tracks.map(({ items: _items, ...track }) => track)
	);
	const audioTracks = compareItems(
		current.audio_tracks.map(({ items: _items, ...track }) => track),
		target.audio_tracks.map(({ items: _items, ...track }) => track)
	);
	const captionTracks = compareItems(
		current.caption_tracks.map(({ cues: _cues, ...track }) => track),
		target.caption_tracks.map(({ cues: _cues, ...track }) => track)
	);
	const changes: VideoEditorRevisionChanges = {
		titleChanged: current.title !== target.title,
		coverChanged:
			normalizeReference(context.currentCoverSourceID) !==
			normalizeReference(context.targetCoverSourceID),
		editingModeChanged: current.editing_mode !== target.editing_mode,
		durationChanged:
			projectDurationUS(current) !== projectDurationUS(target) ||
			!sameRevisionValue(current.timebase, target.timebase),
		exportSettingsChanged: !sameRevisionValue(current.export_defaults, target.export_defaults),
		variantsChanged: variants.added + variants.removed + variants.changed,
		sourcesAdded: sources.added,
		sourcesRemoved: sources.removed,
		sourcesChanged: sources.changed,
		primaryItemsAdded: primary.added,
		primaryItemsRemoved: primary.removed,
		primaryItemsChanged: primary.changed + markers.added + markers.removed + markers.changed,
		visualItemsAdded: visual.added,
		visualItemsRemoved: visual.removed,
		visualItemsChanged:
			visual.changed + visualTracks.added + visualTracks.removed + visualTracks.changed,
		audioItemsAdded: audio.added,
		audioItemsRemoved: audio.removed,
		audioItemsChanged:
			audio.changed + audioTracks.added + audioTracks.removed + audioTracks.changed,
		captionCuesAdded: captions.added,
		captionCuesRemoved: captions.removed,
		captionCuesChanged:
			captions.changed + captionTracks.added + captionTracks.removed + captionTracks.changed
	};
	// Preserve restore reachability when a future valid schema member changes
	// before the detail summary learns how to name that domain.
	if (!videoEditorRevisionHasChanges(changes) && !sameRevisionValue(current, target)) {
		changes.primaryItemsChanged = 1;
	}
	return changes;
}

export function videoEditorRevisionHasChanges(changes: VideoEditorRevisionChanges): boolean {
	return Object.values(changes).some((value) => value === true || Number(value) > 0);
}

function flattenVisualItems(
	document: VideoProjectDocumentV1
): Array<VisualTrackItem & { summary_track_id: string }> {
	return document.visual_tracks.flatMap((track) =>
		track.items.map((item) => ({ ...item, summary_track_id: track.id }))
	);
}

function flattenAudioItems(
	document: VideoProjectDocumentV1
): Array<AudioTrackItem & { summary_track_id: string }> {
	return document.audio_tracks.flatMap((track) =>
		track.items.map((item) => ({ ...item, summary_track_id: track.id }))
	);
}

function flattenCaptionCues(
	document: VideoProjectDocumentV1
): Array<CaptionCue & { summary_track_id: string }> {
	return document.caption_tracks.flatMap((track) =>
		track.cues.map((cue) => ({ ...cue, summary_track_id: track.id }))
	);
}

function compareRecords(
	current: Record<string, VideoSource>,
	target: Record<string, VideoSource>
): RevisionCollectionChanges {
	const currentItems = Object.entries(current).map(([id, value]) => ({ ...value, id }));
	const targetItems = Object.entries(target).map(([id, value]) => ({ ...value, id }));
	return compareItems(currentItems, targetItems);
}

function normalizeReference(value: string | undefined): string {
	return value?.trim() ?? '';
}
