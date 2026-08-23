/** Capture and compatibility rules for project-scoped animation recipes. */
import type {
	AnimationPreset,
	AnimationPresetKeyframe,
	AnimationPresetProperty,
	AnimationPresetVectorProperty,
	EasingConfig,
	KeyframeProperty,
	KeyframeTrack,
	MotionModifier,
	TimelineItem,
	VectorKeyframe
} from '$lib/video-editor/project/types';
import type { ItemEffect } from '$lib/video-editor/effects/types';
import { parseEffectKeyframeProperty } from '$lib/video-editor/effects/effect-keyframes';
import { getAnimatablePropertiesForItem } from './animated-properties';
import { activePositionKeyframes } from './vector-keyframes';

export type AnimationPresetIncompatibility =
	| 'type-mismatch'
	| 'missing-property'
	| 'missing-effect';

export interface AnimationPresetCompatibility {
	compatible: boolean;
	reason?: AnimationPresetIncompatibility;
}

export function captureAnimationFromItem(
	item: TimelineItem,
	name: string,
	createdAt = Date.now()
): AnimationPreset | null {
	const scalarProperties = capturedScalarProperties(item);
	const position = activePositionKeyframes(item);
	const vectorProperties: AnimationPresetVectorProperty[] = position
		? [{ property: 'position', keyframes: position.map(cloneVectorKeyframe) }]
		: [];
	const motionModifiers = (item.motionModifiers ?? [])
		.filter((modifier) => modifier.enabled && modifier.amplitude > 0)
		.map(cloneMotionModifier);
	if (
		scalarProperties.length === 0 &&
		vectorProperties.length === 0 &&
		motionModifiers.length === 0
	) {
		return null;
	}

	const animatedFrames = [
		...scalarProperties.flatMap((property) => property.keyframes.map((keyframe) => keyframe.frame)),
		...vectorProperties.flatMap((property) => property.keyframes.map((keyframe) => keyframe.frame))
	];
	const firstFrame = animatedFrames.length > 0 ? Math.min(...animatedFrames) : 0;
	const properties = scalarProperties.map((property) => ({
		...property,
		keyframes: property.keyframes.map((keyframe) => ({
			...keyframe,
			frame: keyframe.frame - firstFrame
		}))
	}));
	const normalizedVectors = vectorProperties.map((property) => ({
		...property,
		keyframes: property.keyframes.map((keyframe) => ({
			...cloneVectorKeyframe(keyframe),
			frame: keyframe.frame - firstFrame
		}))
	}));
	return {
		id: crypto.randomUUID(),
		name: name.trim(),
		sourceItemType: item.type,
		properties,
		...(normalizedVectors.length > 0 && { vectorProperties: normalizedVectors }),
		effects: carriedEffects(item, properties),
		...(motionModifiers.length > 0 && { motionModifiers }),
		sourceDurationInFrames: item.durationInFrames,
		createdAt
	};
}

export function getAnimationPresetCompatibility(
	preset: AnimationPreset,
	item: TimelineItem
): AnimationPresetCompatibility {
	if (preset.sourceItemType !== item.type) {
		return { compatible: false, reason: 'type-mismatch' };
	}
	const available = new Set(getAnimatablePropertiesForItem(item));
	for (const entry of preset.properties) {
		const parsed = parseEffectKeyframeProperty(entry.property);
		if (parsed) {
			const carried = preset.effects.some(
				(effect) =>
					effect.type === 'gpu' &&
					effect.id === parsed.effectId &&
					effect.effectId === parsed.effectType
			);
			if (!carried) return { compatible: false, reason: 'missing-effect' };
			continue;
		}
		if (!available.has(entry.property)) {
			return { compatible: false, reason: 'missing-property' };
		}
	}
	if (
		preset.vectorProperties?.some(
			(property) => property.property === 'position' && (!available.has('x') || !available.has('y'))
		)
	) {
		return { compatible: false, reason: 'missing-property' };
	}
	return { compatible: true };
}

function capturedScalarProperties(item: TimelineItem): AnimationPresetProperty[] {
	const properties: AnimationPresetProperty[] = [];
	for (const [rawProperty, track] of Object.entries(item.keyframes ?? {})) {
		if (!track || track.frames.length === 0) continue;
		// SAFETY: ItemKeyframes only permits KeyframeProperty keys.
		const property = rawProperty as KeyframeProperty;
		properties.push({ property, keyframes: trackKeyframes(track, property) });
	}
	return properties;
}

function trackKeyframes(
	track: KeyframeTrack,
	property: KeyframeProperty
): AnimationPresetKeyframe[] {
	return track.frames
		.map((frame, index) => ({
			id: track.ids?.[index] ?? `legacy:${property}:${frame}:${index}`,
			frame,
			value: track.values[index] ?? 0,
			easing: track.easings?.[index] ?? 'linear',
			...(track.easingConfigs?.[index] && {
				easingConfig: cloneEasingConfig(track.easingConfigs[index]!)
			})
		}))
		.toSorted((left, right) => left.frame - right.frame);
}

function carriedEffects(
	item: TimelineItem,
	properties: readonly AnimationPresetProperty[]
): ItemEffect[] {
	const ids = new Set(
		properties.flatMap((property) => {
			const parsed = parseEffectKeyframeProperty(property.property);
			return parsed ? [parsed.effectId] : [];
		})
	);
	return (item.effects ?? [])
		.filter((effect) => ids.has(effect.id))
		.map((effect) =>
			effect.type === 'gpu' ? { ...effect, params: { ...effect.params } } : { ...effect }
		);
}

function cloneMotionModifier(modifier: MotionModifier): MotionModifier {
	return {
		...modifier,
		...(modifier.channelGains && { channelGains: { ...modifier.channelGains } })
	};
}

function cloneVectorKeyframe(keyframe: VectorKeyframe): VectorKeyframe {
	return {
		...keyframe,
		value: { ...keyframe.value },
		...(keyframe.easingConfig && { easingConfig: cloneEasingConfig(keyframe.easingConfig) }),
		...(keyframe.spatial && {
			spatial: {
				...keyframe.spatial,
				inTangent: { ...keyframe.spatial.inTangent },
				outTangent: { ...keyframe.spatial.outTangent }
			}
		})
	};
}

function cloneEasingConfig(config: EasingConfig): EasingConfig {
	return {
		...config,
		...(config.bezier && { bezier: { ...config.bezier } }),
		...(config.spring && { spring: { ...config.spring } })
	};
}
