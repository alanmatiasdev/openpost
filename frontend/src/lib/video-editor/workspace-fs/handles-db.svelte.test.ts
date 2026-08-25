import { beforeEach, expect, test } from 'vitest';
import {
	__resetHandlesDBForTesting,
	activateWorkspaceHandle,
	getWorkspaceHandleRecord,
	listKnownWorkspaces,
	removeKnownWorkspace,
	saveWorkspaceHandleRecord
} from './handles-db';

function directory(name: string): FileSystemDirectoryHandle {
	// SAFETY: these tests only persist and compare the handle fields represented by this cloneable stub.
	return { kind: 'directory', name } as FileSystemDirectoryHandle;
}

beforeEach(async () => {
	await __resetHandlesDBForTesting();
});

test('persists known workspaces and clears the active pointer only when its folder is removed in Chromium', async () => {
	await saveWorkspaceHandleRecord(directory('Launch edits'));
	const launch = await getWorkspaceHandleRecord();
	expect(launch?.name).toBe('Launch edits');
	expect(launch?.activeWorkspaceId).toBeTruthy();

	await saveWorkspaceHandleRecord(directory('Archive'));
	const known = await listKnownWorkspaces();
	expect(known.map((record) => record.name)).toEqual(['Archive', 'Launch edits']);
	const archive = await getWorkspaceHandleRecord();
	expect(archive?.name).toBe('Archive');

	await removeKnownWorkspace(launch?.activeWorkspaceId ?? '');
	expect((await getWorkspaceHandleRecord())?.name).toBe('Archive');
	expect((await listKnownWorkspaces()).map((record) => record.name)).toEqual(['Archive']);

	await removeKnownWorkspace(archive?.activeWorkspaceId ?? '');
	expect(await getWorkspaceHandleRecord()).toBeNull();
	expect(await listKnownWorkspaces()).toEqual([]);
});

test('activates a known workspace without duplicating it', async () => {
	await saveWorkspaceHandleRecord(directory('Launch edits'));
	const launchId = (await getWorkspaceHandleRecord())?.activeWorkspaceId;
	await saveWorkspaceHandleRecord(directory('Archive'));

	const activated = await activateWorkspaceHandle(launchId ?? '');
	expect(activated?.name).toBe('Launch edits');
	expect((await getWorkspaceHandleRecord())?.activeWorkspaceId).toBe(launchId);
	expect((await listKnownWorkspaces()).map((record) => record.name)).toEqual([
		'Launch edits',
		'Archive'
	]);
});
