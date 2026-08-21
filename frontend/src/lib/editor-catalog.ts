import type { ImageEditorDesignSummary } from '$lib/image-editor/types';

export const EDITOR_CATALOG_PAGE_SIZE = 50;

export interface EditorCatalogSnapshot {
	workspaceID: string;
	query: string;
	designs: ImageEditorDesignSummary[];
	designTotal: number;
	designOffset: number;
	canEditDesigns: boolean;
}

export type EditorCatalogItemKind = 'design';
export type EditorCatalogSurface = 'loading' | 'error' | 'empty' | 'content';

type RemovedItem = { key: string; index: number; kind: 'design'; item: ImageEditorDesignSummary };

export interface EditorCatalogRollback {
	kind: EditorCatalogItemKind;
	workspaceID: string;
	items: RemovedItem[];
}

export interface EditorCatalogRequestToken {
	key: string;
	generation: number;
	signal: AbortSignal;
}

export function normalizeEditorCatalogQuery(value: string): string {
	return value.trim().toLowerCase();
}

export function editorCatalogKey(workspaceID: string, query: string): string {
	return JSON.stringify([workspaceID, normalizeEditorCatalogQuery(query)]);
}

export function emptyEditorCatalog(workspaceID: string, query: string): EditorCatalogSnapshot {
	return {
		workspaceID,
		query: normalizeEditorCatalogQuery(query),
		designs: [],
		designTotal: 0,
		designOffset: 0,
		canEditDesigns: false
	};
}

export function resolveEditorCatalogSurface(input: {
	loading: boolean;
	error: string;
	designCount: number;
}): EditorCatalogSurface {
	if (input.designCount > 0) return 'content';
	if (input.loading) return 'loading';
	if (input.error) return 'error';
	return 'empty';
}

export function mergeEditorCatalogItems<T extends { id: string }>(
	current: readonly T[],
	incoming: readonly T[]
): T[] {
	const merged = current.map((item) => ({ ...item }));
	const positions = new Map(merged.map((item, index) => [item.id, index]));
	for (const item of incoming) {
		const index = positions.get(item.id);
		if (index === undefined) {
			positions.set(item.id, merged.length);
			merged.push({ ...item });
		} else {
			merged[index] = { ...item };
		}
	}
	return merged;
}

function cloneSnapshot(snapshot: EditorCatalogSnapshot): EditorCatalogSnapshot {
	return {
		...snapshot,
		designs: snapshot.designs.map((design) => ({ ...design }))
	};
}

/**
 * Stores complete query snapshots under both workspace and normalized search.
 * Mutations fan out only across entries for their originating workspace.
 */
export class EditorCatalogCache {
	private readonly entries = new Map<string, EditorCatalogSnapshot>();

	read(workspaceID: string, query: string): EditorCatalogSnapshot | undefined {
		const snapshot = this.entries.get(editorCatalogKey(workspaceID, query));
		return snapshot ? cloneSnapshot(snapshot) : undefined;
	}

	write(snapshot: EditorCatalogSnapshot): void {
		this.entries.set(
			editorCatalogKey(snapshot.workspaceID, snapshot.query),
			cloneSnapshot(snapshot)
		);
	}

	remove(workspaceID: string, kind: EditorCatalogItemKind, itemID: string): EditorCatalogRollback {
		const items: RemovedItem[] = [];
		for (const [key, snapshot] of this.entries) {
			if (snapshot.workspaceID !== workspaceID) continue;
			const index = snapshot.designs.findIndex((item) => item.id === itemID);
			if (index < 0) continue;
			const [item] = snapshot.designs.splice(index, 1);
			snapshot.designTotal = Math.max(0, snapshot.designTotal - 1);
			items.push({ key, index, kind: 'design', item });
		}
		return { kind, workspaceID, items };
	}

	restore(rollback: EditorCatalogRollback): void {
		for (const removed of rollback.items) {
			const snapshot = this.entries.get(removed.key);
			if (!snapshot || snapshot.workspaceID !== rollback.workspaceID) continue;
			if (snapshot.designs.some((item) => item.id === removed.item.id)) continue;
			snapshot.designs.splice(Math.min(removed.index, snapshot.designs.length), 0, removed.item);
			snapshot.designTotal += 1;
		}
	}

	invalidateWorkspace(workspaceID: string): void {
		for (const [key, snapshot] of this.entries) {
			if (snapshot.workspaceID === workspaceID) this.entries.delete(key);
		}
	}
}

/** A small generation gate that aborts superseded reads and rejects late results. */
export class EditorCatalogRequestGate {
	private generation = 0;
	private controller: AbortController | null = null;

	begin(key: string): EditorCatalogRequestToken {
		this.controller?.abort();
		this.controller = new AbortController();
		return {
			key,
			generation: ++this.generation,
			signal: this.controller.signal
		};
	}

	accepts(token: EditorCatalogRequestToken, activeKey: string): boolean {
		return !token.signal.aborted && token.key === activeKey && token.generation === this.generation;
	}

	invalidate(): void {
		this.generation += 1;
		this.controller?.abort();
		this.controller = null;
	}
}

export function isAbortError(cause: unknown): boolean {
	return cause instanceof Error && cause.name === 'AbortError';
}
