/**
 * Timeline domain store — items, tracks, markers, playback settings, zoom.
 *
 * Consolidates FreeCut's separate Zustand stores (items-store,
 * markers-store, timeline-settings-store, zoom-store) into one Svelte 5
 * runes module. State mutates only through the private `_` methods called
 * by the command-wrapped actions in ./actions/; components read through
 * the exported singleton.
 *
 * Ported from FreeCut (MIT), trimmed to v1 (no compositions, transitions,
 * or keyframes).
 */

import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';

export interface TimelineSettings {
	fps: number;
	snapEnabled: boolean;
	linkedSelectionEnabled: boolean;
	currentFrame: number;
	scrollPosition: number;
	maxUndoHistory: number;
}

interface ItemsIndex {
	itemsByTrackId: Map<string, TimelineItem[]>;
	itemById: Map<string, TimelineItem>;
	maxItemEndFrame: number;
}

function buildIndex(items: TimelineItem[]): ItemsIndex {
	const itemsByTrackId = new Map<string, TimelineItem[]>();
	const itemById = new Map<string, TimelineItem>();
	let maxItemEndFrame = 0;
	for (const item of items) {
		const list = itemsByTrackId.get(item.trackId);
		if (list) list.push(item);
		else itemsByTrackId.set(item.trackId, [item]);
		itemById.set(item.id, item);
		maxItemEndFrame = Math.max(maxItemEndFrame, item.from + item.durationInFrames);
	}
	return { itemsByTrackId, itemById, maxItemEndFrame };
}

interface TimelineMarkerRecord {
	id: string;
	frame: number;
	label?: string;
	color: string;
}

interface TimelineState {
	items: TimelineItem[];
	tracks: TimelineTrack[];
	inPoint: number | null;
	outPoint: number | null;
	markers: TimelineMarkerRecord[];
	settings: TimelineSettings;
	zoomLevel: number;
	isDirty: boolean;
}

const state = $state<TimelineState>({
	items: [],
	tracks: [],
	inPoint: null,
	outPoint: null,
	markers: [],
	settings: {
		fps: 30,
		snapEnabled: true,
		linkedSelectionEnabled: true,
		currentFrame: 0,
		scrollPosition: 0,
		maxUndoHistory: 100
	},
	zoomLevel: 1,
	isDirty: false
});

let index = buildIndex(state.items);

function reindex(): void {
	index = buildIndex(state.items);
	state.isDirty = true;
}

