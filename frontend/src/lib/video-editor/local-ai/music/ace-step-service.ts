import type {
	AceStepGenerationResult,
	AceStepUpdateListener,
	AceStepWebGpu,
	AudioQuality,
	CacheInventory,
	WorkerUpdate
} from 'ai-music-js';
import { gpuMediaJobScheduler } from '../../media/processing/gpu-media-job-scheduler';
import { sanitizeAiOutputFileNameSegment } from '../output-file-name';
import type { GeneratedAudio, LocalGenerationProgress } from '../types';

export const ACE_STEP_STANDARD_DOWNLOAD_BYTES = 5_626_494_229;
export const ACE_STEP_HIGH_DOWNLOAD_BYTES = 8_004_092_572;
export const ACE_STEP_MIN_DURATION_SECONDS = 10;
export const ACE_STEP_MAX_DURATION_SECONDS = 120;

export interface MusicGenerationSupport {
	supported: boolean;
	reason?: 'desktop-chromium-required' | 'secure-context-required' | 'webgpu-unavailable';
}

export interface MusicGenerationStorageStatus {
	expectedBytes: number;
	readyBytes: number;
	missingBytes: number;
	headroomBytes: number;
	availableBytes?: number;
	effectiveAvailableBytes?: number;
	sufficient: boolean;
	persisted?: boolean;
}

export interface GenerateLocalMusicOptions {
	prompt: string;
	durationSeconds: number;
	audioQuality: AudioQuality;
	seed?: number;
	signal?: AbortSignal;
	onProgress?: (progress: LocalGenerationProgress) => void;
}

export interface GeneratedMusic extends GeneratedAudio {
	seed: number;
	model: 'ace-step-1.5-xl-turbo';
	audioQuality: AudioQuality;
	prompt: string;
}

export type AceStepRuntime = Pick<
	AceStepWebGpu,
	'generate' | 'subscribe' | 'cancel' | 'dispose' | 'listCachedModels' | 'clearCache'
>;

type RuntimeFactory = (listener: AceStepUpdateListener) => Promise<AceStepRuntime>;

