/**
 * Ported from FreeCut (MIT) — timeline/services/sized-accessed-memory-cache.ts.
 *
 * Size-bounded, least-recently-accessed memory cache. Entries carry their own
 * byte cost; insertion evicts oldest-accessed entries until the new entry
 * fits. Oversized entries are retained rather than rejected so a single long
 * clip's payload is never uncached (it just temporarily exceeds the budget).
 */

type SizedAccessedEntry = {
	sizeBytes: number;
	lastAccessed: number;
};

export class SizedAccessedMemoryCache<TEntry extends SizedAccessedEntry> {
	private entries = new Map<string, TEntry>();
	private currentSizeBytes = 0;

	constructor(private readonly maxSizeBytes: number) {}

	get(key: string): TEntry | null {
		const entry = this.entries.get(key);
		if (!entry) {
			return null;
		}

		entry.lastAccessed = Date.now();
		return entry;
	}

	add(key: string, entry: TEntry): void {
		const existing = this.entries.get(key);
		if (existing) {
			this.currentSizeBytes -= existing.sizeBytes;
			this.entries.delete(key);
		}

		while (this.currentSizeBytes + entry.sizeBytes > this.maxSizeBytes && this.entries.size > 0) {
			this.evictOldest();
		}

		this.entries.set(key, entry);
		this.currentSizeBytes += entry.sizeBytes;
	}

	delete(key: string): void {
		const entry = this.entries.get(key);
		if (!entry) {
			return;
		}

		this.currentSizeBytes -= entry.sizeBytes;
		this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
		this.currentSizeBytes = 0;
	}

	keys(): string[] {
		return [...this.entries.keys()];
	}

	get sizeBytes(): number {
		return this.currentSizeBytes;
	}

	private evictOldest(): void {
		let oldestKey: string | null = null;
		let oldestTime = Number.POSITIVE_INFINITY;

		for (const [key, entry] of this.entries) {
			if (entry.lastAccessed < oldestTime) {
				oldestTime = entry.lastAccessed;
				oldestKey = key;
			}
		}

		if (oldestKey) {
			this.delete(oldestKey);
		}
	}
}
