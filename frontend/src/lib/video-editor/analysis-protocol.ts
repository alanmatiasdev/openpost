export interface TranscriptWorkerChunk {
	text?: string;
	timestamp?: [number | null, number | null];
	confidence?: number;
}

export interface TranscriptWorkerOutput {
	text?: string;
	chunks?: TranscriptWorkerChunk[];
}

export interface VADWorkerRegion {
	start_sample: number;
	end_sample: number;
}

export type AnalysisWorkerRequestInput =
	| {
			type: 'transcribe';
			audio: Float32Array;
			model_base_url: string;
			model_path: string;
			device: 'webgpu' | 'wasm';
			language: string;
	  }
	| { type: 'vad-start'; model_url: string }
	| { type: 'vad-chunk'; audio: Float32Array }
	| { type: 'vad-end' };

export type AnalysisWorkerRequest = AnalysisWorkerRequestInput & { id: string };

export type AnalysisWorkerProgressResponse =
	| { id: string; type: 'model-progress'; status: string }
	| { id: string; type: 'device-fallback'; device: 'wasm' }
	| { id: string; type: 'vad-progress'; processed_samples: number };

export type AnalysisWorkerSuccessResponse =
	| { id: string; type: 'transcript'; output: TranscriptWorkerOutput }
	| { id: string; type: 'vad-ready' }
	| { id: string; type: 'vad-chunk-complete'; processed_samples: number }
	| { id: string; type: 'vad-result'; regions: VADWorkerRegion[] };

export type AnalysisWorkerResponse =
	| AnalysisWorkerProgressResponse
	| AnalysisWorkerSuccessResponse
	| { id: string; type: 'error'; message: string };
