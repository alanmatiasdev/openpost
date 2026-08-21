/**
 * Project document defaults and normalization.
 *
 * Ported from FreeCut (MIT) — shared/projects/defaults.ts, trimmed to v1.
 */

import type { Project, ProjectTimeline, TimelineTrack } from './types';

export const CURRENT_SCHEMA_VERSION = 1;

export const DEFAULT_PROJECT_WIDTH = 1920;
export const DEFAULT_PROJECT_HEIGHT = 1080;
export const DEFAULT_PROJECT_FPS = 30;

export function createDefaultTracks(): TimelineTrack[] {
	return [
		{
			id: 'track-video-overlay',
			name: 'Overlay',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		},
		{
			id: 'track-video-main',
			name: 'Video',
			kind: 'video',
			height: 96,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 1
		},
		{
			id: 'track-audio',
			name: 'Audio',
			kind: 'audio',
			height: 72,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order: 2
		}
	];
}

export function createEmptyTimeline(): ProjectTimeline {
	return {
		tracks: createDefaultTracks(),
		items: [],
		currentFrame: 0,
		zoomLevel: 1,
		scrollPosition: 0
	};
}

export function createBlankProject(name = 'Untitled project'): Project {
	const now = Date.now();
	return {
		id: crypto.randomUUID(),
		name,
		description: '',
		createdAt: now,
		updatedAt: now,
		duration: 0,
		schemaVersion: CURRENT_SCHEMA_VERSION,
		metadata: {
			width: DEFAULT_PROJECT_WIDTH,
			height: DEFAULT_PROJECT_HEIGHT,
			fps: DEFAULT_PROJECT_FPS,
			backgroundColor: '#000000'
		},
		timeline: createEmptyTimeline()
	};
}

/**
 * Normalize a loaded project so every field the editor assumes is present.
 * Runs on every load; must be idempotent. Collects non-fatal warnings.
 */
export interface ProjectWarning {
	code: string;
	message: string;
}

export interface NormalizedProject {
	project: Project;
	warnings: ProjectWarning[];
}

export function normalizeProject(project: Project): NormalizedProject {
	const warnings: ProjectWarning[] = [];
	const timeline = project.timeline ?? createEmptyTimeline();
	if (!project.timeline) {
		warnings.push({
			code: 'TIMELINE_MISSING',
			message: 'Project had no timeline; created an empty one.'
		});
	}
	if (!timeline.tracks.some((track) => track.kind !== 'audio')) {
		timeline.tracks.push({
			id: 'track-video-main',
			name: 'Video',
			kind: 'video',
			height: 96,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: timeline.tracks.length
		});
		warnings.push({ code: 'TRACK_ADDED', message: 'Project had no video track; added one.' });
	}
	if (!timeline.items) timeline.items = [];
	timeline.currentFrame = Number.isFinite(timeline.currentFrame) ? timeline.currentFrame : 0;
	timeline.zoomLevel =
		Number.isFinite(timeline.zoomLevel) && (timeline.zoomLevel ?? 1) > 0 ? timeline.zoomLevel : 1;
	timeline.scrollPosition = Number.isFinite(timeline.scrollPosition) ? timeline.scrollPosition : 0;

	// SAFETY: normalizeProject guarantees a timeline above.
	return {
		project: { ...project, timeline },
		warnings
	};
}

/**
 * Migrate a stored project document to the current schema version.
 * v1 is the first OpenPost schema; unknown future versions load as-is
 * with a warning rather than failing.
 */
export interface MigratedProject {
	project: Project;
	migrated: boolean;
	warnings: ProjectWarning[];
}

export function migrateProjectDocument(stored: Project): MigratedProject {
	// SAFETY: documents without schemaVersion are v1 by contract.
	const version = Number.isFinite(stored.schemaVersion) ? (stored.schemaVersion ?? 1) : 1;
	const normalized = normalizeProject(stored);
	if (version > CURRENT_SCHEMA_VERSION) {
		normalized.warnings.push({
			code: 'FUTURE_SCHEMA',
			message: `Project was written by a newer editor (schema ${version}); loading as-is.`
		});
	}
	// SAFETY: normalizeProject returned a complete document.
	return {
		project: { ...normalized.project, schemaVersion: CURRENT_SCHEMA_VERSION },
		migrated: version !== CURRENT_SCHEMA_VERSION || normalized.warnings.length > 0,
		warnings: normalized.warnings
	};
}
