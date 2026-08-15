import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';
import { parseDraftConflict } from '$lib/draft-conflict';
import {
	ComposerClientError,
	type ComposerPublicationClient,
	type PublicationDraft
} from './session';

type Publication = components['schemas']['PublicationResponse'];
type PublicationUpdate = components['schemas']['PublicationUpdateBody'];
type Problem = components['schemas']['ErrorModel'];

export function createComposerPublicationClient(): ComposerPublicationClient {
	return {
		async load(publicationId) {
			const { data, error, response } = await client.GET('/publications/{id}', {
				params: { path: { id: publicationId } }
			});
			if (error || !data) throw clientError(error, response.status);
			return { publication: data, draft: publicationDraft(data) };
		},

		async create(workspaceId, draft) {
			const { data, error, response } = await client.POST('/publications', {
				body: { ...draft, workspace_id: workspaceId }
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async update(publicationId, expectedRevision, draft) {
			const { data, error, response } = await client.PUT('/publications/{id}', {
				params: { path: { id: publicationId } },
				body: publicationUpdate(draft, expectedRevision)
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async validate(publicationId) {
			const { data, error, response } = await client.POST('/publications/{id}/validate', {
				params: { path: { id: publicationId } }
			});
			if (error || !data) throw clientError(error, response.status);
			return { issues: data.issues ?? [] };
		},

		async schedule(publicationId, expectedRevision) {
			const { data, error, response } = await client.POST('/publications/{id}/schedule', {
				params: { path: { id: publicationId } },
				body: { expected_revision: expectedRevision }
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async publishNow(publicationId, expectedRevision) {
			const { data, error, response } = await client.POST('/publications/{id}/publish-now', {
				params: { path: { id: publicationId } },
				body: { expected_revision: expectedRevision }
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async retry(publicationId, accountId, targetKey) {
			const { data, error, response } = await client.POST(
				'/publications/{id}/renditions/{account_id}/retry',
				{
					params: {
						path: { id: publicationId, account_id: accountId },
						query: targetKey ? { target_key: targetKey } : {}
					}
				}
			);
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async cancel(publicationId, expectedRevision) {
			const { data, error, response } = await client.POST('/publications/{id}/cancel', {
				params: { path: { id: publicationId } },
				body: { expected_revision: expectedRevision }
			});
			if (error || !data) throw clientError(error, response.status);
			return data;
		},

		async delete(publicationId, expectedRevision) {
			const { error, response } = await client.DELETE('/publications/{id}', {
				params: {
					path: { id: publicationId },
					query: { confirm: true, expected_revision: expectedRevision }
				}
			});
			if (error) throw clientError(error, response.status);
		}
	};
}

export function publicationDraft(publication: Publication): PublicationDraft {
	const draft: PublicationDraft = {
		title: publication.title,
		creation_preset: publication.creation_preset as PublicationDraft['creation_preset'],
		content_profile: publication.content_profile,
		source_text: publication.source_text,
		metadata: publication.metadata,
		segments: (publication.segments ?? []).map((segment) => ({
			id: segment.id,
			body: segment.body,
			title: segment.title,
			description: segment.description,
			...(segment.url ? { url: segment.url } : {}),
			settings: segment.settings,
			media: mediaInput(segment.media)
		})),
		renditions: (publication.renditions ?? []).map((rendition) => ({
			id: rendition.id,
			social_account_id: rendition.social_account_id,
			target_key: rendition.target_key,
			profile: rendition.profile,
			output_profile: rendition.output_profile,
			format_locked: rendition.format_locked,
			body: rendition.body,
			title: rendition.title,
			description: rendition.description,
			settings: rendition.settings,
			media: mediaInput(rendition.media),
			...(rendition.schedule_override ? { schedule_override: rendition.schedule_override } : {}),
			segments: (rendition.segments ?? []).map((segment) => ({
				id: segment.id,
				publication_segment_id: segment.publication_segment_id,
				body: segment.body,
				...(segment.body_override !== undefined ? { body_override: segment.body_override } : {}),
				title: segment.title,
				...(segment.title_override !== undefined ? { title_override: segment.title_override } : {}),
				description: segment.description,
				...(segment.description_override !== undefined
					? { description_override: segment.description_override }
					: {}),
				...(segment.url ? { url: segment.url } : {}),
				...(segment.url_override !== undefined ? { url_override: segment.url_override } : {}),
				media_inherited: segment.media_inherited,
				settings: segment.settings,
				media: mediaInput(segment.media)
			}))
		})),
		repost_override: publication.repost_override
	};
	if (publication.source_url) draft.source_url = publication.source_url;
	if (publication.social_set_id) draft.social_set_id = publication.social_set_id;
	if (publication.scheduled_at) draft.scheduled_at = publication.scheduled_at;
	if (!publication.random_delay_inherited) {
		draft.random_delay_minutes = publication.random_delay_minutes;
	}
	return draft;
}

function publicationUpdate(draft: PublicationDraft, expectedRevision: number): PublicationUpdate {
	return {
		expected_revision: expectedRevision,
		title: draft.title,
		creation_preset: draft.creation_preset,
		intent: draft.intent,
		content_profile: draft.content_profile,
		social_set_id: draft.social_set_id ?? '',
		source_text: draft.source_text,
		source_url: draft.source_url ?? '',
		audience: draft.audience,
		goal: draft.goal,
		metadata: draft.metadata,
		segments: draft.segments,
		renditions: draft.renditions,
		repost_override: draft.repost_override,
		...(draft.scheduled_at
			? { scheduled_at: draft.scheduled_at, clear_schedule: false }
			: { clear_schedule: true }),
		...(draft.random_delay_minutes === undefined
			? { inherit_random_delay: true }
			: { random_delay_minutes: draft.random_delay_minutes })
	};
}

function mediaInput(media: Publication['media']) {
	return (media ?? []).map((item) => ({
		media_id: item.id,
		...(item.role ? { role: item.role } : {}),
		...(item.alt_text ? { alt_text: item.alt_text } : {}),
		...(item.thumbnail_timestamp_ms ? { thumbnail_timestamp_ms: item.thumbnail_timestamp_ms } : {}),
		...(item.settings && Object.keys(item.settings).length > 0 ? { settings: item.settings } : {})
	}));
}

function clientError(problem: Problem | undefined, status: number): ComposerClientError {
	const conflict = parseDraftConflict(problem);
	if (conflict) {
		return new ComposerClientError('conflict', conflict.detail, conflict.conflict.current_revision);
	}
	const message = problem?.detail || 'The Publication request failed.';
	if (status === 403) return new ComposerClientError('access_denied', message);
	if (status === 404) return new ComposerClientError('not_found', message);
	if (status === 409) return new ComposerClientError('invalid_state', message);
	if (status === 422 || status === 400) return new ComposerClientError('invalid', message);
	return new ComposerClientError('unavailable', message);
}
