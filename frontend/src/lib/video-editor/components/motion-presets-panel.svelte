<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
	import {
		applyMotionPreset,
		canApplyMotionPreset,
		type MotionPresetApplyMode
	} from '$lib/video-editor/timeline/actions/motion-presets';
	import {
		MOTION_PRESET_CATEGORIES,
		MOTION_PRESETS,
		motionPresetScalesBox,
		type MotionPreset,
		type MotionPresetCategory,
		type MotionPresetId
	} from '$lib/video-editor/timeline/motion-presets';

	let {
		itemId,
		itemIds = [],
		frameWidth,
		frameHeight,
		fps,
		onedit
	}: {
		itemId: string | null;
		itemIds?: string[];
		frameWidth: number;
		frameHeight: number;
		fps: number;
		onedit: () => void;
	} = $props();

	let mode = $state<MotionPresetApplyMode>('replace');
	let durationScale = $state(1);
	let intensityScale = $state(1);
	let staggerFrames = $state(0);
	let status = $state('');

	const selectedIds = $derived(itemId ? [...new Set([itemId, ...itemIds])].filter(Boolean) : []);
	const selectedItems = $derived(
		selectedIds.flatMap((id) => {
			const item = timelineStore.itemById.get(id);
			return item ? [item] : [];
		})
	);

	const labels = $derived<Record<MotionPresetId, string>>({
		'fade-in': m.video_editor_motion_fade_in(),
		'slide-in-left': m.video_editor_motion_slide_in_left(),
		'slide-in-right': m.video_editor_motion_slide_in_right(),
		'slide-in-up': m.video_editor_motion_slide_in_up(),
		'slide-in-down': m.video_editor_motion_slide_in_down(),
		'pop-in': m.video_editor_motion_pop_in(),
		'zoom-in': m.video_editor_motion_zoom_in(),
		'spin-in': m.video_editor_motion_spin_in(),
		'bounce-in': m.video_editor_motion_bounce_in(),
		'fade-out': m.video_editor_motion_fade_out(),
		'slide-out-left': m.video_editor_motion_slide_out_left(),
		'slide-out-right': m.video_editor_motion_slide_out_right(),
		'slide-out-up': m.video_editor_motion_slide_out_up(),
		'slide-out-down': m.video_editor_motion_slide_out_down(),
		'pop-out': m.video_editor_motion_pop_out(),
		'zoom-out': m.video_editor_motion_zoom_out(),
		pulse: m.video_editor_motion_pulse(),
		shake: m.video_editor_motion_shake(),
		wobble: m.video_editor_motion_wobble(),
		flash: m.video_editor_motion_flash()
	});

	const categoryLabels = $derived<Record<MotionPresetCategory, string>>({
		entrance: m.video_editor_motion_entrance(),
		exit: m.video_editor_motion_exit(),
		emphasis: m.video_editor_motion_emphasis()
	});

	function presetsFor(category: MotionPresetCategory): MotionPreset[] {
		return MOTION_PRESETS.filter((preset) => preset.category === category);
	}

	function disabledReason(preset: MotionPreset): string | null {
		if (selectedItems.length === 0) return m.video_editor_motion_select_clip();
		if (selectedItems.some((item) => item.type === 'text') && motionPresetScalesBox(preset)) {
			return m.video_editor_motion_text_incompatible();
		}
		if (selectedItems.some((item) => !canApplyMotionPreset(item, preset))) {
			return m.video_editor_motion_incompatible();
		}
		return null;
	}

	function applyPreset(preset: MotionPreset): void {
		const reason = disabledReason(preset);
		if (reason) {
			status = reason;
			return;
		}
		const result = applyMotionPreset({
			itemIds: selectedIds,
			presetId: preset.id,
			mode,
			frameWidth,
			frameHeight,
			fps,
			settings: { durationScale, intensityScale, staggerFrames }
		});
		if (result.ok) {
			status = m.video_editor_motion_applied({
				name: labels[preset.id],
				count: String(selectedItems.length)
			});
			onedit();
			return;
		}
		status =
			result.reason === 'transition-blocked'
				? m.video_editor_motion_transition_blocked()
				: result.reason === 'no-change'
					? m.video_editor_motion_no_change()
					: m.video_editor_motion_incompatible();
	}

	function modeLabel(): string {
		return mode === 'replace' ? m.video_editor_motion_replace() : m.video_editor_motion_add();
	}
