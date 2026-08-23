/** Adjustment-layer scope and effect ordering shared by preview and export. */

import type { ItemEffect } from './types';
import type { TimelineItem, TimelineTrack } from '../project/types';

export interface AdjustmentLayerScope {
	layer: TimelineItem;
	trackOrder: number;
}

/** Collect adjustment layers from visible tracks with their compositing order. */
export function collectAdjustmentLayers(
	items: readonly TimelineItem[],
	tracks: readonly TimelineTrack[]
): AdjustmentLayerScope[] {
	const orderByTrack = new Map(tracks.map((track) => [track.id, track.order]));
	const anySolo = tracks.some((track) => track.solo);
	const visibleTracks = new Set(
		tracks
			.filter((track) => (anySolo ? track.solo : track.visible !== false))
			.map((track) => track.id)
	);
	return items.flatMap((item) =>
		item.type === 'adjustment' && visibleTracks.has(item.trackId)
			? [{ layer: item, trackOrder: orderByTrack.get(item.trackId) ?? 0 }]
			: []
	);
}

/**
 * Resolve the effects that apply to one visual item at a frame. Adjustment
 * effects run from top to bottom first, followed by the item's own stack.
 */
export function effectsForItemAtFrame(
	item: TimelineItem,
	itemTrackOrder: number,
	adjustmentLayers: readonly AdjustmentLayerScope[],
	frame: number
): ItemEffect[] {
	const adjustmentEffects = adjustmentLayers
		.filter(
			({ layer, trackOrder }) =>
				itemTrackOrder > trackOrder &&
				frame >= layer.from &&
				frame < layer.from + layer.durationInFrames
		)
		.toSorted((left, right) => left.trackOrder - right.trackOrder)
		.flatMap(({ layer }) => (layer.effects ?? []).filter((effect) => effect.enabled));
	return [...adjustmentEffects, ...(item.effects ?? []).filter((effect) => effect.enabled)];
}
