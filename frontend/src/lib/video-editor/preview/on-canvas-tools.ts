/** Pure geometry for crop, anchor, and position-path editing in the preview. */
import type {
	CropSettings,
	ItemKeyframes,
	ItemTransform,
	KeyframeProperty,
	TimelineItem
} from '$lib/video-editor/project/types';
import { applyEasing, applyEasingConfig } from '$lib/video-editor/timeline/easing';

export type CropEdge = 'left' | 'right' | 'top' | 'bottom';

export const CROP_EDGE_PROPERTY = {
	left: 'cropLeft',
	right: 'cropRight',
	top: 'cropTop',
	bottom: 'cropBottom'
} satisfies Record<CropEdge, KeyframeProperty>;

export interface Point {
	x: number;
	y: number;
}

export interface MotionPathPoint extends Point {
	frame: number;
	isKeyframe: boolean;
}

const MIN_VISIBLE_RATIO = 0.001;

export function resolveCrop(crop: CropSettings | undefined): CropSettings {
	return {
		top: crop?.top ?? 0,
		right: crop?.right ?? 0,
		bottom: crop?.bottom ?? 0,
		left: crop?.left ?? 0,
		...(crop?.softness !== undefined && { softness: crop.softness })
	};
}

/**
 * Resolve a crop drag in item-local coordinates. Crop is stored as a source
 * ratio, while pointer positions arrive in canvas pixels.
 */
