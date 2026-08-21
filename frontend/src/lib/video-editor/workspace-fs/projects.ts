/**
 * Projects store backed by the workspace folder.
 *
 * Each project lives at `projects/{id}/project.json` with an entry in
 * `index.json`. The non-serializable `rootFolderHandle` is stripped on write
 * and re-attached on read via the handles registry.
 *
 * Ported from FreeCut (MIT) — workspace-fs/projects.ts.
 */

import type { Project } from '../project/types';
import { migrateProjectDocument } from '../project/defaults';
import { createLogger } from './logger';
import { deleteHandle, getHandle, saveHandle } from './handles-db';
import { requireWorkspaceRoot } from './root';
import {
	exists,
	listDirectory,
	readJson,
	removeEntry,
	writeJsonAtomic,
	WorkspaceFileCorruptError
} from './fs-primitives';
import { PROJECTS_DIR, projectDir, projectJsonPath, projectTrashedMarkerPath } from './paths';
import {
	readWorkspaceIndex,
	sortIndexEntries,
	writeWorkspaceIndex,
	type WorkspaceIndexEntry
} from './workspace-index';
import { withKeyLock } from './with-key-lock';

/**
 * Single key for every `index.json` mutation — serializes concurrent creates
 * so the rebuilt index can't drop another caller's entry.
 */
const INDEX_LOCK_KEY = 'projects:index';

const logger = createLogger('WorkspaceFS:Projects');

/** Shape stored in project.json — no FileSystem*Handle fields. */
type SerializedProject = Omit<Project, 'rootFolderHandle'>;

async function stashRootFolderHandle(project: Project): Promise<SerializedProject> {
	const { rootFolderHandle, ...rest } = project;
	if (rootFolderHandle) {
		await saveHandle({
			kind: 'project-folder',
			id: project.id,
			handle: rootFolderHandle,
			name: rootFolderHandle.name,
			pickedAt: Date.now()
		});
	} else {
		await deleteHandle('project-folder', project.id).catch((error) => {
			logger.warn(`Failed to clean project-folder handle for ${project.id}`, error);
		});
	}
	return rest;
}

async function restoreRootFolderHandle(serialized: SerializedProject): Promise<Project> {
	const record = await getHandle('project-folder', serialized.id);
	if (record) {
		return {
			...serialized,
			// SAFETY: project-folder records always store directory handles.
			rootFolderHandle: record.handle as FileSystemDirectoryHandle,
			rootFolderName: record.name
		};
	}
	// SAFETY: without a stashed handle the record is the plain document.
	return serialized as Project;
}

async function isTrashed(root: FileSystemDirectoryHandle, id: string): Promise<boolean> {
	return exists(root, projectTrashedMarkerPath(id));
}

async function rebuildIndex(root: FileSystemDirectoryHandle): Promise<WorkspaceIndexEntry[]> {
	const entries = await listDirectory(root, [PROJECTS_DIR]);
	const indexEntries: WorkspaceIndexEntry[] = [];
	for (const entry of entries) {
		if (entry.kind !== 'directory') continue;
		// Trashed projects are invisible to listings and the index.
		if (await isTrashed(root, entry.name)) continue;
		let project: SerializedProject | null = null;
		try {
			project = await readJson<SerializedProject>(root, projectJsonPath(entry.name));
		} catch (error) {
			if (!(error instanceof WorkspaceFileCorruptError)) throw error;
			logger.warn(`rebuildIndex: skipping corrupt project.json for ${entry.name}`, error);
			continue;
		}
		if (!project) continue;
		indexEntries.push({
			id: project.id,
			name: project.name,
			updatedAt: project.updatedAt
		});
	}
	return indexEntries;
}

/**
 * Rebuild `index.json` from a directory scan, persist it, and return the
 * entries. `persist='best-effort'` serves scanned entries even when the write
 * fails (read-only mounts) because `projects/` is the source of truth.
 */
async function refreshIndex(
	root: FileSystemDirectoryHandle,
	persist: 'required' | 'best-effort' = 'required'
): Promise<WorkspaceIndexEntry[]> {
	return withKeyLock(INDEX_LOCK_KEY, async () => {
		const entries = sortIndexEntries(await rebuildIndex(root));
		try {
			await writeWorkspaceIndex(root, entries);
		} catch (error) {
			if (persist === 'required') throw error;
			logger.warn('refreshIndex: could not persist index.json — serving from scan', error);
		}
		return entries;
	});
}

/**
 * Incrementally add/update a single index entry without re-reading every
 * other project. Falls back to a full scan when the on-disk index is empty.
 */
