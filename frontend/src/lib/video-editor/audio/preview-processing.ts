import type { TimelineItem } from '../project/types';
import { appendResolvedAudioEqSources, getAudioEqSettings, isAudioEqStageActive } from './audio-eq';
import { getAudioPitchShiftSemitones, isAudioPitchShiftActive } from './audio-pitch';

export function previewAudioEqStages(item: TimelineItem) {
	return appendResolvedAudioEqSources(undefined, getAudioEqSettings(item));
}

/** Native media playback cannot preserve pitch while changing clip tempo. */
export function requiresProcessedPreviewAudio(item: TimelineItem): boolean {
	return (
		Math.abs((item.speed ?? 1) - 1) > 0.0001 ||
		isAudioPitchShiftActive(getAudioPitchShiftSemitones(item)) ||
		previewAudioEqStages(item).some(isAudioEqStageActive)
	);
}
