/** Shared keyframe selection for the dope sheet and value graph. */

class KeyframeSelectionStore {
	#itemId = $state<string | null>(null);
	#ids = $state<Set<string>>(new Set());

	get itemId(): string | null {
		return this.#itemId;
	}

	get ids(): ReadonlySet<string> {
		return this.#ids;
	}

	forItem(itemId: string): ReadonlySet<string> {
		return this.#itemId === itemId ? this.#ids : new Set();
	}

	replace(itemId: string, ids: Iterable<string>): void {
		this.#itemId = itemId;
		this.#ids = new Set(ids);
	}

	clear(): void {
		this.#itemId = null;
		this.#ids = new Set();
	}

	prune(itemId: string, validIds: ReadonlySet<string>): void {
		if (this.#itemId !== itemId) return;
		const next = new Set([...this.#ids].filter((id) => validIds.has(id)));
		if (next.size !== this.#ids.size) this.#ids = next;
	}
}

export const keyframeSelectionStore = new KeyframeSelectionStore();
