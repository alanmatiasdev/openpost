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

import type { ItemEffect, ItemType } from '$lib/video-editor/effects/types';
import { EFFECT_DEFINITIONS } from '$lib/video-editor/effects/types';
import { timelineStore } from '../stores/timeline-store.svelte';
import { execute } from '../commands/command-store.svelte';

/** Append a new enabled effect with its default amount. One undoable step. */
export function addEffect(itemId: string, type: ItemType): boolean {
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

/** Patch one effect's amount/enabled flag in place. One undoable step. */
export function updateEffect(
	itemId: string,
	effectId: string,
	patch: Partial<Pick<ItemEffect, 'amount' | 'enabled'>>
): boolean {
	return execute('UPDATE_EFFECT', () => {
		const effects = timelineStore.itemById.get(itemId)?.effects;
		const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;
		if (!effects || index === -1) return false;
		const current = effects[index];
		if (!current) return false;
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
