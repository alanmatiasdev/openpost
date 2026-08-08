<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { client } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { Button } from '$lib/components/ui/button';
	import PageLoading from '$lib/components/page-loading.svelte';
	import PageContainer from '$lib/components/page-container.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import ComposeTextPost from '$lib/components/compose-text-post.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getPlatformName } from '$lib/utils';
	import { getLocaleTag } from '$lib/i18n';
	import ArrowLeftIcon from 'lucide-svelte/icons/arrow-left';
	import ExternalLinkIcon from 'lucide-svelte/icons/external-link';

	type Publication = components['schemas']['PublicationResponse'];
	type PostDetailResponse = components['schemas']['PostDetailResponse'];
	type PostDetail = Omit<PostDetailResponse, 'media' | 'destinations'> & {
		media: NonNullable<PostDetailResponse['media']>;
		destinations: NonNullable<PostDetailResponse['destinations']>;
	};

	let publication = $state<Publication | null>(null);
	let textPost = $state<PostDetail | null>(null);
	let hasLoaded = $state(false);
	let error = $state('');
	let requestedPublicationId = $state('');
	let publicationRequestSequence = 0;

	const publicationId = $derived($page.params.id);
	const readOnlyPublication = $derived(
		publication?.status === 'published' || publication?.status === 'publishing'
	);

	function statusLabel(status: string) {
		if (status === 'published') return m.activity_status_published();
		if (status === 'publishing') return m.activity_status_publishing();
		if (status === 'failed') return m.activity_status_failed();
		if (status === 'scheduled') return m.activity_status_scheduled();
		return m.activity_status_draft();
	}

	function formatDateTime(value: string) {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	async function loadPublication(id: string) {
		const requestSequence = ++publicationRequestSequence;
		hasLoaded = false;
		error = '';
		textPost = null;
		try {
			const { data, error: err } = await client.GET('/publications/{id}', {
				params: { path: { id } }
			});
			if (err) throw new Error((err as any)?.detail || m.publication_edit_load_failed());
			if (requestSequence !== publicationRequestSequence || publicationId !== id) return;
			if (data.text_post_id) {
				const { data: postData, error: postError } = await client.GET('/posts/{id}', {
					params: { path: { id: data.text_post_id } }
				});
				if (postError) {
					throw new Error(postError.detail || m.post_edit_load_failed());
				}
				if (requestSequence !== publicationRequestSequence || publicationId !== id) return;
				textPost = postData
					? {
							...postData,
							media: postData.media ?? [],
							destinations: postData.destinations ?? []
						}
					: null;
			}
			publication = data;
		} catch (err) {
			if (requestSequence !== publicationRequestSequence || publicationId !== id) return;
			error = err instanceof Error ? err.message : m.publication_edit_load_failed();
			publication = null;
		} finally {
			if (requestSequence === publicationRequestSequence && publicationId === id) hasLoaded = true;
		}
	}

	async function handleSuccess() {
		ui.triggerRefresh();
		goto(resolve('/'));
	}

	$effect(() => {
		if (publicationId && publicationId !== requestedPublicationId) {
			requestedPublicationId = publicationId;
			loadPublication(publicationId);
		}
	});
</script>

<svelte:head>
	<title
		>{publication
			? readOnlyPublication
				? m.publication_detail_title()
				: m.publication_edit_title()
			: m.publication_edit_loading_title()} - {m.common_openpost()}</title
	>
</svelte:head>

{#if !hasLoaded}
	<div class="flex flex-1 flex-col" aria-busy="true">
		<PageLoading layout="composer" label={m.publication_edit_loading()} />
	</div>
{:else if error && !publication}
	<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button size="sm" onclick={() => publicationId && loadPublication(publicationId)}>
					{m.common_retry()}
				</Button>
				<Button variant="outline" size="sm" onclick={() => goto(resolve('/'))}>
					{m.common_back()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{:else if publication && readOnlyPublication}
	<PageContainer
		title={publication.title || m.publication_detail_title()}
		description={m.publication_detail_description({ status: statusLabel(publication.status) })}
	>
		{#snippet actions()}
			<Button variant="outline" onclick={() => history.back()}>
				<ArrowLeftIcon class="mr-1.5 size-4" />
				{m.common_back()}
			</Button>
		{/snippet}

		<div class="space-y-6">
			<InlineNotice tone="info" message={m.publication_published_editing_explanation()} />

			<section class="rounded-xl border bg-card p-4 sm:p-6">
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
					<span class="font-medium text-foreground">{statusLabel(publication.status)}</span>
					<span>·</span>
					<span>{formatDateTime(publication.actual_run_at || publication.updated_at)}</span>
				</div>
				<div class="mt-4 space-y-4">
					{#if publication.source_text}
						<p class="max-w-3xl leading-7 whitespace-pre-wrap">{publication.source_text}</p>
					{/if}
					{#each publication.segments ?? [] as segment (segment.id)}
						<div class="max-w-3xl border-t pt-4">
							{#if segment.title}<h2 class="font-semibold">{segment.title}</h2>{/if}
							{#if segment.body}<p class="mt-2 leading-7 whitespace-pre-wrap">
									{segment.body}
								</p>{/if}
						</div>
					{/each}
				</div>
			</section>

			<section aria-labelledby="publication-destinations-heading">
				<h2 id="publication-destinations-heading" class="mb-3 text-base font-semibold">
					{m.publication_destinations_heading()}
				</h2>
				<div class="grid gap-3 sm:grid-cols-2">
					{#each publication.renditions ?? [] as rendition (rendition.id)}
						<div class="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4">
							<PlatformIcon platform={rendition.platform} class="mt-0.5 size-5 shrink-0" />
							<div class="min-w-0 flex-1">
								<p class="font-medium">{getPlatformName(rendition.platform)}</p>
								<p class="mt-0.5 text-sm text-muted-foreground">
									{statusLabel(rendition.status)}
								</p>
								{#if rendition.error_message}
									<p class="mt-2 text-sm text-destructive">{rendition.error_message}</p>
								{/if}
							</div>
							{#if rendition.external_url}
								<Button
									href={rendition.external_url}
									target="_blank"
									rel="noreferrer"
									variant="ghost"
									size="icon"
									aria-label={m.publication_view_on_platform({
										platform: getPlatformName(rendition.platform)
									})}
								>
									<ExternalLinkIcon class="size-4" />
								</Button>
							{/if}
						</div>
					{/each}
				</div>
			</section>
		</div>
	</PageContainer>
{:else if publication}
	<div class="flex flex-1 flex-col overflow-hidden">
		<ComposeTextPost
			initialPost={textPost ?? undefined}
			initialPublication={publication}
			onSuccess={handleSuccess}
			onDeleted={handleSuccess}
		/>
	</div>
{/if}
