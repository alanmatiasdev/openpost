import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { WorkspaceGate } from '$lib/video-editor/gate/workspace-gate.svelte';
import type { HandleRecord } from '$lib/video-editor/workspace-fs/handles-db';
import WorkspaceIndicator from './workspace-indicator.svelte';

function workspace(id: string, name: string): HandleRecord {
	return {
		key: `workspace:${id}`,
		kind: 'workspace',
		id,
		name,
		// SAFETY: the indicator only reads the record id and name, never the handle methods.
		handle: { name } as FileSystemDirectoryHandle,
		pickedAt: 1
	};
}

function gateFixture(): WorkspaceGate {
	return {
		state: 'ready',
		workspaceName: 'Launch edits',
		activeWorkspaceId: 'launch',
		workspaceRevision: 1,
		knownWorkspaces: [workspace('launch', 'Launch edits'), workspace('archive', 'Archive')],
		busy: false,
		error: '',
		pickFolder: vi.fn(async () => {}),
		reconnect: vi.fn(async () => {}),
		chooseDifferentFolder: vi.fn(async () => {}),
		switchWorkspace: vi.fn(async () => {}),
		forgetWorkspace: vi.fn(async () => {})
	};
}

afterEach(async () => {
	await page.viewport(1280, 900);
});

test('lists, switches, adds, and confirms removal of known workspaces', async () => {
	const gate = gateFixture();
	const screen = await render(WorkspaceIndicator, { gate });

	await screen.getByRole('button', { name: /Launch edits/ }).click();
	await expect.element(screen.getByText('Launch edits', { exact: true }).nth(1)).toBeVisible();
	await expect.element(screen.getByText('Active', { exact: true })).toBeVisible();

	await screen.getByRole('button', { name: 'Switch' }).click();
	expect(gate.switchWorkspace).toHaveBeenCalledExactlyOnceWith('archive');

	await screen.getByRole('button', { name: /Launch edits/ }).click();
	await screen.getByRole('button', { name: 'Remove Archive' }).click();
	await screen.getByRole('button', { name: 'Remove', exact: true }).click();
	expect(gate.forgetWorkspace).toHaveBeenCalledExactlyOnceWith('archive');

	await screen.getByRole('button', { name: 'Add workspace folder' }).click();
	expect(gate.pickFolder).toHaveBeenCalledOnce();
});

test('keeps the workspace control and menu within a 320px viewport', async () => {
	await page.viewport(320, 720);
	const screen = await render(WorkspaceIndicator, { gate: gateFixture() });
	const trigger = screen.getByRole('button', { name: 'Launch edits', exact: true });
	await expect.element(trigger).toHaveStyle({ minHeight: '44px' });
	await trigger.click();

	const menu = screen.getByRole('menu', { name: 'Editing workspaces' }).element();
	expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(320);
	expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
	await trigger.click();
});
