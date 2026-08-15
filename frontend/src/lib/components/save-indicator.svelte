<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { cn } from '$lib/utils';

	interface Props {
		saving: boolean;
		saved: boolean;
		savingLabel: string;
		savedLabel: string;
		class?: string;
		testId?: string;
	}

	let { saving, saved, savingLabel, savedLabel, class: className, testId }: Props = $props();
</script>

<span
	class={cn(
		'flex min-w-0 shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground',
		!(saving || saved) && 'invisible',
		className
	)}
	role="status"
	aria-live="polite"
	aria-atomic="true"
	data-testid={testId}
	data-state={saving ? 'saving' : saved ? 'saved' : 'idle'}
>
	{#if saving}
		<LoaderIcon class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
		<span class="whitespace-nowrap max-sm:sr-only">{savingLabel}</span>
	{:else}
		<CheckIcon class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
		<span class="whitespace-nowrap max-sm:sr-only">{savedLabel}</span>
	{/if}
</span>
