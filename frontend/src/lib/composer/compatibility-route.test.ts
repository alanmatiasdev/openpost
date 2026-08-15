import { describe, expect, it } from 'vitest';
import { canonicalPublicationPathFromLegacyPost } from './compatibility-route';

describe('legacy Post composer compatibility route', () => {
	it('resolves an old Post identifier to its canonical Publication URL', () => {
		expect(canonicalPublicationPathFromLegacyPost({ publication_id: 'publication:legacy/1' })).toBe(
			'/publications/publication%3Alegacy%2F1'
		);
	});

	it('fails closed when a legacy Post has no canonical Publication', () => {
		expect(canonicalPublicationPathFromLegacyPost({ publication_id: '' })).toBeNull();
		expect(canonicalPublicationPathFromLegacyPost(null)).toBeNull();
	});
});
