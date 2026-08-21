/**
 * Editor session: binds one project to the timeline store, media pool,
 * and autosave. One instance per open editor route.
 *
 * Playback uses the preview Clock; frame changes update the timeline store's
 * currentFrame so all panels stay in sync.
 */

import { createLogger } from './workspace-fs/logger';
import { getMediaForProject } from './workspace-fs/project-media';
import { updateProject } from './workspace-fs/projects';
import { getProject } from './workspace-fs/projects';
import type { Project } from './project/types';
import { timelineStore } from './timeline/stores/timeline-store.svelte';
import { commandHistory } from './timeline/commands/command-store.svelte';
import { Clock } from './preview/clock';
import { mediaPool } from './media/pool.svelte';

const logger = createLogger('EditorSession');

class EditorSession {
	project = $state<Project | null>(null);
	loading = $state(true);
	loadError = $state('');
	saving = $state(false);

	clock = new Clock({ fps: 30 });

	private projectId: string | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	get fps(): number {
		return this.project?.metadata.fps ?? 30;
	}

	async load(projectId: string): Promise<void> {
		this.projectId = projectId;
		this.loading = true;
		this.loadError = '';
		try {
			const project = await getProject(projectId);
			if (!project) {
				this.loadError = 'Project not found';
				return;
			}
			this.project = project;
			commandHistory.clearHistory();
			timelineStore.setAll({
				items: project.timeline?.items ?? [],
				tracks: project.timeline?.tracks ?? [],
				currentFrame: project.timeline?.currentFrame ?? 0,
				fps: project.metadata.fps
			});
			this.clock.setFps(project.metadata.fps);
			const media = await getMediaForProject(projectId);
			mediaPool.loadAll(media);
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	startPlayback(range?: { start: number; end: number; loop?: boolean }): void {
		this.clock.play(
			range ? { range: { start: range.start, end: range.end }, loop: range.loop } : undefined
		);
	}

	pausePlayback(): void {
		this.clock.pause();
	}

	stopPlayback(): void {
		this.clock.pause();
		this.clock.seek(0);
	}

	scheduleAutosave(): void {
		if (!this.projectId) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.saveNow(), 800);
	}

	async saveNow(): Promise<void> {
		if (!this.projectId || !this.project) return;
		this.saving = true;
		try {
			await updateProject(this.projectId, {
				duration: timelineStore.maxItemEndFrame / this.fps,
				timeline: {
					...this.project.timeline,
					tracks: timelineStore.tracks,
					items: structuredClone(timelineStore.items),
					currentFrame: timelineStore.currentFrame,
					inPoint: timelineStore.inPoint ?? undefined,
					outPoint: timelineStore.outPoint ?? undefined,
					markers: [...timelineStore.markers]
				}
			});
			timelineStore._clearDirty();
		} catch (error) {
			logger.error('save failed', error);
		} finally {
			this.saving = false;
		}
	}
}

export const editorSession = new EditorSession();