</script>

<section class="motion-panel" aria-labelledby="motion-panel-title">
	<div class="motion-heading">
		<div>
			<h2 id="motion-panel-title">{m.video_editor_motion_title()}</h2>
			<p>{m.video_editor_motion_description()}</p>
		</div>
		<span class="selection-count"
			>{m.video_editor_motion_selected({ count: String(selectedItems.length) })}</span
		>
	</div>

	<div class="mode-control" role="group" aria-label={m.video_editor_motion_apply_mode()}>
		<button
			type="button"
			class:active={mode === 'replace'}
			aria-pressed={mode === 'replace'}
			onclick={() => (mode = 'replace')}
		>
			{m.video_editor_motion_replace()}
		</button>
		<button
			type="button"
			class:active={mode === 'add'}
			aria-pressed={mode === 'add'}
			onclick={() => (mode = 'add')}
		>
			{m.video_editor_motion_add()}
		</button>
	</div>
	<p class="mode-hint">
		{mode === 'replace' ? m.video_editor_motion_replace_hint() : m.video_editor_motion_add_hint()}
	</p>

	<div class="generator-controls">
		<label>
			<span>{m.video_editor_motion_duration()}</span>
			<output>{Math.round(durationScale * 100)}%</output>
			<input type="range" min="0.25" max="3" step="0.05" bind:value={durationScale} />
		</label>
		<label>
			<span>{m.video_editor_motion_intensity()}</span>
			<output>{Math.round(intensityScale * 100)}%</output>
			<input type="range" min="0" max="2" step="0.05" bind:value={intensityScale} />
		</label>
		<label>
			<span>{m.video_editor_motion_stagger()}</span>
			<output>{staggerFrames}</output>
			<input type="range" min="0" max="30" step="1" bind:value={staggerFrames} />
		</label>
	</div>

	<div class="preset-library">
		{#each MOTION_PRESET_CATEGORIES as category}
			<section class="preset-group" aria-labelledby={`motion-category-${category}`}>
				<h3 id={`motion-category-${category}`}>{categoryLabels[category]}</h3>
				<div class="preset-grid">
					{#each presetsFor(category) as preset (preset.id)}
						{@const reason = disabledReason(preset)}
						<button
							type="button"
							class="preset-tile"
							disabled={reason !== null}
							title={reason ??
								m.video_editor_motion_apply_named({ mode: modeLabel(), name: labels[preset.id] })}
							aria-label={m.video_editor_motion_apply_named({
								mode: modeLabel(),
								name: labels[preset.id]
							})}
							data-kind={preset.thumbnail.kind}
							data-category={preset.category}
							data-angle={preset.thumbnail.angle ?? 0}
							data-direction={preset.thumbnail.direction ?? 1}
							onclick={() => applyPreset(preset)}
						>
							<span class="thumbnail" aria-hidden="true">
								<span class="motion-glyph"></span>
								<span class="motion-origin"></span>
							</span>
							<span>{labels[preset.id]}</span>
						</button>
					{/each}
				</div>
			</section>
		{/each}
	</div>

	<p class="motion-status" aria-live="polite">{status}</p>
</section>

<style>
	.motion-panel {
		margin-top: 0.5rem;
		border-top: 1px solid oklch(0.25 0.015 55);
		padding-top: 0.75rem;
		color: oklch(0.92 0.012 70);
	}
	.motion-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 0.75rem;
	}
	h2,
	h3,
	p {
		margin: 0;
	}
	h2 {
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.01em;
	}
	.motion-heading p,
	.mode-hint,
	.motion-status {
		margin-top: 0.2rem;
		font-size: 0.625rem;
		line-height: 1.4;
		color: oklch(0.67 0.018 65);
	}
	.selection-count {
		flex: none;
		border: 1px solid oklch(0.31 0.02 58);
		border-radius: 999px;
		padding: 0.15rem 0.4rem;
		font-size: 0.5625rem;
		color: oklch(0.72 0.02 68);
	}
	.mode-control {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin-top: 0.6rem;
		border: 1px solid oklch(0.29 0.018 58);
		border-radius: 0.4rem;
		padding: 0.15rem;
		background: oklch(0.175 0.012 55);
	}
	.mode-control button {
		min-height: 1.75rem;
		border: 0;
		border-radius: 0.28rem;
		background: transparent;
		color: oklch(0.65 0.018 65);
		font-size: 0.625rem;
		font-weight: 600;
		cursor: pointer;
	}
	.mode-control button.active {
		background: oklch(0.29 0.035 55);
		color: oklch(0.95 0.014 70);
		box-shadow: 0 1px 2px oklch(0.08 0.01 55 / 0.45);
	}
	.mode-control button:focus-visible,
	.preset-tile:focus-visible,
	.generator-controls input:focus-visible {
		outline: 2px solid oklch(0.66 0.14 45);
		outline-offset: 2px;
	}
	.generator-controls {
		display: grid;
		gap: 0.45rem;
		margin-top: 0.65rem;
		border: 1px solid oklch(0.255 0.016 55);
		border-radius: 0.45rem;
		padding: 0.55rem;
		background: oklch(0.17 0.01 55 / 0.7);
	}
	.generator-controls label {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		column-gap: 0.5rem;
		font-size: 0.6rem;
		color: oklch(0.76 0.018 65);
	}
	.generator-controls output {
		min-width: 2.4rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
		color: oklch(0.68 0.11 45);
	}
	.generator-controls input {
		grid-column: 1 / -1;
		width: 100%;
		height: 1rem;
		accent-color: oklch(0.66 0.14 45);
		cursor: pointer;
	}
	.preset-library {
		display: grid;
		gap: 0.8rem;
		margin-top: 0.8rem;
	}
	.preset-group h3 {
		margin-bottom: 0.4rem;
		font-size: 0.5625rem;
		font-weight: 700;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: oklch(0.64 0.02 65);
	}
	.preset-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.35rem;
	}
	.preset-tile {
		display: flex;
		min-width: 0;
		min-height: 4.15rem;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		border: 1px solid oklch(0.27 0.016 55);
		border-radius: 0.4rem;
		padding: 0.35rem;
		background: oklch(0.18 0.012 55);
		color: oklch(0.7 0.018 65);
		font-size: 0.55rem;
		line-height: 1.15;
		text-align: center;
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background 120ms ease,
			color 120ms ease;
	}
	.preset-tile:hover:not(:disabled),
	.preset-tile:focus-visible {
		border-color: oklch(0.48 0.065 50);
		background: oklch(0.225 0.022 52);
		color: oklch(0.95 0.014 70);
	}
	.preset-tile:disabled {
		cursor: not-allowed;
		opacity: 0.42;
	}
	.thumbnail {
		position: relative;
		display: grid;
		width: 2.25rem;
		height: 1.65rem;
		place-items: center;
		overflow: hidden;
		border-radius: 0.28rem;
		background: oklch(0.135 0.012 55);
	}
	.motion-origin {
		position: absolute;
		width: 0.25rem;
		height: 0.25rem;
		border: 1px solid oklch(0.58 0.035 58);
		border-radius: 50%;
		opacity: 0.55;
	}
	.motion-glyph {
		position: relative;
		z-index: 1;
		width: 0.8rem;
		height: 0.8rem;
		border-radius: 0.18rem;
		background: oklch(0.68 0.15 45);
		box-shadow: 0 0 0 1px oklch(0.84 0.09 55 / 0.22);
	}
	.preset-tile[data-kind='fade']:hover .motion-glyph,
	.preset-tile[data-kind='fade']:focus-visible .motion-glyph {
		animation: ve-motion-fade 700ms ease-in-out infinite alternate;
	}
	.preset-tile[data-kind='slide'][data-angle='0']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='0']:focus-visible .motion-glyph {
		animation: ve-motion-slide-right 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='slide'][data-angle='180']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='180']:focus-visible .motion-glyph {
		animation: ve-motion-slide-left 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='slide'][data-angle='90']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='90']:focus-visible .motion-glyph {
		animation: ve-motion-slide-down 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='slide'][data-angle='270']:hover .motion-glyph,
	.preset-tile[data-kind='slide'][data-angle='270']:focus-visible .motion-glyph {
		animation: ve-motion-slide-up 700ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='scale']:hover .motion-glyph,
	.preset-tile[data-kind='scale']:focus-visible .motion-glyph,
	.preset-tile[data-kind='pulse']:hover .motion-glyph,
	.preset-tile[data-kind='pulse']:focus-visible .motion-glyph {
		animation: ve-motion-scale 650ms cubic-bezier(0.34, 1.56, 0.64, 1) infinite alternate;
	}
	.preset-tile[data-kind='spin']:hover .motion-glyph,
	.preset-tile[data-kind='spin']:focus-visible .motion-glyph {
		animation: ve-motion-spin 750ms cubic-bezier(0.16, 1, 0.3, 1) infinite;
	}
	.preset-tile[data-kind='bounce']:hover .motion-glyph,
	.preset-tile[data-kind='bounce']:focus-visible .motion-glyph {
		animation: ve-motion-bounce 650ms cubic-bezier(0.2, 1.5, 0.4, 1) infinite;
	}
	.preset-tile[data-kind='shake']:hover .motion-glyph,
	.preset-tile[data-kind='shake']:focus-visible .motion-glyph {
		animation: ve-motion-shake 430ms ease-in-out infinite;
	}
	.preset-tile[data-kind='wobble']:hover .motion-glyph,
	.preset-tile[data-kind='wobble']:focus-visible .motion-glyph {
		animation: ve-motion-wobble 620ms ease-in-out infinite;
	}
	.motion-status {
		min-height: 0.9rem;
		color: oklch(0.76 0.055 58);
	}
	@keyframes ve-motion-fade {
		from {
			opacity: 0.18;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-right {
		from {
			transform: translateX(-0.75rem);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-left {
		from {
			transform: translateX(0.75rem);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-down {
		from {
			transform: translateY(-0.5rem);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-slide-up {
		from {
			transform: translateY(0.5rem);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-scale {
		from {
			transform: scale(0.62);
			opacity: 0.45;
		}
		to {
			transform: scale(1.12);
			opacity: 1;
		}
	}
	@keyframes ve-motion-spin {
		from {
			transform: rotate(-180deg) scale(0.7);
			opacity: 0;
		}
		to {
			transform: rotate(0) scale(1);
			opacity: 1;
		}
	}
	@keyframes ve-motion-bounce {
		0% {
			transform: translateY(-0.5rem);
			opacity: 0;
		}
		72% {
			transform: translateY(0.12rem);
			opacity: 1;
		}
		100% {
			transform: translateY(0);
			opacity: 1;
		}
	}
	@keyframes ve-motion-shake {
		0%,
		100% {
			transform: translateX(0);
		}
		25% {
			transform: translateX(0.3rem);
		}
		75% {
			transform: translateX(-0.3rem);
		}
	}
	@keyframes ve-motion-wobble {
		0%,
		100% {
			transform: rotate(0);
		}
		30% {
			transform: rotate(10deg);
		}
		65% {
			transform: rotate(-8deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.preset-tile,
		.motion-glyph {
			animation: none !important;
			transition: none !important;
		}
	}
</style>
