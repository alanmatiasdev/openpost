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

	it('does not treat the broad filler-word CLAP label as audio proof', () => {
		// Captured from Xenova/clap-htsat-unfused (q8) for the spoken sentence
		// "The project is ready for review." The generic label dominated even
		// though the explicit hesitation labels correctly rejected the clip.
		expect(
			classifyFillerAudioConfidence([
				{ label: 'filler word', score: 0.7368325591087341 },
				{ label: 'hesitation sound', score: 0.0004259230918250978 },
				{ label: 'person saying um', score: 0.0009275225456804037 },
				{ label: 'person saying uh', score: 0.00017002446111291647 },
				{ label: 'person hesitating while speaking', score: 0.0003350691986270249 },
				{ label: 'normal speech', score: 0.25064781308174133 }
			])
		).toMatchObject({
			level: 'low',
			fillerScore: 0.0009275225456804037,
			nonFillerScore: 0.25064781308174133,
			label: 'person saying um'
		});
	});
});
