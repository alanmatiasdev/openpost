import { describe, expect, it } from 'vitest';
import { colorPreviewStore } from './color-preview-store.svelte';

describe('color preview store', () => {
	it('keeps comparison state preview-only and clamps the split', () => {
		colorPreviewStore.__resetForTesting();
		colorPreviewStore.setComparisonMode('split');
		colorPreviewStore.setSplitPosition(2);
		expect(colorPreviewStore.comparisonMode).toBe('split');
		expect(colorPreviewStore.splitPosition).toBe(0.95);
	});

	it('resolves one picker request and cancels the previous request', async () => {
		colorPreviewStore.__resetForTesting();
		const first = colorPreviewStore.requestPick('one', 'white-balance');
		const second = colorPreviewStore.requestPick('two', 'black-point');
		expect(await first).toBeNull();
		colorPreviewStore.resolvePick({ r: 0.1, g: 0.2, b: 0.3 });
		expect(await second).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
	});

	it('resolves a requested final-frame capture for the matching item', async () => {
		colorPreviewStore.__resetForTesting();
		const capture = colorPreviewStore.requestFrameCapture('video');
		const image = new ImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1);
		colorPreviewStore.resolveFrameCapture('other', image);
		expect(colorPreviewStore.frameCaptureItemId).toBe('video');
		colorPreviewStore.resolveFrameCapture('video', image);
		expect(await capture).toBe(image);
		expect(colorPreviewStore.frameCaptureItemId).toBeNull();
	});

	it('overrides one GPU effect for preview without mutating the stored stack', () => {
		colorPreviewStore.__resetForTesting();
		const effect = {
			id: 'curves',
			type: 'gpu' as const,
			effectId: 'gpu-curves',
			params: { masterShadowY: 0.25 },
			enabled: true
		};
		colorPreviewStore.setEffectDraft('video', effect, { masterPoints: '[[0,0],[1,0.8]]' }, [
			'peer-curves'
		]);

		const preview = colorPreviewStore.applyEffectDraft('video', [effect]);
		expect(preview[0]).toMatchObject({
			params: { masterShadowY: 0.25, masterPoints: '[[0,0],[1,0.8]]' }
		});
		expect(effect.params).toEqual({ masterShadowY: 0.25 });
		const peerEffect = { ...effect, id: 'peer-curves' };
		expect(colorPreviewStore.applyEffectDraft('other', [peerEffect])[0]).toMatchObject({
			params: { masterPoints: '[[0,0],[1,0.8]]' }
		});
		expect(
			colorPreviewStore.applyEffectDraft('other', [{ ...effect, id: 'unselected' }])[0]
		).toEqual({
			...effect,
			id: 'unselected'
		});

		colorPreviewStore.clearEffectDraft('other', 'curves');
		expect(colorPreviewStore.effectDraft).not.toBeNull();
		colorPreviewStore.clearEffectDraft('video', 'curves');
		expect(colorPreviewStore.effectDraft).toBeNull();
	});
});
