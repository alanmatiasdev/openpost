import { describe, expect, it } from 'vitest';
import { SizedAccessedMemoryCache } from './sized-accessed-memory-cache';

interface Entry {
	sizeBytes: number;
	lastAccessed: number;
	value: string;
}

function makeCache(maxBytes: number): SizedAccessedMemoryCache<Entry> {
	return new SizedAccessedMemoryCache<Entry>(maxBytes);
}

describe('SizedAccessedMemoryCache', () => {
	it('stores and retrieves entries', () => {
		const cache = makeCache(100);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		expect(cache.get('a')?.value).toBe('a');
		expect(cache.sizeBytes).toBe(10);
	});

	it('evicts the least recently accessed entry to admit a new one', () => {
		const cache = makeCache(20);
		cache.add('old', { sizeBytes: 10, lastAccessed: 1, value: 'old' });
		cache.add('new', { sizeBytes: 10, lastAccessed: 2, value: 'new' });
		cache.get('new');
		cache.add('incoming', { sizeBytes: 10, lastAccessed: 3, value: 'incoming' });
		expect(cache.get('old')).toBeNull();
		expect(cache.get('new')?.value).toBe('new');
		expect(cache.get('incoming')?.value).toBe('incoming');
	});

	it('touching an entry protects it from eviction', () => {
		const cache = makeCache(20);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		cache.add('b', { sizeBytes: 10, lastAccessed: 2, value: 'b' });
		cache.get('a');
		cache.add('c', { sizeBytes: 10, lastAccessed: 3, value: 'c' });
		expect(cache.get('b')).toBeNull();
		expect(cache.get('a')).not.toBeNull();
	});

	it('retains an oversized entry once everything else is evicted', () => {
		const cache = makeCache(10);
		cache.add('small', { sizeBytes: 4, lastAccessed: 1, value: 'small' });
		cache.add('huge', { sizeBytes: 50, lastAccessed: 2, value: 'huge' });
		expect(cache.get('small')).toBeNull();
		expect(cache.get('huge')?.value).toBe('huge');
		expect(cache.sizeBytes).toBeGreaterThan(10);
	});

	it('replaces an existing key and adjusts the running size', () => {
		const cache = makeCache(100);
		cache.add('a', { sizeBytes: 30, lastAccessed: 1, value: 'a1' });
		cache.add('a', { sizeBytes: 12, lastAccessed: 2, value: 'a2' });
		expect(cache.get('a')?.value).toBe('a2');
		expect(cache.sizeBytes).toBe(12);
	});

	it('delete and clear release byte accounting', () => {
		const cache = makeCache(100);
		cache.add('a', { sizeBytes: 10, lastAccessed: 1, value: 'a' });
		cache.add('b', { sizeBytes: 5, lastAccessed: 2, value: 'b' });
		cache.delete('a');
		expect(cache.sizeBytes).toBe(5);
		cache.clear();
		expect(cache.sizeBytes).toBe(0);
		expect(cache.keys()).toEqual([]);
	});
});