function isMobileBrowser(): boolean {
	return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

export async function inspectMusicGenerationSupport(): Promise<MusicGenerationSupport> {
	if (typeof window === 'undefined' || typeof Worker === 'undefined' || isMobileBrowser()) {
		return { supported: false, reason: 'desktop-chromium-required' };
	}
	if (!window.isSecureContext && location.hostname !== 'localhost') {
		return { supported: false, reason: 'secure-context-required' };
	}
	if (!('gpu' in navigator)) return { supported: false, reason: 'webgpu-unavailable' };
	try {
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
		return adapter ? { supported: true } : { supported: false, reason: 'webgpu-unavailable' };
	} catch {
		return { supported: false, reason: 'webgpu-unavailable' };
	}
}

function stageFromUpdate(update: WorkerUpdate): LocalGenerationProgress['stage'] {
	if (update.type === 'download') return 'downloading';
	if (update.type !== 'progress') return 'preparing';
	if (/packaging|complete/i.test(update.stage)) return 'finalizing';
	if (/starting|compatibility|tokenization|model/i.test(update.stage)) return 'preparing';
	return 'generating';
}

function progressMessage(update: WorkerUpdate): string {
	if (update.type === 'download') return `Downloading ${update.label}`;
	if (update.type === 'progress') return update.detail || update.stage.replaceAll('-', ' ');
	if (update.type === 'stage') return update.detail || update.stage.replaceAll('-', ' ');
	return 'Preparing ACE-Step';
}

export class AceStepMusicService {
	private runtime: AceStepRuntime | null = null;
	private runtimePromise: Promise<AceStepRuntime> | null = null;
	private generationTail: Promise<void> = Promise.resolve();
	private activeAbort: AbortController | null = null;

	constructor(
		private readonly createRuntime: RuntimeFactory = AceStepMusicService.defaultRuntime
	) {}

	private static async defaultRuntime(listener: AceStepUpdateListener): Promise<AceStepRuntime> {
		const [module, workerAsset, languageWorkerAsset, wasmAsset, wasmModuleAsset] =
			await Promise.all([
				import('ai-music-js'),
				import('ai-music-js/worker?url'),
				import('ai-music-js/language-worker?url'),
				import('ai-music-js/wasm/ort-wasm-simd-threaded.asyncify.wasm?url'),
				import('ai-music-js/wasm/ort-wasm-simd-threaded.asyncify.mjs?url')
			]);
		return new module.AceStepWebGpu({
			workerUrl: workerAsset.default,
			languageWorkerUrl: languageWorkerAsset.default,
			wasmUrl: wasmAsset.default,
			wasmModuleUrl: wasmModuleAsset.default,
			allowWasmFallback: false,
			onUpdate: listener
		});
	}

	private ensureRuntime(): Promise<AceStepRuntime> {
		if (this.runtime) {
			return Promise.resolve(this.runtime);
		}
		if (!this.runtimePromise) {
			this.runtimePromise = this.createRuntime(() => undefined)
				.then((runtime) => {
					this.runtime = runtime;
					return runtime;
				})
				.finally(() => {
					this.runtimePromise = null;
				});
		}
		return this.runtimePromise;
	}

	async generate(options: GenerateLocalMusicOptions): Promise<GeneratedMusic> {
		const prompt = options.prompt.trim();
		if (!prompt) throw new TypeError('Describe the music you want to create.');
		if (
			!Number.isInteger(options.durationSeconds) ||
			options.durationSeconds < ACE_STEP_MIN_DURATION_SECONDS ||
			options.durationSeconds > ACE_STEP_MAX_DURATION_SECONDS
		) {
			throw new RangeError(
				`Duration must be a whole number from ${ACE_STEP_MIN_DURATION_SECONDS} to ${ACE_STEP_MAX_DURATION_SECONDS} seconds.`
			);
		}
		const previous = this.generationTail;
		let releaseTurn!: () => void;
		this.generationTail = new Promise<void>((resolve) => {
			releaseTurn = resolve;
		});
		await previous;
		const abort = new AbortController();
		this.activeAbort = abort;
		const forwardAbort = () => abort.abort();
		options.signal?.addEventListener('abort', forwardAbort, { once: true });
		if (options.signal?.aborted) abort.abort();
		let releaseGpu: (() => void) | undefined;
		let unsubscribe: (() => void) | undefined;
		const downloads = new Map<string, number>();
		const totalBytes =
			options.audioQuality === 'high'
				? ACE_STEP_HIGH_DOWNLOAD_BYTES
				: ACE_STEP_STANDARD_DOWNLOAD_BYTES;
		const listener: AceStepUpdateListener = (update) => {
			if (update.type === 'download')
				downloads.set(update.assetId, Math.min(update.loaded, update.total));
			if (update.type !== 'download' && update.type !== 'progress' && update.type !== 'stage')
				return;
			const receivedBytes = Math.min(
				totalBytes,
				[...downloads.values()].reduce((sum, value) => sum + value, 0)
			);
			const nextProgress: LocalGenerationProgress = {
				stage: stageFromUpdate(update),
				message: progressMessage(update),
				progress: update.type === 'progress' ? update.progress : null,
				backend: 'webgpu'
			};
			if (receivedBytes > 0) {
				nextProgress.receivedBytes = receivedBytes;
				nextProgress.totalBytes = totalBytes;
			}
			options.onProgress?.(nextProgress);
		};
		try {
			releaseGpu = await gpuMediaJobScheduler.acquire(abort.signal);
			options.onProgress?.({
				stage: 'preparing',
				message: 'Preparing ACE-Step',
				progress: 0,
				backend: 'webgpu',
				totalBytes
			});
			const runtime = await this.ensureRuntime();
			unsubscribe = runtime.subscribe(listener);
			const seed = options.seed ?? crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
			const result: AceStepGenerationResult = await runtime.generate({
				prompt,
				durationSeconds: options.durationSeconds,
				audioQuality: options.audioQuality,
				plannerQuality: 'turbo',
				seed,
				sampler: 'euler',
				allowWasmFallback: false,
				signal: abort.signal
			});
			const fileName = `ai-music-${sanitizeAiOutputFileNameSegment(prompt, 'track')}-${seed}.wav`;
			const file = new File([result.wav], fileName, { type: 'audio/wav' });
			return {
				blob: result.wav,
				file,
				duration: result.durationSeconds,
				sampleRate: result.sampleRate,
				seed,
				model: 'ace-step-1.5-xl-turbo',
				audioQuality: options.audioQuality,
				prompt
			};
		} finally {
			unsubscribe?.();
			releaseGpu?.();
			options.signal?.removeEventListener('abort', forwardAbort);
			if (this.activeAbort === abort) this.activeAbort = null;
			releaseTurn();
		}
	}

	cancel(): boolean {
		if (!this.activeAbort) return false;
		this.activeAbort.abort();
		this.runtime?.cancel();
		return true;
	}

	async inspectCache(signal?: AbortSignal): Promise<CacheInventory> {
		const runtime = await this.ensureRuntime();
		return runtime.listCachedModels(signal);
	}

	async inspectGenerationStorage(
		audioQuality: AudioQuality,
		signal?: AbortSignal
	): Promise<MusicGenerationStorageStatus> {
		const [module, inventory] = await Promise.all([
			import('ai-music-js'),
			this.inspectCache(signal)
		]);
		const required = module.getRequiredAssets({ audioQuality });
		const cachedAssets = new Map(
			inventory.models.flatMap((model) => model.assets).map((asset) => [asset.id, asset])
		);
		let readyBytes = 0;
		let partialBytes = 0;
		for (const asset of required) {
			const cached = cachedAssets.get(asset.id);
			if (cached?.cached) readyBytes += asset.bytes;
			else partialBytes += Math.min(cached?.storedBytes ?? 0, asset.bytes);
		}
		const expectedBytes = required.reduce((sum, asset) => sum + asset.bytes, 0);
		const missingBytes = Math.max(0, expectedBytes - readyBytes);
		const headroomBytes =
			missingBytes > 0 ? Math.max(512_000_000, Math.ceil(missingBytes * 0.05)) : 0;
		const effectiveAvailableBytes =
			inventory.availableBytes === undefined ? undefined : inventory.availableBytes + partialBytes;
		return {
			expectedBytes,
			readyBytes,
			missingBytes,
			headroomBytes,
			availableBytes: inventory.availableBytes,
			effectiveAvailableBytes,
			sufficient:
				effectiveAvailableBytes === undefined ||
				effectiveAvailableBytes >= missingBytes + headroomBytes,
			persisted: inventory.persisted
		};
	}

	async clearCache(signal?: AbortSignal): Promise<boolean> {
		const inventory = await this.inspectCache(signal);
		if (inventory.storedBytes === 0) return false;
		await this.runtime?.clearCache(signal);
		this.unload();
		return true;
	}

	unload(): void {
		this.cancel();
		this.runtime?.dispose();
		this.runtime = null;
		this.runtimePromise = null;
	}
}

export const aceStepMusicService = new AceStepMusicService();

export function inspectMusicGenerationStorage(
	audioQuality: AudioQuality,
	signal?: AbortSignal
): Promise<MusicGenerationStorageStatus> {
	return aceStepMusicService.inspectGenerationStorage(audioQuality, signal);
}

export function generateLocalMusic(options: GenerateLocalMusicOptions): Promise<GeneratedMusic> {
	return aceStepMusicService.generate(options);
}

export function musicGenerationTags(result: GeneratedMusic): string[] {
	return [
		'ai-generated',
		'music',
		'ace-step',
		`ace-step-quality:${result.audioQuality}`,
		`ace-step-seed:${result.seed}`
	];
}
