<script lang="ts">
	/* oxlint-disable anti-slop/no-known-value-widening, anti-slop/no-unknown-parameters, anti-slop/require-safety-comment-for-type-assertion -- The six typed band definitions map resolved EQ keys to flat persisted timeline keys. */
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { m } from '$lib/paraglide/messages';
	import AppSelect, { type AppSelectOption } from '$lib/components/app-select.svelte';
	import type { TimelineItem } from '$lib/video-editor/project/types';
	import { updateItemProperties } from '$lib/video-editor/timeline/actions/items';
	import {
		AUDIO_EQ_GAIN_DB_MAX,
		AUDIO_EQ_GAIN_DB_MIN,
		AUDIO_EQ_PRESETS,
		AUDIO_EQ_Q_MAX,
		AUDIO_EQ_Q_MIN,
		findAudioEqPresetId,
		getAudioEqPresetById,
		resolveAudioEqSettings,
		sampleAudioEqResponseCurve,
		type AudioEqPresetId
	} from '$lib/video-editor/audio/audio-eq';
	import {
		AUDIO_EQ_BAND1_FILTER_OPTIONS,
		AUDIO_EQ_BAND6_FILTER_OPTIONS,
		AUDIO_EQ_INNER_FILTER_OPTIONS,
		AUDIO_EQ_SLOPE_OPTIONS,
		buildTimelineEqPatchFromResolvedSettings
	} from '$lib/video-editor/audio/audio-eq-ui';
	import type { ResolvedAudioEqSettings } from '$lib/video-editor/audio/types';

	let { item, onedit }: { item: TimelineItem; onedit: () => void } = $props();

	interface BandDefinition {
		key: 'band1' | 'low' | 'lowMid' | 'highMid' | 'high' | 'band6';
		label: () => string;
		enabledField: keyof TimelineItem;
		typeField: keyof TimelineItem;
		frequencyField: keyof TimelineItem;
		gainField: keyof TimelineItem;
		qField: keyof TimelineItem;
		slopeField?: keyof TimelineItem;
		enabledKey: keyof ResolvedAudioEqSettings;
		typeKey: keyof ResolvedAudioEqSettings;
		frequencyKey: keyof ResolvedAudioEqSettings;
		gainKey: keyof ResolvedAudioEqSettings;
		qKey: keyof ResolvedAudioEqSettings;
		slopeKey?: keyof ResolvedAudioEqSettings;
		types: readonly string[];
	}

	const bands: BandDefinition[] = [
		{
			key: 'band1',
			label: m.video_editor_audio_eq_band_1,
			enabledField: 'audioEqBand1Enabled',
			typeField: 'audioEqBand1Type',
			frequencyField: 'audioEqBand1FrequencyHz',
			gainField: 'audioEqBand1GainDb',
			qField: 'audioEqBand1Q',
			slopeField: 'audioEqBand1SlopeDbPerOct',
			enabledKey: 'band1Enabled',
			typeKey: 'band1Type',
			frequencyKey: 'band1FrequencyHz',
			gainKey: 'band1GainDb',
			qKey: 'band1Q',
			slopeKey: 'band1SlopeDbPerOct',
			types: AUDIO_EQ_BAND1_FILTER_OPTIONS
		},
		{
			key: 'low',
			label: m.video_editor_audio_eq_low,
			enabledField: 'audioEqLowEnabled',
			typeField: 'audioEqLowType',
			frequencyField: 'audioEqLowFrequencyHz',
			gainField: 'audioEqLowGainDb',
			qField: 'audioEqLowQ',
			enabledKey: 'lowEnabled',
			typeKey: 'lowType',
			frequencyKey: 'lowFrequencyHz',
			gainKey: 'lowGainDb',
			qKey: 'lowQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'lowMid',
			label: m.video_editor_audio_eq_low_mid,
			enabledField: 'audioEqLowMidEnabled',
			typeField: 'audioEqLowMidType',
			frequencyField: 'audioEqLowMidFrequencyHz',
			gainField: 'audioEqLowMidGainDb',
			qField: 'audioEqLowMidQ',
			enabledKey: 'lowMidEnabled',
			typeKey: 'lowMidType',
			frequencyKey: 'lowMidFrequencyHz',
			gainKey: 'lowMidGainDb',
			qKey: 'lowMidQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'highMid',
			label: m.video_editor_audio_eq_high_mid,
			enabledField: 'audioEqHighMidEnabled',
			typeField: 'audioEqHighMidType',
			frequencyField: 'audioEqHighMidFrequencyHz',
			gainField: 'audioEqHighMidGainDb',
			qField: 'audioEqHighMidQ',
			enabledKey: 'highMidEnabled',
			typeKey: 'highMidType',
			frequencyKey: 'highMidFrequencyHz',
			gainKey: 'highMidGainDb',
			qKey: 'highMidQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'high',
			label: m.video_editor_audio_eq_high,
			enabledField: 'audioEqHighEnabled',
			typeField: 'audioEqHighType',
			frequencyField: 'audioEqHighFrequencyHz',
			gainField: 'audioEqHighGainDb',
			qField: 'audioEqHighQ',
			enabledKey: 'highEnabled',
			typeKey: 'highType',
			frequencyKey: 'highFrequencyHz',
			gainKey: 'highGainDb',
			qKey: 'highQ',
			types: AUDIO_EQ_INNER_FILTER_OPTIONS
		},
		{
			key: 'band6',
			label: m.video_editor_audio_eq_band_6,
			enabledField: 'audioEqBand6Enabled',
			typeField: 'audioEqBand6Type',
			frequencyField: 'audioEqBand6FrequencyHz',
			gainField: 'audioEqBand6GainDb',
			qField: 'audioEqBand6Q',
			slopeField: 'audioEqBand6SlopeDbPerOct',
			enabledKey: 'band6Enabled',
			typeKey: 'band6Type',
			frequencyKey: 'band6FrequencyHz',
			gainKey: 'band6GainDb',
			qKey: 'band6Q',
			slopeKey: 'band6SlopeDbPerOct',
			types: AUDIO_EQ_BAND6_FILTER_OPTIONS
		}
	];

	function typeLabel(type: string): string {
		if (type === 'high-pass') return m.video_editor_audio_eq_high_pass();
		if (type === 'low-pass') return m.video_editor_audio_eq_low_pass();
		if (type === 'low-shelf') return m.video_editor_audio_eq_low_shelf();
		if (type === 'high-shelf') return m.video_editor_audio_eq_high_shelf();
		if (type === 'peaking') return m.video_editor_audio_eq_peaking();
		if (type === 'notch') return m.video_editor_audio_eq_notch();
		return type;
	}

	function presetLabel(id: AudioEqPresetId | 'custom'): string {
		switch (id) {
			case 'flat':
				return m.video_editor_audio_eq_preset_flat();
			case 'voice-clarity':
				return m.video_editor_audio_eq_preset_voice_clarity();
			case 'podcast':
				return m.video_editor_audio_eq_preset_podcast();
			case 'warmth':
				return m.video_editor_audio_eq_preset_warmth();
			case 'bass-boost':
				return m.video_editor_audio_eq_preset_bass_boost();
			case 'de-mud':
				return m.video_editor_audio_eq_preset_de_mud();
			case 'smile':
				return m.video_editor_audio_eq_preset_smile();
			case 'sparkle':
				return m.video_editor_audio_eq_preset_sparkle();
			case 'air':
				return m.video_editor_audio_eq_preset_air();
			case 'soften':
				return m.video_editor_audio_eq_preset_soften();
			case 'radio':
				return m.video_editor_audio_eq_preset_radio();
			case 'telephone':
				return m.video_editor_audio_eq_preset_telephone();
			case 'dialog-lift':
				return m.video_editor_audio_eq_preset_dialog_lift();
			case 'rumble-cut':
				return m.video_editor_audio_eq_preset_rumble_cut();
			case 'brighten':
				return m.video_editor_audio_eq_preset_brighten();
			case 'custom':
				return m.video_editor_audio_eq_custom();
		}
	}
	const presetOptions: AppSelectOption[] = [
		{ value: 'custom', label: presetLabel('custom') },
		...AUDIO_EQ_PRESETS.map((preset) => ({
			value: preset.id,
			label: presetLabel(preset.id)
		}))
	];
	const slopeOptions: AppSelectOption[] = AUDIO_EQ_SLOPE_OPTIONS.map((slope) => ({
		value: String(slope),
		label: `${slope} dB/oct`
	}));

	const resolved = $derived(resolveAudioEqSettings(item));
	const selectedPreset = $derived(findAudioEqPresetId(resolved) ?? 'custom');
	const curve = $derived(sampleAudioEqResponseCurve(resolved, { sampleCount: 72 }));
	const curvePath = $derived(
		curve
			.map((point, index) => {
				const x = (index / Math.max(1, curve.length - 1)) * 280;
				const y = 48 - (Math.max(-24, Math.min(24, point.gainDb)) / 24) * 42;
				return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
			})
			.join(' ')
	);

	function commit(patch: Partial<TimelineItem>): void {
		updateItemProperties(item.id, patch, 'UPDATE_CLIP_AUDIO_EQ');
		onedit();
	}

	function setField(field: keyof TimelineItem, value: unknown): void {
		commit({ [field]: value } as Partial<TimelineItem>);
	}

	function applyPreset(id: string): void {
		if (id === 'custom') return;
		const preset = getAudioEqPresetById(id as AudioEqPresetId);
		if (!preset) return;
		commit({
			audioEqEnabled: true,
			...buildTimelineEqPatchFromResolvedSettings(preset.settings)
		});
	}

	function enabled(band: BandDefinition): boolean {
		return Boolean(resolved[band.enabledKey]);
	}

	function value(
		band: BandDefinition,
		key: 'typeKey' | 'frequencyKey' | 'gainKey' | 'qKey' | 'slopeKey'
	) {
		const resolvedKey = band[key];
		return resolvedKey ? resolved[resolvedKey] : undefined;
	}

	function isPass(type: unknown): boolean {
		return type === 'high-pass' || type === 'low-pass';
	}
