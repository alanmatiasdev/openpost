import type {
	DirectLinkableProperty,
	ScalarLinkableProperty,
	TimelineItem,
	Vector2
} from '../project/types';
import {
	areDirectLinkPropertiesCompatible,
	evaluatePropertyExpression,
	isExpressionValueCompatible,
	type ExpressionValue,
	type PropertyExpressionResult
} from './property-expression';

export interface PropertyRuntimeContext {
	absoluteFrame: number;
	fps: number;
	items: readonly TimelineItem[];
	resolvePreExpressionItem: (item: TimelineItem, absoluteFrame: number) => TimelineItem;
}

interface PropertyRuntimeState {
	linkedCache: Map<string, ExpressionValue>;
	expressionCache: Map<string, PropertyExpressionResult>;
	active: Set<string>;
	itemsById: ReadonlyMap<string, TimelineItem>;
}

const SCALAR_PROPERTIES: readonly ScalarLinkableProperty[] = [
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

export function doDirectLinkTargetsConflict(
	left: DirectLinkableProperty,
	right: DirectLinkableProperty
): boolean {
	if (left === right) return true;
	if (left === 'position') return right === 'x' || right === 'y';
	if (right === 'position') return left === 'x' || left === 'y';
	return false;
}

export function resolveItemPropertyRuntime(
	item: TimelineItem,
	preExpressionItem: TimelineItem,
	context: PropertyRuntimeContext
): TimelineItem {
	if (
		(!item.propertyLinks?.some((link) => link.enabled) &&
			!item.expressions?.some((expression) => expression.enabled)) ||
		context.items.length === 0
	) {
		return preExpressionItem;
	}
	const state: PropertyRuntimeState = {
		linkedCache: new Map(),
		expressionCache: new Map(),
		active: new Set(),
		itemsById: new Map(context.items.map((candidate) => [candidate.id, candidate]))
	};
	let resolved = preExpressionItem;
	for (const property of ['position', ...SCALAR_PROPERTIES] as const) {
		const preValue = propertyValue(resolved, property);
		const postLink = resolveLinkedValue(
			item.id,
			property,
			preValue,
			context.absoluteFrame,
			context,
			state
		);
		const result = resolveExpressionValue(
			item.id,
			property,
			postLink,
			context.absoluteFrame,
			context,
			state
		);
		if (isExpressionValueCompatible(property, result.value)) {
			resolved = applyPropertyValue(resolved, property, result.value);
		}
	}
	return resolved;
}

export function evaluateItemPropertyExpression(
	item: TimelineItem,
	property: DirectLinkableProperty,
	context: PropertyRuntimeContext
): PropertyExpressionResult {
	const itemsById = new Map(context.items.map((candidate) => [candidate.id, candidate]));
	itemsById.set(item.id, item);
	const state: PropertyRuntimeState = {
		linkedCache: new Map(),
		expressionCache: new Map(),
		active: new Set(),
		itemsById
	};
	const preItem = context.resolvePreExpressionItem(item, context.absoluteFrame);
	const preValue = propertyValue(preItem, property);
	const postLink = resolveLinkedValue(
		item.id,
		property,
		preValue,
		context.absoluteFrame,
		context,
		state
	);
	return resolveExpressionValue(item.id, property, postLink, context.absoluteFrame, context, state);
}

function resolveCompleteValue(
	itemId: string,
	property: DirectLinkableProperty,
	absoluteFrame: number,
	context: PropertyRuntimeContext,
	state: PropertyRuntimeState
): ExpressionValue | null {
	const item = state.itemsById.get(itemId);
	if (!item) return null;
	const preItem = context.resolvePreExpressionItem(item, absoluteFrame);
	const preValue = propertyValue(preItem, property);
	const postLink = resolveLinkedValue(itemId, property, preValue, absoluteFrame, context, state);
	return resolveExpressionValue(itemId, property, postLink, absoluteFrame, context, state).value;
}

function resolveLinkedValue(
	itemId: string,
	property: DirectLinkableProperty,
	preValue: ExpressionValue,
	absoluteFrame: number,
	context: PropertyRuntimeContext,
	state: PropertyRuntimeState
): ExpressionValue {
	const dependencyKey = `${itemId}:${property}`;
	const cacheKey = `${dependencyKey}@${absoluteFrame}`;
	const cached = state.linkedCache.get(cacheKey);
	if (cached !== undefined) return cached;
	if (state.active.has(dependencyKey)) return preValue;
	const item = state.itemsById.get(itemId);
	const link = item?.propertyLinks?.find(
		(candidate) => candidate.targetProperty === property && candidate.enabled
	);
	if (!link || !areDirectLinkPropertiesCompatible(property, link.sourceProperty)) {
		state.linkedCache.set(cacheKey, preValue);
		return preValue;
	}
	const source = state.itemsById.get(link.sourceItemId);
	if (!source) {
		state.linkedCache.set(cacheKey, preValue);
		return preValue;
	}
	state.active.add(dependencyKey);
	const sourceFrame = absoluteFrame - link.timeOffsetFrames;
	const sourcePreItem = context.resolvePreExpressionItem(source, sourceFrame);
	const sourcePreValue = propertyValue(sourcePreItem, link.sourceProperty);
	const value = resolveLinkedValue(
		source.id,
		link.sourceProperty,
		sourcePreValue,
		sourceFrame,
		context,
		state
	);
	state.active.delete(dependencyKey);
	state.linkedCache.set(cacheKey, value);
	return value;
}

function resolveExpressionValue(
	itemId: string,
	property: DirectLinkableProperty,
	preValue: ExpressionValue,
	absoluteFrame: number,
	context: PropertyRuntimeContext,
	state: PropertyRuntimeState
): PropertyExpressionResult {
	const item = state.itemsById.get(itemId);
	const expression = item?.expressions?.find(
		(candidate) => candidate.targetProperty === property && candidate.enabled
	);
	if (!expression) return { value: preValue };
	const dependencyKey = `expression:${itemId}:${property}`;
	const cacheKey = `${dependencyKey}@${absoluteFrame}`;
	const cached = state.expressionCache.get(cacheKey);
	if (cached) return cached;
	if (state.active.has(dependencyKey)) {
		return { value: preValue, error: 'Expression dependency cycle' };
	}
	state.active.add(dependencyKey);
	const result = evaluatePropertyExpression(expression.source, {
		preValue,
		globalFrame: absoluteFrame,
		fps: context.fps,
		resolveProperty: (sourceItemId, sourceProperty) =>
			resolveCompleteValue(sourceItemId, sourceProperty, absoluteFrame, context, state)
	});
	state.active.delete(dependencyKey);
	const compatible = isExpressionValueCompatible(property, result.value);
	const finalResult =
		result.error || !compatible
			? { value: preValue, error: result.error ?? 'Expression result has the wrong value type' }
			: result;
	state.expressionCache.set(cacheKey, finalResult);
	return finalResult;
}

function propertyValue(item: TimelineItem, property: DirectLinkableProperty): ExpressionValue {
	const transform = item.transform ?? {};
	if (property === 'position') return { x: transform.x ?? 0, y: transform.y ?? 0 };
	switch (property) {
		case 'x':
			return transform.x ?? 0;
		case 'y':
			return transform.y ?? 0;
		case 'width':
			return transform.width ?? item.sourceWidth ?? 1;
		case 'height':
			return transform.height ?? item.sourceHeight ?? 1;
		case 'anchorX':
			return transform.anchorX ?? (transform.width ?? item.sourceWidth ?? 1) / 2;
		case 'anchorY':
			return transform.anchorY ?? (transform.height ?? item.sourceHeight ?? 1) / 2;
		case 'rotation':
			return transform.rotation ?? 0;
		case 'opacity':
			return transform.opacity ?? 1;
		case 'cornerRadius':
			return transform.cornerRadius ?? 0;
	}
}

function applyPropertyValue(
	item: TimelineItem,
	property: DirectLinkableProperty,
	value: ExpressionValue
): TimelineItem {
	if (property === 'position') {
		if (Object(value) !== value) return item;
		// SAFETY: compatibility is checked before this function handles a vector property.
		const position = value as Vector2;
		return { ...item, transform: { ...item.transform, x: position.x, y: position.y } };
	}
	if (Object(value) === value) return item;
	// SAFETY: the object branch above excludes the Vector2 member.
	const scalar = value as number;
	return { ...item, transform: { ...item.transform, [property]: scalar } };
}
