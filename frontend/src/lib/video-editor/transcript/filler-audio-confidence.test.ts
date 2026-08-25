import { describe, expect, it } from 'vitest';
import { classifyFillerAudioConfidence } from './filler-audio-confidence';

describe('filler audio confidence', () => {
	it('requires both a strong filler score and margin over ordinary speech', () => {
		expect(
			classifyFillerAudioConfidence([
				{ label: 'person saying um', score: 0.7 },
				{ label: 'normal speech', score: 0.3 }
			])
		).toMatchObject({ level: 'high', fillerScore: 0.7, nonFillerScore: 0.3 });
		expect(
			classifyFillerAudioConfidence([
				{ label: 'hesitation sound', score: 0.35 },
				{ label: 'normal speech', score: 0.32 }
			])
		).toMatchObject({ level: 'medium' });
		expect(
			classifyFillerAudioConfidence([
				{ label: 'filler word', score: 0.5 },
				{ label: 'normal speech', score: 0.49 }
			])
		).toMatchObject({ level: 'low' });
	});
});
