import type { components } from '$lib/api/types';

type CreatePublication = components['schemas']['CreatePublicationBody'];
type ValidationIssue = components['schemas']['ValidationIssue'];
type PublicationAction = components['schemas']['ActionOutputBody'];
type DeliveryOutcome = components['schemas']['RenditionActionOutcome'];

export type PublicationDraft = Omit<CreatePublication, 'workspace_id'>;

export interface ComposerPublication {
	id: string;
	workspace_id: string;
	revision: number;
	status: string;
}

export interface ComposerPublicationClient {
	load(publicationId: string): Promise<{
		publication: ComposerPublication;
		draft: PublicationDraft;
	}>;
	create(workspaceId: string, draft: PublicationDraft): Promise<ComposerPublication>;
	update(
		publicationId: string,
		expectedRevision: number,
		draft: PublicationDraft
	): Promise<ComposerPublication>;
	validate(publicationId: string): Promise<{ issues: ValidationIssue[] }>;
	schedule(publicationId: string, expectedRevision: number): Promise<PublicationAction>;
	publishNow(publicationId: string, expectedRevision: number): Promise<PublicationAction>;
	retry(publicationId: string, accountId: string, targetKey?: string): Promise<PublicationAction>;
	cancel(publicationId: string, expectedRevision: number): Promise<PublicationAction>;
	delete(publicationId: string, expectedRevision: number): Promise<void>;
}

export interface ComposerEditorHandoffBinding {
	workspaceId: string;
	publicationId: string;
	revision: number;
	returnToken: string;
}

export type ComposerClientErrorCategory =
	| 'invalid'
	| 'access_denied'
	| 'not_found'
	| 'conflict'
	| 'invalid_state'
	| 'not_ready'
	| 'unavailable';

export class ComposerClientError extends Error {
	constructor(
		readonly category: ComposerClientErrorCategory,
		message: string,
		readonly currentRevision?: number
	) {
		super(message);
		this.name = 'ComposerClientError';
	}
}

export type ComposerSessionPhase =
	| 'idle'
	| 'loading'
	| 'saving'
	| 'validating'
	| 'scheduling'
	| 'publishing'
	| 'retrying'
	| 'cancelling'
	| 'deleting';

export interface ComposerSessionSnapshot {
	workspaceId: string;
	publicationId: string | null;
	revision: number | null;
	status: string | null;
	phase: ComposerSessionPhase;
	dirty: boolean;
	conflict: { expectedRevision: number; currentRevision: number } | null;
	validationIssues: ValidationIssue[];
	delivery: DeliveryOutcome[];
	error: string | null;
}

export class ComposerSession {
	readonly workspaceId: string;
	readonly #client: ComposerPublicationClient;
	#draft: PublicationDraft | null = null;
	#draftVersion = 0;
	#saveTail: Promise<void> = Promise.resolve();
	#pendingSaves = 0;
	#consumedEditorReturnTokens = new Set<string>();
	#snapshot: ComposerSessionSnapshot;
	#listeners = new Set<(snapshot: Readonly<ComposerSessionSnapshot>) => void>();

