import { describe, expect, it } from 'vitest';
import {
	createBlankProject,
	createDefaultTracks,
	migrateProjectDocument,
	normalizeProject,
	CURRENT_SCHEMA_VERSION
} from './defaults';
import type { Project } from './types';

describe('createBlankProject', () => {
	it('creates a normalized 1080p30 project with default tracks', () => {
		const project = createBlankProject('My cut');
		expect(project.name).toBe('My cut');
		expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(project.metadata).toMatchObject({ width: 1920, height: 1080, fps: 30 });
		expect(project.timeline?.tracks.map((t) => t.id)).toEqual([
			'track-video-overlay',
			'track-video-main',
			'track-audio'
		]);
		expect(project.timeline?.items).toEqual([]);
		expect(project.animationPresets).toEqual([]);
	});

	it('generates unique ids', () => {
		expect(createBlankProject().id).not.toBe(createBlankProject().id);
	});
});

describe('migrateProjectDocument', () => {
	it('normalizes a missing timeline', () => {
		const stored = createBlankProject();
		// SAFETY: test fixture is a complete Project minus the optional timeline.
		delete (stored as Partial<Project>).timeline;
		const result = migrateProjectDocument(stored);
		expect(result.project.timeline?.tracks.length).toBeGreaterThan(0);
		expect(result.warnings.some((w) => w.code === 'TIMELINE_MISSING')).toBe(true);
	});

	it('adds a video track when only audio tracks exist', () => {
		const stored = createBlankProject();
		stored.timeline!.tracks = stored.timeline!.tracks.filter((t) => t.kind === 'audio');
		const { project } = normalizeProject(stored);
		expect(project.timeline!.tracks.some((t) => t.kind !== 'audio')).toBe(true);
	});

	it('flags future schema versions instead of failing', () => {
		const stored = createBlankProject();
		stored.schemaVersion = CURRENT_SCHEMA_VERSION + 5;
		const result = migrateProjectDocument(stored);
		expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 5);
		expect(result.warnings.some((w) => w.code === 'FUTURE_SCHEMA')).toBe(true);
	});

	it('is idempotent', () => {
		const first = migrateProjectDocument(createBlankProject());
		const second = migrateProjectDocument(first.project);
		expect(second.warnings).toEqual([]);
	});
});

describe('createDefaultTracks', () => {
	it('orders overlay above main video above audio', () => {
		const tracks = createDefaultTracks();
		expect(tracks.map((t) => t.order)).toEqual([0, 1, 2]);
	});
});
