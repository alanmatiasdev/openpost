import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { previewDiagnostics } from '$lib/video-editor/preview/diagnostics.svelte';
import PreviewDiagnosticsPanel from './preview-diagnostics-panel.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	previewDiagnostics.setPerformanceOverlay(false);
	previewDiagnostics.setClipTimingOverlay(false);
	previewDiagnostics.resetCounters();
	previewDiagnostics.setPlaying(false);
	previewDiagnostics.updateRuntime({
		renderPath: 'composited',
		renderWidth: 1280,
		renderHeight: 720,
		activeLayers: 3,
		qualityMode: 'auto',
		qualityScale: 0.5,
		readyProxies: 2,
		pendingProxies: 1,
		webgl2Ready: true,
		webgpuTransitionsReady: false
	});
	previewDiagnostics.setPlaying(true);
	previewDiagnostics.recordFrame(1, 100, 30, 1);
	previewDiagnostics.recordFrame(2, 133, 30, 1);
});

describe('PreviewDiagnosticsPanel', () => {
	it('shows real runtime state, controls overlays by keyboard, and copies a private report', async () => {
		await page.viewport(320, 720);
		const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
		const screen = await render(PreviewDiagnosticsPanel);

		await screen.getByRole('button', { name: 'Preview diagnostics' }).click();
		const content = document.querySelector<HTMLElement>('[data-popover-content]');
		expect(content?.scrollWidth).toBeLessThanOrEqual(content?.clientWidth ?? 0);
		await expect.element(screen.getByText('Reduced quality')).toBeVisible();
		await expect.element(screen.getByText('1280x720')).toBeVisible();
		await expect.element(screen.getByText('WebGL2 effects')).toBeVisible();
		await expect.element(screen.getByText('2 ready / 1 preparing')).toBeVisible();

		const performanceOverlay = screen.getByRole('switch', { name: 'Performance overlay' });
		performanceOverlay.element().focus();
		await userEvent.keyboard('{Enter}');
		expect(previewDiagnostics.performanceOverlay).toBe(true);
		await expect.element(performanceOverlay).toHaveAttribute('aria-checked', 'true');

		await screen.getByRole('button', { name: 'Copy report' }).click();
		expect(writeText).toHaveBeenCalledOnce();
		const report = JSON.parse(writeText.mock.calls[0]?.[0] ?? '{}');
		expect(report.renderer).toMatchObject({ path: 'composited', width: 1280, height: 720 });
		expect(report.project).toBeUndefined();
		expect(report.media.ids).toBeUndefined();
		await expect.element(screen.getByRole('button', { name: 'Copied' })).toBeVisible();
	});
});
