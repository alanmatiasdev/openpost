import { describe, expect, it } from 'vitest';
import {
	isNavigationItemActive,
	isOrganizationOwnershipSettingsRoute,
	primaryNavigation
} from './app-navigation';

describe('primary application navigation', () => {
	it('treats post details as part of Posts without claiming the composer root', () => {
		const posts = primaryNavigation.find((item) => item.id === 'posts');
		const composer = primaryNavigation.find((item) => item.id === 'new');

		expect(posts && isNavigationItemActive(posts, '/posts/post-123')).toBe(true);
		expect(composer && isNavigationItemActive(composer, '/posts/post-123')).toBe(false);
		expect(composer && isNavigationItemActive(composer, '/')).toBe(true);
	});

	it('recognizes both supported ownership Settings URLs without a Workspace', () => {
		expect(
			isOrganizationOwnershipSettingsRoute(new URL('https://openpost.test/settings?tab=ownership'))
		).toBe(true);
		expect(
			isOrganizationOwnershipSettingsRoute(new URL('https://openpost.test/settings#ownership'))
		).toBe(true);
		expect(
			isOrganizationOwnershipSettingsRoute(new URL('https://openpost.test/settings#plan'))
		).toBe(false);
	});
});
