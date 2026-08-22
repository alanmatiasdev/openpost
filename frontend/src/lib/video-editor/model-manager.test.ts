import { describe, expect, it } from 'vitest';
import { parseStaticModelManifest } from './model-manager';

const validManifest = {
	version: 1,
	models: [
		{
			id: 'silero-vad',
			kind: 'vad',
			version: '6.2',
			path: 'silero-vad-v6.2.onnx',
			size_bytes: 12,
			sha256: 'model-checksum',
			files: [{ path: 'silero-vad-v6.2.onnx', size_bytes: 12, sha256: 'file-checksum' }]
		}
	]
};

describe('parseStaticModelManifest', () => {
	it('keeps the pinned model download contract', () => {
		expect(parseStaticModelManifest(validManifest)).toEqual(validManifest);
	});

	it('rejects partial or malformed manifests', () => {
		expect(parseStaticModelManifest({ ...validManifest, version: 2 })).toBeNull();
		expect(
			parseStaticModelManifest({
				...validManifest,
				models: [{ ...validManifest.models[0], files: [{ path: 'model', size_bytes: '12' }] }]
			})
		).toBeNull();
	});
});
