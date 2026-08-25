import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import { getGpuEffect } from './registry';
import { gpuEffectLabel, gpuOptionLabel, gpuParamLabel } from './i18n';

describe('GPU effect localization', () => {
	afterEach(() => setLocale('en', { reload: false }));

	it('localizes effect, parameter, and option labels without changing stored values', () => {
		const brightness = getGpuEffect('gpu-brightness');
		expect(brightness).toBeDefined();
		const amount = brightness?.schema[0];
		expect(amount).toBeDefined();

		setLocale('pt', { reload: false });

		expect(gpuEffectLabel(brightness!)).toBe('Luminosidade');
		expect(gpuParamLabel(amount!)).toBe('Intensidade');
		expect(gpuOptionLabel({ label: 'Right' })).toBe('Direita');
		expect(brightness?.id).toBe('gpu-brightness');
		expect(amount?.name).toBe('amount');
	});
});
