import { describe, expect, it } from 'vitest';
import {
	isAutomaticProxyCandidate,
	PROXY_MAX_HEIGHT,
	proxyDimensions,
	shouldUseAutomaticProxy
} from './proxy-client';
import type { MediaMetadata } from './types';

function media(overrides: Partial<MediaMetadata> = {}): MediaMetadata {
	return {
		id: 'media',
		storageType: 'workspace',
		fileName: 'source.mp4',
		fileSize: 20 * 1024 * 1024,
		mimeType: 'video/mp4',
		duration: 10,
		width: 1920,
		height: 1080,
		fps: 30,
		codec: 'avc',
		bitrate: 8_000_000,
		tags: [],
		...overrides
	};
}

describe('proxyDimensions', () => {
	it('caps height at the max while preserving aspect ratio', () => {
		const size = proxyDimensions(1920, 1080);
		expect(size.height).toBeLessThanOrEqual(PROXY_MAX_HEIGHT);
		expect(size.width / size.height).toBeCloseTo(1920 / 1080, 2);
	});

	it('keeps even dimensions for codec compatibility', () => {
		expect(proxyDimensions(1919, 1079).width % 2).toBe(0);
		expect(proxyDimensions(1919, 1079).height % 2).toBe(0);
	});

	it('never upscales smaller footage', () => {
		expect(proxyDimensions(640, 360)).toEqual({ width: 640, height: 360 });
	});

	it('returns zeroed dimensions for unusable input', () => {
		expect(proxyDimensions(0, 0)).toEqual({ width: 0, height: 0 });
	});

	it('only auto-proxies sources that are costly to decode or seek', () => {
		expect(isAutomaticProxyCandidate(media())).toBe(false);
		expect(isAutomaticProxyCandidate(media({ width: 3840, height: 2160 }))).toBe(true);
		expect(isAutomaticProxyCandidate(media({ fps: 60 }))).toBe(true);
		expect(isAutomaticProxyCandidate(media({ bitrate: 12_000_000 }))).toBe(true);
		expect(isAutomaticProxyCandidate(media({ fileSize: 512 * 1024 * 1024 }))).toBe(true);
		expect(isAutomaticProxyCandidate(media({ videoCodecSupported: false }))).toBe(true);
		expect(isAutomaticProxyCandidate(media({ mimeType: 'audio/mpeg', width: 0, height: 0 }))).toBe(
			false
		);
	});

	it('keeps compatibility proxies active at Full quality without forcing ordinary clips', () => {
		expect(shouldUseAutomaticProxy(media({ videoCodecSupported: false }), 'full')).toBe(true);
		expect(shouldUseAutomaticProxy(media(), 'full')).toBe(false);
		expect(shouldUseAutomaticProxy(media({ width: 3840, height: 2160 }), 'auto')).toBe(true);
	});
});
