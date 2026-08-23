/**
 * Project document model for the OpenPost Video Editor.
 *
 * Ported from FreeCut (MIT) - types/project.ts - trimmed to the v1 surface:
 * video / audio / image / Lottie / text / subtitle / shape / adjustment / composition
 * items and reusable nested sequences.
 */

import type {
	BezierPoints as TransitionBezierPoints,
	TransitionPresentation,
	TransitionTiming,
	WipeDirection as TransitionDirection
} from '../transitions/types';

export type {
	BezierPoints as TransitionBezierPoints,
	TransitionTiming,
	WipeDirection as TransitionDirection
} from '../transitions/types';

export type TimelineItemKind =
	| 'video'
	| 'audio'
	| 'image'
	| 'lottie'
	| 'text'
	| 'subtitle'
	| 'shape'
	| 'adjustment'
	| 'composition';

export type ShapeType =
	| 'rectangle'
	| 'circle'
	| 'triangle'
	| 'ellipse'
	| 'star'
	| 'polygon'
	| 'heart'
	| 'path';

/** One normalized Bezier vertex. Handles are offsets from the vertex. */
export interface ShapePathVertex {
	position: [number, number];
	inHandle: [number, number];
	outHandle: [number, number];
	tangentMode?: 'corner' | 'smooth' | 'continuous' | 'broken';
}

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

export type MotionModifierType = 'float-drift' | 'breath-pulse' | 'micro-shake' | 'sway' | 'spin';
export type MotionModifierChannel = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity';
export type MotionModifierChannelGains = Partial<Record<MotionModifierChannel, number>>;

export interface MotionModifier {
	version?: 2;
	id: string;
	type: MotionModifierType;
	enabled: boolean;
	amplitude: number;
	frequency: number;
	phaseFrames: number;
	seed: number;
	channelGains?: MotionModifierChannelGains;
}

export const TEXT_MOTION_IN_PRESET_IDS = [
	'typewriter',
	'fade-up',
	'rise',
	'cascade',
	'pop',
	'blur-in',
	'slide-mask',
	'wave-in'
] as const;
export const TEXT_MOTION_OUT_PRESET_IDS = [
	'fade-down',
	'sink',
	'pop-out',
	'blur-out',
	'typewriter-erase'
] as const;
export const TEXT_MOTION_LOOP_PRESET_IDS = ['pulse', 'wave', 'shimmer', 'swing'] as const;

export type TextMotionInPresetId = (typeof TEXT_MOTION_IN_PRESET_IDS)[number];
export type TextMotionOutPresetId = (typeof TEXT_MOTION_OUT_PRESET_IDS)[number];
export type TextMotionLoopPresetId = (typeof TEXT_MOTION_LOOP_PRESET_IDS)[number];
export type TextMotionPresetId =
	| TextMotionInPresetId
	| TextMotionOutPresetId
	| TextMotionLoopPresetId;
export type TextMotionUnit = 'character' | 'word' | 'line' | 'whole-clip';
export type TextMotionOrder = 'forward' | 'backward' | 'center' | 'random';
export type TextMotionEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'overshoot';
export type TextMotionSlot = 'in' | 'out' | 'loop';

export interface TextMotionEffectBase {
	durationFrames: number;
	offsetFrames?: number;
	staggerFrames: number;
	intensity: number;
	order: TextMotionOrder;
	easing: TextMotionEasing;
	seed: number;
	unit?: TextMotionUnit;
}

export interface TextMotionInEffect extends TextMotionEffectBase {
	presetId: TextMotionInPresetId;
}

export interface TextMotionOutEffect extends TextMotionEffectBase {
	presetId: TextMotionOutPresetId;
}

export interface TextMotionLoopEffect extends TextMotionEffectBase {
	presetId: TextMotionLoopPresetId;
}

export type TextMotionEffect = TextMotionInEffect | TextMotionOutEffect | TextMotionLoopEffect;

export interface TextMotionSpec {
	in?: TextMotionInEffect;
	out?: TextMotionOutEffect;
	loop?: TextMotionLoopEffect;
}

export interface CropSettings {
	top: number;
	right: number;
	bottom: number;
	left: number;
	softness?: number;
}

/** Four local-pixel offsets stored against the item size where they were authored. */
export interface TimelineItemCornerPin {
	topLeft: [number, number];
	topRight: [number, number];
	bottomRight: [number, number];
	bottomLeft: [number, number];
	referenceWidth?: number;
	referenceHeight?: number;
}

/**
 * Ported from FreeCut (MIT) - types/keyframe.ts.
 */
export type EasingType =
	| 'linear'
	| 'ease-in'
	| 'ease-out'
	| 'ease-in-out'
	| 'hold'
	| 'cubic-bezier'
	| 'spring';

