import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WorkspaceActivationCompletion from './workspace-activation-completion.svelte';

vi.mock('$lib/paraglide/messages', () => ({
	m: {
		workspace_activation_heading: () => 'Workspace activated',
		workspace_activation_description: () => 'Your first Publication is ready to track.',
		workspace_activation_view_publication: () => 'View publication',
		workspace_activation_create_another: () => 'Create another'
	}
}));

describe('WorkspaceActivationCompletion', () => {
	it('offers the completed Publication and a fresh composer without delay', async () => {
		const onCreateAnother = vi.fn();
		const screen = await render(WorkspaceActivationCompletion, {
			publicationID: 'publication/first',
			onCreateAnother
		});

		await expect
			.element(screen.getByRole('link', { name: 'View publication' }))
			.toHaveAttribute('href', '/publications/publication%2Ffirst');
		await screen.getByRole('button', { name: 'Create another' }).click();
		expect(onCreateAnother).toHaveBeenCalledOnce();
	});
});
