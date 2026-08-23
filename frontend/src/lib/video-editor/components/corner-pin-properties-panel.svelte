<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import type { TimelineItem, TimelineItemCornerPin } from '$lib/video-editor/project/types';
	import {
		resolveCornerPinForSize,
		withCornerPinReferenceSize,
		type CornerPinKey,
		type CornerPinOffsets
	} from '$lib/video-editor/preview/corner-pin';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	const width = $derived(Math.max(1, item.transform?.width ?? item.cornerPin?.referenceWidth ?? 1));
	const height = $derived(
		Math.max(1, item.transform?.height ?? item.cornerPin?.referenceHeight ?? 1)
	);
	const zero: CornerPinOffsets = {
		topLeft: [0, 0],
		topRight: [0, 0],
		bottomRight: [0, 0],
		bottomLeft: [0, 0]
	};
	const pin = $derived(resolveCornerPinForSize(item.cornerPin, width, height) ?? zero);
	const corners: Array<{ key: CornerPinKey; label: string }> = [
		{ key: 'topLeft', label: 'TL' },
		{ key: 'topRight', label: 'TR' },
		{ key: 'bottomRight', label: 'BR' },
		{ key: 'bottomLeft', label: 'BL' }
	];

	function commit(cornerPin: TimelineItemCornerPin | undefined): void {
		updateItemProperties(item.id, { cornerPin }, 'UPDATE_CORNER_PIN');
		onedit();
	}

	function setCoordinate(corner: CornerPinKey, axis: 0 | 1, value: number): void {
		if (!Number.isFinite(value)) return;
		const nextCorner: [number, number] = [...pin[corner]];
		nextCorner[axis] = value;
		commit(withCornerPinReferenceSize({ ...pin, [corner]: nextCorner }, width, height));
	}
</script>

<section class="flex flex-col gap-2">
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
			{m.video_editor_corner_pin()}
		</h3>
		{#if item.cornerPin}
			<button
				type="button"
				class="rounded px-1.5 py-1 text-[10px] text-[oklch(0.7_0.01_55)] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
				onclick={() => commit(undefined)}>{m.video_editor_corner_pin_reset()}</button
			>
		{/if}
	</div>
	<p class="text-[10px] leading-4 text-[oklch(0.6_0.01_55)]">
		{m.video_editor_corner_pin_hint()}
	</p>
	{#each corners as corner (corner.key)}
		<div class="grid grid-cols-[1.5rem_1fr_1fr] items-end gap-1">
			<span class="pb-2 text-[10px] font-medium text-[oklch(0.72_0.01_55)]">{corner.label}</span>
			<label class="min-w-0 text-[9px] text-[oklch(0.58_0.01_55)]">
				X
				<Input
					type="number"
					min="-2000"
					max="2000"
					step="1"
					class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
					value={pin[corner.key][0]}
					onchange={(event) => setCoordinate(corner.key, 0, event.currentTarget.valueAsNumber)}
				/>
			</label>
			<label class="min-w-0 text-[9px] text-[oklch(0.58_0.01_55)]">
				Y
				<Input
					type="number"
					min="-2000"
					max="2000"
					step="1"
					class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
					value={pin[corner.key][1]}
					onchange={(event) => setCoordinate(corner.key, 1, event.currentTarget.valueAsNumber)}
				/>
			</label>
		</div>
	{/each}
</section>