export function calculateCropFromDrag({
	edge,
	startCrop,
	startPoint,
	currentPoint,
	rotation,
	mediaWidth,
	mediaHeight,
	sourceDimension
}: {
	edge: CropEdge;
	startCrop: CropSettings | undefined;
	startPoint: Point;
	currentPoint: Point;
	rotation: number;
	mediaWidth: number;
	mediaHeight: number;
	sourceDimension: number;
}): CropSettings {
	const crop = resolveCrop(startCrop);
	const radians = (rotation * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const worldDeltaX = currentPoint.x - startPoint.x;
	const worldDeltaY = currentPoint.y - startPoint.y;
	const localDeltaX = worldDeltaX * cos + worldDeltaY * sin;
	const localDeltaY = -worldDeltaX * sin + worldDeltaY * cos;
	const horizontal = edge === 'left' || edge === 'right';
	const dimension = horizontal ? mediaWidth : mediaHeight;
	if (dimension <= 0 || sourceDimension <= 0 || !Number.isFinite(dimension)) return crop;

	const opposite =
		edge === 'left'
			? crop.right
			: edge === 'right'
				? crop.left
				: edge === 'top'
					? crop.bottom
					: crop.top;
	const signedDelta =
		edge === 'left'
			? localDeltaX
			: edge === 'right'
				? -localDeltaX
				: edge === 'top'
					? localDeltaY
					: -localDeltaY;
	const startInset = crop[edge] * dimension;
	const maxInset = Math.max(0, (1 - opposite - MIN_VISIBLE_RATIO) * dimension);
	const nextInset = Math.min(maxInset, Math.max(0, startInset + signedDelta));
	const requestedSourcePixels = Math.round((nextInset / dimension) * sourceDimension);
	const maxSourcePixels = Math.max(0, Math.floor((1 - opposite) * sourceDimension) - 1);
	const nextSourcePixels = Math.min(maxSourcePixels, Math.max(0, requestedSourcePixels));
	return { ...crop, [edge]: nextSourcePixels / sourceDimension };
}

function rotateVector(point: Point, angleDegrees: number): Point {
	const radians = (angleDegrees * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	return {
		x: point.x * cos - point.y * sin,
		y: point.x * sin + point.y * cos
	};
}

/** Move an anchor in local space while preserving the layer's visible pose. */
export function calculateAnchorDrag(
	startTransform: Required<Pick<ItemTransform, 'x' | 'y' | 'width' | 'height' | 'rotation'>> &
		ItemTransform,
	startPoint: Point,
	currentPoint: Point
): ItemTransform {
	const worldDelta = {
		x: currentPoint.x - startPoint.x,
		y: currentPoint.y - startPoint.y
	};
	const localDelta = rotateVector(worldDelta, -startTransform.rotation);
	return {
		...startTransform,
		x: startTransform.x + worldDelta.x - localDelta.x,
		y: startTransform.y + worldDelta.y - localDelta.y,
		anchorX: (startTransform.anchorX ?? startTransform.width / 2) + localDelta.x,
		anchorY: (startTransform.anchorY ?? startTransform.height / 2) + localDelta.y
	};
}

export function positionKeyframeFrames(item: TimelineItem): number[] {
	const frames = new Set<number>();
	for (const property of ['x', 'y'] as const) {
		for (const frame of item.keyframes?.[property]?.frames ?? []) {
			if (frame >= 0 && frame < item.durationInFrames) frames.add(item.from + frame);
		}
	}
	return [...frames].sort((left, right) => left - right);
}

function evenFrames(start: number, end: number, maxSamples: number): number[] {
	const span = end - start;
	if (span <= 0) return [start];
	const count = Math.max(2, Math.min(maxSamples, span + 1));
	return Array.from({ length: count }, (_, index) =>
		Math.round(start + (span * index) / (count - 1))
	);
}

function trackValueAt(item: TimelineItem, property: 'x' | 'y', absoluteFrame: number): number {
	const track = item.keyframes?.[property];
	if (!track || track.frames.length === 0) return item.transform?.[property] ?? 0;
	const frame = absoluteFrame - item.from;
	if (frame <= (track.frames[0] ?? 0)) return track.values[0] ?? 0;
	const last = track.frames.length - 1;
	if (frame >= (track.frames[last] ?? 0)) return track.values[last] ?? 0;
	for (let index = 1; index <= last; index += 1) {
		const nextFrame = track.frames[index] ?? 0;
		if (frame > nextFrame) continue;
		const previousFrame = track.frames[index - 1] ?? 0;
		const progress = (frame - previousFrame) / Math.max(1, nextFrame - previousFrame);
		const config = track.easingConfigs?.[index - 1] ?? undefined;
		const eased = config
			? applyEasingConfig(progress, config)
			: applyEasing(progress, track.easings?.[index - 1] ?? 'linear');
		const start = track.values[index - 1] ?? 0;
		const end = track.values[index] ?? start;
		return start + eased * (end - start);
	}
	return track.values[last] ?? 0;
}

function upsertPreviewPosition(
	item: TimelineItem,
	preview: { frame: number; x: number; y: number } | undefined
): TimelineItem {
	if (!preview) return item;
	const relativeFrame = preview.frame - item.from;
	const keyframes: ItemKeyframes = { ...item.keyframes };
	const positionFrames = [
		...new Set([...(item.keyframes?.x?.frames ?? []), ...(item.keyframes?.y?.frames ?? [])])
	].sort((left, right) => left - right);
	const template = item.keyframes?.x ?? item.keyframes?.y;
	for (const property of ['x', 'y'] as const) {
		const source = item.keyframes?.[property] ?? {
			frames: positionFrames,
			values: positionFrames.map(() => item.transform?.[property] ?? 0),
			...(template?.easings && {
				easings: positionFrames.map((frame) => {
					const index = template.frames.indexOf(frame);
					return index >= 0 ? (template.easings?.[index] ?? 'linear') : 'linear';
				})
			}),
			...(template?.easingConfigs && {
				easingConfigs: positionFrames.map((frame) => {
					const index = template.frames.indexOf(frame);
					return index >= 0 ? (template.easingConfigs?.[index] ?? null) : null;
				})
			})
		};
		const value = preview[property];
		const index = source.frames.indexOf(relativeFrame);
		if (index >= 0) {
			const values = [...source.values];
			values[index] = value;
			keyframes[property] = { ...source, values };
		} else {
			const entries = [
				...source.frames.map((frame, entryIndex) => ({
					frame,
					value: source.values[entryIndex] ?? 0,
					id: source.ids?.[entryIndex],
					easing: source.easings?.[entryIndex],
					config: source.easingConfigs?.[entryIndex]
				})),
				{
					frame: relativeFrame,
					value,
					id: undefined,
					easing: undefined,
					config: undefined
				}
			].sort((left, right) => left.frame - right.frame);
			keyframes[property] = {
				frames: entries.map((entry) => entry.frame),
				values: entries.map((entry) => entry.value),
				...(source.ids && { ids: entries.map((entry) => entry.id ?? crypto.randomUUID()) }),
				...(source.easings && { easings: entries.map((entry) => entry.easing ?? 'linear') }),
				...(source.easingConfigs && {
					easingConfigs: entries.map((entry) => entry.config ?? null)
				})
			};
		}
	}
	return { ...item, keyframes };
}

/** Build a bounded sampled position path plus every editable X/Y keyframe. */
export function buildMotionPathPoints({
	item,
	canvasWidth,
	canvasHeight,
	maxSamples = 36,
	preview
}: {
	item: TimelineItem;
	canvasWidth: number;
	canvasHeight: number;
	maxSamples?: number;
	preview?: { frame: number; x: number; y: number };
}): MotionPathPoint[] {
	const keyframes = positionKeyframeFrames(item);
	if (keyframes.length === 0) return [];
	const end = item.from + Math.max(0, item.durationInFrames - 1);
	if (end <= item.from) return [];
	const previewed = upsertPreviewPosition(item, preview);
	const frames = new Set([...evenFrames(item.from, end, maxSamples), ...keyframes]);
	if (preview) frames.add(preview.frame);
	const keyframeSet = new Set(keyframes);
	const points = [...frames]
		.sort((left, right) => left - right)
		.map((frame) => {
			return {
				frame,
				x: canvasWidth / 2 + trackValueAt(previewed, 'x', frame),
				y: canvasHeight / 2 + trackValueAt(previewed, 'y', frame),
				isKeyframe: keyframeSet.has(frame) || preview?.frame === frame
			};
		});
	const first = points[0];
	if (!first) return [];
	return points.some(
		(point) => Math.abs(point.x - first.x) > 0.5 || Math.abs(point.y - first.y) > 0.5
	)
		? points
		: [];
}
