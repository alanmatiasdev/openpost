/**
 * Workspace gate state machine.
 *
 * Drives the /video-editor entry: decide whether the browser can run the
 * editor at all, whether a known workspace exists, and whether its handle
 * still has permission. Adapted from FreeCut (MIT) to Svelte 5 runes.
 */

import { onMount } from 'svelte';
import {
	activateWorkspaceHandle,
	ensureKnownWorkspaceForCurrent,
	getWorkspaceHandleRecord,
	isFileSystemAccessSupported,
	listKnownWorkspaces,
	queryHandlePermission,
	requestHandlePermission,
	saveWorkspaceHandleRecord,
	type HandleRecord
} from '../workspace-fs/handles-db';
import { setWorkspaceRoot } from '../workspace-fs/root';
import { bootstrapWorkspace } from '../workspace-fs/bootstrap';

export type WorkspaceGateState = 'initializing' | 'unavailable' | 'pick' | 'reconnect' | 'ready';

export function createWorkspaceGate() {
	let state = $state<WorkspaceGateState>('initializing');
	let workspaceName = $state('');
	let knownWorkspaces = $state.raw<HandleRecord[]>([]);
	let busy = $state(false);
	let error = $state('');

	async function activate(record: HandleRecord): Promise<boolean> {
		// SAFETY: workspace records always store a directory handle.
		const handle = record.handle as FileSystemDirectoryHandle;
		const permission = await queryHandlePermission(handle);
		if (permission !== 'granted') return false;
		setWorkspaceRoot(handle);
		await bootstrapWorkspace(handle);
		workspaceName = record.name;
		state = 'ready';
		return true;
	}

	onMount(() => {
		void (async () => {
			if (!isFileSystemAccessSupported()) {
				state = 'unavailable';
				return;
			}
			try {
				await ensureKnownWorkspaceForCurrent();
				const current = await getWorkspaceHandleRecord();
				if (!current) {
					state = 'pick';
					return;
				}
				const activated = await activate(current);
				if (!activated) {
					knownWorkspaces = await listKnownWorkspaces();
					workspaceName = current.name;
					state = 'reconnect';
				}
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
				state = 'pick';
			}
		})();
	});

	async function pickFolder(): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const handle = await window.showDirectoryPicker?.({
				id: 'openpost-video-workspace',
				mode: 'readwrite',
				startIn: 'documents'
			});
			if (!handle) return;
			const permission = await queryHandlePermission(handle);
			if (permission !== 'granted') {
				const granted = await requestHandlePermission(handle);
				if (granted !== 'granted') {
					state = 'reconnect';
					workspaceName = handle.name;
					return;
				}
			}
			await saveWorkspaceHandleRecord(handle);
			setWorkspaceRoot(handle);
			await bootstrapWorkspace(handle);
			workspaceName = handle.name;
			state = 'ready';
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function reconnect(): Promise<void> {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const current = await getWorkspaceHandleRecord();
			if (!current) {
				state = 'pick';
				return;
			}
			// SAFETY: the current record is a workspace, so its handle is a directory.
			const granted = await requestHandlePermission(current.handle as FileSystemDirectoryHandle);
			if (granted !== 'granted') return;
			const activated = await activate(current);
			if (!activated) state = 'reconnect';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function chooseDifferentFolder(): Promise<void> {
		await pickFolder();
	}

	function forgetWorkspace(workspaceId?: string): void {
		// Removing the active pointer is enough; known-workspace management UI
		// arrives with a later release.
		void workspaceId;
		state = 'pick';
		workspaceName = '';
	}

	return {
		get state() {
			return state;
		},
		get workspaceName() {
			return workspaceName;
		},
		get knownWorkspaces() {
			return knownWorkspaces;
		},
		get busy() {
			return busy;
		},
		get error() {
			return error;
		},
		pickFolder,
		reconnect,
		chooseDifferentFolder,
		forgetWorkspace
	};
}
