<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Input } from '$lib/components/ui/input';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();
	const maxFrame = $derived(Math.max(0, (item.lottieTotalFrames ?? 1) - 1));

	function commit(patch: Partial<TimelineItem>): void {
		updateItemProperties(item.id, patch, 'UPDATE_LOTTIE_PROPERTIES');
		onedit();
	}

	function setNumber(
		property: 'speed' | 'lottieSegmentStart' | 'lottieSegmentEnd',
		value: number
	): void {
		if (!Number.isFinite(value)) return;
		if (property === 'speed') {
			commit({ speed: Math.max(0.05, Math.min(16, value)) });
			return;
		}
		const next = Math.max(0, Math.min(maxFrame, Math.round(value)));
		if (property === 'lottieSegmentStart') {
			commit({
				lottieSegmentStart: next,
				lottieSegmentEnd: Math.max(next, item.lottieSegmentEnd ?? maxFrame)
			});
		} else {
			commit({
				lottieSegmentStart: Math.min(item.lottieSegmentStart ?? 0, next),
				lottieSegmentEnd: next
			});
		}
	}

	function useMarker(name: string): void {
		const marker = item.lottieMarkers?.find((candidate) => candidate.name === name);
		if (!marker) return;
		const start = Math.max(0, Math.min(Math.round(marker.start), maxFrame));
		const end =
			marker.duration > 0
				? Math.max(start, Math.min(Math.round(marker.start + marker.duration), maxFrame))
				: maxFrame;
		commit({ lottieSegmentStart: start, lottieSegmentEnd: end });
	}
</script>

<section class="flex flex-col gap-2" aria-label={m.video_editor_lottie()}>
	<div class="flex items-center justify-between gap-2">
		<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
			{m.video_editor_lottie()}
		</h3>
		<span class="text-[9px] text-[oklch(0.58_0.01_55)] tabular-nums">
			{item.lottieTotalFrames ?? 1}f · {(item.lottieFrameRate ?? 30).toFixed(2)} fps
		</span>
	</div>
	<div class="grid grid-cols-2 gap-1">
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_lottie_speed()}
			<Input
				type="number"
				min="0.05"
				max="16"
				step="0.05"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.speed ?? 1}
				onchange={(event) => setNumber('speed', event.currentTarget.valueAsNumber)}
			/>
		</label>
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_lottie_repeat_mode()}
			<select
				class="mt-0.5 h-8 w-full rounded border-0 bg-[oklch(0.22_0.01_50)] px-1.5 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				value={item.lottieLoopMode ?? 'loop'}
				onchange={(event) =>
					commit({
						lottieLoopMode: event.currentTarget.value as 'loop' | 'pingpong'
					})}
			>
				<option value="loop">{m.video_editor_lottie_loop()}</option>
				<option value="pingpong">{m.video_editor_lottie_ping_pong()}</option>
			</select>
		</label>
	</div>
	{#if item.lottieMarkers && item.lottieMarkers.length > 0}
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_lottie_marker()}
			<select
				class="mt-0.5 h-8 w-full rounded border-0 bg-[oklch(0.22_0.01_50)] px-1.5 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
				aria-label={m.video_editor_lottie_marker()}
				onchange={(event) => useMarker(event.currentTarget.value)}
			>
				<option value="">{m.video_editor_lottie_marker_choose()}</option>
				{#each item.lottieMarkers as marker (marker.name)}
					<option value={marker.name}>{marker.name}</option>
				{/each}
			</select>
		</label>
	{/if}
	<div class="grid grid-cols-2 gap-1">
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_property_start()}
			<Input
				type="number"
				min="0"
				max={maxFrame}
				step="1"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.lottieSegmentStart ?? 0}
				onchange={(event) => setNumber('lottieSegmentStart', event.currentTarget.valueAsNumber)}
			/>
		</label>
		<label class="min-w-0 text-[10px] text-[oklch(0.7_0.01_55)]">
			{m.video_editor_property_end()}
			<Input
				type="number"
				min="0"
				max={maxFrame}
				step="1"
				class="mt-0.5 h-8 w-full rounded bg-[oklch(0.22_0.01_50)] px-1.5 text-xs"
				value={item.lottieSegmentEnd ?? maxFrame}
				onchange={(event) => setNumber('lottieSegmentEnd', event.currentTarget.valueAsNumber)}
			/>
		</label>
	</div>
	<div class="grid grid-cols-2 gap-1 rounded bg-[oklch(0.19_0.01_50)] p-1.5">
		<label class="flex min-h-7 items-center gap-2 text-[10px] text-[oklch(0.72_0.01_55)]">
			<input
				type="checkbox"
				class="size-3.5 accent-[oklch(0.66_0.14_45)]"
				checked={item.lottieLoop ?? true}
				onchange={(event) => commit({ lottieLoop: event.currentTarget.checked })}
			/>
			{m.video_editor_lottie_repeat()}
		</label>
		<label class="flex min-h-7 items-center gap-2 text-[10px] text-[oklch(0.72_0.01_55)]">
			<input
				type="checkbox"
				class="size-3.5 accent-[oklch(0.66_0.14_45)]"
				checked={item.lottieReversed ?? false}
				onchange={(event) => commit({ lottieReversed: event.currentTarget.checked })}
			/>
			{m.video_editor_lottie_reverse()}
		</label>
	</div>
	<p class="text-[10px] leading-4 text-[oklch(0.58_0.01_55)]">
		{m.video_editor_lottie_hint()}
	</p>
</section>
