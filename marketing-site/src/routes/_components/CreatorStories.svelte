<script lang="ts">
	import PlatformIcon from '$lib/components/platform-icon.svelte';

	const stories = [
		{
			name: 'Maya Ribeiro',
			role: 'Founder, Norte Studio',
			image: '/assets/testimonial-portraits/maya-ribeiro.webp',
			quote:
				'I start with the release note, then shape the LinkedIn post, X thread, and visual update while the idea is still fresh.',
			platforms: ['linkedin', 'x', 'instagram']
		},
		{
			name: 'Jordan Ellis',
			role: 'Founder, Patchwork Labs',
			image: '/assets/testimonial-portraits/jordan-ellis.webp',
			quote:
				'The useful part is seeing every destination next to the source. I can change the format without losing the point of the post.',
			platforms: ['youtube', 'mastodon', 'bluesky']
		},
		{
			name: 'Priya Nair',
			role: 'Founder, Little Atlas',
			image: '/assets/testimonial-portraits/priya-nair.webp',
			quote:
				'I can prepare a week of publishing in one focused pass, then get back to the product instead of reopening every network.',
			platforms: ['tiktok', 'threads', 'facebook']
		}
	] as const;
</script>

<section class="stories" aria-labelledby="stories-title">
	<div class="marketing-shell">
		<header class="stories-heading">
			<div>
				<p>Illustrative creator stories</p>
				<h2 id="stories-title">A content team that fits the founder’s day.</h2>
			</div>
			<span>Example workflows using OpenPost</span>
		</header>

		<div class="story-grid">
			{#each stories as story, index (story.name)}
				<article class:story-featured={index === 0} class="story-card">
					<img src={story.image} alt={`Illustrative portrait of ${story.name}`} loading="lazy" />
					<div class="story-body">
						<div class="story-platforms" aria-label="Example destinations">
							{#each story.platforms as platform (platform)}
								<span><PlatformIcon {platform} /></span>
							{/each}
						</div>
						<blockquote>“{story.quote}”</blockquote>
						<footer>
							<strong>{story.name}</strong>
							<span>{story.role}</span>
						</footer>
					</div>
				</article>
			{/each}
		</div>
	</div>
</section>

<style>
	.stories {
		padding-block: clamp(5rem, 10vw, 9rem);
		background: color-mix(in oklch, var(--muted) 38%, var(--background));
	}

	.stories-heading {
		display: grid;
		gap: 1.5rem;
		align-items: end;
		margin-bottom: clamp(2.5rem, 6vw, 5rem);
	}

	.stories-heading p {
		color: var(--primary);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.stories-heading h2 {
		max-width: 46rem;
		margin-top: 0.9rem;
		font-size: clamp(2.5rem, 5vw, 5rem);
		font-weight: 710;
		line-height: 0.98;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}

	.stories-heading > span {
		max-width: 18rem;
		color: var(--muted-foreground);
		font-size: 0.78rem;
		line-height: 1.5;
	}

	.story-grid {
		display: grid;
		gap: 1rem;
	}

	.story-card {
		display: grid;
		overflow: hidden;
		min-width: 0;
		border-radius: 1.15rem;
		background: var(--card);
		box-shadow: 0 1.5rem 4rem -2.5rem color-mix(in oklch, var(--foreground) 30%, transparent);
	}

	.story-card > img {
		display: block;
		width: 100%;
		aspect-ratio: 5 / 4;
		object-fit: cover;
	}

	.story-body {
		display: flex;
		min-height: 17rem;
		flex-direction: column;
		padding: clamp(1.4rem, 3vw, 2.25rem);
	}

	.story-platforms {
		display: flex;
		gap: 0.35rem;
	}

	.story-platforms span {
		display: grid;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border-radius: 0.6rem;
		background: var(--muted);
		color: var(--muted-foreground);
	}

	.story-platforms :global(svg) {
		width: 0.9rem;
		height: 0.9rem;
	}

	blockquote {
		margin: 2rem 0;
		font-size: clamp(1.05rem, 1.6vw, 1.35rem);
		font-weight: 570;
		line-height: 1.48;
		letter-spacing: -0.02em;
	}

	.story-body footer {
		display: grid;
		gap: 0.18rem;
		margin-top: auto;
	}

	.story-body footer strong {
		font-size: 0.9rem;
	}

	.story-body footer span {
		color: var(--muted-foreground);
		font-size: 0.75rem;
	}

	@media (min-width: 48rem) {
		.stories-heading {
			grid-template-columns: 1fr auto;
		}

		.story-grid {
			grid-template-columns: 1.15fr 0.85fr;
		}

		.story-featured {
			grid-row: span 2;
		}

		.story-featured > img {
			aspect-ratio: 4 / 3;
		}

		.story-card:not(.story-featured) {
			grid-template-columns: minmax(10rem, 0.62fr) 1fr;
		}

		.story-card:not(.story-featured) > img {
			height: 100%;
			aspect-ratio: auto;
		}

		.story-card:not(.story-featured) .story-body {
			min-height: 18rem;
			padding: 1.5rem;
		}

		.story-card:not(.story-featured) blockquote {
			margin-block: 1.4rem;
			font-size: 1rem;
		}
	}
</style>
