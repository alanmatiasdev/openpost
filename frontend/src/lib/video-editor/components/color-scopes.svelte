<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import AppSelect from '$lib/components/app-select.svelte';
	import { scopeSamples } from '$lib/video-editor/effects/scope-samples.svelte';
	import { buildScopeBins } from '$lib/video-editor/effects/scopes';
	let { itemId }: { itemId: string | null } = $props();
	let canvas = $state<HTMLCanvasElement | null>(null);
	let mode = $state<'histogram' | 'waveform' | 'parade' | 'vectorscope'>('histogram');
	const active = $derived(
		scopeSamples.current?.itemId === itemId ? scopeSamples.current.image : null
	);
	$effect(() => {
		if (!canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#0d0d0d';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		if (!active) return;
		const bins = buildScopeBins(active.data, active.width, active.height);
		if (mode === 'histogram') drawHistogram(ctx, bins.histogram, canvas.width, canvas.height);
		else if (mode === 'parade') drawParade(ctx, bins.parade, canvas.width, canvas.height);
		else
			drawDensity(
				ctx,
				mode === 'waveform' ? bins.waveform : bins.vectorscope,
				mode === 'waveform' ? 256 : 128,
				128,
				canvas.width,
				canvas.height
			);
	});

	function drawHistogram(
		ctx: CanvasRenderingContext2D,
		bins: ReturnType<typeof buildScopeBins>['histogram'],
		width: number,
		height: number
	): void {
		const max = Math.max(1, ...bins.red, ...bins.green, ...bins.blue);
		const series: Array<{ values: Uint32Array; color: string }> = [
			{ values: bins.red, color: '#ff5a5f' },
			{ values: bins.green, color: '#52d273' },
			{ values: bins.blue, color: '#4da3ff' }
		];
		for (const { values, color } of series) {
			ctx.strokeStyle = color;
			ctx.globalAlpha = 0.7;
			ctx.beginPath();
			for (let x = 0; x < 256; x++) {
				const y = height - ((values[x] ?? 0) / max) * height;
				if (x === 0) ctx.moveTo(0, y);
				else ctx.lineTo((x / 255) * width, y);
			}
			ctx.stroke();
		}
		ctx.globalAlpha = 1;
	}

	function drawParade(
		ctx: CanvasRenderingContext2D,
		bins: ReturnType<typeof buildScopeBins>['parade'],
		width: number,
		height: number
	): void {
		const channels = [
			{ values: bins.red, color: '#ff5a5f' },
			{ values: bins.green, color: '#52d273' },
			{ values: bins.blue, color: '#4da3ff' }
		];
		const sectionWidth = width / channels.length;
		for (const [section, channel] of channels.entries()) {
			const max = Math.max(1, ...channel.values);
			ctx.fillStyle = channel.color;
			for (let y = 0; y < 128; y++) {
				for (let x = 0; x < 256; x++) {
					const value = channel.values[y * 256 + x] ?? 0;
					if (!value) continue;
					ctx.globalAlpha = Math.min(1, Math.log1p(value) / Math.log1p(max));
					ctx.fillRect(
						section * sectionWidth + (x / 256) * sectionWidth,
						(y / 128) * height,
						Math.max(1, sectionWidth / 256),
						Math.max(1, height / 128)
					);
				}
			}
		}
		ctx.globalAlpha = 1;
		ctx.strokeStyle = 'rgba(180,150,70,0.18)';
		ctx.lineWidth = 1;
		for (let level = 0; level <= 4; level++) {
			const y = Math.round((level / 4) * height) + 0.5;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(width, y);
			ctx.stroke();
		}
		ctx.strokeStyle = 'rgba(255,255,255,0.18)';
		for (let section = 1; section < 3; section++) {
			ctx.beginPath();
			ctx.moveTo(section * sectionWidth, 0);
			ctx.lineTo(section * sectionWidth, height);
			ctx.stroke();
		}
		ctx.font = '9px ui-monospace, monospace';
		ctx.textBaseline = 'top';
		for (const [section, label] of ['R', 'G', 'B'].entries()) {
			ctx.fillStyle = channels[section]?.color ?? '#ffffff';
			ctx.globalAlpha = 0.8;
			ctx.fillText(label, section * sectionWidth + 4, 3);
		}
		ctx.globalAlpha = 1;
	}

	function drawDensity(
		ctx: CanvasRenderingContext2D,
		bins: Uint32Array,
		sourceWidth: number,
		sourceHeight: number,
		width: number,
		height: number
	): void {
		const max = Math.max(1, ...bins);
		ctx.fillStyle = '#71efb0';
		for (let y = 0; y < sourceHeight; y++)
			for (let x = 0; x < sourceWidth; x++) {
				const value = bins[y * sourceWidth + x] ?? 0;
				if (!value) continue;
				ctx.globalAlpha = Math.min(1, Math.log1p(value) / Math.log1p(max));
				ctx.fillRect(
					(x / sourceWidth) * width,
					(y / sourceHeight) * height,
					Math.max(1, width / sourceWidth),
					Math.max(1, height / sourceHeight)
				);
			}
		ctx.globalAlpha = 1;
	}
</script>

<section class="mt-2 border-t border-[oklch(0.25_0.015_55)] pt-2">
	<div class="mb-1 flex items-center justify-between">
		<h3 class="text-[10px] font-semibold tracking-wider text-[oklch(0.65_0.015_55)] uppercase">
			Scopes
		</h3>
		<AppSelect
			bind:value={mode}
			ariaLabel={m.video_editor_scope_live()}
			class="h-7 w-28 text-[10px]"
			options={[
				{ value: 'histogram', label: m.video_editor_scope_histogram() },
				{ value: 'waveform', label: m.video_editor_scope_waveform() },
				{ value: 'parade', label: m.video_editor_scope_parade() },
				{ value: 'vectorscope', label: m.video_editor_scope_vectorscope() }
			]}
		/>
	</div>
	<canvas
		bind:this={canvas}
		width="224"
		height="112"
		class="w-full rounded bg-black"
		aria-label={m.video_editor_scope_live()}
	></canvas>
</section>