	constructor(options: { workspaceId: string; client: ComposerPublicationClient }) {
		this.workspaceId = options.workspaceId;
		this.#client = options.client;
		this.#snapshot = {
			workspaceId: options.workspaceId,
			publicationId: null,
			revision: null,
			status: null,
			phase: 'idle',
			dirty: false,
			conflict: null,
			validationIssues: [],
			delivery: [],
			error: null
		};
	}

	get snapshot(): Readonly<ComposerSessionSnapshot> {
		return structuredClone(this.#snapshot);
	}

	get draft(): Readonly<PublicationDraft> | null {
		return this.#draft ? structuredClone(this.#draft) : null;
	}

	subscribe(listener: (snapshot: Readonly<ComposerSessionSnapshot>) => void): () => void {
		this.#listeners.add(listener);
		listener(this.snapshot);
		return () => this.#listeners.delete(listener);
	}

	async load(publicationId: string): Promise<void> {
		this.#patch({ phase: 'loading', error: null });
		try {
			const loaded = await this.#client.load(publicationId);
			if (loaded.publication.workspace_id !== this.workspaceId) {
				throw new Error('The Publication does not belong to this Composer session Workspace.');
			}
			this.#draft = structuredClone(loaded.draft);
			this.#draftVersion += 1;
			this.#patch({
				publicationId: loaded.publication.id,
				revision: loaded.publication.revision,
				status: loaded.publication.status,
				dirty: false,
				conflict: null,
				validationIssues: [],
				delivery: [],
				error: null
			});
		} catch (cause) {
			this.#patch({ error: errorMessage(cause) });
			throw cause;
		} finally {
			this.#patch({ phase: 'idle' });
		}
	}

	edit(draft: PublicationDraft): void {
		this.#draft = structuredClone(draft);
		this.#draftVersion += 1;
		this.#patch({ dirty: true, error: null });
	}

	async save(): Promise<ComposerPublication> {
		if (!this.#draft) throw new Error('The Composer session has no content to save.');
		if (this.#snapshot.conflict) {
			throw new ComposerClientError(
				'conflict',
				this.#snapshot.error || 'Resolve the Publication revision conflict before saving.',
				this.#snapshot.conflict.currentRevision
			);
		}
		const draft = structuredClone(this.#draft);
		const draftVersion = this.#draftVersion;
		this.#pendingSaves += 1;
		this.#patch({ phase: 'saving', error: null });
		const run = this.#saveTail.then(() => this.#persist(draft, draftVersion));
		this.#saveTail = run.then(
			() => undefined,
			() => undefined
		);
		return run;
	}

	async flush(): Promise<void> {
		await this.#saveTail;
	}

	bindEditorHandoff(returnToken: string): ComposerEditorHandoffBinding {
		if (!returnToken.trim()) throw new Error('The editor return token is required.');
		if (!this.#snapshot.publicationId || this.#snapshot.revision === null) {
			throw new Error('Save the Publication before opening an editor.');
		}
		return {
			workspaceId: this.workspaceId,
			publicationId: this.#snapshot.publicationId,
			revision: this.#snapshot.revision,
			returnToken
		};
	}

	acceptEditorHandoff(binding: ComposerEditorHandoffBinding): ComposerEditorHandoffBinding {
		if (!binding.returnToken.trim()) throw new Error('The editor return token is required.');
		if (this.#consumedEditorReturnTokens.has(binding.returnToken)) {
			throw new Error('This editor return has already been used.');
		}
		if (binding.workspaceId !== this.workspaceId) {
			throw new Error('This editor return belongs to another Workspace.');
		}
		if (!this.#snapshot.publicationId || binding.publicationId !== this.#snapshot.publicationId) {
			throw new Error('This editor return belongs to another Publication.');
		}
		if (!Number.isInteger(binding.revision) || binding.revision < 1) {
			throw new Error('This editor return has an invalid Publication revision.');
		}
		this.#consumedEditorReturnTokens.add(binding.returnToken);
		this.#patch({ revision: binding.revision, conflict: null, error: null });
		return { ...binding };
	}

	async overwriteConflict(): Promise<ComposerPublication> {
		if (!this.#snapshot.conflict) {
			throw new Error('The Composer session has no revision conflict to overwrite.');
		}
		this.#patch({
			revision: this.#snapshot.conflict.currentRevision,
			conflict: null,
			error: null
		});
		return this.save();
	}

	async validate(): Promise<ValidationIssue[]> {
		const publication = await this.#ensureSaved();
		this.#patch({ phase: 'validating', error: null });
		try {
			const result = await this.#client.validate(publication.id);
			this.#patch({ validationIssues: result.issues });
			return result.issues;
		} catch (cause) {
			this.#patch({ error: errorMessage(cause) });
			throw cause;
		} finally {
			this.#patch({ phase: 'idle' });
		}
	}

	async schedule(): Promise<PublicationAction> {
		const publication = await this.#ensureSaved();
		await this.#validateForDelivery();
		this.#patch({ phase: 'scheduling', error: null });
		try {
			const action = await this.#client.schedule(publication.id, this.#requiredRevision());
			this.#applyAction(action, 'scheduled');
			return action;
		} catch (cause) {
			this.#captureClientError(cause);
			throw cause;
		} finally {
			this.#patch({ phase: 'idle' });
		}
	}

	async publishNow(): Promise<PublicationAction> {
		const publication = await this.#ensureSaved();
		await this.#validateForDelivery();
		this.#patch({ phase: 'publishing', error: null });
		try {
			const action = await this.#client.publishNow(publication.id, this.#requiredRevision());
			this.#applyAction(action, 'publishing');
			return action;
		} catch (cause) {
			this.#captureClientError(cause);
			throw cause;
		} finally {
			this.#patch({ phase: 'idle' });
		}
	}

	async retry(accountId: string, targetKey?: string): Promise<PublicationAction> {
		const publication = await this.#ensureSaved();
		this.#patch({ phase: 'retrying', error: null });
		try {
			const action = await this.#client.retry(publication.id, accountId, targetKey);
			this.#applyAction(action, this.#snapshot.status ?? 'publishing');
			return action;
		} catch (cause) {
			this.#captureClientError(cause);
			throw cause;
		} finally {
			this.#patch({ phase: 'idle' });
		}
	}

	async cancel(): Promise<PublicationAction> {
		const publication = await this.#ensureSaved();
		this.#patch({ phase: 'cancelling', error: null });
		try {
			const action = await this.#client.cancel(publication.id, this.#requiredRevision());
			this.#applyAction(action, 'draft');
			return action;
		} catch (cause) {
			this.#captureClientError(cause);
			throw cause;
		} finally {
			this.#patch({ phase: 'idle' });
		}
	}

	async delete(): Promise<void> {
		const publication = await this.#ensureSaved();
		this.#patch({ phase: 'deleting', error: null });
		try {
			await this.#client.delete(publication.id, this.#requiredRevision());
			this.#draft = null;
			this.#draftVersion += 1;
			this.#patch({
				publicationId: null,
				revision: null,
				status: 'deleted',
				dirty: false,
				conflict: null,
				validationIssues: [],
				delivery: []
			});
		} catch (cause) {
			this.#captureClientError(cause);
			throw cause;
		} finally {
			this.#patch({ phase: 'idle' });
		}
	}

	reset(): void {
		if (this.#pendingSaves > 0) {
			throw new Error('The Composer session cannot reset while a save is pending.');
		}
		this.#draft = null;
		this.#draftVersion += 1;
		this.#snapshot = {
			workspaceId: this.workspaceId,
			publicationId: null,
			revision: null,
			status: null,
			phase: 'idle',
			dirty: false,
			conflict: null,
			validationIssues: [],
			delivery: [],
			error: null
		};
		this.#notify();
	}

	async #persist(draft: PublicationDraft, draftVersion: number): Promise<ComposerPublication> {
		try {
			const publication =
				this.#snapshot.publicationId && this.#snapshot.revision !== null
					? await this.#client.update(this.#snapshot.publicationId, this.#snapshot.revision, draft)
					: await this.#client.create(this.workspaceId, draft);
			this.#patch({
				publicationId: publication.id,
				revision: publication.revision,
				status: publication.status,
				dirty: this.#draftVersion !== draftVersion,
				conflict: null,
				error: null
			});
			return publication;
		} catch (cause) {
			this.#captureClientError(cause, { dirty: true });
			throw cause;
		} finally {
			this.#pendingSaves -= 1;
			if (this.#pendingSaves === 0) this.#patch({ phase: 'idle' });
		}
	}

	async #ensureSaved(): Promise<ComposerPublication> {
		if (this.#snapshot.dirty || !this.#snapshot.publicationId) return this.save();
		return {
			id: this.#snapshot.publicationId,
			workspace_id: this.workspaceId,
			revision: this.#requiredRevision(),
			status: this.#snapshot.status ?? 'draft'
		};
	}

	async #validateForDelivery(): Promise<void> {
		const issues = await this.validate();
		const blocker = issues.find((issue) => issue.severity === 'error');
		if (!blocker) return;
		const failure = new ComposerClientError(
			'not_ready',
			blocker.message || blocker.fallback_message
		);
		this.#patch({ error: failure.message });
		throw failure;
	}

	#requiredRevision(): number {
		if (this.#snapshot.revision === null) {
			throw new Error('The Composer session has no accepted Publication revision.');
		}
		return this.#snapshot.revision;
	}

	#applyAction(action: PublicationAction, status: string): void {
		this.#patch({
			status,
			revision: action.revision ?? this.#snapshot.revision,
			delivery: action.renditions ?? [],
			error: null,
			conflict: null
		});
	}

	#captureClientError(cause: unknown, extra: Partial<ComposerSessionSnapshot> = {}): void {
		this.#patch({
			...extra,
			error: errorMessage(cause),
			...(cause instanceof ComposerClientError &&
			cause.category === 'conflict' &&
			this.#snapshot.revision !== null &&
			typeof cause.currentRevision === 'number'
				? {
						conflict: {
							expectedRevision: this.#snapshot.revision,
							currentRevision: cause.currentRevision
						}
					}
				: {})
		});
	}

	#patch(patch: Partial<ComposerSessionSnapshot>): void {
		this.#snapshot = { ...this.#snapshot, ...patch };
		this.#notify();
	}

	#notify(): void {
		const snapshot = this.snapshot;
		for (const listener of this.#listeners) listener(snapshot);
	}
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : 'The Composer session request failed.';
}
