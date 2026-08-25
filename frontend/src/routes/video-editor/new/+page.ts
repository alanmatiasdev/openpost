import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { m } from '$lib/paraglide/messages';

export const load: PageLoad = async ({ url }) => {
	const { createBlankProject } = await import('$lib/video-editor/project/defaults');
	const { createProject } = await import('$lib/video-editor/workspace-fs/projects');

	const name = url.searchParams.get('name')?.trim() || m.video_editor_project_untitled();
	const project = createBlankProject(name);
	await createProject(project);

	// Source media handoff (?source=media:<id>) is consumed by the editor's
	// media pool once the import pipeline lands; carried through for now.
	const source = url.searchParams.get('source');
	const target = source
		? `/video-editor/${project.id}?${new URLSearchParams({ source })}`
		: `/video-editor/${project.id}`;
	redirect(303, target);
};
