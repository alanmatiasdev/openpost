import { describe, expect, it } from 'vitest';
import {
	directUploadSupportedFromStorageResponse,
	directUploadHeadersForBrowser,
	normalizedUploadErrorMessage,
	shouldUseMultipartFallback,
	UploadRequestError
} from './media-upload-client';

describe('media-upload-client', () => {
	it('filters headers that browser uploads cannot set manually', () => {
		const headers = directUploadHeadersForBrowser({
			Host: 'uploads.openpost.test',
			'Content-Length': '12',
			'Content-Type': 'image/png',
			'x-amz-meta-workspace': 'ws-1'
		});

		expect(headers.has('Host')).toBe(false);
		expect(headers.has('Content-Length')).toBe(false);
		expect(headers.get('Content-Type')).toBe('image/png');
		expect(headers.get('x-amz-meta-workspace')).toBe('ws-1');
	});

	it('uses multipart uploads only when the storage capability explicitly disables upload sessions', () => {
		expect(directUploadSupportedFromStorageResponse({ direct_upload_supported: false })).toBe(
			false
		);
		expect(directUploadSupportedFromStorageResponse({ direct_upload_supported: true })).toBe(true);
		expect(directUploadSupportedFromStorageResponse({})).toBe(true);
	});

	it('falls back only when direct upload sessions are unavailable', () => {
		expect(shouldUseMultipartFallback(new UploadRequestError('missing route', 404))).toBe(true);
		expect(
			shouldUseMultipartFallback(
				new UploadRequestError('direct media upload sessions require s3 storage', 400)
			)
		).toBe(true);
		expect(
			shouldUseMultipartFallback(new UploadRequestError('media_bytes_stored limit exceeded', 400))
		).toBe(false);
	});

	it('normalizes JSON upload problems without exposing serialized response bodies', () => {
		expect(
			normalizedUploadErrorMessage(
				JSON.stringify({ title: 'Upload failed', detail: 'This image exceeds the limit.' }),
				'application/problem+json',
				'Upload failed',
				413
			)
		).toBe('This image exceeds the limit.');
		expect(
			normalizedUploadErrorMessage(
				JSON.stringify({ unexpected: true }),
				'application/json',
				'Upload failed',
				422
			)
		).toBe('Upload failed (422)');
		expect(
			normalizedUploadErrorMessage(
				JSON.stringify({ detail: 'Upload quota reached.' }),
				null,
				'Upload failed',
				429
			)
		).toBe('Upload quota reached.');
		expect(
			normalizedUploadErrorMessage('Temporary upload failure', 'text/plain', 'Upload failed', 503)
		).toBe('Temporary upload failure');
	});
});
