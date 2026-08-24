import type { Project } from '../project/types';
import type { MediaMetadata } from './types';
import type {
	AudioExportOptions,
	RenderedExportArtifact,
	RenderExportOptions,
	RenderExportProgress
} from './render-export';

export type WorkerVideoExportOptions = Omit<RenderExportOptions, 'signal' | 'onProgress'>;
export type WorkerAudioExportOptions = Omit<AudioExportOptions, 'signal' | 'onProgress'>;

interface WorkerRenderStartBase {
	type: 'start';
	requestId: string;
	project: Project;
	media: MediaMetadata[];
	workspaceRoot: FileSystemDirectoryHandle;
}

export interface WorkerVideoRenderStart extends WorkerRenderStartBase {
	mode: 'video';
	options: WorkerVideoExportOptions;
}

export interface WorkerAudioRenderStart extends WorkerRenderStartBase {
	mode: 'audio';
	options: WorkerAudioExportOptions;
}

export interface WorkerRenderCancel {
	type: 'cancel';
	requestId: string;
}

export type RenderExportWorkerRequest =
	| WorkerVideoRenderStart
	| WorkerAudioRenderStart
	| WorkerRenderCancel;

export type RenderExportWorkerResponse =
	| {
			type: 'progress';
			requestId: string;
			progress: RenderExportProgress;
	  }
	| {
			type: 'complete';
			requestId: string;
			artifact: RenderedExportArtifact;
	  }
	| {
			type: 'cancelled';
			requestId: string;
	  }
	| {
			type: 'error';
			requestId: string;
			error: string;
	  };
