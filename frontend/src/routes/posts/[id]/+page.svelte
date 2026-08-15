<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import { client } from '$lib/api/client';
	import { canonicalPublicationPathFromLegacyPost } from '$lib/composer/compatibility-route';
	import { Button } from '$lib/components/ui/button';
	import PageLoading from '$lib/components/page-loading.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { m } from '$lib/paraglide/messages';

	let hasLoaded = $state(false);
	let error = $state('');
	let requestedPostId = $state('');
	let postRequestSequence = 0;

	const postId = $derived($page.params.id);

	async function loadPost(id: string) {
		const requestSequence = ++postRequestSequence;
		hasLoaded = false;
		error = '';
		try {
			const { data, error: err } = await client.GET('/posts/{id}', {
				params: { path: { id } }
			});
			if (err) throw new Error(err.detail || m.post_edit_load_failed());
			if (requestSequence !== postRequestSequence || postId !== id) return;
			const canonicalPath = canonicalPublicationPathFromLegacyPost(data);
			if (canonicalPath) {
				await goto(resolve(canonicalPath as '/'), {
					replaceState: true
				});
				return;
			}
			throw new Error(m.post_edit_load_failed());
		} catch (e) {
			if (requestSequence !== postRequestSequence || postId !== id) return;
			error = (e as Error).message;
		} finally {
			if (requestSequence === postRequestSequence && postId === id) hasLoaded = true;
		}
	}

	$effect(() => {
		if (postId && postId !== requestedPostId) {
			requestedPostId = postId;
			loadPost(postId);
		}
	});
</script>

<svelte:head>
	<title>{m.post_edit_loading_title()} - {m.common_openpost()}</title>
</svelte:head>

{#if !hasLoaded}
	<div class="flex flex-1 flex-col" aria-busy="true">
		<PageLoading layout="composer" label={m.post_edit_loading()} />
	</div>
{:else if error}
	<div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
		<InlineNotice tone="error" message={error}>
			{#snippet actions()}
				<Button size="sm" onclick={() => postId && loadPost(postId)}>{m.common_retry()}</Button>
				<Button variant="outline" size="sm" onclick={() => goto(resolve('/'))}>
					{m.common_back()}
				</Button>
			{/snippet}
		</InlineNotice>
	</div>
{/if}
