/**
 * Final render outputs from the export queue.
 *
 * Saves to the project's own `projects/{id}/exports/` folder so outputs are
 * grouped with the project and removed with it. Filenames are de-duplicated
 * (` (2)`, ` (3)`, …) so re-rendering doesn't overwrite a previous result.
 *
 * Ported from FreeCut (MIT) — workspace-fs/exports.ts.
 */

import { getWorkspaceRoot, requireWorkspaceRoot } from './root';
import { exists, readBlob, readDirectoryFiles, removeEntry, writeBlob } from './fs-primitives';
import {
	EXPORTS_DIR,
	PROJECTS_DIR,
	exportFilePath,
	projectExportFilePath,
	projectExportsDir,
	sanitizeWorkspaceFileName
} from './paths';

export interface SavedExport {
	/** The on-disk filename actually used (after de-duplication). */
	fileName: string;
	/** Workspace-root-relative path, forward-slash separated (for display). */
	relPath: string;
}

export interface ExportFileEntry {
	name: string;
	size: number;
	lastModified: number;
	/** Workspace-relative path segments — used to read/delete the file. */
	path: string[];
}

function suffixFileName(fileName: string, n: number): string {
	const dot = fileName.lastIndexOf('.');
	const hasExt = dot > 0;
	const stem = hasExt ? fileName.slice(0, dot) : fileName;
	const ext = hasExt ? fileName.slice(dot) : '';
	return `${stem} (${n})${ext}`;
}

async function uniqueFileName(
	root: FileSystemDirectoryHandle,
	pathOf: (name: string) => string[],
	fileName: string
): Promise<string> {
	const safe = sanitizeWorkspaceFileName(fileName);
	if (!(await exists(root, pathOf(safe)))) return safe;
	for (let n = 2; n < 1000; n++) {
		const candidate = suffixFileName(safe, n);
		if (!(await exists(root, pathOf(candidate)))) return candidate;
	}
	return suffixFileName(safe, Date.now());
}

/**
 * Save a rendered blob to the project's `exports/` folder. Falls back to a
 * top-level `exports/` only when no project id is given.
 */
export async function saveExportFile(
	projectId: string | undefined,
	fileName: string,
	data: Blob
): Promise<SavedExport> {
	const root = requireWorkspaceRoot();
	const pathOf = projectId
		? (name: string) => projectExportFilePath(projectId, name)
		: (name: string) => exportFilePath(name);
	const relBase = projectId ? `${PROJECTS_DIR}/${projectId}/${EXPORTS_DIR}` : EXPORTS_DIR;

	const name = await uniqueFileName(root, pathOf, fileName);
	await writeBlob(root, pathOf(name), data);
	return { fileName: name, relPath: `${relBase}/${name}` };
}

/** List a project's saved export files, newest first. Empty when none. */
export async function listExportFiles(projectId: string): Promise<ExportFileEntry[]> {
	const files = await readDirectoryFiles(requireWorkspaceRoot(), projectExportsDir(projectId));
	return files
		.map(({ name, blob }) => ({
			name,
			size: blob.size,
			// SAFETY: readDirectoryFiles returns File-backed blobs.
			lastModified: (blob as File).lastModified ?? 0,
			path: projectExportFilePath(projectId, name)
		}))
		.sort((a, b) => b.lastModified - a.lastModified);
}

export function readExportFile(path: string[]): Promise<Blob | null> {
	return readBlob(requireWorkspaceRoot(), path);
}

export function deleteExportFile(path: string[]): Promise<void> {
	return removeEntry(requireWorkspaceRoot(), path);
}

/** The user-picked workspace folder's name (for telling users where files land). */
export function workspaceFolderName(): string | null {
	return getWorkspaceRoot()?.name ?? null;
}
