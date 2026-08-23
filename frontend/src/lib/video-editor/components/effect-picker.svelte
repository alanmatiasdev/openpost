<script lang="ts" module>
	import type { CssFilterType } from '$lib/video-editor/effects/types';

	export interface EffectPickerOption {
		value: string;
		label: string;
		group: string;
		gpuEffectId?: string;
		cssEffect?: CssFilterType;
		cssAmount?: number;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import * as Command from '$lib/components/ui/command';
	import * as Popover from '$lib/components/ui/popover';
	import { prewarmEffectPreviews } from '$lib/video-editor/effects/preview/effect-preview-engine';
	import EffectThumbnail from './effect-thumbnail.svelte';

	let {
		value = $bindable(''),
		options,
		ariaLabel,
		searchPlaceholder,
		emptyLabel,
		disabled = false,
		onValueChange
	}: {
		value?: string;
		options: EffectPickerOption[];
		ariaLabel: string;
		searchPlaceholder: string;
		emptyLabel: string;
		disabled?: boolean;
		onValueChange?: (value: string) => void;
	} = $props();

	let open = $state(false);
	let hoveredValue = $state<string | null>(null);
	let listElement = $state<HTMLElement | null>(null);
	const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? value);
	const groups = $derived(
		[...new Set(options.map((option) => option.group))].map((label) => ({
			label,
			options: options.filter((option) => option.group === label)
		}))
	);

	function selectOption(next: string): void {
		value = next;
		onValueChange?.(next);
		open = false;
		hoveredValue = null;
	}

	onMount(() => {
		const idle = window.requestIdleCallback?.(() => prewarmEffectPreviews());
		if (idle === undefined) prewarmEffectPreviews();
		return () => {
			if (idle !== undefined) window.cancelIdleCallback?.(idle);
		};
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class="flex h-8 min-w-0 flex-1 items-center justify-between gap-1 rounded border border-[oklch(0.32_0.015_55)] bg-[oklch(0.18_0.008_50)] px-2 text-xs hover:bg-[oklch(0.22_0.01_50)] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] disabled:cursor-not-allowed disabled:opacity-50"
				aria-label={ariaLabel}
				aria-expanded={open}
				{disabled}
			>
				<span class="truncate">{selectedLabel}</span>
				<ChevronDownIcon class="size-3 shrink-0 opacity-60" />
			</button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="start" class="w-80 max-w-[calc(100vw-1rem)] p-0">
		<Command.Root>
			<Command.Input placeholder={searchPlaceholder} />
			<Command.List bind:ref={listElement} class="max-h-[min(26rem,60vh)]">
				<Command.Empty>{emptyLabel}</Command.Empty>
				{#each groups as group (group.label)}
					<Command.Group heading={group.label}>
						{#each group.options as option (option.value)}
							<Command.Item
								value={`${option.label} ${option.group}`}
								data-effect-option={option.value}
								data-checked={option.value === value}
								class="min-h-11 gap-2"
								onSelect={() => selectOption(option.value)}
								onpointerenter={() => (hoveredValue = option.value)}
								onpointerleave={() => {
									if (hoveredValue === option.value) hoveredValue = null;
								}}
								onfocus={() => (hoveredValue = option.value)}
								onblur={() => {
									if (hoveredValue === option.value) hoveredValue = null;
								}}
							>
								<EffectThumbnail
									effectId={option.gpuEffectId}
									cssEffect={option.cssEffect}
									cssAmount={option.cssAmount}
									viewport={listElement}
									active={hoveredValue === option.value}
									class="h-[27px] w-12 shrink-0 rounded"
								/>
								<span class="min-w-0 truncate">{option.label}</span>
							</Command.Item>
						{/each}
					</Command.Group>
				{/each}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