export interface BezierControlPoints {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export interface SpringParameters {
	tension: number;
	friction: number;
	mass: number;
}

export interface EasingConfig {
	type: EasingType;
	bezier?: BezierControlPoints;
	spring?: SpringParameters;
}

export const DEFAULT_SPRING_PARAMS: SpringParameters = {
	tension: 170,
	friction: 26,
	mass: 1
};

export const DEFAULT_BEZIER_POINTS: BezierControlPoints = {
	x1: 0.42,
	y1: 0,
	x2: 0.58,
	y2: 1
};

/** Stable effect-parameter lane, matching FreeCut's persisted property format. */
export type EffectKeyframeProperty = `effect:${string}:${string}:${string}`;

/** Built-in property that can be animated with per-item keyframes. */
export type BuiltInKeyframeProperty =
	| 'x'
	| 'y'
	| 'width'
	| 'height'
	| 'anchorX'
	| 'anchorY'
	| 'rotation'
	| 'opacity'
	| 'cornerRadius'
	| 'cropLeft'
	| 'cropRight'
	| 'cropTop'
	| 'cropBottom'
	| 'cropSoftness'
	| 'volume'
	| 'fontSize'
	| 'fontWeight'
	| 'lineHeight'
	| 'letterSpacing'
	| 'paddingX'
	| 'paddingY'
	| 'borderRadius'
	| 'textShadowOffsetX'
	| 'textShadowOffsetY'
	| 'textShadowBlur'
	| 'strokeWidth';

/** Property that can be animated with per-item keyframes. */
export type KeyframeProperty = BuiltInKeyframeProperty | EffectKeyframeProperty;

/**
 * Parallel frame/value arrays for one animated property. Frames ascend and
 * are relative to the item's start (`from`), so tracks survive item moves.
 */
export interface KeyframeTrack {
	frames: number[];
	values: number[];
	/** Stable IDs and outgoing segment easing. Missing arrays mean legacy linear tracks. */
	ids?: string[];
	easings?: EasingType[];
	easingConfigs?: Array<EasingConfig | null>;
}

/** Per-property keyframe tracks stored on a timeline item. */
export type ItemKeyframes = Partial<Record<KeyframeProperty, KeyframeTrack>>;

/** Two-dimensional value used by coupled transform animation. */
export interface Vector2 {
	x: number;
	y: number;
}

/** Spatial Bezier handles stored as offsets from their keyframe value. */
export interface SpatialBezierTangents {
	inTangent: Vector2;
	outTangent: Vector2;
	/** Keep the handles opposite and collinear while either handle moves. */
	continuous?: boolean;
}

/** A coupled vector keyframe with temporal and spatial interpolation. */
export interface VectorKeyframe {
	id: string;
	frame: number;
	value: Vector2;
	easing: EasingType;
	easingConfig?: EasingConfig;
	spatial?: SpatialBezierTangents;
}

export type VectorKeyframeProperty = 'position';
export type ItemVectorKeyframes = Partial<Record<VectorKeyframeProperty, VectorKeyframe[]>>;

/** One scalar key stored inside a portable saved animation recipe. */
export interface AnimationPresetKeyframe {
	id: string;
	frame: number;
	value: number;
	easing: EasingType;
	easingConfig?: EasingConfig;
}

export interface AnimationPresetProperty {
	property: KeyframeProperty;
	keyframes: AnimationPresetKeyframe[];
}

export interface AnimationPresetVectorProperty {
	property: VectorKeyframeProperty;
	keyframes: VectorKeyframe[];
}

/** Project-scoped animation recipe captured from one compatible clip type. */
export interface AnimationPreset {
	id: string;
	name: string;
	sourceItemType: TimelineItemKind;
	properties: AnimationPresetProperty[];
	vectorProperties?: AnimationPresetVectorProperty[];
	effects: import('../effects/types').ItemEffect[];
	motionModifiers?: MotionModifier[];
	textMotion?: TextMotionSpec;
	sourceDurationInFrames: number;
	createdAt: number;
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
	textShadow?: {
		blur: number;
		color: string;
		offsetX: number;
		offsetY: number;
	};
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
	words?: SubtitleWord[];
}

export interface SubtitleWord {
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
	/** Reusable nested timeline referenced by composition and companion audio items. */
	compositionId?: string;
	compositionWidth?: number;
	compositionHeight?: number;

	// Source boundaries for media items (frames at the source's frame rate)
	sourceStart?: number;
	sourceEnd?: number;
	sourceDuration?: number;
	sourceFps?: number;
	speed?: number;
	/** Play the selected source window from its exclusive end back to its start. */
	isReversed?: boolean;

