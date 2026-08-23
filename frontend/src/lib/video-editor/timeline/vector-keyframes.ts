/** Coupled vector-keyframe promotion and interpolation. */
import type {
	EasingConfig,
	EasingType,
	ItemKeyframes,
	ItemVectorKeyframes,
	KeyframeTrack,
	SpatialBezierTangents,
	TimelineItem,
	Vector2,
	VectorKeyframe
} from '$lib/video-editor/project/types';
import { applyEasing, applyEasingConfig } from './easing';

export interface PositionPromotion {
	position: VectorKeyframe[];
	keyframes: ItemKeyframes | undefined;
	identityRemap: ReadonlyMap<string, string>;
}

export function activePositionKeyframes(item: TimelineItem): readonly VectorKeyframe[] | undefined {
	if (item.separatedVectorProperties?.includes('position')) return undefined;
	const position = item.vectorKeyframes?.position;
	return position && position.length > 0 ? position : undefined;
}

export function positionKeyframeByFrame(
	item: TimelineItem,
	relativeFrame: number
): VectorKeyframe | undefined {
	return activePositionKeyframes(item)?.find((keyframe) => keyframe.frame === relativeFrame);
}

/**
 * Promote legacy scalar X/Y tracks to one position lane. The union of both
 * frame sets preserves every keyed value. X owns temporal easing when both
 * axes have different outgoing easing, matching FreeCut's promotion rule.
 */
export function promotePositionKeyframes(
	item: TimelineItem,
	includeFrame?: number
): PositionPromotion | null {
	const active = activePositionKeyframes(item);
	if (active) {
		return {
			position: active.map(cloneVectorKeyframe),
			keyframes: withoutPositionScalarTracks(item.keyframes),
			identityRemap: new Map()
		};
	}
	const xTrack = item.keyframes?.x;
	const yTrack = item.keyframes?.y;
	const frames = new Set<number>([...(xTrack?.frames ?? []), ...(yTrack?.frames ?? [])]);
	if (includeFrame !== undefined) frames.add(includeFrame);
	if (frames.size === 0) return null;
	const xFallback = item.transform?.x ?? 0;
	const yFallback = item.transform?.y ?? 0;
	const identityRemap = new Map<string, string>();
	const position = [...frames]
		.filter((frame) => Number.isInteger(frame) && frame >= 0 && frame < item.durationInFrames)
		.toSorted((left, right) => left - right)
		.map((frame) => {
			const style = segmentStyleAt(xTrack, frame) ?? segmentStyleAt(yTrack, frame);
			const xIndex = xTrack?.frames.indexOf(frame) ?? -1;
			const yIndex = yTrack?.frames.indexOf(frame) ?? -1;
			const id =
				(xIndex >= 0 ? xTrack?.ids?.[xIndex] : undefined) ??
				(yIndex >= 0 ? yTrack?.ids?.[yIndex] : undefined) ??
				crypto.randomUUID();
			if (xIndex >= 0) {
				identityRemap.set(xTrack?.ids?.[xIndex] ?? `legacy:x:${frame}:${xIndex}`, id);
			}
			if (yIndex >= 0) {
				identityRemap.set(yTrack?.ids?.[yIndex] ?? `legacy:y:${frame}:${yIndex}`, `${id}:y`);
			}
			return {
				id,
				frame,
				value: {
					x: interpolateScalarTrack(xTrack, frame, xFallback),
					y: interpolateScalarTrack(yTrack, frame, yFallback)
				},
				easing: style?.easing ?? 'linear',
				...(style?.easingConfig && { easingConfig: cloneEasingConfig(style.easingConfig) })
			};
		});
	return position.length > 0
		? { position, keyframes: withoutPositionScalarTracks(item.keyframes), identityRemap }
		: null;
}