export const timelineStore = {
	get items(): TimelineItem[] {
		return state.items;
	},
	get tracks(): TimelineTrack[] {
		return state.tracks;
	},
	get inPoint(): number | null {
		return state.inPoint;
	},
	get outPoint(): number | null {
		return state.outPoint;
	},
	get markers() {
		return state.markers;
	},
	get fps(): number {
		return state.settings.fps;
	},
	get snapEnabled(): boolean {
		return state.settings.snapEnabled;
	},
	get linkedSelectionEnabled(): boolean {
		return state.settings.linkedSelectionEnabled;
	},
	get currentFrame(): number {
		return state.settings.currentFrame;
	},
	get scrollPosition(): number {
		return state.settings.scrollPosition;
	},
	get maxUndoHistory(): number {
		return state.settings.maxUndoHistory;
	},
	get zoomLevel(): number {
		return state.zoomLevel;
	},
	get isDirty(): boolean {
		return state.isDirty;
	},
	get itemsByTrackId(): Map<string, TimelineItem[]> {
		return index.itemsByTrackId;
	},
	get itemById(): Map<string, TimelineItem> {
		return index.itemById;
	},
	get maxItemEndFrame(): number {
		return index.maxItemEndFrame;
	},

	/* ─────────────── Bulk setters (snapshot restore / project load) ─────────────── */

	setAll(next: {
		items?: TimelineItem[];
		tracks?: TimelineTrack[];
		inPoint?: number | null;
		outPoint?: number | null;
		currentFrame?: number;
		fps?: number;
	}): void {
		if (next.items) state.items = next.items;
		if (next.tracks) state.tracks = next.tracks;
		if (next.inPoint !== undefined) state.inPoint = next.inPoint;
		if (next.outPoint !== undefined) state.outPoint = next.outPoint;
		if (next.currentFrame !== undefined && Number.isFinite(next.currentFrame)) {
			state.settings.currentFrame = next.currentFrame;
		}
		if (next.fps !== undefined && Number.isFinite(next.fps) && next.fps > 0) {
			state.settings.fps = next.fps;
		}
		reindex();
	},

	clear(): void {
		state.items = [];
		state.tracks = [];
		state.inPoint = null;
		state.outPoint = null;
		state.markers = [];
		state.settings.currentFrame = 0;
		state.isDirty = false;
		reindex();
	},

	/* ────────────────────────── Private mutators (actions only) ────────────────── */

	_setItems(items: TimelineItem[]): void {
		state.items = items;
		reindex();
	},

	_setTracks(tracks: TimelineTrack[]): void {
		state.tracks = tracks;
		state.isDirty = true;
	},

	_addItem(item: TimelineItem): void {
		state.items.push(item);
		reindex();
	},

	_updateItems(updates: Array<{ id: string; patch: Partial<TimelineItem> }>): void {
		for (const { id, patch } of updates) {
			const item = index.itemById.get(id);
			if (!item) continue;
			Object.assign(item, patch);
		}
		reindex();
	},

	_removeItems(ids: string[]): void {
		const remove = new Set(ids);
		state.items = state.items.filter((item) => !remove.has(item.id));
		reindex();
	},

	_splitItem(
		id: string,
		frame: number
	): { leftItem: TimelineItem; rightItem: TimelineItem } | null {
		const item = index.itemById.get(id);
		if (!item) return null;
		const relative = frame - item.from;
		if (relative <= 0 || relative >= item.durationInFrames) return null;

		const rightDuration = item.durationInFrames - relative;
		const rightItem: TimelineItem = {
			...structuredClone(item),
			id: crypto.randomUUID(),
			originId: item.originId ?? item.id,
			from: frame,
			durationInFrames: rightDuration,
			label: item.label
		};
		if (
			(rightItem.type === 'video' || rightItem.type === 'audio') &&
			item.sourceFps &&
			item.sourceFps > 0
		) {
			// Shift the right piece's source window by the source frames consumed by
			// the left piece (timeline frames scaled by speed).
			const speed = item.speed ?? 1;
			rightItem.sourceStart =
				(item.sourceStart ?? 0) +
				Math.round((relative * speed * item.sourceFps) / state.settings.fps);
		}
		item.durationInFrames = relative;
		// Both halves carry the original's lineage so downstream range-removal
		// can identify every piece of the clip that was edited.
		if (!item.originId) item.originId = rightItem.originId;
		state.items.push(rightItem);
		reindex();
		return { leftItem: item, rightItem };
	},

	_moveItems(updates: Array<{ id: string; from: number; trackId?: string }>): void {
		for (const update of updates) {
			const item = index.itemById.get(update.id);
			if (!item) continue;
			item.from = update.from;
			if (update.trackId && update.trackId !== item.trackId) {
				item.trackId = update.trackId;
			}
		}
		reindex();
	},

	_setCurrentFrame(frame: number): void {
		state.settings.currentFrame = Math.max(0, Math.round(frame));
	},

	_setScrollPosition(position: number): void {
		state.settings.scrollPosition = position;
	},

	_setSnapEnabled(enabled: boolean): void {
		state.settings.snapEnabled = enabled;
	},

	_setLinkedSelectionEnabled(enabled: boolean): void {
		state.settings.linkedSelectionEnabled = enabled;
	},

	_setZoomLevel(level: number): void {
		state.zoomLevel = Math.min(50, Math.max(0.01, level));
	},

	_setInPoint(frame: number | null): void {
		state.inPoint = frame;
		state.isDirty = true;
	},

	_setOutPoint(frame: number | null): void {
		state.outPoint = frame;
		state.isDirty = true;
	},

	_addMarker(marker: TimelineMarkerRecord): void {
		state.markers.push(marker);
		state.isDirty = true;
	},

	_removeMarker(id: string): void {
		state.markers = state.markers.filter((marker) => marker.id !== id);
		state.isDirty = true;
	},

	_clearDirty(): void {
		state.isDirty = false;
	},

	__resetForTesting(): void {
		timelineStore.clear();
		timelineStore._setZoomLevel(1);
		state.settings.snapEnabled = true;
		state.settings.linkedSelectionEnabled = true;
		state.settings.maxUndoHistory = 100;
		state.markers = [];
	}
};
