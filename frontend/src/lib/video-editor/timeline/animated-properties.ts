/**
 * Resolve keyframed item properties for preview and export.
 *
 * Ported from FreeCut (MIT) - features/keyframes/utils/animatable-properties.ts,
 * animated-transform-resolver.ts, animated-crop-resolver.ts, and
 * animated-text-item.ts. Adapted to OpenPost's item model.
 */
import type { KeyframeProperty, TimelineItem } from '$lib/video-editor/project/types';
import { activeValueAt } from './actions/keyframes';

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
	switch (item.type) {
		case 'audio':
			return ['volume'];
		case 'video':
			return [...VISUAL_PROPERTIES, ...VIDEO_PROPERTIES];
		case 'text':
			return [...VISUAL_PROPERTIES, ...TEXT_PROPERTIES];
		case 'image':
		case 'subtitle':
			return [...VISUAL_PROPERTIES];
	}
}

export function resolveAnimatedItemAt(item: TimelineItem, absoluteFrame: number): TimelineItem {
	let resolved: TimelineItem = {
		...item,
		transform: item.transform ? { ...item.transform } : undefined,
		crop: item.crop ? { ...item.crop } : undefined,
		textShadow: item.textShadow ? { ...item.textShadow } : undefined
	};

	for (const property of getAnimatablePropertiesForItem(item)) {
		const value = activeValueAt(item, property, absoluteFrame);
		if (value === null) continue;
		resolved = applyResolvedValue(resolved, property, value);
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
			return { ...item, textShadow: { ...shadowOrDefault(item), offsetX: value } };
		case 'textShadowOffsetY':
			return { ...item, textShadow: { ...shadowOrDefault(item), offsetY: value } };
		case 'textShadowBlur':
			return { ...item, textShadow: { ...shadowOrDefault(item), blur: Math.max(0, value) } };
	}
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
