/**
 * Resolve keyframed item properties for preview and export.
 *
 * Ported from FreeCut (MIT) - features/keyframes/utils/animatable-properties.ts,
 * animated-transform-resolver.ts, animated-crop-resolver.ts, and
 * animated-text-item.ts. Adapted to OpenPost's item model.
 */
import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
import { activeValueAt } from './keyframe-interpolation';
import { activePositionKeyframes, interpolatePosition } from './vector-keyframes';
import {
	getAnimatableEffectPropertiesForItem,
	isEffectKeyframeProperty,
	resolveAnimatedEffectsAt
} from '$lib/video-editor/effects/effect-keyframes';
import { applyMotionModifiers } from './motion-modifier-eval';

export interface AnimatedItemMotionContext {
	fps: number;
	frameWidth: number;
	frameHeight: number;
}

const VISUAL_PROPERTIES: KeyframeProperty[] = [
	'x',
	'y',
	'width',
	'height',
	'anchorX',
	'anchorY',
	'rotation',
	'opacity',
	'cornerRadius'
];

const VIDEO_PROPERTIES: KeyframeProperty[] = [
	'cropLeft',
	'cropRight',
	'cropTop',
	'cropBottom',
	'cropSoftness',
	'volume'
];

const CROP_PROPERTIES: KeyframeProperty[] = VIDEO_PROPERTIES.filter(
	(property) => property !== 'volume'
);

const TEXT_PROPERTIES: KeyframeProperty[] = [
	'fontSize',
	'fontWeight',
	'lineHeight',
	'letterSpacing',
	'paddingX',
	'paddingY',
	'borderRadius',
	'textShadowOffsetX',
	'textShadowOffsetY',
	'textShadowBlur',
	'strokeWidth'
];

export function getAnimatablePropertiesForItem(item: TimelineItem): KeyframeProperty[] {
	let builtIn: KeyframeProperty[];
	switch (item.type) {
		case 'audio':
			return ['volume'];
		case 'video':
			builtIn = [...VISUAL_PROPERTIES, ...VIDEO_PROPERTIES];
			break;
		case 'text':
			builtIn = [...VISUAL_PROPERTIES, ...TEXT_PROPERTIES];
			break;
		case 'image':
		case 'lottie':
			builtIn = [...VISUAL_PROPERTIES, ...CROP_PROPERTIES];
			break;
		case 'subtitle':
		case 'shape':
		case 'composition':
			builtIn = [...VISUAL_PROPERTIES];
			break;
		case 'adjustment':
			builtIn = [];
			break;
	}
	return [...builtIn, ...getAnimatableEffectPropertiesForItem(item)];
}

export function resolveAnimatedItemAt(
	item: TimelineItem,
	absoluteFrame: number,
	motionContext?: AnimatedItemMotionContext
): TimelineItem {
	let resolved: TimelineItem = {
		...item,
		transform: item.transform ? { ...item.transform } : undefined,
		crop: item.crop ? { ...item.crop } : undefined,
		textShadow: item.textShadow ? { ...item.textShadow } : undefined,
		effects: resolveAnimatedEffectsAt(item, absoluteFrame)
	};
	const positionTrack = activePositionKeyframes(item);
	if (positionTrack) {
		const position = interpolatePosition(positionTrack, absoluteFrame - item.from);
		if (position) {
			resolved = {
				...resolved,
				transform: { ...resolved.transform, x: position.x, y: position.y }
			};
		}
	}

	for (const property of getAnimatablePropertiesForItem(item)) {
		if (isEffectKeyframeProperty(property)) continue;
		if (positionTrack && (property === 'x' || property === 'y')) continue;
		const value = activeValueAt(item, property, absoluteFrame);
		if (value === null) continue;
		resolved = applyResolvedValue(resolved, property, value);
	}
	if (motionContext && item.motionModifiers?.length) {
		const transform = resolved.transform ?? {};
		const animated = applyMotionModifiers(
			{
				x: transform.x ?? 0,
				y: transform.y ?? 0,
				width: Math.max(1, transform.width ?? resolved.sourceWidth ?? motionContext.frameWidth),
				height: Math.max(1, transform.height ?? resolved.sourceHeight ?? motionContext.frameHeight),
				rotation: transform.rotation ?? 0,
				opacity: transform.opacity ?? 1
			},
			item.motionModifiers,
			{
				frame: absoluteFrame - item.from,
				fps: motionContext.fps,
				frameWidth: motionContext.frameWidth,
				frameHeight: motionContext.frameHeight
			}
		);
		resolved = { ...resolved, transform: { ...transform, ...animated } };
	}
	return resolved;
}

function applyResolvedValue(
	item: TimelineItem,
	property: KeyframeProperty,
	value: number
): TimelineItem {
	if (isTransformProperty(property)) {
		return { ...item, transform: { ...item.transform, [property]: value } };
	}

	switch (property) {
		case 'cropLeft':
			return { ...item, crop: { ...cropOrDefault(item), left: value } };
		case 'cropRight':
			return { ...item, crop: { ...cropOrDefault(item), right: value } };
		case 'cropTop':
			return { ...item, crop: { ...cropOrDefault(item), top: value } };
		case 'cropBottom':
			return { ...item, crop: { ...cropOrDefault(item), bottom: value } };
		case 'cropSoftness':
			return { ...item, crop: { ...cropOrDefault(item), softness: value } };
		case 'volume':
		case 'fontSize':
		case 'fontWeight':
		case 'lineHeight':
		case 'letterSpacing':
		case 'paddingX':
		case 'paddingY':
		case 'borderRadius':
		case 'strokeWidth':
			return { ...item, [property]: value };
		case 'textShadowOffsetX':
			return {
				...item,
				textShadow: { ...shadowOrDefault(item), offsetX: value }
			};
		case 'textShadowOffsetY':
			return {
				...item,
				textShadow: { ...shadowOrDefault(item), offsetY: value }
			};
		case 'textShadowBlur':
			return {
				...item,
				textShadow: { ...shadowOrDefault(item), blur: Math.max(0, value) }
			};
	}
	return item;
}

function isTransformProperty(
	property: KeyframeProperty
): property is keyof NonNullable<TimelineItem['transform']> & KeyframeProperty {
	return VISUAL_PROPERTIES.includes(property);
}

function cropOrDefault(item: TimelineItem): NonNullable<TimelineItem['crop']> {
	return item.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

function shadowOrDefault(item: TimelineItem): NonNullable<TimelineItem['textShadow']> {
	return (
		item.textShadow ?? {
			blur: 0,
			color: '#000000',
			offsetX: 0,
			offsetY: 0
		}
	);
}