	// Lottie playback
	lottieTotalFrames?: number;
	lottieFrameRate?: number;
	lottieLoop?: boolean;
	lottieReversed?: boolean;
	lottieLoopMode?: 'loop' | 'pingpong';
	lottieSegmentStart?: number;
	lottieSegmentEnd?: number;
	/** Project-frame phase carried by a split clip so its animation does not restart. */
	lottiePhaseOffset?: number;
	lottieMarkers?: Array<{ name: string; start: number; duration: number }>;
	lottieAnimationId?: string;
	lottieThemeId?: string;
	lottieTextOverrides?: Record<string, string>;
	lottieColorOverrides?: Record<string, string>;
	lottieSlotOverrides?: Record<string, number | [number, number]>;

	// Text items
	text?: string;

	// Shape items
	shapeType?: ShapeType;
	fillColor?: string;
	fillEnabled?: boolean;
	fillType?: 'solid' | 'linear';
	gradientStartColor?: string;
	gradientEndColor?: string;
	gradientAngle?: number;
	strokeEnabled?: boolean;
	strokeColor?: string;
	strokeWidth?: number;
	strokeLineCap?: 'butt' | 'round' | 'square';
	strokeLineJoin?: 'miter' | 'round' | 'bevel';
	strokeMiterLimit?: number;
	shapeCornerRadius?: number;
	shapeDirection?: 'up' | 'down' | 'left' | 'right';
	shapePoints?: number;
	shapeInnerRadius?: number;
	pathVertices?: ShapePathVertex[];
	pathClosed?: boolean;
	isMask?: boolean;
	maskType?: 'clip' | 'alpha';
	maskFeather?: number;
	maskOpacity?: number;
	maskInvert?: boolean;

	// Subtitle items own the full cue list and render the active cue per frame
	captionSource?: CaptionSource;
	cues?: SubtitleCue[];
	subtitleStyleScale?: number;

	// Source dimensions (video/image)
	sourceWidth?: number;
	sourceHeight?: number;

	transform?: ItemTransform;
	crop?: CropSettings;
	cornerPin?: TimelineItemCornerPin;

	// Audio properties
	volume?: number;
	audioFadeIn?: number;
	audioFadeOut?: number;

	// Video properties
	fadeIn?: number;
	fadeOut?: number;

	// Animated properties (keyframes override the static values above)
	keyframes?: ItemKeyframes;
	/**
	 * Coupled transform animation. Kept beside the scalar map so legacy
	 * projects remain valid and scalar-property code cannot mistake metadata
	 * for a numeric track.
	 */
	vectorKeyframes?: ItemVectorKeyframes;
	animationVersion?: 2;
	separatedVectorProperties?: VectorKeyframeProperty[];
	/** Small deterministic live-motion records evaluated during preview and export. */
	motionModifiers?: MotionModifier[];
	/** Independent per-unit text animation slots evaluated in preview and export. */
	textMotion?: TextMotionSpec;

	// Clip effects (CSS-filter-semantics color/blur stack; see effects/types.ts)
	effects?: import('$lib/video-editor/effects/types').ItemEffect[];

	// Per-clip compositing blend mode for the GPU pipeline (25 modes; see
	// effects/gpu/blend-modes.ts). Absent/'normal' keeps opacity-only blending.
	blendMode?: import('$lib/video-editor/effects/gpu/blend-modes').BlendMode;
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

export type TransitionPropertyValue = number | [number, number, number];

export interface TimelineTransition {
	id: string;
	/** Legacy display type. New projects use `presentation` for the renderer. */
	type: 'crossfade' | 'fade-black';
	presentation?: TransitionPresentation;
	timing?: TransitionTiming;
	direction?: TransitionDirection;
	bezierPoints?: TransitionBezierPoints;
	properties?: Record<string, TransitionPropertyValue>;
	durationInFrames: number;
	/** 0 starts at the cut, 0.5 centers on it, and 1 ends at the cut. */
	alignment?: number;
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
	/** Ordered reusable timelines promoted to tabs. Main stays implicit. */
	topLevelSequenceIds?: string[];
	/** Reusable nested timelines. The same entry can be a tab and a nested clip. */
	compositions?: SubComposition[];
}

export interface SubComposition {
	id: string;
	name: string;
	editorKind?: 'sequence';
	items: TimelineItem[];
	tracks: TimelineTrack[];
	transitions: TimelineTransition[];
	fps: number;
	width: number;
	height: number;
	durationInFrames: number;
	backgroundColor?: string;
	markers?: TimelineMarker[];
	inPoint?: number | null;
	outPoint?: number | null;
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
	/** Saved animation recipes that travel with this project document. */
	animationPresets?: AnimationPreset[];
	/**
	 * Root folder handle for the project's media files. Non-serializable —
	 * stripped on save and re-attached from the handles registry on load.
	 */
	rootFolderHandle?: FileSystemDirectoryHandle;
	rootFolderName?: string;
}
