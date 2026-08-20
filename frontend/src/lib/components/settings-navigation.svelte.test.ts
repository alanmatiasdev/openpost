import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import SettingsNavigation from './settings-navigation.svelte';

describe('SettingsNavigation', () => {
	it('plays one tab cue for each desktop settings destination', async () => {
		const screen = render(SettingsNavigation, { active: 'profile' });
		const navigation = screen.getByTestId('settings-navigation');
		const destinations = navigation.getByRole('link');

		await expect.element(destinations.first()).toHaveAttribute('data-cuelume-toggle', 'toggle');
		for (const destination of await destinations.all()) {
			await expect.element(destination).toHaveAttribute('data-cuelume-toggle', 'toggle');
		}
	});
});