export function interpolatePosition(
	keyframes: readonly VectorKeyframe[],
	frame: number
): Vector2 | null {
	if (keyframes.length === 0) return null;
	if (keyframes.length === 1 || frame <= (keyframes[0]?.frame ?? 0)) {
		return cloneVector(keyframes[0]?.value ?? { x: 0, y: 0 });
	}
	const last = keyframes.length - 1;
	if (frame >= (keyframes[last]?.frame ?? 0)) {
		return cloneVector(keyframes[last]?.value ?? { x: 0, y: 0 });
	}
	for (let index = 1; index <= last; index += 1) {
		const end = keyframes[index];
		const start = keyframes[index - 1];
		if (!start || !end || frame > end.frame) continue;
		const progress = (frame - start.frame) / Math.max(1, end.frame - start.frame);
		const eased = start.easingConfig
			? applyEasingConfig(progress, start.easingConfig)
			: applyEasing(progress, start.easing);
		return interpolatePositionSegment(start, end, eased);
	}
	return cloneVector(keyframes[last]?.value ?? { x: 0, y: 0 });
}

export function interpolatePositionSegment(
	start: Pick<VectorKeyframe, 'value' | 'spatial'>,
	end: Pick<VectorKeyframe, 'value' | 'spatial'>,
	progress: number
): Vector2 {
	const t = Number.isFinite(progress) ? progress : 0;
	const out = start.spatial?.outTangent;
	const incoming = end.spatial?.inTangent;
	if (!out && !incoming) {
		return {
			x: start.value.x + t * (end.value.x - start.value.x),
			y: start.value.y + t * (end.value.y - start.value.y)
		};
	}
	const control1 = add(start.value, out ?? { x: 0, y: 0 });
	const control2 = add(end.value, incoming ?? { x: 0, y: 0 });
	return cubicBezier(start.value, control1, control2, end.value, t);
}

/** Build FreeCut-style smooth default handles for one position keyframe. */
export function defaultSpatialTangents(
	keyframes: readonly VectorKeyframe[],
	index: number
): SpatialBezierTangents | null {
	const current = keyframes[index];
	if (!current || keyframes.length < 2) return null;
	const previous = keyframes[index - 1];
	const next = keyframes[index + 1];
	let outTangent: Vector2;
	if (!previous && next) {
		outTangent = scale(subtract(next.value, current.value), 1 / 3);
	} else if (previous && !next) {
		outTangent = scale(subtract(current.value, previous.value), 1 / 3);
	} else if (previous && next) {
		outTangent = scale(subtract(next.value, previous.value), 1 / 6);
	} else {
		return null;
	}
	return {
		inTangent: scale(outTangent, -1),
		outTangent,
		continuous: true
	};
}

export function withSpatialTangent(
	spatial: SpatialBezierTangents,
	handle: 'in' | 'out',
	tangent: Vector2
): SpatialBezierTangents {
	if (!spatial.continuous) {
		return {
			...spatial,
			[handle === 'in' ? 'inTangent' : 'outTangent']: cloneVector(tangent)
		};
	}
	return handle === 'in'
		? { ...spatial, inTangent: cloneVector(tangent), outTangent: scale(tangent, -1) }
		: { ...spatial, outTangent: cloneVector(tangent), inTangent: scale(tangent, -1) };
}

export function upsertPositionKeyframe(
	keyframes: readonly VectorKeyframe[],
	frame: number,
	value: Vector2
): VectorKeyframe[] {
	const next = keyframes.map(cloneVectorKeyframe);
	const index = next.findIndex((keyframe) => keyframe.frame === frame);
	if (index >= 0) {
		const current = next[index];
		if (current) next[index] = { ...current, value: cloneVector(value) };
		return next;
	}
	next.push({ id: crypto.randomUUID(), frame, value: cloneVector(value), easing: 'linear' });
	return next.toSorted((left, right) => left.frame - right.frame);
}

export function vectorKeyframesPatch(
	item: TimelineItem,
	position: readonly VectorKeyframe[]
): Pick<
	TimelineItem,
	'keyframes' | 'vectorKeyframes' | 'animationVersion' | 'separatedVectorProperties'
> {
	const vectorKeyframes: ItemVectorKeyframes = {
		...item.vectorKeyframes,
		position: position.map(cloneVectorKeyframe)
	};
	return {
		keyframes: withoutPositionScalarTracks(item.keyframes),
		vectorKeyframes,
		animationVersion: 2,
		separatedVectorProperties: item.separatedVectorProperties?.filter(
			(property) => property !== 'position'
		)
	};
}

