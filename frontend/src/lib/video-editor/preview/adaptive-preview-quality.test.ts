import { describe, expect, it } from 'vitest';
import {
	createAdaptivePreviewQualityState,
	previewFrameBudgetMs,
	updateAdaptivePreviewQuality
} from './adaptive-preview-quality';

describe('adaptive preview quality', () => {
	it('degrades only after sustained missed budgets and observes the cooldown', () => {
		let state = createAdaptivePreviewQualityState();
		for (let sample = 0; sample < 9; sample++) {
			state = updateAdaptivePreviewQuality({
				state,
				sampleMsPerFrame: 50,
				frameBudgetMs: previewFrameBudgetMs(30, 1),
				nowMs: 2_000 + sample * 50
			}).state;
		}
		expect(state.qualityCap).toBe(1);
		state = updateAdaptivePreviewQuality({
			state,
			sampleMsPerFrame: 50,
			frameBudgetMs: previewFrameBudgetMs(30, 1),
			nowMs: 2_500
		}).state;
		expect(state.qualityCap).toBe(0.5);

		for (let sample = 0; sample < 20; sample++) {
			state = updateAdaptivePreviewQuality({
				state,
				sampleMsPerFrame: 50,
				frameBudgetMs: previewFrameBudgetMs(30, 1),
				nowMs: 2_550 + sample * 50
			}).state;
		}
		expect(state.qualityCap).toBe(0.5);
	});

	it('recovers one step only after a longer stable run', () => {
		let state = createAdaptivePreviewQualityState(0.25);
		for (let sample = 0; sample < 35; sample++) {
			state = updateAdaptivePreviewQuality({
				state,
				sampleMsPerFrame: 10,
				frameBudgetMs: previewFrameBudgetMs(30, 1),
				nowMs: 2_000 + sample * 34
			}).state;
		}
		expect(state.qualityCap).toBe(0.25);
		state = updateAdaptivePreviewQuality({
			state,
			sampleMsPerFrame: 10,
			frameBudgetMs: previewFrameBudgetMs(30, 1),
			nowMs: 3_300
		}).state;
		expect(state.qualityCap).toBe(0.33);
	});
});
