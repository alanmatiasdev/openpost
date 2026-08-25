import { describe, expect, it } from 'vitest';
import {
	MIXER_MAX_DB,
	MIXER_MIN_DB,
	advanceMeterBallistics,
	createMeterBallistics,
	meterLevelToPercent,
	mixerDbToFaderPercent,
	mixerDbToGain,
	mixerFaderPercentToDb,
	mixerGainToDb
} from './mixer-utils';

describe('audio mixer value mapping', () => {
	it('round-trips fader positions and uses silence at the lower stop', () => {
		for (const db of [-60, -42.5, -12, 0, 6, 12]) {
			expect(mixerFaderPercentToDb(mixerDbToFaderPercent(db))).toBeCloseTo(db, 8);
		}
		expect(mixerDbToFaderPercent(MIXER_MIN_DB)).toBe(0);
		expect(mixerDbToFaderPercent(MIXER_MAX_DB)).toBe(100);
		expect(mixerDbToGain(MIXER_MIN_DB)).toBe(0);
		expect(mixerGainToDb(0)).toBe(MIXER_MIN_DB);
		expect(mixerGainToDb(mixerDbToGain(6))).toBeCloseTo(6, 8);
	});

	it('holds peaks, decays smoothly, and keeps the meter scale logarithmic', () => {
		const state = createMeterBallistics();
		advanceMeterBallistics(state, 0.8, 0.4, 1000);
		expect(state.left).toBeGreaterThan(state.right);
		expect(state.peakLeft).toBe(state.left);
		expect(state.holdLeftMs).toBe(350);

		const heldPeak = state.peakLeft;
		advanceMeterBallistics(state, 0, 0, 1100);
		expect(state.left).toBeLessThan(heldPeak);
		expect(state.peakLeft).toBe(heldPeak);
		expect(state.holdLeftMs).toBeGreaterThan(0);
		expect(meterLevelToPercent(1)).toBeGreaterThan(meterLevelToPercent(0.1));
		expect(meterLevelToPercent(0.001)).toBe(0);
	});
});
