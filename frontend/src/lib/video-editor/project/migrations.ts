import type { Project, ProjectTimeline, TimelineItem, TimelineTrack } from './types';

export const CURRENT_SCHEMA_VERSION = 5;

export interface ProjectMigration {
	version: number;
	description: string;
	migrate(project: Project): Project;
}

function renumberTracks(tracks: TimelineTrack[]): TimelineTrack[] {
	return tracks
		.map((track, index) => ({ track, index }))
		.sort((left, right) => {
			const byOrder = (left.track.order ?? left.index) - (right.track.order ?? right.index);
			return byOrder || left.index - right.index;
		})
		.map(({ track }, order) => ({ ...track, order }));
}

function backfillOriginIds(items: TimelineItem[]): TimelineItem[] {
	return items.map((item) => (item.originId ? item : { ...item, originId: item.id }));
}

function migrateTimelineIdentity(timeline: ProjectTimeline): ProjectTimeline {
	return {
		...timeline,
		tracks: renumberTracks(timeline.tracks),
		items: backfillOriginIds(timeline.items),
		transitions: timeline.transitions?.map((transition) => ({
			...transition,
			alignment: transition.alignment ?? 0.5
		})),
		compositions: timeline.compositions?.map((composition) => ({
			...composition,
			tracks: renumberTracks(composition.tracks),
			items: backfillOriginIds(composition.items),
			transitions: composition.transitions.map((transition) => ({
				...transition,
				alignment: transition.alignment ?? 0.5
			}))
		}))
	};
}

/**
 * Append-only project migrations keyed by their target version. Never change
 * an existing migration after release. Add the next version instead.
 */
const PROJECT_MIGRATIONS: ReadonlyMap<number, ProjectMigration> = new Map([
	[
		2,
		{
			version: 2,
			description: 'Add reusable sequence storage',
			migrate: (project) => project
		}
	],
	[
		3,
		{
			version: 3,
			description: 'Stabilize timeline identities and transition alignment',
			migrate: (project) =>
				project.timeline
					? { ...project, timeline: migrateTimelineIdentity(project.timeline) }
					: project
		}
	],
	[
		4,
		{
			version: 4,
			description: 'Add procedural background items with clone-safe defaults',
			migrate: (project) => {
				if (!project.timeline) return project;
				const patchItems = (items: TimelineItem[]): TimelineItem[] =>
					items.map((item) =>
						item.type === 'background' && !item.background
							? {
									...item,
									background: {
										kind: 'mesh-gradient',
										colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
										smoothness: 0.55,
										rotation: 0,
										scale: 1,
										offsetX: 0,
										offsetY: 0
									}
								}
							: item
					);
				return {
					...project,
					timeline: {
						...project.timeline,
						items: patchItems(project.timeline.items),
						compositions: project.timeline.compositions?.map((c) => ({
							...c,
							items: patchItems(c.items)
						}))
					}
				};
			}
		}
	],
	[
		5,
		{
			version: 5,
			description: 'Identify the OpenPost project schema family',
			migrate: (project) => ({ ...project, schemaFamily: 'openpost' })
		}
	]
]);

export function getMigrationsToApply(fromVersion: number, toVersion: number): ProjectMigration[] {
	const migrations: ProjectMigration[] = [];
	for (let version = fromVersion + 1; version <= toVersion; version += 1) {
		const migration = PROJECT_MIGRATIONS.get(version);
		if (!migration) throw new Error(`Missing project migration for schema ${version}`);
		migrations.push(migration);
	}
	return migrations;
}
