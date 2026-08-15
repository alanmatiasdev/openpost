/// <reference lib="webworker" />

import type { VideoProjectDocumentV1 } from '@openpost/video-project';
import { exportQuickCutLosslessly } from './lossless-exporter';

interface ExportRequest {
	type: 'export';
	project: VideoProjectDocumentV1;
	projectID?: string;
	format?: 'mp4' | 'webm';
	outputFileHandle?: FileSystemFileHandle;
}

interface CancelRequest {
	type: 'cancel';
}

let controller: AbortController | null = null;

self.onmessage = (event: MessageEvent<ExportRequest | CancelRequest>) => {
	if (event.data.type === 'cancel') {
		controller?.abort(new DOMException('Cancelled', 'AbortError'));
		return;
	}
	if (controller) return;
	controller = new AbortController();
	void exportQuickCutLosslessly(event.data.project, {
		projectID: event.data.projectID,
		format: event.data.format,
		outputFileHandle: event.data.outputFileHandle,
		signal: controller.signal,
		onProgress: (fraction) => postMessage({ type: 'progress', fraction })
	})
		.then((file) => postMessage({ type: 'complete', file }))
		.catch((cause: unknown) => {
			const error = cause instanceof Error ? cause : new Error(String(cause));
			postMessage({
				type: 'error',
				name: error.name,
				message: error.message,
				stack: error.stack
			});
		})
		.finally(() => {
			controller = null;
		});
};

export {};
