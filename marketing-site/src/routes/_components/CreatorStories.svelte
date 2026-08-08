<script lang="ts">
	import PlatformIcon from '$lib/components/platform-icon.svelte';

	interface Workflow {
		title: string;
		role: string;
		image?: string;
		platform: string;
		content: string;
	}

	const workflows: readonly Workflow[] = [
		{
			title: 'Launch day',
			role: 'Solo founder',
			image: '/assets/testimonial-portraits/maya-ribeiro.webp',
			platform: 'linkedin',
			content:
				'Turn one product update into a LinkedIn post, an X thread, and a short video without starting over.'
		},
		{
			title: 'A full week, planned',
			role: 'Creator',
			platform: 'instagram',
			content: 'Draft the week, choose each destination, and schedule every post from one calendar.'
		},
		{
			title: 'Every format in view',
			role: 'Product team',
			image: '/assets/testimonial-portraits/jordan-ellis.webp',
			platform: 'youtube',
			content:
				'Keep the source idea beside the text, image, Story, short-video, and video versions it becomes.'
		},
		{
			title: 'Replies stay close',
			role: 'Community lead',
			platform: 'mastodon',
			content: 'Read and answer conversations without losing the post or account behind them.'
		},
		{
			title: 'One clear workspace',
			role: 'Small team',
			image: '/assets/testimonial-portraits/priya-nair.webp',
			platform: 'tiktok',
			content:
				'Share drafts, media, schedules, and publishing status without passing files between tools.'
		},
		{
			title: 'Results beside the work',
			role: 'Founder',
			platform: 'x',
			content:
				'See what published, what failed, and what earned attention while the campaign is still fresh.'
		}
	] as const;
</script>

<section class="stories" aria-labelledby="stories-title">
	<div class="marketing-shell">
		<header class="stories-heading">
			<h2 id="stories-title">Built for focused publishing.</h2>
			<p>Everything stays close, from the first draft to the final result.</p>
		</header>

		<div class="story-mosaic">
			{#each workflows as workflow (workflow.title)}
				<article class="story-card">
					{#if workflow.image}
						<img class="story-image" src={workflow.image} alt="Creator working at a desk" />
					{/if}
					<header>
						<span class="story-mark"><PlatformIcon platform={workflow.platform} /></span>
						<div>
							<h3>{workflow.title}</h3>
							<span>{workflow.role}</span>
						</div>
						<span class="story-source" aria-label={`${workflow.platform} workflow`}>
							<PlatformIcon platform={workflow.platform} />
						</span>
					</header>
					<p>{workflow.content}</p>
				</article>
			{/each}
		</div>
	</div>
</section>

<style>
	.stories {
		padding-block: clamp(4.5rem, 9vw, 7.5rem);
		background: color-mix(in oklch, var(--muted) 38%, var(--background));
	}

	.stories-heading {
		display: grid;
		gap: 1rem;
		margin: 0 auto clamp(2.5rem, 5vw, 4rem);
		text-align: center;
	}

	.stories-heading h2 {
		font-size: clamp(2.25rem, 4.5vw, 4rem);
		font-weight: 710;
		line-height: 1;
		letter-spacing: -0.038em;
		text-wrap: balance;
	}

	.stories-heading p {
		color: var(--muted-foreground);
		font-size: 1rem;
		line-height: 1.6;
	}

	.story-mosaic {
		columns: 1;
		column-gap: 1rem;
	}

	.story-card {
		break-inside: avoid;
		margin-bottom: 1rem;
		padding: clamp(1.25rem, 2vw, 1.6rem);
		border: 1px solid var(--border);
		border-radius: 1rem;
		background: var(--card);
		box-shadow: 0 0.9rem 2.5rem -2rem color-mix(in oklch, var(--foreground) 32%, transparent);
	}

	.story-card:nth-child(3n + 1) {
		padding-bottom: clamp(1.8rem, 3vw, 2.4rem);
	}

	.story-image {
		display: block;
		width: calc(100% + clamp(2.5rem, 4vw, 3.2rem));
		height: clamp(10rem, 18vw, 14rem);
		margin: calc(clamp(1.25rem, 2vw, 1.6rem) * -1);
		margin-bottom: 1.35rem;
		border-radius: 1rem 1rem 0.45rem 0.45rem;
		object-fit: cover;
	}

	.story-card header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.story-mark {
		display: grid;
		width: 2.5rem;
		height: 2.5rem;
		flex: none;
		place-items: center;
		border-radius: 50%;
		background: var(--muted);
		object-fit: cover;
	}

	.story-mark :global(svg) {
		width: 1rem;
		height: 1rem;
	}

	.story-card header > div {
		display: grid;
		min-width: 0;
		gap: 0.12rem;
	}

	.story-card h3 {
		font-size: 0.9rem;
		font-weight: 650;
	}

	.story-card header div span {
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}

	.story-source {
		display: grid;
		width: 2rem;
		height: 2rem;
		margin-left: auto;
		place-items: center;
		color: var(--muted-foreground);
	}

	.story-source :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	.story-card > p {
		margin-top: 1.5rem;
		color: color-mix(in oklch, var(--foreground) 72%, transparent);
		font-size: clamp(0.96rem, 1.4vw, 1.08rem);
		line-height: 1.7;
	}

	@media (min-width: 48rem) {
		.story-mosaic {
			columns: 2;
		}
	}

	@media (min-width: 64rem) {
		.story-mosaic {
			columns: 3;
		}
	}
</style>
