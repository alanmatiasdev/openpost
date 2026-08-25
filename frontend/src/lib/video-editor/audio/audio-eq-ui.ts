import type { TimelineItem } from '../project/types';
import type { ResolvedAudioEqSettings } from './types';

export const AUDIO_EQ_SLOPE_OPTIONS = [6, 12, 18, 24] as const;
export const AUDIO_EQ_BAND1_FILTER_OPTIONS = [
	'low-shelf',
	'peaking',
	'high-shelf',
	'high-pass'
] as const;
export const AUDIO_EQ_INNER_FILTER_OPTIONS = [
	'low-shelf',
	'peaking',
	'high-shelf',
	'notch'
] as const;
export const AUDIO_EQ_BAND6_FILTER_OPTIONS = [
	'low-pass',
	'low-shelf',
	'peaking',
	'high-shelf'
] as const;

export function buildTimelineEqPatchFromResolvedSettings(
	settings: ResolvedAudioEqSettings
): Partial<TimelineItem> {
	return {
		audioEqOutputGainDb: settings.outputGainDb,
		audioEqBand1Enabled: settings.band1Enabled,
		audioEqBand1Type: settings.band1Type,
		audioEqBand1FrequencyHz: settings.band1FrequencyHz,
		audioEqBand1GainDb: settings.band1GainDb,
		audioEqBand1Q: settings.band1Q,
		audioEqBand1SlopeDbPerOct: settings.band1SlopeDbPerOct,
		audioEqLowCutEnabled: settings.lowCutEnabled,
		audioEqLowCutFrequencyHz: settings.lowCutFrequencyHz,
		audioEqLowCutSlopeDbPerOct: settings.lowCutSlopeDbPerOct,
		audioEqLowEnabled: settings.lowEnabled,
		audioEqLowType: settings.lowType,
		audioEqLowGainDb: settings.lowGainDb,
		audioEqLowFrequencyHz: settings.lowFrequencyHz,
		audioEqLowQ: settings.lowQ,
		audioEqLowMidEnabled: settings.lowMidEnabled,
		audioEqLowMidType: settings.lowMidType,
		audioEqLowMidGainDb: settings.lowMidGainDb,
		audioEqLowMidFrequencyHz: settings.lowMidFrequencyHz,
		audioEqLowMidQ: settings.lowMidQ,
		audioEqMidGainDb: 0,
		audioEqHighMidEnabled: settings.highMidEnabled,
		audioEqHighMidType: settings.highMidType,
		audioEqHighMidGainDb: settings.highMidGainDb,
		audioEqHighMidFrequencyHz: settings.highMidFrequencyHz,
		audioEqHighMidQ: settings.highMidQ,
		audioEqHighEnabled: settings.highEnabled,
		audioEqHighType: settings.highType,
		audioEqHighGainDb: settings.highGainDb,
		audioEqHighFrequencyHz: settings.highFrequencyHz,
		audioEqHighQ: settings.highQ,
		audioEqBand6Enabled: settings.band6Enabled,
		audioEqBand6Type: settings.band6Type,
		audioEqBand6FrequencyHz: settings.band6FrequencyHz,
		audioEqBand6GainDb: settings.band6GainDb,
		audioEqBand6Q: settings.band6Q,
		audioEqBand6SlopeDbPerOct: settings.band6SlopeDbPerOct,
		audioEqHighCutEnabled: settings.highCutEnabled,
		audioEqHighCutFrequencyHz: settings.highCutFrequencyHz,
		audioEqHighCutSlopeDbPerOct: settings.highCutSlopeDbPerOct
	};
}
