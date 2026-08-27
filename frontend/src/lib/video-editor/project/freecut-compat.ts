import { mixerDbToGain } from '../audio/mixer-utils';
import type {
	EasingConfig,
	EasingType,
	ItemKeyframes,
	ItemVectorKeyframes,
	KeyframeProperty,
	KeyframeTrack,
	Project,
	ProjectTimeline,
	SubComposition,
	TimelineItem,
	TimelineTrack,
	TimelineTransition,
	VectorKeyframeProperty
} from './types';

export const FREECUT_SCHEMA_VERSION = 15;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as UnknownRecord)
		: undefined;
}

function records(value: unknown): UnknownRecord[] {
	return Array.isArray(value) ? value.map(record).filter((entry) => entry !== undefined) : [];
}

function finite(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function hasFreeCutTimelineShape(timeline: UnknownRecord): boolean {
	if ('masterBusDb' in timeline || Array.isArray(timeline.keyframes)) return true;
	for (const transition of records(timeline.transitions)) {
		if ('leftClipId' in transition || 'rightClipId' in transition) return true;
	}
	for (const item of records(timeline.items)) {
		if ('direction' in item || 'points' in item || 'innerRadius' in item) return true;
		for (const effect of records(item.effects)) {
			if (record(effect.effect)?.type === 'gpu-effect') return true;
		}
	}
	return false;
}

export function isFreeCutProjectDocument(project: Project): boolean {
	if (project.schemaFamily === 'openpost') return false;
	const version = finite(project.schemaVersion) ?? 1;
	if (version >= 5 && version <= FREECUT_SCHEMA_VERSION) return true;
	const timeline = record(project.timeline);
	return timeline ? hasFreeCutTimelineShape(timeline) : false;
}

function freeCutDbToGain(value: unknown): number | undefined {
	const db = finite(value);
	return db === undefined ? undefined : mixerDbToGain(db);
}

function convertTrack(value: UnknownRecord): TimelineTrack {
	const volume = freeCutDbToGain(value.volume);
	return {
		...value,
		...(volume !== undefined && { volume })
	} as unknown as TimelineTrack;
}

function convertEffect(value: UnknownRecord): UnknownRecord | null {
	if (value.type === 'gpu') return value;
	const nested = record(value.effect);
	if (nested?.type !== 'gpu-effect') return null;
	const effectId = stringValue(nested.gpuEffectType);
	if (!effectId) return null;
	return {
		id: value.id,
		enabled: value.enabled !== false,
		type: 'gpu',
		effectId,
		params: record(nested.params) ?? {}
	};
}

function convertSubtitleCue(value: UnknownRecord, fps: number): UnknownRecord | null {
	const id = stringValue(value.id);
	const text = stringValue(value.text);
	const startSeconds = finite(value.startSeconds);
	const endSeconds = finite(value.endSeconds);
	if (!id || text === undefined || startSeconds === undefined || endSeconds === undefined)
		return null;
	return {
		id,
		startFrame: Math.max(0, Math.round(startSeconds * fps)),
		endFrame: Math.max(1, Math.round(endSeconds * fps)),
		text
	};
}

function convertCaptionSource(
	value: unknown,
	fallbackClipId: string,
	fallbackMediaId?: string
): UnknownRecord | undefined {
	const source = record(value);
	const type = stringValue(source?.type);
	if (!source || !type) return undefined;
	const identity = {
		clipId: stringValue(source.clipId) ?? fallbackClipId,
		mediaId: stringValue(source.mediaId) ?? fallbackMediaId ?? ''
	};
	if (type === 'embedded-subtitles') {
		return {
			...source,
			type,
			...identity,
			language: stringValue(source.language) ?? 'und',
			codecId: stringValue(source.codecId) ?? ''
		};
	}
	return { ...source, type, ...identity };
}

function mapScalarProperty(property: string): string[] {
	if (property === 'textPadding') return ['paddingX', 'paddingY'];
	if (property === 'backgroundRadius') return ['borderRadius'];
	return [property];
}

function convertKeyframeTrack(property: string, value: UnknownRecord): KeyframeTrack {
	const keyframes = records(value.keyframes);
	const convertValue = property === 'volume' ? freeCutDbToGain : finite;
	return {
		frames: keyframes.map((keyframe) => finite(keyframe.frame) ?? 0),
		values: keyframes.map((keyframe) => convertValue(keyframe.value) ?? 0),
		ids: keyframes.map((keyframe, index) => stringValue(keyframe.id) ?? `${property}-${index}`),
		easings: keyframes.map((keyframe) => (stringValue(keyframe.easing) ?? 'linear') as EasingType),
		easingConfigs: keyframes.map(
			(keyframe) => (record(keyframe.easingConfig) as EasingConfig | undefined) ?? null
		)
	};
}

function convertItemAnimation(item: TimelineItem, value: UnknownRecord | undefined): TimelineItem {
	if (!value) return item;
	const scalar: ItemKeyframes = { ...(item.keyframes ?? {}) };
	for (const propertyGroup of records(value.properties)) {
		const property = stringValue(propertyGroup.property);
		if (!property) continue;
		for (const mappedProperty of mapScalarProperty(property)) {
			scalar[mappedProperty as KeyframeProperty] = convertKeyframeTrack(property, propertyGroup);
		}
	}

	const vectors: ItemVectorKeyframes = { ...(item.vectorKeyframes ?? {}) };
	for (const propertyGroup of records(value.vectorProperties)) {
		const property = stringValue(propertyGroup.property) as VectorKeyframeProperty | undefined;
		if (!property || !['position', 'scale', 'anchor'].includes(property)) continue;
		vectors[property] = records(propertyGroup.keyframes).map((keyframe, index) => ({
			...keyframe,
			id: stringValue(keyframe.id) ?? `${property}-${index}`,
			frame: finite(keyframe.frame) ?? 0,
			value: {
				x: finite(record(keyframe.value)?.x) ?? 0,
				y: finite(record(keyframe.value)?.y) ?? 0
			},
			easing: (stringValue(keyframe.easing) ?? 'linear') as EasingType
		}));
	}

	return {
		...item,
		...(Object.keys(scalar).length > 0 && { keyframes: scalar }),
		...(Object.keys(vectors).length > 0 && { vectorKeyframes: vectors }),
		...(value.animationVersion === 2 && { animationVersion: 2 }),
		...(Array.isArray(value.separatedVectorProperties) && {
			separatedVectorProperties: value.separatedVectorProperties as VectorKeyframeProperty[]
		}),
		...(Array.isArray(value.propertyLinks) && { propertyLinks: value.propertyLinks }),
		...(Array.isArray(value.expressions) && { expressions: value.expressions })
	} as TimelineItem;
}

function convertItem(value: UnknownRecord, fps: number): TimelineItem {
	const volume = freeCutDbToGain(value.volume);
	const effects = records(value.effects)
		.map(convertEffect)
		.filter((effect) => effect !== null);
	const source = convertCaptionSource(
		value.captionSource ?? value.source,
		stringValue(value.id) ?? '',
		stringValue(value.mediaId)
	);
	const cues = records(value.cues)
		.map((cue) => convertSubtitleCue(cue, fps))
		.filter((cue) => cue !== null);
	const converted: UnknownRecord = {
		...value,
		...(volume !== undefined && { volume }),
		...(value.type === 'shape' && {
			shapeCornerRadius: value.shapeCornerRadius ?? value.cornerRadius,
			shapeDirection: value.shapeDirection ?? value.direction,
			shapePoints: value.shapePoints ?? value.points,
			shapeInnerRadius: value.shapeInnerRadius ?? value.innerRadius
		}),
		...(value.type === 'lottie' && {
			lottieFrameRate: value.lottieFrameRate ?? value.frameRate,
			lottieTotalFrames: value.lottieTotalFrames ?? value.totalFrames,
			lottieLoop: value.lottieLoop ?? value.loop,
			lottieReversed: value.lottieReversed ?? value.reversed,
			lottieLoopMode: value.lottieLoopMode ?? value.loopMode,
			lottieSegmentStart: value.lottieSegmentStart ?? value.segmentStart,
			lottieSegmentEnd: value.lottieSegmentEnd ?? value.segmentEnd,
			lottieAnimationId: value.lottieAnimationId ?? value.animationId,
			lottieThemeId: value.lottieThemeId ?? value.themeId,
			lottieTextOverrides: value.lottieTextOverrides ?? value.textOverrides,
			lottieColorOverrides: value.lottieColorOverrides ?? value.colorOverrides,
			lottieSlotOverrides: value.lottieSlotOverrides ?? value.slotOverrides
		}),
		...(source && { captionSource: source }),
		...(Array.isArray(value.cues) && { cues }),
		...(Array.isArray(value.effects) && { effects })
	};
	return converted as unknown as TimelineItem;
}

function convertTransition(value: UnknownRecord): TimelineTransition | null {
	const fromItemId = stringValue(value.fromItemId ?? value.leftClipId);
	const toItemId = stringValue(value.toItemId ?? value.rightClipId);
	if (!fromItemId || !toItemId) return null;
	return {
		...value,
		fromItemId,
		toItemId
	} as unknown as TimelineTransition;
}

function animationByItemId(value: unknown): Map<string, UnknownRecord> {
	return new Map(
		records(value).flatMap((entry) => {
			const itemId = stringValue(entry.itemId);
			return itemId ? [[itemId, entry] as const] : [];
		})
	);
}

function convertComposition(value: UnknownRecord, projectFps: number): SubComposition {
	const fps = finite(value.fps) ?? projectFps;
	const keyframes = animationByItemId(value.keyframes);
	return {
		...value,
		items: records(value.items).map((item) => {
			const converted = convertItem(item, fps);
			return convertItemAnimation(converted, keyframes.get(converted.id));
		}),
		tracks: records(value.tracks).map(convertTrack),
		transitions: records(value.transitions)
			.map(convertTransition)
			.filter((transition) => transition !== null),
		fps
	} as unknown as SubComposition;
}

function convertTimeline(value: UnknownRecord, fps: number): ProjectTimeline {
	const keyframes = animationByItemId(value.keyframes);
	const masterVolumeDb = finite(value.masterVolumeDb ?? value.masterBusDb);
	return {
		...value,
		tracks: records(value.tracks).map(convertTrack),
		items: records(value.items).map((item) => {
			const converted = convertItem(item, fps);
			return convertItemAnimation(converted, keyframes.get(converted.id));
		}),
		transitions: records(value.transitions)
			.map(convertTransition)
			.filter((transition) => transition !== null),
		compositions: records(value.compositions).map((composition) =>
			convertComposition(composition, fps)
		),
		...(masterVolumeDb !== undefined && { masterVolumeDb })
	} as unknown as ProjectTimeline;
}

export function convertFreeCutProjectDocument(project: Project, schemaVersion: number): Project {
	const timeline = record(project.timeline);
	return {
		...project,
		schemaVersion,
		schemaFamily: 'openpost',
		...(timeline && { timeline: convertTimeline(timeline, project.metadata.fps) })
	};
}
