<script lang="ts">
	const SCRUB_THRESHOLD_PX = 3;

	let {
		ariaLabel,
		value,
		min,
		max,
		step = 1,
		decimals = 2,
		disabled = false,
		class: className = '',
		onlive,
		oncommit
	}: {
		ariaLabel: string;
		value: number;
		min?: number;
		max?: number;
		step?: number;
		decimals?: number;
		disabled?: boolean;
		class?: string;
		onlive: (value: number) => void;
		oncommit: (value: number) => void;
	} = $props();

	let input: HTMLInputElement;
	let draft = $state<string | null>(null);
	let drag: { pointerId: number; startX: number; startValue: number; scrubbed: boolean } | null =
		null;
	const displayValue = $derived(draft ?? value.toFixed(decimals));

	function clamp(next: number): number {
		return Math.min(max ?? next, Math.max(min ?? next, next));
	}

	function setLive(next: number): void {
		const safe = clamp(next);
		draft = safe.toFixed(decimals);
		onlive(safe);
	}

	function commit(raw = displayValue): void {
		const parsed = Number(raw);
		draft = null;
		if (Number.isFinite(parsed)) oncommit(clamp(parsed));
	}

	function revert(): void {
		draft = null;
		onlive(value);
	}

	function startScrub(event: PointerEvent): void {
		if (disabled || event.button !== 0 || document.activeElement === input) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		drag = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startValue: value,
			scrubbed: false
		};
	}

	function moveScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const distance = event.clientX - drag.startX;
		if (!drag.scrubbed && Math.abs(distance) < SCRUB_THRESHOLD_PX) return;
		drag.scrubbed = true;
		setLive(drag.startValue + distance * step * (event.shiftKey ? 0.1 : 1));
	}

	function finishScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const scrubbed = drag.scrubbed;
		drag = null;
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		if (scrubbed) commit();
		else {
			input.focus();
			input.select();
		}
	}

	function cancelScrub(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		const scrubbed = drag.scrubbed;
		drag = null;
		if (scrubbed) revert();
	}

	function handleInput(event: Event): void {
		const raw = event.currentTarget.value;
		draft = raw;
		const parsed = Number(raw);
		if (Number.isFinite(parsed)) onlive(clamp(parsed));
	}

	function handleKeydown(event: KeyboardEvent): void {
		event.stopPropagation();
		if (event.key === 'Enter') {
			if (draft !== null) commit(event.currentTarget.value);
			event.currentTarget.blur();
		} else if (event.key === 'Escape') {
			if (draft !== null) revert();
			event.currentTarget.blur();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const current = Number(draft ?? value);
			const direction = event.key === 'ArrowUp' ? 1 : -1;
			setLive(current + direction * step * (event.shiftKey ? 10 : 1));
		}
	}

	function handleKeyup(event: KeyboardEvent): void {
		event.stopPropagation();
		if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && draft !== null) commit();
	}
</script>

<input
	bind:this={input}
	type="text"
	inputmode="decimal"
	autocomplete="off"
	{disabled}
	aria-label={ariaLabel}
	value={displayValue}
	class="cursor-ew-resize touch-none select-none focus:cursor-text focus:select-auto {className}"
	onpointerdown={startScrub}
	onpointermove={moveScrub}
	onpointerup={finishScrub}
	onpointercancel={cancelScrub}
	oninput={handleInput}
	onkeydown={handleKeydown}
	onkeyup={handleKeyup}
	onblur={(event) => {
		if (draft !== null) commit(event.currentTarget.value);
	}}
/>
