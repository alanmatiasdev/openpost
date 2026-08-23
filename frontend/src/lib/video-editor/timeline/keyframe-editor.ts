/** Framework-free value-graph math ported from FreeCut (MIT). */

import type {
	EasingConfig,
	EasingType,
	KeyframeProperty,
	KeyframeTrack,
	TimelineItem
} from '$lib/video-editor/project/types';
import { applyEasingConfig } from './easing';

export interface KeyframeRef {
	property: KeyframeProperty;
	frame: number;
	id?: string;
	index?: number;
}

export interface EditorKeyframe extends KeyframeRef {
	index: number;
	value: number;
	easing: EasingType;
	easingConfig?: EasingConfig;
}

export interface GraphViewport {
	width: number;
	height: number;
	startFrame: number;
	endFrame: number;
	minValue: number;
	maxValue: number;
}

export interface GraphPadding {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface PropertyValueRange {
	min: number;
	max: number;
	unit: string;
	decimals: number;
}

export interface GraphValueRange {
	min: number;
	max: number;
}

export interface GraphCoordinate {
	x: number;
	y: number;
}

export interface GraphDataCoordinate {
	frame: number;
	value: number;
}

export const GRAPH_PADDING: GraphPadding = { top: 18, right: 12, bottom: 28, left: 44 };

export const PROPERTY_VALUE_RANGES = {
	x: { min: -1000, max: 2000, unit: 'px', decimals: 0 },
	y: { min: -1000, max: 2000, unit: 'px', decimals: 0 },
	width: { min: 0, max: 2000, unit: 'px', decimals: 0 },
	height: { min: 0, max: 2000, unit: 'px', decimals: 0 },
	anchorX: { min: -1000, max: 2000, unit: 'px', decimals: 0 },
	anchorY: { min: -1000, max: 2000, unit: 'px', decimals: 0 },
	rotation: { min: -360, max: 360, unit: '°', decimals: 1 },
	opacity: { min: 0, max: 1, unit: '', decimals: 2 },
	cornerRadius: { min: 0, max: 1000, unit: 'px', decimals: 0 },
	cropLeft: { min: 0, max: 4000, unit: 'px', decimals: 0 },
	cropRight: { min: 0, max: 4000, unit: 'px', decimals: 0 },
	cropTop: { min: 0, max: 4000, unit: 'px', decimals: 0 },
	cropBottom: { min: 0, max: 4000, unit: 'px', decimals: 0 },
	cropSoftness: { min: -2000, max: 2000, unit: 'px', decimals: 0 },
	volume: { min: 0, max: 1, unit: '', decimals: 2 },
	fontSize: { min: 8, max: 500, unit: 'px', decimals: 0 },
	fontWeight: { min: 100, max: 900, unit: '', decimals: 0 },
	lineHeight: { min: 0.5, max: 3, unit: 'x', decimals: 2 },
	letterSpacing: { min: -20, max: 100, unit: 'px', decimals: 1 },
	paddingX: { min: 0, max: 160, unit: 'px', decimals: 0 },
	paddingY: { min: 0, max: 160, unit: 'px', decimals: 0 },
	borderRadius: { min: 0, max: 200, unit: 'px', decimals: 0 },
	textShadowOffsetX: { min: -100, max: 100, unit: 'px', decimals: 0 },
	textShadowOffsetY: { min: -100, max: 100, unit: 'px', decimals: 0 },
	textShadowBlur: { min: 0, max: 160, unit: 'px', decimals: 0 },
	strokeWidth: { min: 0, max: 24, unit: 'px', decimals: 0 }
} satisfies Record<KeyframeProperty, PropertyValueRange>;

export function editorKeyframes(item: TimelineItem, property: KeyframeProperty): EditorKeyframe[] {
	const track = item.keyframes?.[property];
	if (!track) return [];
	return track.frames.map((frame, index) => ({
		property,
		frame,
		id: track.ids?.[index],
		index,
		value: track.values[index] ?? 0,
		easing: track.easings?.[index] ?? 'linear',
		easingConfig: track.easingConfigs?.[index] ?? undefined
	}));
}

export function keyframeIdentity(keyframe: KeyframeRef): string {
	return keyframe.id ?? `${keyframe.property}:${keyframe.frame}:${keyframe.index ?? ''}`;
}

const MIN_VALUE_RANGE = 0.0001;

export function graphValueRange(
	property: KeyframeProperty,
	keyframes: readonly Pick<EditorKeyframe, 'value'>[],
	autoFit = true
): GraphValueRange {
	const bounds = PROPERTY_VALUE_RANGES[property];
	if (!autoFit || keyframes.length === 0) return { min: bounds.min, max: bounds.max };
	let minimum = Number.POSITIVE_INFINITY;
	let maximum = Number.NEGATIVE_INFINITY;
	for (const keyframe of keyframes) {
		minimum = Math.min(minimum, keyframe.value);
		maximum = Math.max(maximum, keyframe.value);
	}
	const fallbackSpan = Math.max(MIN_VALUE_RANGE, bounds.max - bounds.min);
	const spread = Math.max(0, maximum - minimum);
	const padding =
		spread > MIN_VALUE_RANGE
			? Math.max(spread * 0.12, fallbackSpan * 0.01)
			: Math.max(fallbackSpan * 0.05, MIN_VALUE_RANGE);
	let min = Math.max(bounds.min, minimum - padding);
	let max = Math.min(bounds.max, maximum + padding);
	if (max - min < MIN_VALUE_RANGE) {
		const center = (minimum + maximum) / 2;
		const half = Math.max(fallbackSpan * 0.02, MIN_VALUE_RANGE / 2);
		min = Math.max(bounds.min, center - half);
		max = Math.min(bounds.max, center + half);
		if (min === bounds.min) max = Math.min(bounds.max, min + half * 2);
		if (max === bounds.max) min = Math.max(bounds.min, max - half * 2);
	}
	return { min, max: Math.max(min + MIN_VALUE_RANGE, max) };
}

export function graphDimensions(viewport: GraphViewport, padding = GRAPH_PADDING) {
	return {
		left: padding.left,
		top: padding.top,
		width: Math.max(1, viewport.width - padding.left - padding.right),
		height: Math.max(1, viewport.height - padding.top - padding.bottom),
		frameRange: Math.max(1, viewport.endFrame - viewport.startFrame),
		valueRange: Math.max(MIN_VALUE_RANGE, viewport.maxValue - viewport.minValue)
	};
}

export function graphPoint(
	frame: number,
	value: number,
	viewport: GraphViewport,
	padding = GRAPH_PADDING
): GraphCoordinate {
	const dimensions = graphDimensions(viewport, padding);
	return {
		x: dimensions.left + ((frame - viewport.startFrame) / dimensions.frameRange) * dimensions.width,
		y: dimensions.top + ((viewport.maxValue - value) / dimensions.valueRange) * dimensions.height
	};
}

export function graphCoordinates(
	x: number,
	y: number,
	viewport: GraphViewport,
	padding = GRAPH_PADDING
): GraphDataCoordinate {
	const dimensions = graphDimensions(viewport, padding);
	return {
		frame: viewport.startFrame + ((x - dimensions.left) / dimensions.width) * dimensions.frameRange,
		value: viewport.maxValue - ((y - dimensions.top) / dimensions.height) * dimensions.valueRange
	};
}

export function curvePath(
	start: EditorKeyframe,
	end: EditorKeyframe,
	viewport: GraphViewport,
	samples = 50
): string {
	const first = graphPoint(start.frame, start.value, viewport);
	const last = graphPoint(end.frame, end.value, viewport);
	const config = start.easingConfig ?? { type: start.easing };
	const points: string[] = [];
	for (let index = 0; index <= samples; index++) {
		const progress = index / samples;
		const eased = applyEasingConfig(progress, config);
		const x = first.x + progress * (last.x - first.x);
		const y = first.y + eased * (last.y - first.y);
		points.push(`${index === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`);
	}
	return points.join(' ');
}

export type MarqueeMode = 'replace' | 'add' | 'toggle';

export function marqueeSelection(
	mode: MarqueeMode,
	base: ReadonlySet<string>,
	hits: Iterable<string>
): Set<string> {
	const result = mode === 'replace' ? new Set<string>() : new Set(base);
	for (const id of hits) {
		if (mode === 'toggle' && result.has(id)) result.delete(id);
		else result.add(id);
	}
	return result;
}

export function trackEntryAt(track: KeyframeTrack, ref: KeyframeRef): number {
	if (ref.id) {
		const byId = track.ids?.indexOf(ref.id) ?? -1;
		if (byId >= 0) return byId;
	}
	if (ref.index !== undefined && track.frames[ref.index] === ref.frame) return ref.index;
	return track.frames.indexOf(ref.frame);
}
