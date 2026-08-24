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
	const onexportjson = vi.fn(async () => undefined);
	const onexportbundle = vi.fn(async () => undefined);
	const screen = await render(ProjectBrowser, {
		projects: [project('alpha', 'Alpha launch', 100), project('beta', 'Beta update', 200)],
		loading: false,
		error: '',
		creating: false,
		importing: false,
		duplicatingId: null,
		exportingId: null,
		exportingKind: null,
		bundleProgress: null,
		bundleOperation: null,
		bundleCanceling: false,
		oncreate: vi.fn(async () => true),
		onimportjson: vi.fn(async () => undefined),
		onimportbundle: vi.fn(async () => undefined),
		onopen: vi.fn(),
		onrename: vi.fn(async () => undefined),
		onduplicate,
		onexportjson,
		onexportbundle,
		oncancelbundle: vi.fn(),
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
	await screen.getByRole('menuitem', { name: 'Export bundle' }).click();
	expect(onexportbundle).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }));
	await screen.getByRole('button', { name: 'Actions for Beta update' }).click();
	await screen.getByRole('menuitem', { name: 'Export JSON' }).click();
	expect(onexportjson).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }));
	await screen.getByRole('button', { name: 'Import project' }).click();
	await expect.element(screen.getByRole('menuitem', { name: 'Import bundle' })).toBeVisible();
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
});

it('reports bundle progress and lets the user cancel at 320 pixels', async () => {
	await page.viewport(320, 720);
	const oncancelbundle = vi.fn();
	const screen = await render(ProjectBrowser, {
		projects: [project('alpha', 'Alpha launch', 100)],
		loading: false,
		error: '',
		creating: false,
		importing: false,
		duplicatingId: null,
		exportingId: 'alpha',
		exportingKind: 'bundle',
		bundleProgress: { stage: 'packaging', percent: 42, currentFile: 'launch.mp4' },
		bundleOperation: 'export',
		bundleCanceling: false,
		oncreate: vi.fn(async () => true),
		onimportjson: vi.fn(async () => undefined),
		onimportbundle: vi.fn(async () => undefined),
		onopen: vi.fn(),
		onrename: vi.fn(async () => undefined),
		onduplicate: vi.fn(async () => undefined),
		onexportjson: vi.fn(async () => undefined),
		onexportbundle: vi.fn(async () => undefined),
		oncancelbundle,
		ondelete: vi.fn(async () => undefined)
	});

	await expect.element(screen.getByText('42%')).toBeVisible();
	await expect.element(screen.getByText('launch.mp4')).toHaveAttribute('title', 'launch.mp4');
	const progress = screen.getByRole('progressbar', { name: 'Exporting bundle' });
	await expect.element(progress).toHaveAttribute('aria-valuenow', '42');
	await screen.getByRole('button', { name: 'Cancel' }).click();
	expect(oncancelbundle).toHaveBeenCalledOnce();
	await expect.element(screen.getByRole('button', { name: 'Import project' })).toBeDisabled();
	expect(screen.container.scrollWidth).toBeLessThanOrEqual(screen.container.clientWidth);
});
