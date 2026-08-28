import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = {
	backupProject: vi.fn(async () => undefined),
	deleteHandle: vi.fn(async () => undefined),
	exists: vi.fn(async () => false),
	getHandle: vi.fn(async () => null),
	listDirectory: vi.fn(async () => []),
	readBlob: vi.fn(async () => null),
	readJson: vi.fn(),
	readWorkspaceIndex: vi.fn(),
	removeEntry: vi.fn(async () => undefined),
	saveHandle: vi.fn(async () => undefined),
	writeBlob: vi.fn(async () => undefined),
	writeJsonAtomic: vi.fn(async () => undefined),
	writeWorkspaceIndex: vi.fn(async () => undefined)
};

vi.mock('../project/project-upgrade', () => ({
	ensureProjectUpgradeBackup: storage.backupProject
}));
vi.mock('./handles-db', () => ({
	deleteHandle: storage.deleteHandle,
	getHandle: storage.getHandle,
	saveHandle: storage.saveHandle
}));
vi.mock('./root', () => ({
	requireWorkspaceRoot: () => ({ kind: 'directory', name: 'Test workspace' })
}));
vi.mock('./fs-primitives', () => ({
	exists: storage.exists,
	listDirectory: storage.listDirectory,
	readBlob: storage.readBlob,
	readJson: storage.readJson,
	removeEntry: storage.removeEntry,
	writeBlob: storage.writeBlob,
	writeJsonAtomic: storage.writeJsonAtomic,
	WorkspaceFileCorruptError: class WorkspaceFileCorruptError extends Error {}
}));
vi.mock('./workspace-index', () => ({
	readWorkspaceIndex: storage.readWorkspaceIndex,
	sortIndexEntries: (entries: unknown[]) => entries,
	writeWorkspaceIndex: storage.writeWorkspaceIndex
}));
vi.mock('./with-key-lock', () => ({
	withKeyLock: async (_key: string, operation: () => Promise<unknown>) => operation()
}));

import { createBlankProject, CURRENT_SCHEMA_VERSION } from '../project/defaults';
import { getAllProjects, getProject } from './projects';

describe('workspace project migration boundaries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('normalizes legacy projects for the catalog without changing disk until one is opened', async () => {
		const legacy = createBlankProject('Legacy edit');
		legacy.id = 'legacy-project';
		legacy.schemaVersion = CURRENT_SCHEMA_VERSION - 1;
		storage.readWorkspaceIndex.mockResolvedValue({
			version: '1.0',
			updatedAt: legacy.updatedAt,
			projects: [{ id: legacy.id, name: legacy.name, updatedAt: legacy.updatedAt }]
		});
		storage.readJson.mockResolvedValue(legacy);

		const listed = await getAllProjects();

		expect(listed).toHaveLength(1);
		expect(listed[0]?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(storage.backupProject).not.toHaveBeenCalled();
		expect(storage.writeJsonAtomic).not.toHaveBeenCalled();

		const opened = await getProject(legacy.id);

		expect(opened?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(storage.backupProject).toHaveBeenCalledOnce();
		expect(storage.writeJsonAtomic).toHaveBeenCalledOnce();
	});
});
