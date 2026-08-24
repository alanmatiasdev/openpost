import { expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { Project } from '../project/types';
import ProjectBrowser from './project-browser.svelte';
import '../../../routes/layout.css';

function project(id: string, name: string, updatedAt: number): Project {
	return {
		id,
		name,
		description: `${name} campaign`,
		createdAt: updatedAt - 100,
		updatedAt,
		duration: 0,
		metadata: { width: 1920, height: 1080, fps: 30 },
		timeline: { tracks: [], items: [] }
	};
}

it('keeps project search and compact actions usable at 320 pixels', async () => {
	await page.viewport(320, 720);
	const onduplicate = vi.fn(async () => undefined);
	const onexport = vi.fn(async () => undefined);
	const screen = await render(ProjectBrowser, {
		projects: [project('alpha', 'Alpha launch', 100), project('beta', 'Beta update', 200)],
		loading: false,
		error: '',
		creating: false,
		importing: false,
		duplicatingId: null,
		exportingId: null,
		oncreate: vi.fn(async () => true),
		onimport: vi.fn(async () => undefined),
		onopen: vi.fn(),
		onrename: vi.fn(async () => undefined),
		onduplicate,
		onexport,
		ondelete: vi.fn(async () => undefined)
	});

	const search = screen.getByRole('textbox', { name: 'Search projects' });
	await search.fill('alpha');
	await expect.element(screen.getByText('Alpha launch')).toBeVisible();
	await expect.element(screen.getByText('Beta update')).not.toBeInTheDocument();
	await search.fill('');

	await screen.getByRole('button', { name: 'Actions for Beta update' }).click();
	await screen.getByRole('menuitem', { name: 'Duplicate' }).click();
	expect(onduplicate).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }));
	await screen.getByRole('button', { name: 'Actions for Beta update' }).click();
	await screen.getByRole('menuitem', { name: 'Export JSON' }).click();
	expect(onexport).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }));
	await expect.element(screen.getByRole('button', { name: 'Import JSON' })).toBeVisible();
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
});
