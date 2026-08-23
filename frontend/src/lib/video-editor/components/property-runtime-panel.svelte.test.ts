import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import PropertyRuntimePanel from './property-runtime-panel.svelte';

function item(id: string, x: number): TimelineItem {
	return {
		id,
		trackId: 'visual',
		from: 0,
		durationInFrames: 90,
		label: id === 'one' ? 'Title' : 'Driver',
		type: 'shape',
		transform: { x, y: 20, width: 100, height: 50, opacity: 1 }
	};
}

function props(onedit = vi.fn()) {
	const items = [item('one', 10), item('two', 40)];
	return {
		item: items[0]!,
		items,
		availableProperties: ['x', 'y', 'width', 'height', 'rotation', 'opacity'],
		currentFrame: 30,
		fps: 30,
		onedit
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setItems([item('one', 10), item('two', 40)]);
});

describe('PropertyRuntimePanel', () => {
	it('previews, validates, and saves a sandboxed expression', async () => {
		const input = props();
		const screen = await render(PropertyRuntimePanel, input);
		const textarea = screen.getByRole('textbox', { name: 'Expression source' });
		await textarea.fill('value * 2');
		await vi.waitFor(() => {
			expect(document.querySelectorAll('output')[1]?.textContent).toBe('20.00');
		});
		await screen.getByRole('button', { name: 'Apply', exact: true }).click();
		expect(timelineStore.itemById.get('one')?.expressions).toMatchObject([
			{ targetProperty: 'x', source: 'value * 2', enabled: true }
		]);
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(input.onedit).toHaveBeenCalledTimes(1);
		await textarea.fill('value / 0');
		expect(screen.getByRole('alert')).toHaveTextContent('Division by zero');
		expect(screen.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
	});

	it('links through the accessible layer and property controls', async () => {
		const input = props();
		const screen = await render(PropertyRuntimePanel, input);
		await vi.waitFor(() => {
			expect(
				document.querySelector<HTMLSelectElement>('select[aria-label="Source layer"]')?.value
			).toBe('two');
		});
		await screen.getByRole('button', { name: 'Apply link' }).click();
		expect(timelineStore.itemById.get('one')?.propertyLinks).toMatchObject([
			{ targetProperty: 'x', sourceItemId: 'two', sourceProperty: 'x' }
		]);
		expect(screen.getByText('Linked to Driver x.')).toBeVisible();
	});

	it('uses the drag pick whip for links and prop references', async () => {
		const screen = await render(PropertyRuntimePanel, props());
		const linkWhip = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Drag pick whip to a source property"]'
		);
		expect(linkWhip).not.toBeNull();
		linkWhip?.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				pointerId: 17,
				clientX: 20,
				clientY: 20
			})
		);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-property-source-item="two"]')).not.toBeNull();
		});
		const chip = document.querySelector<HTMLElement>(
			'[data-property-source-item="two"][data-property-source-name="x"]'
		);
		expect(chip).not.toBeNull();
		if (!chip) return;
		const box = chip.getBoundingClientRect();
		window.dispatchEvent(
			new PointerEvent('pointermove', {
				bubbles: true,
				pointerId: 17,
				clientX: box.left + box.width / 2,
				clientY: box.top + box.height / 2
			})
		);
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				pointerId: 17,
				clientX: box.left + box.width / 2,
				clientY: box.top + box.height / 2
			})
		);
		expect(timelineStore.itemById.get('one')?.propertyLinks?.[0]).toMatchObject({
			sourceItemId: 'two',
			sourceProperty: 'x'
		});

		const textareaElement = document.querySelector<HTMLTextAreaElement>('textarea');
		textareaElement?.focus();
		textareaElement?.setSelectionRange(5, 5);
		const referenceWhip = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Drag pick whip to insert a property reference"]'
		);
		expect(referenceWhip).not.toBeNull();
		referenceWhip?.dispatchEvent(
			new PointerEvent('pointerdown', {
				bubbles: true,
				button: 0,
				pointerId: 18,
				clientX: 30,
				clientY: 30
			})
		);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-property-source-item="two"]')).not.toBeNull();
		});
		const referenceChip = document.querySelector<HTMLElement>(
			'[data-property-source-item="two"][data-property-source-name="x"]'
		);
		expect(referenceChip).not.toBeNull();
		if (!referenceChip) return;
		const referenceBox = referenceChip.getBoundingClientRect();
		window.dispatchEvent(
			new PointerEvent('pointerup', {
				bubbles: true,
				pointerId: 18,
				clientX: referenceBox.left + referenceBox.width / 2,
				clientY: referenceBox.top + referenceBox.height / 2
			})
		);
		await vi.waitFor(() => {
			expect(screen.getByRole('textbox', { name: 'Expression source' })).toHaveValue(
				'prop("two", "x")'
			);
		});
	});
});
