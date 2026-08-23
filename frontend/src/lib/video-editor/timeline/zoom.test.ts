import { describe, expect, it } from 'vitest';
import {
	anchoredTimelineScrollLeft,
	centeredTimelineScrollLeft,
	clampTimelineZoom,
	cursorZoomAnchor,
	playheadZoomAnchor,
	timelineSliderToZoom,
	timelineZoomToFit,
	timelineZoomToSlider
} from './zoom';

describe('timeline zoom geometry', () => {
	it('clamps zoom and maps the logarithmic slider in both directions', () => {
		expect(clampTimelineZoom(0)).toBe(0.01);
		expect(clampTimelineZoom(50)).toBe(2);
		expect(timelineSliderToZoom(timelineZoomToSlider(1))).toBeCloseTo(1);
		expect(timelineSliderToZoom(0)).toBe(0.01);
		expect(timelineSliderToZoom(1)).toBe(2);
	});

	it('fits at least ten seconds of content inside the time viewport', () => {
		expect(
			timelineZoomToFit({
				viewportWidth: 1_000,
				headerWidth: 180,
				durationInFrames: 120,
				fps: 30
			})
		).toBeCloseTo(770 / (300 * 4));
		expect(
			timelineZoomToFit({
				viewportWidth: 1_000,
				headerWidth: 180,
				durationInFrames: 600,
				fps: 30
			})
		).toBeCloseTo(770 / (600 * 4));
	});

	it('keeps the exact frame below a cursor while zoom changes', () => {
		const anchor = cursorZoomAnchor({
			zoomLevel: 1,
			pointerScreenX: 500,
			scrollLeft: 200,
			headerWidth: 180,
			maxFrame: 1_000
		});
		expect(anchor.frame).toBe(130);
		expect(anchoredTimelineScrollLeft({ anchor, nextZoomLevel: 2, headerWidth: 180 })).toBe(720);
	});

	it('keeps button zoom anchored to the playhead screen position', () => {
		const anchor = playheadZoomAnchor({
			frame: 100,
			zoomLevel: 1,
			scrollLeft: 150,
			headerWidth: 180,
			maxFrame: 1_000
		});
		expect(anchor.screenX).toBe(430);
		expect(
			anchoredTimelineScrollLeft({ anchor, nextZoomLevel: 1.15, headerWidth: 180 })
		).toBeCloseTo(210);
	});

	it('centers 100 percent zoom in the time viewport', () => {
		expect(
			centeredTimelineScrollLeft({
				frame: 200,
				zoomLevel: 1,
				viewportWidth: 1_000,
				headerWidth: 180
			})
		).toBe(390);
	});
});
