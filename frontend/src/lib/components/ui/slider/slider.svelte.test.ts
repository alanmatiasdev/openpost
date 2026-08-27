import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import Slider from './slider.svelte';

describe('Slider', () => {
	it('commits one keyboard gesture after all repeated arrow updates', async () => {
		const onValueChange = vi.fn();
		const onValueCommit = vi.fn();
		const screen = await render(Slider, {
			value: 0,
			min: 0,
			max: 10,
			step: 1,
			ariaLabel: 'Precision value',
			onValueChange,
			onValueCommit
		});
		const thumb = screen.getByRole('slider', { name: 'Precision value' });
		thumb.element().focus();
		await userEvent.keyboard('{ArrowRight>4/}');

		await expect.element(thumb).toHaveAttribute('aria-valuenow', '4');
		expect(onValueChange).toHaveBeenCalledTimes(4);
		expect(onValueCommit).toHaveBeenCalledOnce();
		expect(onValueCommit).toHaveBeenCalledWith(4);
	});
});
