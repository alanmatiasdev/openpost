export type LocalGenerationStage = 'downloading' | 'preparing' | 'generating' | 'finalizing';

export interface LocalGenerationProgress {
	stage: LocalGenerationStage;
	message: string;
	progress: number | null;
	backend?: 'webgpu' | 'wasm';
	receivedBytes?: number;
	totalBytes?: number;
}

export interface GeneratedAudio {
	blob: Blob;
	file: File;
	duration: number;
	sampleRate: number;
}
