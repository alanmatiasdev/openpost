import { describe, expect, it } from 'vitest';
import {
	getSettingsDestinations,
	normalizeSettingsTab,
	settingsTabIDs
} from './settings-navigation';

describe('settings destination registry', () => {
	it('registers ownership once with its navigation and page metadata', () => {
		const ownership = getSettingsDestinations(false).find(
			(destination) => destination.id === 'ownership'
		);

		expect(settingsTabIDs.filter((id) => id === 'ownership')).toHaveLength(1);
		expect(ownership).toMatchObject({
			group: 'organization',
			loadingVariant: 'form'
		});
		expect(ownership?.title).toBe(ownership?.label);
	});

	it('keeps instance destinations restricted and legacy aliases stable', () => {
		expect(
			getSettingsDestinations(false).some((destination) => destination.group === 'instance')
		).toBe(false);
		expect(getSettingsDestinations(true).some((destination) => destination.id === 'instance')).toBe(
			true
		);
		expect(normalizeSettingsTab('instance', false)).toBe('general');
		expect(normalizeSettingsTab('instance', true)).toBe('instance');
		expect(normalizeSettingsTab('billing', false)).toBe('plan');
		expect(normalizeSettingsTab('team', false)).toBe('members');
		expect(normalizeSettingsTab('social-accounts', false)).toBe('accounts');
	});
});
