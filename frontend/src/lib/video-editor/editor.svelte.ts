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
import type { AnimationPreset, Project } from './project/types';
import { cloneAnimationPreset, normalizeAnimationPresets } from './project/animation-presets';
import { timelineStore } from './timeline/stores/timeline-store.svelte';
import { commandHistory } from './timeline/commands/command-store.svelte';
import { Clock } from './preview/clock';
import { mediaPool } from './media/pool.svelte';
import { sceneBrowser } from './media/scene-search/scene-browser.svelte';
import { sequenceStore } from './sequences/sequence-store.svelte';
import { editorSettings } from './settings/editor-settings.svelte';

const logger = createLogger('EditorSession');

class EditorSession {
	project = $state<Project | null>(null);
	loading = $state(true);
	loadError = $state('');
	saving = $state(false);

	clock = new Clock({ fps: 30 });

	private projectId: string | null = null;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		this.clock.on('framechange', (frame) => timelineStore._setCurrentFrame(frame));
	}

	get fps(): number {
		return this.project ? timelineStore.fps : 30;
	}

	async load(projectId: string): Promise<void> {
		this.projectId = projectId;
		this.loading = true;
		this.loadError = '';
		try {
			sceneBrowser.reset();
			mediaPool.clear();
			const project = await getProject(projectId);
			if (!project) {
				this.loadError = 'Project not found';
				return;
			}
			this.project = {
				...project,
				animationPresets: normalizeAnimationPresets(project.animationPresets)
			};
			commandHistory.clearHistory();
			sequenceStore.load(project.timeline ?? { tracks: [], items: [] }, project.metadata);
			timelineStore._setSnapEnabled(editorSettings.snapByDefault);
			timelineStore._setMaxUndoHistory(editorSettings.maxUndoHistory);
			this.clock.setFps(project.metadata.fps);
			this.syncTimelineClock();
			const media = await getMediaForProject(projectId);
			mediaPool.loadAll(media);
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
		}
	}

	syncTimelineClock(): void {
		this.clock.setFps(this.fps);
		this.clock.seek(timelineStore.currentFrame);
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

	saveAnimationPreset(preset: AnimationPreset): void {
		if (!this.project) return;
		const next = [
			...(this.project.animationPresets ?? []).filter((entry) => entry.id !== preset.id),
			cloneAnimationPreset(preset)
		].toSorted((left, right) => right.createdAt - left.createdAt);
		this.project = { ...this.project, animationPresets: next };
		this.scheduleAutosave();
	}

	deleteAnimationPreset(presetId: string): void {
		if (!this.project) return;
		const next = (this.project.animationPresets ?? []).filter((preset) => preset.id !== presetId);
		if (next.length === (this.project.animationPresets ?? []).length) return;
		this.project = { ...this.project, animationPresets: next };
		this.scheduleAutosave();
	}

	async saveNow(): Promise<void> {
		if (!this.projectId || !this.project) return;
		this.saving = true;
		try {
			const timeline = sequenceStore.projectTimeline();
			await updateProject(this.projectId, {
				duration:
					timeline.items.reduce(
						(max, item) => Math.max(max, item.from + item.durationInFrames),
						0
					) / this.project.metadata.fps,
				timeline,
				animationPresets: this.project.animationPresets
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