</script>

<details class="group rounded-md border border-white/10 bg-black/10">
	<summary
		class="flex min-h-9 cursor-pointer list-none items-center justify-between gap-2 px-2 text-xs focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)]"
	>
		<span class="font-medium text-white/85">{m.video_editor_audio_eq_title()}</span>
		<span class="text-[10px] text-white/45"
			>{item.audioEqEnabled === false
				? m.video_editor_audio_eq_bypassed()
				: selectedPreset === 'custom'
					? m.video_editor_audio_eq_custom()
					: presetOptions.find((option) => option.value === selectedPreset)?.label}</span
		>
	</summary>
	<div class="space-y-2 border-t border-white/10 p-2">
		<div class="flex items-end gap-1">
			<label class="min-w-0 flex-1 text-[10px] text-white/60">
				{m.video_editor_audio_eq_preset()}
				<AppSelect
					value={selectedPreset}
					options={presetOptions}
					ariaLabel={m.video_editor_audio_eq_preset_aria()}
					class="mt-0.5 h-8 w-full text-xs"
					onValueChange={applyPreset}
				/>
			</label>
			<Button
				type="button"
				size="sm"
				variant={item.audioEqEnabled === false ? 'outline' : 'secondary'}
				class="h-8 px-2 text-[10px]"
				aria-pressed={item.audioEqEnabled !== false}
				onclick={() => commit({ audioEqEnabled: item.audioEqEnabled === false })}
			>
				{item.audioEqEnabled === false
					? m.video_editor_audio_eq_enable()
					: m.video_editor_audio_eq_bypass()}
			</Button>
		</div>

		<svg
			viewBox="0 0 280 96"
			class="h-20 w-full rounded bg-[oklch(0.18_0.01_50)]"
			role="img"
			aria-label={m.video_editor_audio_eq_response()}
		>
			<path
				d="M0 48 H280"
				stroke="currentColor"
				class="text-white/15"
				vector-effect="non-scaling-stroke"
			/>
			<path
				d={curvePath}
				fill="none"
				stroke="oklch(0.72 0.14 45)"
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
			/>
		</svg>

		<label class="block text-[10px] text-white/60">
			{m.video_editor_audio_eq_output_gain()}
			<Input
				class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
				type="number"
				min={AUDIO_EQ_GAIN_DB_MIN}
				max={AUDIO_EQ_GAIN_DB_MAX}
				step="0.1"
				value={resolved.outputGainDb}
				onchange={(event) => commit({ audioEqOutputGainDb: event.currentTarget.valueAsNumber })}
			/>
		</label>

		<div class="space-y-1">
			{#each bands as band (band.key)}
				{@const bandType = value(band, 'typeKey')}
				<details class="rounded border border-white/8 bg-white/[0.02]">
					<summary
						class="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2 text-[10px]"
					>
						<span class="w-14 font-medium text-white/75">{band.label()}</span>
						<span class="min-w-0 flex-1 truncate text-white/45"
							>{typeLabel(String(bandType))} · {Math.round(Number(value(band, 'frequencyKey')))} Hz</span
						>
						<button
							type="button"
							class={`rounded px-1.5 py-0.5 text-[9px] focus-visible:outline-2 focus-visible:outline-[oklch(0.66_0.14_45)] ${enabled(band) ? 'bg-[oklch(0.66_0.14_45)] text-black' : 'bg-white/8'}`}
							aria-pressed={enabled(band)}
							onclick={(event) => {
								event.preventDefault();
								setField(band.enabledField, !enabled(band));
							}}
							>{enabled(band)
								? m.video_editor_audio_eq_on()
								: m.video_editor_audio_eq_off()}</button
						>
					</summary>
					<div class="grid grid-cols-2 gap-1 border-t border-white/8 p-2">
						<label class="text-[10px] text-white/60">
							{m.video_editor_audio_eq_filter()}
							<AppSelect
								value={String(bandType)}
								options={band.types.map((type) => ({
									value: type,
									label: typeLabel(type)
								}))}
								ariaLabel={m.video_editor_audio_eq_filter_aria({ band: band.label() })}
								class="mt-0.5 h-8 w-full text-xs"
								onValueChange={(next) => setField(band.typeField, next)}
							/>
						</label>
						<label class="text-[10px] text-white/60">
							{m.video_editor_audio_eq_frequency()}
							<Input
								class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
								type="number"
								min="20"
								max="22000"
								step="1"
								value={Number(value(band, 'frequencyKey'))}
								onchange={(event) =>
									setField(band.frequencyField, event.currentTarget.valueAsNumber)}
							/>
						</label>
						{#if isPass(bandType) && band.slopeField}
							<label class="col-span-2 text-[10px] text-white/60">
								{m.video_editor_audio_eq_slope()}
								<AppSelect
									value={String(value(band, 'slopeKey'))}
									options={slopeOptions}
									ariaLabel={m.video_editor_audio_eq_slope_aria({ band: band.label() })}
									class="mt-0.5 h-8 w-full text-xs"
									onValueChange={(next) => setField(band.slopeField!, Number(next))}
								/>
							</label>
						{:else}
							<label class="text-[10px] text-white/60">
								{m.video_editor_audio_eq_gain()}
								<Input
									class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
									type="number"
									min={AUDIO_EQ_GAIN_DB_MIN}
									max={AUDIO_EQ_GAIN_DB_MAX}
									step="0.1"
									value={Number(value(band, 'gainKey'))}
									onchange={(event) => setField(band.gainField, event.currentTarget.valueAsNumber)}
								/>
							</label>
							<label class="text-[10px] text-white/60">
								Q
								<Input
									class="mt-0.5 h-8 w-full bg-[oklch(0.22_0.01_50)] text-xs"
									type="number"
									min={AUDIO_EQ_Q_MIN}
									max={AUDIO_EQ_Q_MAX}
									step="0.05"
									value={Number(value(band, 'qKey'))}
									onchange={(event) => setField(band.qField, event.currentTarget.valueAsNumber)}
								/>
							</label>
						{/if}
					</div>
				</details>
			{/each}
		</div>
	</div>
</details>