export function scaleItemVectorKeyframes(
	vectorKeyframes: ItemVectorKeyframes | undefined,
	oldDuration: number,
	newDuration: number
): ItemVectorKeyframes | undefined {
	if (!vectorKeyframes || oldDuration <= 0 || newDuration <= 0 || oldDuration === newDuration)
		return vectorKeyframes;
	const scaleFactor = newDuration / oldDuration;
	const maxFrame = newDuration - 1;
	const position = vectorKeyframes.position;
	if (!position) return vectorKeyframes;
	const byFrame = new Map<number, VectorKeyframe>();
	for (const keyframe of position) {
		const frame = Math.max(0, Math.min(maxFrame, Math.round(keyframe.frame * scaleFactor)));
		byFrame.set(frame, { ...cloneVectorKeyframe(keyframe), frame });
	}
	return {
		...vectorKeyframes,
		position: [...byFrame.values()].toSorted((left, right) => left.frame - right.frame)
	};
}

export function cloneVectorKeyframe(keyframe: VectorKeyframe): VectorKeyframe {
	return {
		...keyframe,
		value: cloneVector(keyframe.value),
		...(keyframe.easingConfig && { easingConfig: cloneEasingConfig(keyframe.easingConfig) }),
		...(keyframe.spatial && {
			spatial: {
				...keyframe.spatial,
				inTangent: cloneVector(keyframe.spatial.inTangent),
				outTangent: cloneVector(keyframe.spatial.outTangent)
			}
		})
	};
}

function withoutPositionScalarTracks(
	keyframes: ItemKeyframes | undefined
): ItemKeyframes | undefined {
	if (!keyframes?.x && !keyframes?.y) return keyframes;
	const next = { ...keyframes };
	delete next.x;
	delete next.y;
	return Object.keys(next).length > 0 ? next : undefined;
}

function interpolateScalarTrack(
	track: KeyframeTrack | undefined,
	frame: number,
	fallback: number
): number {
	if (!track || track.frames.length === 0) return fallback;
	if (track.frames.length === 1 || frame <= (track.frames[0] ?? 0)) {
		return track.values[0] ?? fallback;
	}
	const last = track.frames.length - 1;
	if (frame >= (track.frames[last] ?? 0)) return track.values[last] ?? fallback;
	for (let index = 1; index <= last; index += 1) {
		const endFrame = track.frames[index] ?? 0;
		if (frame > endFrame) continue;
		const startFrame = track.frames[index - 1] ?? 0;
		const progress = (frame - startFrame) / Math.max(1, endFrame - startFrame);
		const config = track.easingConfigs?.[index - 1] ?? undefined;
		const eased = config
			? applyEasingConfig(progress, config)
			: applyEasing(progress, track.easings?.[index - 1] ?? 'linear');
		const start = track.values[index - 1] ?? fallback;
		const end = track.values[index] ?? start;
		return start + eased * (end - start);
	}
	return track.values[last] ?? fallback;
}

function segmentStyleAt(
	track: KeyframeTrack | undefined,
	frame: number
): { easing: EasingType; easingConfig?: EasingConfig } | null {
	if (!track || track.frames.length === 0) return null;
	let index = 0;
	for (let candidate = 0; candidate < track.frames.length; candidate += 1) {
		if ((track.frames[candidate] ?? 0) > frame) break;
		index = candidate;
	}
	const easing = track.easings?.[index] ?? 'linear';
	const easingConfig = track.easingConfigs?.[index] ?? undefined;
	return { easing, ...(easingConfig && { easingConfig }) };
}

function cubicBezier(p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2, t: number): Vector2 {
	const inverse = 1 - t;
	const a = inverse * inverse * inverse;
	const b = 3 * inverse * inverse * t;
	const c = 3 * inverse * t * t;
	const d = t * t * t;
	return {
		x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
		y: a * p0.y + b * p1.y + c * p2.y + d * p3.y
	};
}

function add(left: Vector2, right: Vector2): Vector2 {
	return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Vector2, right: Vector2): Vector2 {
	return { x: left.x - right.x, y: left.y - right.y };
}

function scale(value: Vector2, factor: number): Vector2 {
	const x = value.x * factor;
	const y = value.y * factor;
	return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

function cloneVector(value: Vector2): Vector2 {
	return { x: value.x, y: value.y };
}

function cloneEasingConfig(config: EasingConfig): EasingConfig {
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}