async function upsertIndexEntry(
	root: FileSystemDirectoryHandle,
	entry: WorkspaceIndexEntry
): Promise<void> {
	await withKeyLock(INDEX_LOCK_KEY, async () => {
		const index = await readWorkspaceIndex(root);
		const baseEntries = index.projects.length > 0 ? index.projects : await rebuildIndex(root);
		const next = baseEntries.some((existing) => existing.id === entry.id)
			? baseEntries.map((existing) => (existing.id === entry.id ? entry : existing))
			: [...baseEntries, entry];
		await writeWorkspaceIndex(root, next);
	});
}

/* ────────────────────────────── Public API ───────────────────────────── */

export async function getAllProjects(): Promise<Project[]> {
	const root = requireWorkspaceRoot();
	try {
		let entries = (await readWorkspaceIndex(root)).projects;
		if (entries.length === 0) {
			entries = await refreshIndex(root, 'best-effort');
		}
		const projects: Project[] = [];
		for (const entry of entries) {
			if (await isTrashed(root, entry.id)) continue;
			let serialized: SerializedProject | null = null;
			try {
				serialized = await readJson<SerializedProject>(root, projectJsonPath(entry.id));
			} catch (error) {
				if (!(error instanceof WorkspaceFileCorruptError)) throw error;
				logger.warn(`getAllProjects: skipping corrupt project.json for ${entry.id}`, error);
				continue;
			}
			if (!serialized) continue;
			projects.push(await restoreRootFolderHandle(serialized));
		}
		return projects;
	} catch (error) {
		throw new Error('Failed to load projects from workspace', { cause: error });
	}
}

export async function getProject(id: string): Promise<Project | undefined> {
	const root = requireWorkspaceRoot();
	try {
		if (await isTrashed(root, id)) return undefined;
		const serialized = await readJson<SerializedProject>(root, projectJsonPath(id));
		if (!serialized) return undefined;
		const restored = await restoreRootFolderHandle(serialized);
		const { project, warnings } = migrateProjectDocument(restored);
		for (const warning of warnings) {
			logger.warn(`getProject(${id}): ${warning.code} — ${warning.message}`);
		}
		return project;
	} catch (error) {
		logger.error(`getProject(${id}) failed`, error);
		throw new Error(`Failed to load project: ${id}`, { cause: error });
	}
}

export async function createProject(project: Project): Promise<Project> {
	const root = requireWorkspaceRoot();
	try {
		const existing = await readJson<SerializedProject>(root, projectJsonPath(project.id));
		if (existing) {
			throw new Error(`Project already exists: ${project.id}`);
		}
		const serialized = await stashRootFolderHandle(project);
		await writeJsonAtomic(root, projectJsonPath(project.id), serialized);
		await upsertIndexEntry(root, {
			id: project.id,
			name: project.name,
			updatedAt: project.updatedAt
		});
		return project;
	} catch (error) {
		logger.error('createProject failed', error);
		throw error;
	}
}

export async function updateProject(id: string, updates: Partial<Project>): Promise<Project> {
	const root = requireWorkspaceRoot();
	try {
		const existingSerialized = await readJson<SerializedProject>(root, projectJsonPath(id));
		if (!existingSerialized) {
			throw new Error(`Project not found: ${id}`);
		}

		// Merge at the serialized layer — `rootFolderHandle` never lives in
		// project.json. Only touch the handle registry when the caller actually
		// changes the handle; a normal autosave leaves it untouched.
		const handleChanging = 'rootFolderHandle' in updates;
		const { rootFolderHandle, ...serializableUpdates } = updates;
		const updatedAt = Date.now();
		const nextSerialized: SerializedProject = {
			...existingSerialized,
			...serializableUpdates,
			id,
			updatedAt
		};

		if (handleChanging) {
			if (rootFolderHandle) {
				await saveHandle({
					kind: 'project-folder',
					id,
					handle: rootFolderHandle,
					name: rootFolderHandle.name,
					pickedAt: Date.now()
				});
			} else {
				await deleteHandle('project-folder', id).catch((error) => {
					logger.warn(`Failed to clean project-folder handle for ${id}`, error);
				});
			}
		}

		await writeJsonAtomic(root, projectJsonPath(id), nextSerialized);
		await upsertIndexEntry(root, { id, name: nextSerialized.name, updatedAt });
		return restoreRootFolderHandle(nextSerialized);
	} catch (error) {
		logger.error(`updateProject(${id}) failed`, error);
		throw error;
	}
}

export async function deleteProject(id: string): Promise<void> {
	const root = requireWorkspaceRoot();
	try {
		await removeEntry(root, projectDir(id), { recursive: true });
		await deleteHandle('project-folder', id).catch((error) => {
			logger.warn(`Failed to clean project-folder handle for ${id}`, error);
		});
		await refreshIndex(root);
	} catch (error) {
		logger.error(`deleteProject(${id}) failed`, error);
		throw new Error(`Failed to delete project: ${id}`, { cause: error });
	}
}
