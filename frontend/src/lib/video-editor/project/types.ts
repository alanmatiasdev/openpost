/**
 * Project document model for the OpenPost Video Editor.
 *
 * Ported from FreeCut (MIT) — types/project.ts — trimmed to the v1 surface:
 * video / audio / image / text / subtitle items, one top-level sequence,
 * no compositions, shapes, masks, or per-band EQ.
 */

export type TimelineItemKind = 'video' | 'audio' | 'image' | 'text' | 'subtitle';

export interface ItemTransform {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	anchorX?: number;
	anchorY?: number;
	rotation?: number;
	flipHorizontal?: boolean;
	flipVertical?: boolean;
	opacity?: number;
	cornerRadius?: number;
	aspectRatioLocked?: boolean;
}

export interface CropSettings {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** Styling for text items and caption rendering. */
export interface TextStyleFields {
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: number;
	color?: string;
	backgroundColor?: string;
	textAlign?: 'left' | 'center' | 'right';
	verticalAlign?: 'top' | 'middle' | 'bottom';
	lineHeight?: number;
	letterSpacing?: number;
	textShadow?: { blur: number; color: string; offsetX: number; offsetY: number };
	strokeWidth?: number;
	strokeColor?: string;
	paddingX?: number;
	paddingY?: number;
	borderRadius?: number;
}

/**
 * Where a subtitle item's cues come from. Transcript captions are generated
 * from the media's speech recognition output; imports come from .srt/.vtt.
 */
export interface CaptionSource {
	type: 'transcript' | 'subtitle-import';
	clipId: string;
	mediaId: string;
	fileName?: string;
	format?: 'srt' | 'vtt';
	importedAt?: number;
}

export interface SubtitleCue {
	id: string;
	startFrame: number;
	endFrame: number;
	text: string;
}

export interface TimelineItem extends TextStyleFields {
	id: string;
	trackId: string;
	from: number;
	durationInFrames: number;
	label: string;
	type: TimelineItemKind;
	mediaId?: string;
	originId?: string;
	linkedGroupId?: string;

	// Source boundaries for media items (frames at the source's frame rate)
	sourceStart?: number;
	sourceEnd?: number;
	sourceDuration?: number;
	sourceFps?: number;
	speed?: number;

	// Text items
	text?: string;

	// Subtitle items own the full cue list and render the active cue per frame
	captionSource?: CaptionSource;
	cues?: SubtitleCue[];
	subtitleStyleScale?: number;

	// Source dimensions (video/image)
	sourceWidth?: number;
	sourceHeight?: number;

	transform?: ItemTransform;
	crop?: CropSettings;

	// Audio properties
	volume?: number;
	audioFadeIn?: number;
	audioFadeOut?: number;

	// Video properties
	fadeIn?: number;
	fadeOut?: number;
}

export interface TimelineTrack {
	id: string;
	name: string;
	kind?: 'video' | 'audio';
	height: number;
	locked: boolean;
	syncLock?: boolean;
	visible: boolean;
	muted: boolean;
	solo: boolean;
	volume?: number;
	color?: string;
	order: number;
}

export interface TimelineMarker {
	id: string;
	frame: number;
	label?: string;
	color: string;
}

export interface TimelineTransition {
	id: string;
	type: 'crossfade' | 'fade-black';
	durationInFrames: number;
	fromItemId: string;
	toItemId: string;
}

export interface ProjectTimeline {
	tracks: TimelineTrack[];
	items: TimelineItem[];

	// Playback and view state
	currentFrame?: number;
	zoomLevel?: number;
	scrollPosition?: number;

	// In/Out points
	inPoint?: number;
	outPoint?: number;

	markers?: TimelineMarker[];
	transitions?: TimelineTransition[];
}

export interface ProjectResolution {
	width: number;
	height: number;
	fps: number;
	backgroundColor?: string;
}

export interface Project {
	id: string;
	name: string;
	description: string;
	createdAt: number;
	updatedAt: number;
	duration: number;
	/**
	 * Schema version for migrations. Projects without this field are version 1.
	 */
	schemaVersion?: number;
	thumbnailId?: string;
	metadata: ProjectResolution;
	timeline?: ProjectTimeline;
	/**
	 * Root folder handle for the project's media files. Non-serializable —
	 * stripped on save and re-attached from the handles registry on load.
	 */
	rootFolderHandle?: FileSystemDirectoryHandle;
	rootFolderName?: string;
}
