import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { ui } from '$lib/stores/ui.svelte';
import WorkspaceSetupGuide from './workspace-setup-guide.svelte';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('$lib/api/client', () => ({ client: { GET: mocks.get } }));

vi.mock('$lib/paraglide/messages', () => ({
	m: {
		workspace_setup_heading: () => 'Finish setting up this Workspace',
		workspace_setup_progress: ({ completed, total }: { completed: number; total: number }) =>
			`${completed} of ${total} complete`,
		workspace_setup_name_description: () =>
			'Give this Workspace a name before you connect a destination.',
		workspace_setup_checkout_description: () =>
			'Resume checkout to start your plan, then connect a destination.',
		workspace_setup_destination_description: () =>
			'Connect a destination so OpenPost can prepare your first Publication.',
		workspace_setup_publication_description: () =>
			'Schedule or submit your first Publication to activate this Workspace.',
		workspace_setup_resume_checkout: () => 'Resume checkout',
		workspace_setup_name_workspace: () => 'Name this Workspace',
		workspace_setup_connect_destination: () => 'Connect a destination',
		workspace_setup_create_publication: () => 'Create a Publication',
		workspace_setup_workspace: () => 'Workspace',
		workspace_setup_subscription: () => 'Plan',
		workspace_setup_destination: () => 'Destination',
		workspace_setup_composition: () => 'Composition',
		workspace_setup_publication: () => 'Publication'
	}
}));

describe('WorkspaceSetupGuide', () => {
	beforeEach(() => mocks.get.mockReset());

	it('shows server-projected progress and only its authorized next action', async () => {
		mocks.get.mockResolvedValue({
			data: {
				visible: true,
				activated: false,
				completed_steps: 3,
				total_steps: 4,
				next_step: 'publication',
				next_action: 'create_publication',
				action_href: '/',
				steps: [
					{ id: 'workspace', completed: true },
					{ id: 'destination', completed: true },
					{ id: 'composition', completed: true },
					{ id: 'publication', completed: false }
				]
			}
		});

		const screen = await render(WorkspaceSetupGuide, { workspaceID: 'workspace-1' });
		const guide = screen.getByTestId('workspace-setup-guide-home');
		await expect.element(guide).toBeVisible();
		await expect.element(guide).toHaveTextContent('3 of 4 complete');
		await expect.element(guide).toHaveTextContent('Schedule or submit your first Publication');
		await expect
			.element(screen.getByRole('link', { name: 'Create a Publication' }))
			.toHaveAttribute('href', '/');
		expect(mocks.get).toHaveBeenCalledWith('/workspaces/{id}/setup', {
			params: { path: { id: 'workspace-1' } }
		});
	});

	it('stays absent after server-projected activation', async () => {
		mocks.get.mockResolvedValue({
			data: {
				visible: false,
				activated: true,
				completed_steps: 3,
				total_steps: 3,
				steps: []
			}
		});

		const screen = await render(WorkspaceSetupGuide, { workspaceID: 'workspace-1' });
		await expect.element(screen.getByTestId('workspace-setup-guide-home')).not.toBeInTheDocument();
	});

	it('refreshes its projection after workspace state changes', async () => {
		mocks.get
			.mockResolvedValueOnce({
				data: {
					visible: true,
					activated: false,
					completed_steps: 2,
					total_steps: 3,
					next_action: 'create_publication',
					action_href: '/',
					steps: []
				}
			})
			.mockResolvedValueOnce({
				data: {
					visible: false,
					activated: true,
					completed_steps: 3,
					total_steps: 3,
					steps: []
				}
			});

		const screen = await render(WorkspaceSetupGuide, { workspaceID: 'workspace-1' });
		await expect.element(screen.getByTestId('workspace-setup-guide-home')).toBeVisible();
		ui.refreshWorkspaceSetup();
		await expect.element(screen.getByTestId('workspace-setup-guide-home')).not.toBeInTheDocument();
	});
});
