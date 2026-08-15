import { describe, expect, it } from 'vitest';
import {
	ComposerClientError,
	ComposerSession,
	type ComposerPublicationClient,
	type PublicationDraft
} from './session';

function draft(sourceText: string): PublicationDraft {
	return {
		title: '',
		creation_preset: 'post',
		content_profile: 'short_text',
		source_text: sourceText,
		metadata: {},
		segments: [{ id: 'segment-1', body: sourceText, media: [] }],
		renditions: [
			{
				social_account_id: 'account-1',
				profile: 'post',
				output_profile: 'bluesky.post',
				body: sourceText,
				media: [],
				segments: [{ publication_segment_id: 'segment-1', body: sourceText, media: [] }]
			}
		]
	};
}

function clientWith(overrides: Partial<ComposerPublicationClient>): ComposerPublicationClient {
	return overrides as ComposerPublicationClient;
}

describe('ComposerSession', () => {
	it('creates a new Publication in its Workspace and accepts the returned revision', async () => {
		const creates: Array<{ workspaceId: string; draft: PublicationDraft }> = [];
		const client = clientWith({
			async create(workspaceId, input) {
				creates.push({ workspaceId, draft: input });
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });

		session.edit(draft('First idea'));
		await session.save();

		expect(creates).toEqual([{ workspaceId: 'workspace-1', draft: draft('First idea') }]);
		expect(session.snapshot).toMatchObject({
			workspaceId: 'workspace-1',
			publicationId: 'publication-1',
			revision: 1,
			phase: 'idle',
			dirty: false,
			conflict: null,
			error: null
		});
	});

	it('serializes queued saves and sends the last accepted revision', async () => {
		let finishCreate!: (publication: {
			id: string;
			workspace_id: string;
			revision: number;
			status: string;
		}) => void;
		const createResult = new Promise<{
			id: string;
			workspace_id: string;
			revision: number;
			status: string;
		}>((resolve) => (finishCreate = resolve));
		const calls: string[] = [];
		const client = clientWith({
			async create() {
				calls.push('create');
				return createResult;
			},
			async update(_id, revision, input) {
				calls.push(`update:${revision}:${input.source_text}`);
				return { id: 'publication-1', workspace_id: 'workspace-1', revision: 2, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });

		session.edit(draft('First'));
		const firstSave = session.save();
		session.edit(draft('Second'));
		const secondSave = session.save();
		await Promise.resolve();
		expect(calls).toEqual(['create']);

		finishCreate({
			id: 'publication-1',
			workspace_id: 'workspace-1',
			revision: 1,
			status: 'draft'
		});
		await Promise.all([firstSave, secondSave]);

		expect(calls).toEqual(['create', 'update:1:Second']);
		expect(session.snapshot).toMatchObject({ revision: 2, dirty: false, phase: 'idle' });
	});

	it('loads an existing Publication through the same session', async () => {
		const client = clientWith({
			async load(id) {
				expect(id).toBe('publication-1');
				return {
					publication: {
						id,
						workspace_id: 'workspace-1',
						revision: 4,
						status: 'draft'
					},
					draft: draft('Existing idea')
				};
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });

		await session.load('publication-1');

		expect(session.draft).toEqual(draft('Existing idea'));
		expect(session.snapshot).toMatchObject({
			publicationId: 'publication-1',
			revision: 4,
			dirty: false,
			phase: 'idle'
		});
	});

	it('keeps a failed save dirty and retries it from the last accepted revision', async () => {
		let attempts = 0;
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			},
			async update(_id, revision) {
				attempts += 1;
				expect(revision).toBe(1);
				if (attempts === 1) throw new ComposerClientError('unavailable', 'Network unavailable');
				return { id: 'publication-1', workspace_id: 'workspace-1', revision: 2, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('First'));
		await session.save();
		session.edit(draft('Changed'));

		await expect(session.save()).rejects.toThrow('Network unavailable');
		expect(session.snapshot).toMatchObject({
			revision: 1,
			dirty: true,
			error: 'Network unavailable'
		});

		await session.save();
		expect(session.snapshot).toMatchObject({ revision: 2, dirty: false, error: null });
	});

	it('enters an explicit conflict state when another session accepts a revision first', async () => {
		let serverRevision = 1;
		const client = clientWith({
			async load(id) {
				return {
					publication: {
						id,
						workspace_id: 'workspace-1',
						revision: serverRevision,
						status: 'draft'
					},
					draft: draft('Shared')
				};
			},
			async update(id, expectedRevision) {
				if (expectedRevision !== serverRevision) {
					throw new ComposerClientError('conflict', 'Revision conflict', serverRevision);
				}
				serverRevision += 1;
				return {
					id,
					workspace_id: 'workspace-1',
					revision: serverRevision,
					status: 'draft'
				};
			}
		});
		const first = new ComposerSession({ workspaceId: 'workspace-1', client });
		const second = new ComposerSession({ workspaceId: 'workspace-1', client });
		await Promise.all([first.load('publication-1'), second.load('publication-1')]);

		first.edit(draft('First tab'));
		await first.save();
		second.edit(draft('Second tab'));
		await expect(second.save()).rejects.toThrow('Revision conflict');

		expect(second.snapshot.conflict).toEqual({ expectedRevision: 1, currentRevision: 2 });
		expect(second.snapshot).toMatchObject({ revision: 1, dirty: true, phase: 'idle' });
		await expect(second.save()).rejects.toThrow('Revision conflict');
		expect(serverRevision).toBe(2);
		await second.overwriteConflict();
		expect(second.snapshot).toMatchObject({ revision: 3, conflict: null, dirty: false });
	});

	it('saves, validates, and schedules through the Publication client', async () => {
		const calls: string[] = [];
		const client = clientWith({
			async create(workspaceId) {
				calls.push('create');
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			},
			async validate(id) {
				calls.push(`validate:${id}`);
				return { issues: [] };
			},
			async schedule(id, revision) {
				calls.push(`schedule:${id}:${revision}`);
				return { message: 'Scheduled', publication_id: id, revision: 2, renditions: [] };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit({ ...draft('Scheduled idea'), scheduled_at: '2026-08-16T10:00:00Z' });

		await session.schedule();

		expect(calls).toEqual(['create', 'validate:publication-1', 'schedule:publication-1:1']);
		expect(session.snapshot).toMatchObject({
			status: 'scheduled',
			revision: 2,
			validationIssues: [],
			phase: 'idle'
		});
	});

	it('keeps destination validation issues in observable session state', async () => {
		const issue = {
			code: 'text_too_long',
			fallback_message: 'Text is too long',
			message: 'Text is too long',
			severity: 'error',
			scope: 'rendition',
			scope_id: 'account-1'
		};
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			},
			async validate() {
				return { issues: [issue] };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Needs validation'));

		expect(await session.validate()).toEqual([issue]);
		expect(session.snapshot.validationIssues).toEqual([issue]);
	});

	it('publishes now only after saving and validation', async () => {
		const calls: string[] = [];
		const client = clientWith({
			async create(workspaceId) {
				calls.push('create');
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			},
			async validate() {
				calls.push('validate');
				return { issues: [] };
			},
			async publishNow(id, revision) {
				calls.push(`publish:${id}:${revision}`);
				return { message: 'Publishing', publication_id: id, revision: 2, renditions: [] };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Publish this'));

		await session.publishNow();

		expect(calls).toEqual(['create', 'validate', 'publish:publication-1:1']);
		expect(session.snapshot).toMatchObject({ status: 'publishing', revision: 2 });
	});

	it('retries one failed Rendition through the Publication client', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'failed' };
			},
			async retry(id, accountId, targetKey) {
				expect([id, accountId, targetKey]).toEqual(['publication-1', 'account-1', 'feed']);
				return {
					message: 'Retry queued',
					publication_id: id,
					renditions: [
						{
							id: 'rendition-1',
							platform: 'bluesky',
							social_account_id: accountId,
							status: 'pending',
							target_key: targetKey
						}
					]
				};
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Retry this'));
		await session.save();

		await session.retry('account-1', 'feed');

		expect(session.snapshot.delivery[0]).toMatchObject({ id: 'rendition-1', status: 'pending' });
	});

	it('cancels scheduled delivery with the accepted revision', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 3, status: 'scheduled' };
			},
			async cancel(id, revision) {
				expect([id, revision]).toEqual(['publication-1', 3]);
				return { message: 'Cancelled', publication_id: id, revision: 4, renditions: [] };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Cancel this'));
		await session.save();

		await session.cancel();

		expect(session.snapshot).toMatchObject({ status: 'draft', revision: 4 });
	});

	it('deletes the Publication with explicit revision confirmation', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 2, status: 'draft' };
			},
			async delete(id, revision) {
				expect([id, revision]).toEqual(['publication-1', 2]);
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Delete this'));
		await session.save();

		await session.delete();

		expect(session.snapshot).toMatchObject({
			publicationId: null,
			revision: null,
			status: 'deleted',
			dirty: false
		});
	});

	it('resets a completed new-publication session for the next success path', async () => {
		const client = clientWith({
			async create(workspaceId) {
				return { id: 'publication-1', workspace_id: workspaceId, revision: 1, status: 'draft' };
			}
		});
		const session = new ComposerSession({ workspaceId: 'workspace-1', client });
		session.edit(draft('Done'));
		await session.save();

		session.reset();

		expect(session.draft).toBeNull();
		expect(session.snapshot).toMatchObject({
			publicationId: null,
			revision: null,
			status: null,
			dirty: false,
			validationIssues: [],
			delivery: []
		});
	});

	it('notifies rendering consumers with observable state snapshots', () => {
		const session = new ComposerSession({
			workspaceId: 'workspace-1',
			client: {} as ComposerPublicationClient
		});
		const dirtyStates: boolean[] = [];
		const unsubscribe = session.subscribe((state) => dirtyStates.push(state.dirty));

		session.edit(draft('Observable'));
		unsubscribe();
		session.edit(draft('No longer observed'));

		expect(dirtyStates).toEqual([false, true]);
	});
});
