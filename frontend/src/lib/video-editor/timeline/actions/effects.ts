/**
 * Undoable clip effect actions.
 *
 * Effects live on the item (`item.effects`), so undo/redo captures them
 * through the regular snapshot clone, exactly like keyframes and other
 * item fields. Every mutation is one `execute()` step; actions return
 * false (and record nothing) when the target is absent or unchanged.
 *
 * Ported from FreeCut (MIT) — ItemEffect instance model (id + enabled),
 * with OpenPost's snapshot-undo action pattern from keyframes.ts.
 */

import type {
	CssFilterType,
	GpuEffect,
	ItemEffect,
	ItemType
} from '$lib/video-editor/effects/types';
import { EFFECT_DEFINITIONS } from '$lib/video-editor/effects/types';
import type { BlendMode } from '$lib/video-editor/effects/gpu/blend-modes';
import { clampGpuParam, defaultGpuParams } from '$lib/video-editor/effects/gpu/types';
import { getGpuEffect } from '$lib/video-editor/effects/gpu/registry';
import type { EffectTemplate } from '$lib/video-editor/timeline/effect-drop';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';

/** Append a new enabled effect with its default amount. One undoable step. */
export function addEffect(itemId: string, type: CssFilterType): boolean {
	return execute('ADD_EFFECT', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		const definition = EFFECT_DEFINITIONS.find((entry) => entry.type === type);
		if (!definition) return false;
		const next: ItemEffect = {
			id: crypto.randomUUID(),
			type,
			amount: definition.defaultAmount,
			enabled: true
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: [...(item.effects ?? []), next] } }
		]);
		return true;
	});
}

/** Patch one CSS-filter effect's amount/enabled flag in place. One undoable step. */
export function updateEffect(
	itemId: string,
	effectId: string,
	patch: { amount?: number; enabled?: boolean }
): boolean {
	return execute('UPDATE_EFFECT', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type === 'gpu') return false;
		const nextEffect: ItemEffect = { ...current, ...patch };
		if (nextEffect.amount === current.amount && nextEffect.enabled === current.enabled) {
			return false;
		}
		timelineStore._updateItems([
			{
				id: itemId,
				patch: { effects: replaceAt(effects, index, nextEffect) }
			}
		]);
		return true;
	});
}

/** Append a new enabled GPU effect with its registry defaults. One undoable step. */
export function addGpuEffect(itemId: string, effectId: string): boolean {
	return execute('ADD_GPU_EFFECT', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		if (!getGpuEffect(effectId)) return false;
		const next: GpuEffect = {
			id: crypto.randomUUID(),
			type: 'gpu',
			effectId,
			params: defaultGpuParams(getGpuEffect(effectId)?.schema ?? []),
			enabled: true
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: [...(item.effects ?? []), next] } }
		]);
		return true;
	});
}

/** Apply one effect template stack to multiple visual clips as one undo step. */
export function addEffectTemplates(
	itemIds: readonly string[],
	templates: readonly EffectTemplate[]
): boolean {
	const uniqueItemIds = Array.from(new Set(itemIds));
	return execute(
		'ADD_EFFECTS',
		() => {
			const updates = uniqueItemIds.flatMap((itemId) => {
				const item = timelineStore.itemById.get(itemId);
				if (!item || item.type === 'audio') return [];
				const additions = templates.flatMap((template) => {
					const effect = createEffectFromTemplate(template);
					return effect ? [effect] : [];
				});
				if (additions.length === 0) return [];
				return [
					{
						id: itemId,
						patch: { effects: [...(item.effects ?? []), ...additions] }
					}
				];
			});
			if (updates.length === 0) return false;
			timelineStore._updateItems(updates);
			return true;
		},
		{ count: uniqueItemIds.length }
	);
}

/** Toggle one GPU effect's enabled flag. One undoable step. */
export function setGpuEffectEnabled(itemId: string, effectId: string, enabled: boolean): boolean {
	return execute('SET_GPU_EFFECT_ENABLED', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type !== 'gpu' || current.enabled === enabled) return false;
		const next: GpuEffect = { ...current, enabled };
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: replaceAt(effects, index, next) } }
		]);
		return true;
	});
}

/** Set one GPU effect param, clamped to the registry schema. One undoable step. */
export function setGpuEffectParam(
	itemId: string,
	effectId: string,
	paramName: string,
	value: number
): boolean {
	return execute('SET_GPU_EFFECT_PARAM', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type !== 'gpu') return false;
		const definition = getGpuEffect(current.effectId);
		const schemaParam = definition?.schema.find((entry) => entry.name === paramName);
		if (!definition || !schemaParam) return false;
		const clamped = clampGpuParam(schemaParam, value);
		if (current.params[paramName] === clamped) return false;
		const next: GpuEffect = {
			...current,
			params: { ...current.params, [paramName]: clamped }
		};
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: replaceAt(effects, index, next) } }
		]);
		return true;
	});
}

/** Store a non-numeric GPU resource param such as an encoded LUT. */
export function setGpuEffectData(
	itemId: string,
	effectId: string,
	params: Record<string, string | number>
): boolean {
	return execute('SET_GPU_EFFECT_DATA', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current || current.type !== 'gpu') return false;
		const next: GpuEffect = { ...current, params: { ...current.params, ...params } };
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: replaceAt(effects, index, next) } }
		]);
		return true;
	});
}

/** Set the clip's compositing blend mode for the GPU pipeline. One undoable step. */
export function setItemBlendMode(itemId: string, mode: BlendMode): boolean {
	return execute('SET_ITEM_BLEND_MODE', () => {
		const item = timelineStore.itemById.get(itemId);
		if (!item) return false;
		if ((item.blendMode ?? 'normal') === mode) return false;
		timelineStore._updateItems([{ id: itemId, patch: { blendMode: mode } }]);
		return true;
	});
}

/** Remove one effect by id. One undoable step. */
export function removeEffect(itemId: string, effectId: string): boolean {
	return execute('REMOVE_EFFECT', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		if (!effects || !effects.some((effect) => effect.id === effectId)) return false;
		const next = effects.filter((effect) => effect.id !== effectId);
		timelineStore._updateItems([
			{ id: itemId, patch: { effects: next.length > 0 ? next : undefined } }
		]);
		return true;
	});
}

function replaceAt(effects: ItemEffect[], index: number, next: ItemEffect): ItemEffect[] {
	return [...effects.slice(0, index), next, ...effects.slice(index + 1)];
}

function createEffectFromTemplate(template: EffectTemplate): ItemEffect | null {
	if (template.kind === 'css') {
		const definition = EFFECT_DEFINITIONS.find((entry) => entry.type === template.effectType);
		if (!definition) return null;
		return {
			id: crypto.randomUUID(),
			type: definition.type,
			amount: definition.defaultAmount,
			enabled: true
		};
	}
	const definition = getGpuEffect(template.effectId);
	if (!definition) return null;
	return {
		id: crypto.randomUUID(),
		type: 'gpu',
		effectId: definition.id,
		params: defaultGpuParams(definition.schema),
		enabled: true
	};
}
