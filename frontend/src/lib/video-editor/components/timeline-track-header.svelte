<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import type { TimelineTrack } from '$lib/video-editor/project/types';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import LockIcon from '@lucide/svelte/icons/lock';
	import LockOpenIcon from '@lucide/svelte/icons/lock-open';
	import Link2Icon from '@lucide/svelte/icons/link-2';
	import RadioIcon from '@lucide/svelte/icons/radio';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import Volume2Icon from '@lucide/svelte/icons/volume-2';
	import VolumeXIcon from '@lucide/svelte/icons/volume-x';

	let {
		track,
		itemCount,
		canDelete,
		onvisibility,
		onmute,
		onsolo,
		onlock,
		onsynclock,
		ondelete
	}: {
		track: TimelineTrack;
		itemCount: number;
		canDelete: boolean;
		onvisibility: () => void;
		onmute: () => void;
		onsolo: () => void;
		onlock: () => void;
		onsynclock: () => void;
		ondelete: () => void;
	} = $props();

	const controlClass =
		'size-6 rounded text-[oklch(0.65_0.015_55)] hover:bg-[oklch(0.27_0.012_55)] hover:text-white focus-visible:ring-2 focus-visible:ring-[oklch(0.66_0.14_45)] data-[active=true]:bg-[oklch(0.66_0.14_45_/_0.16)] data-[active=true]:text-[oklch(0.76_0.14_45)]';
</script>

<div
	class="flex size-full min-w-0 flex-col justify-center gap-0.5 border-r border-[oklch(0.25_0.015_55)] bg-[oklch(0.16_0.008_55)] px-2"
	data-track-header={track.id}
>
	<div class="flex min-w-0 items-center gap-1.5">
		<span class="min-w-0 flex-1 truncate text-[11px] font-medium text-white/90">{track.name}</span>
		<span class="shrink-0 font-mono text-[9px] text-[oklch(0.58_0.015_55)]">
			{itemCount}
		</span>
	</div>
	<div class="flex items-center gap-0.5">
		<Button
			variant="ghost"
			size="icon"
			class={controlClass}
			data-active={!track.visible}
			aria-label={track.visible ? m.video_editor_track_hide() : m.video_editor_track_show()}
			title={track.visible ? m.video_editor_track_hide() : m.video_editor_track_show()}
			onclick={onvisibility}
		>
			{#if track.visible}<EyeIcon class="size-3.5" />{:else}<EyeOffIcon class="size-3.5" />{/if}
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class={controlClass}
			data-active={track.syncLock !== false}
			aria-label={track.syncLock !== false
				? m.video_editor_track_sync_unlock()
				: m.video_editor_track_sync_lock()}
			title={track.syncLock !== false
				? m.video_editor_track_sync_unlock()
				: m.video_editor_track_sync_lock()}
			onclick={onsynclock}
		>
			<Link2Icon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class={controlClass}
			data-active={track.muted}
			aria-label={track.muted ? m.video_editor_track_unmute() : m.video_editor_track_mute()}
			title={track.muted ? m.video_editor_track_unmute() : m.video_editor_track_mute()}
			onclick={onmute}
		>
			{#if track.muted}<VolumeXIcon class="size-3.5" />{:else}<Volume2Icon class="size-3.5" />{/if}
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class={controlClass}
			data-active={track.solo}
			aria-label={track.solo ? m.video_editor_track_unsolo() : m.video_editor_track_solo()}
			title={track.solo ? m.video_editor_track_unsolo() : m.video_editor_track_solo()}
			onclick={onsolo}
		>
			<RadioIcon class="size-3.5" />
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class={controlClass}
			data-active={track.locked}
			aria-label={track.locked ? m.video_editor_track_unlock() : m.video_editor_track_lock()}
			title={track.locked ? m.video_editor_track_unlock() : m.video_editor_track_lock()}
			onclick={onlock}
		>
			{#if track.locked}<LockIcon class="size-3.5" />{:else}<LockOpenIcon class="size-3.5" />{/if}
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="{controlClass} ml-auto hover:bg-red-500/15 hover:text-red-300"
			aria-label={m.video_editor_track_delete()}
			title={canDelete ? m.video_editor_track_delete() : m.video_editor_track_keep_one()}
			disabled={!canDelete}
			onclick={ondelete}
		>
			<Trash2Icon class="size-3.5" />
		</Button>
	</div>
</div>
