import type { HandleClientError } from '@sveltejs/kit';
import { captureClientException, installGlobalErrorCapture } from '@openpost/telemetry';

export async function init() {
	installGlobalErrorCapture();
	detectStaleChunks();
}

/**
 * After a deployment, old Vite chunk hashes are no longer on the server. If the
 * user's browser still has the old app loaded, any dynamic `import()` will fail
 * with "Failed to fetch dynamically imported module". We detect this in two ways:
 *
 * 1. **Proactive** - listen for the service-worker `controllerchange` event which
 *    fires when a new SW (from the fresh deployment) takes control. Reload once
 *    so the page picks up the new chunks immediately.
 * 2. **Reactive** - intercept the unhandled error/rejection for stale chunks and
 *    force a full reload as a fallback (e.g. the error fires before
 *    controllerchange, or SW is not supported).
 */
function detectStaleChunks() {
	// --- proactive: reload when a new service-worker controller takes over ---
	if ('serviceWorker' in navigator) {
		let hadController = navigator.serviceWorker.controller !== null;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (!hadController) {
				hadController = true;
				return;
			}
			window.location.reload();
		});
	}

	// --- reactive: catch stale-chunk errors and reload ---
	const isStaleChunkError = (error: unknown): boolean => {
		if (!(error instanceof TypeError)) return false;
		return (
			error.message === 'Failed to fetch dynamically imported module' ||
			/^\w+: Failed to fetch dynamically imported module$/u.test(error.message)
		);
	};
	const reloadOnce = (() => {
		let reloading = false;
		return () => {
			if (reloading) return;
			reloading = true;
			const doReload = () => window.location.reload();
			void caches
				?.keys()
				?.then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
				?.then(doReload, doReload);
		};
	})();
	window.addEventListener('error', (event) => {
		if (isStaleChunkError(event.error)) reloadOnce();
	});
	window.addEventListener('unhandledrejection', (event) => {
		if (isStaleChunkError(event.reason)) reloadOnce();
	});
}

export const handleError: HandleClientError = ({ error, status }) => {
	if (status === 404) return;
	captureClientException(error, { error_boundary: 'sveltekit', status });
};
