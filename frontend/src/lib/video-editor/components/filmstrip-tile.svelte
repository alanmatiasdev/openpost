<!-- ImageBitmap fast path with img fallback for browsers that cannot decode it. -->
<script lang="ts">
	let { bitmap, url, style }: { bitmap?: ImageBitmap; url: string | null; style: string } =
		$props();
	let canvas = $state<HTMLCanvasElement | null>(null);
	$effect(() => {
		if (!canvas || !bitmap) return;
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
	});
</script>

{#if bitmap}
	<canvas bind:this={canvas} class="absolute top-0 h-full rounded-sm opacity-90" {style}></canvas>
{:else}
	<img
		src={url ?? ''}
		alt=""
		class="absolute top-0 h-full rounded-sm object-cover opacity-90"
		{style}
	/>
{/if}
