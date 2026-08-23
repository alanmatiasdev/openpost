import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TRANSCRIPTION_MODEL,
	PARAKEET_SUPPORTED_LANGUAGES,
	TRANSCRIPTION_MODEL_OPTIONS,
	resolveTranscriptionEngine,
	transcriptionModelLabel
} from './models';

describe('transcription model registry', () => {
	it('exposes every supported local model with Parakeet as the default', () => {
		expect(DEFAULT_TRANSCRIPTION_MODEL).toBe('parakeet-tdt-v3');
		expect(TRANSCRIPTION_MODEL_OPTIONS.map((option) => option.value)).toEqual([
			'parakeet-tdt-v3',
			'whisper-base',
			'whisper-small',
			'whisper-large',
			'whisper-tiny'
		]);
		expect(transcriptionModelLabel('whisper-large')).toBe('Whisper Large v3 Turbo');
	});

	it('uses Parakeet for supported languages with WebGPU', () => {
		expect(PARAKEET_SUPPORTED_LANGUAGES.has('pt')).toBe(true);
		expect(resolveTranscriptionEngine('parakeet-tdt-v3', ' PT ', { webgpu: true })).toEqual({
			engine: 'parakeet',
			model: 'parakeet-tdt-v3'
		});
	});

	it('falls back to Whisper Base for unsupported languages', () => {
		expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'ja', { webgpu: true })).toEqual({
			engine: 'whisper',
			model: 'whisper-base',
			fallbackReason: 'language'
		});
	});

	it('falls back to Whisper Base without WebGPU', () => {
		expect(resolveTranscriptionEngine('parakeet-tdt-v3', 'en', { webgpu: false })).toEqual({
			engine: 'whisper',
			model: 'whisper-base',
			fallbackReason: 'no-webgpu'
		});
	});

	it('keeps explicit Whisper choices on Whisper', () => {
		expect(resolveTranscriptionEngine('whisper-small', 'zh', { webgpu: false })).toEqual({
			engine: 'whisper',
			model: 'whisper-small'
		});
	});
});
