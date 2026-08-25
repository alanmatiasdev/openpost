import { describe, expect, it } from 'vitest';
import {
	ALL_FORMATS,
	AudioSampleSink,
	BlobSource,
	BufferTarget,
	Input,
	Mp4OutputFormat,
	Output
} from 'mediabunny';
import ac3FixtureUrl from '../fixtures/tone-ac3.mkv?url';
import { setupAudioCopy } from './render-support';
import * as mediabunny from 'mediabunny';
import { ensureAc3DecoderForCodec } from '../ac3-decoder';

describe('processed-media audio preservation', () => {
	it('preserves and decodes real AC-3 audio in processed MP4 media', async () => {
		const response = await fetch(ac3FixtureUrl);
		expect(response.ok).toBe(true);
		const input = new Input({
			formats: ALL_FORMATS,
			source: new BlobSource(await response.blob())
		});
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat(), target });
		try {
			const audio = await setupAudioCopy(mediabunny, input, output);
			await output.start();
			await audio.drain();
			await output.finalize();
			expect(target.buffer).not.toBeNull();

			const rendered = new Input({
				formats: ALL_FORMATS,
				source: new BlobSource(new Blob([target.buffer!], { type: 'video/mp4' }))
			});
			try {
				const track = await rendered.getPrimaryAudioTrack();
				expect(track).not.toBeNull();
				expect(track?.codec).toBe('ac3');
				await ensureAc3DecoderForCodec(track?.codec);
				let sampleCount = 0;
				for await (const sample of new AudioSampleSink(track!).samples()) {
					sampleCount += 1;
					sample.close();
				}
				expect(sampleCount).toBeGreaterThan(0);
			} finally {
				rendered.dispose();
			}
		} finally {
			input.dispose();
		}
	});
});
