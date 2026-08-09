<script lang="ts">
	import Check from 'lucide-svelte/icons/check';
	import { Button } from '$lib/components/ui/button';
	import { appUrl, managedAccessSummary, plans } from '../_marketing';
	import AnimatedPrice from './AnimatedPrice.svelte';

	interface Props {
		compact?: boolean;
	}

	let { compact = false }: Props = $props();
	let billingPeriod = $state<'monthly' | 'annual'>('monthly');
	const featuredPlans = plans.slice(0, 3);

	function numericPrice(price: string) {
		return Number(price.replace(/[^0-9.]/g, ''));
	}

	function monthlyPrice(plan: (typeof plans)[number]) {
		return billingPeriod === 'monthly'
			? numericPrice(plan.price)
			: numericPrice(plan.annualPrice) / 12;
	}
</script>

<div class:pricing-compact={compact} class="pricing-showcase">
	<div class="pricing-toolbar">
		<div>
			<p class="font-semibold">14 days free</p>
			<p>{managedAccessSummary}</p>
		</div>
		<div class="billing-toggle" aria-label="Billing period">
			<Button
				variant={billingPeriod === 'monthly' ? 'default' : 'ghost'}
				size="sm"
				aria-pressed={billingPeriod === 'monthly'}
				onclick={() => (billingPeriod = 'monthly')}>Monthly</Button
			>
			<Button
				variant={billingPeriod === 'annual' ? 'default' : 'ghost'}
				size="sm"
				aria-pressed={billingPeriod === 'annual'}
				onclick={() => (billingPeriod = 'annual')}
			>
				Yearly <span>Save 17%</span>
			</Button>
		</div>
	</div>

	<div class="pricing-grid" aria-live="polite">
		{#each featuredPlans as plan (plan.id)}
			<article class:featured={plan.featured} class="pricing-card">
				{#if plan.featured}<span class="popular-label">Most popular</span>{/if}
				<div>
					<h3>{plan.name}</h3>
					<p class="plan-description">{plan.description}</p>
				</div>
				<p class="price-line">
					<AnimatedPrice value={monthlyPrice(plan)} />
					<span>/month</span>
				</p>
				<p class="billing-note">
					{#if billingPeriod === 'annual'}
						Billed {plan.annualPrice} yearly
					{:else}
						Billed monthly
					{/if}
				</p>
				<ul>
					{#each plan.limits.slice(0, compact ? 4 : 5) as limit (limit)}
						<li><Check aria-hidden="true" /> <span>{limit}</span></li>
					{/each}
				</ul>
				<Button
					href={`${appUrl}/register?plan=${plan.id}&billing_period=${billingPeriod}`}
					variant={plan.featured ? 'default' : 'outline'}
					class="w-full"
				>
					Start {plan.name}
				</Button>
			</article>
		{/each}
	</div>
</div>

<style>
	.pricing-showcase {
		display: grid;
		gap: 2rem;
	}

	.pricing-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem;
		padding-bottom: 1.5rem;
		border-bottom: 1px solid var(--border);
	}

	.pricing-toolbar > div:first-child {
		display: grid;
		gap: 0.3rem;
	}

	.pricing-toolbar p:last-child {
		color: var(--muted-foreground);
		font-size: 0.8rem;
	}

	.billing-toggle {
		display: inline-flex;
		flex: none;
		gap: 0.2rem;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: color-mix(in oklch, var(--muted) 52%, var(--background));
	}

	.billing-toggle :global(button) {
		min-width: 6rem;
	}

	.billing-toggle span {
		margin-left: 0.2rem;
		font-size: 0.68rem;
		opacity: 0.72;
	}

	.pricing-grid {
		display: grid;
		gap: 1rem;
	}

	.pricing-card {
		position: relative;
		display: flex;
		min-width: 0;
		min-height: 31rem;
		flex-direction: column;
		padding: clamp(1.4rem, 2.5vw, 2rem);
		border: 1px solid var(--border);
		border-radius: 1.5rem;
		background: color-mix(in oklch, var(--card) 95%, var(--background));
		box-shadow: 0 1rem 3rem -2.2rem color-mix(in oklch, var(--foreground) 28%, transparent);
		transition:
			transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
			box-shadow 180ms cubic-bezier(0.16, 1, 0.3, 1),
			border-color 180ms ease;
	}

	.pricing-card:hover {
		transform: translateY(-0.25rem);
		box-shadow: 0 1.5rem 4rem -2rem color-mix(in oklch, var(--foreground) 30%, transparent);
	}

	.pricing-card.featured {
		border-color: color-mix(in oklch, var(--primary) 76%, var(--border));
		box-shadow:
			0 0 0 1px color-mix(in oklch, var(--primary) 22%, transparent),
			0 1.5rem 4rem -2rem color-mix(in oklch, var(--primary) 38%, transparent);
	}

	.popular-label {
		position: absolute;
		top: 0;
		left: 50%;
		padding: 0.4rem 1.1rem;
		border-radius: 0 0 0.8rem 0.8rem;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 0.74rem;
		font-weight: 700;
		transform: translateX(-50%);
	}

	.pricing-card h3 {
		font-size: 1.25rem;
		font-weight: 700;
	}

	.plan-description {
		min-height: 3rem;
		margin-top: 0.75rem;
		color: var(--muted-foreground);
		font-size: 0.9rem;
		line-height: 1.65;
	}

	.price-line {
		display: flex;
		align-items: baseline;
		margin-top: 2rem;
		font-size: clamp(2.7rem, 5vw, 4rem);
		font-weight: 720;
		letter-spacing: -0.055em;
	}

	.price-line > span:last-child {
		margin-left: 0.25rem;
		color: var(--muted-foreground);
		font-size: 0.82rem;
		font-weight: 450;
		letter-spacing: normal;
	}

	.billing-note {
		min-height: 1.25rem;
		margin-top: 0.35rem;
		color: var(--muted-foreground);
		font-size: 0.72rem;
	}

	.pricing-card ul {
		display: grid;
		gap: 0.85rem;
		margin-block: 2rem auto;
		padding: 0;
		list-style: none;
	}

	.pricing-card li {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		color: var(--muted-foreground);
		font-size: 0.88rem;
		line-height: 1.45;
	}

	.pricing-card li :global(svg) {
		width: 1rem;
		height: 1rem;
		flex: none;
		margin-top: 0.1rem;
		color: var(--primary);
	}

	@media (min-width: 64rem) {
		.pricing-grid {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}

		.pricing-card.featured {
			transform: translateY(-0.5rem);
		}

		.pricing-card.featured:hover {
			transform: translateY(-0.75rem);
		}
	}

	@media (max-width: 39.99rem) {
		.pricing-toolbar {
			align-items: stretch;
			flex-direction: column;
		}

		.billing-toggle,
		.billing-toggle :global(button) {
			width: 100%;
		}

		.billing-toggle :global(button) {
			flex: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pricing-card {
			transition: none;
		}
	}
</style>
