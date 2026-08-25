import { describe, expect, it } from 'vitest';
import {
	buildFrameFileName,
	clampMonitorVolume,
	normalizePreviewZoom,
	previewItemVolume,
	previewItemVolumeWithFade,
	zoomPreview
} from './playback-settings';
const item = { trackId: 'main', volume: 0.5 };
const track = {
	id: 'main',
	muted: false,
	visible: true,
	solo: false,
	volume: 0.8
};

describe('preview playback settings', () => {
	it('keeps fit mode and clamps fixed zoom to FreeCut bounds', () => {
		expect(normalizePreviewZoom(-1)).toBe(-1);
		expect(normalizePreviewZoom(0.01)).toBe(0.1);
		expect(normalizePreviewZoom(4)).toBe(2);
		expect(normalizePreviewZoom(Number.NaN)).toBe(-1);
	});

	it('zooms in and out by twenty percent', () => {
		expect(zoomPreview(1, 'in')).toBe(1.2);
		expect(zoomPreview(1, 'out')).toBe(0.83);
		expect(zoomPreview(-1, 'in')).toBe(1.2);
	});

	it('clamps device monitor gain', () => {
		expect(clampMonitorVolume(-0.5)).toBe(0);
		expect(clampMonitorVolume(0.42)).toBe(0.42);
		expect(clampMonitorVolume(2)).toBe(1);
	});

	it('keeps monitor gain separate from clip and track gain', () => {
		expect(previewItemVolume(item, [track], 0.5, false)).toBeCloseTo(0.2);
		expect(previewItemVolume(item, [{ ...track, muted: true }], 1, false)).toBe(0);
		expect(previewItemVolume(item, [{ ...track, visible: false }], 1, false)).toBe(0);
		expect(previewItemVolume(item, [track], 1, true)).toBe(0);
		expect(previewItemVolume(item, [track, { ...track, id: 'solo', solo: true }], 1, false)).toBe(
			0
		);
	});

	it('composes clip fades with transition fades', () => {
		expect(previewItemVolumeWithFade(0.8, 0.5, 0.25)).toBeCloseTo(0.1);
	});

	it('applies group visibility, mute, and solo to preview gain', () => {
		const group = {
			...track,
			id: 'group',
			isGroup: true,
			muted: true
		};
		const child = { ...track, parentTrackId: group.id };
		expect(previewItemVolume(item, [group, child], 1, false)).toBe(0);
		expect(
			previewItemVolume(item, [{ ...group, muted: false, visible: false }, child], 1, false)
		).toBe(0);
		expect(
			previewItemVolume(item, [{ ...group, muted: false, solo: true }, child], 1, false)
		).toBeCloseTo(0.4);
	});

	it('builds stable frame capture names', () => {
		expect(buildFrameFileName(48, 24, 240)).toBe('frame-048-00-00-02-00.png');
		expect(buildFrameFileName(-1, 0, 0)).toBe('frame-0-00-00-00-00.png');
	});
});
