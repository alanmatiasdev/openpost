import { describe, expect, it } from 'vitest';
import {
	buildPreviewDiagnosticReport,
	emptyPreviewFrameSampleState,
	previewHealth,
	recordPreviewFrameSample,
	type PreviewDiagnosticSnapshot
} from './diagnostics';

function snapshot(overrides: Partial<PreviewDiagnosticSnapshot> = {}): PreviewDiagnosticSnapshot {
	return {
		playing: true,
		targetFps: 30,
		playbackRate: 1,
		frameTimeEmaMs: 30,
		frameBudgetMs: 33.33,
		samples: 10,
		skippedFrames: 0,
		renderPath: 'composited',
		renderTimeMs: 4.567,
		renderWidth: 1280,
		renderHeight: 720,
		activeLayers: 3,
		qualityMode: 'auto',
		qualityScale: 1,
		readyProxies: 2,
		pendingProxies: 1,
		webgl2Ready: true,
		webgpuTransitionsReady: false,
		lastFallback: null,
		...overrides
	};
}

describe('preview diagnostics', () => {
	it('measures regular playback and counts skipped timeline frames', () => {
		let state = emptyPreviewFrameSampleState();
		state = recordPreviewFrameSample(state, { frame: 10, atMs: 100, fps: 30, playbackRate: 1 });
		state = recordPreviewFrameSample(state, { frame: 11, atMs: 133, fps: 30, playbackRate: 1 });
		state = recordPreviewFrameSample(state, { frame: 14, atMs: 233, fps: 30, playbackRate: 1 });

		expect(state.samples).toBe(2);
		expect(state.frameTimeEmaMs).toBeCloseTo(33.07, 1);
		expect(state.frameBudgetMs).toBeCloseTo(33.33, 1);
		expect(state.skippedFrames).toBe(2);
	});

	it('starts a fresh window after seeks, loop wraps, and hidden-tab gaps', () => {
		let state = recordPreviewFrameSample(emptyPreviewFrameSampleState(), {
			frame: 20,
			atMs: 100,
			fps: 60,
			playbackRate: 1
		});
		state = recordPreviewFrameSample(state, {
			frame: 5,
			atMs: 120,
			fps: 60,
			playbackRate: 1
		});
		state = recordPreviewFrameSample(state, {
			frame: 6,
			atMs: 2_000,
			fps: 60,
			playbackRate: 1
		});

		expect(state.samples).toBe(0);
		expect(state.skippedFrames).toBe(0);
		expect(state.frameBudgetMs).toBeCloseTo(16.67, 1);
	});

	it('reports waiting, reduced quality, load, and healthy playback from measured values', () => {
		expect(previewHealth(snapshot({ playing: false }))).toBe('waiting');
		expect(previewHealth(snapshot({ qualityScale: 0.5 }))).toBe('reduced');
		expect(previewHealth(snapshot({ frameTimeEmaMs: 45 }))).toBe('under-load');
		expect(previewHealth(snapshot())).toBe('smooth');
	});

	it('builds a privacy-safe report with rounded runtime values', () => {
		const report = JSON.parse(buildPreviewDiagnosticReport(snapshot()));

		expect(report).toEqual({
			version: 1,
			preview: {
				playing: true,
				targetFps: 30,
				playbackRate: 1,
				frameTimeMs: 30,
				frameBudgetMs: 33.33,
				sampleCount: 10,
				skippedFrames: 0,
				qualityMode: 'auto',
				qualityScale: 1
			},
			renderer: {
				path: 'composited',
				renderTimeMs: 4.57,
				width: 1280,
				height: 720,
				activeLayers: 3,
				webgl2Ready: true,
				webgpuTransitionsReady: false,
				lastFallback: null
			},
			media: { readyProxies: 2, pendingProxies: 1 }
		});
		expect(report.project).toBeUndefined();
		expect(report.media.ids).toBeUndefined();
	});
});
