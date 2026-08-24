/**
 * Project document defaults and normalization.
 *
 * Ported from FreeCut (MIT) - shared/projects/defaults.ts, adapted to
 * OpenPost's append-only project schema history.
 */

import type { Project, ProjectTimeline, SubComposition, TimelineTrack } from './types';
import { CURRENT_SCHEMA_VERSION, getMigrationsToApply } from './migrations';

export { CURRENT_SCHEMA_VERSION } from './migrations';

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
		timeline: createEmptyTimeline(),
		animationPresets: []
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
	const normalizedCompositions = (timeline.compositions ?? []).map(normalizeSubComposition);
	const validSequenceIds = new Set(normalizedCompositions.map((composition) => composition.id));
	const topLevelSequenceIds = [
		...new Set((timeline.topLevelSequenceIds ?? []).filter((id) => validSequenceIds.has(id)))
	];
	if (topLevelSequenceIds.length !== (timeline.topLevelSequenceIds ?? []).length) {
		warnings.push({
			code: 'SEQUENCE_TABS_REPAIRED',
			message: 'Removed duplicate or missing sequence tabs.'
		});
	}
	timeline.compositions = normalizedCompositions;
	timeline.topLevelSequenceIds = topLevelSequenceIds;
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

function normalizeSubComposition(composition: SubComposition): SubComposition {
	const tracks = composition.tracks?.length > 0 ? composition.tracks : createDefaultTracks();
	const items = composition.items ?? [];
	const contentDuration = items.reduce(
		(max, item) => Math.max(max, item.from + item.durationInFrames),
		0
	);
	const durationInFrames = Math.max(0, composition.durationInFrames ?? 0, contentDuration);
	return {
		...composition,
		editorKind: 'sequence',
		items,
		tracks,
		transitions: composition.transitions ?? [],
		fps: Number.isFinite(composition.fps) && composition.fps > 0 ? composition.fps : 30,
		width: Number.isFinite(composition.width) && composition.width > 0 ? composition.width : 1920,
		height:
			Number.isFinite(composition.height) && composition.height > 0 ? composition.height : 1080,
		durationInFrames
	};
}

/**
 * Migrate a stored project document to the current schema version.
 * v1 is the original single-timeline schema; v2 adds reusable sequences.
 * Unknown future versions load as-is
 * with a warning rather than failing.
 */
export interface MigratedProject {
	project: Project;
	migrated: boolean;
	appliedMigrations: number[];
	fromVersion: number;
	toVersion: number;
	warnings: ProjectWarning[];
}

export function migrateProjectDocument(stored: Project): MigratedProject {
	// SAFETY: documents without schemaVersion are v1 by contract.
	const version = Number.isFinite(stored.schemaVersion) ? (stored.schemaVersion ?? 1) : 1;
	if (version > CURRENT_SCHEMA_VERSION) {
		return {
			project: stored,
			migrated: false,
			appliedMigrations: [],
			fromVersion: version,
			toVersion: version,
			warnings: [
				{
					code: 'FUTURE_SCHEMA',
					message: `Project was written by a newer editor (schema ${version}); loading as-is.`
				}
			]
		};
	}

	let migratedProject = stored;
	const migrations = getMigrationsToApply(version, CURRENT_SCHEMA_VERSION);
	for (const migration of migrations) {
		try {
			migratedProject = migration.migrate(migratedProject);
		} catch (error) {
			throw new Error(`Project migration ${migration.version} failed: ${migration.description}`, {
				cause: error
			});
		}
	}
	const normalized = normalizeProject({
		...migratedProject,
		schemaVersion: CURRENT_SCHEMA_VERSION
	});
	if (migrations.length > 0) {
		normalized.warnings.unshift({
			code: 'SCHEMA_UPGRADED',
			message: `Upgraded project schema from ${version} to ${CURRENT_SCHEMA_VERSION}.`
		});
	}
	// SAFETY: normalizeProject returned a complete document.
	return {
		project: normalized.project,
		migrated: migrations.length > 0 || normalized.warnings.length > 0,
		appliedMigrations: migrations.map((migration) => migration.version),
		fromVersion: version,
		toVersion: CURRENT_SCHEMA_VERSION,
		warnings: normalized.warnings
	};
}
