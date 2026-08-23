import { ONNX_MODEL_CACHE_NAME } from '../transcript/engine/onnx-model-cache';
import { kokoroTtsService } from './tts/kokoro-service';
import { clearMossModelStorage, inspectMossModelStorage } from './tts/moss-model-storage';
import { mossTtsService } from './tts/moss-service';
import { supertonicTtsService } from './tts/supertonic-service';

export const TRANSFORMERS_CACHE_NAME = 'transformers-cache';

export interface LocalModelCacheDefinition {
	id: string;
	label: string;
	description: string;
	cacheName: string;
	matchPathFragments: string[];
	storage?: 'cache' | 'moss-opfs';
}

export interface LocalModelCacheSummary extends LocalModelCacheDefinition {
	supported: boolean;
	downloaded: boolean;
	entryCount: number;
	totalBytes: number;
	sizeStatus: 'exact' | 'partial' | 'unavailable';
	inspectionState: 'ready' | 'timed-out' | 'error';
}

export const LOCAL_MODEL_CACHE_DEFINITIONS: LocalModelCacheDefinition[] = [
	{
		id: 'whisper',
		label: 'Whisper',
		description: 'Speech recognition models and tokenizers.',
		cacheName: TRANSFORMERS_CACHE_NAME,
		matchPathFragments: ['/onnx-community/whisper-']
	},
	{
		id: 'parakeet',
		label: 'Parakeet',
		description: 'Speech recognition encoder, decoder and vocabulary.',
		cacheName: ONNX_MODEL_CACHE_NAME,
		matchPathFragments: ['/parakeet-tdt-0.6b-v3-smoothquant-onnx/']
	},
	{
		id: 'scene-captions',
		label: 'Scene captions',
		description: 'LFM visual caption model.',
		cacheName: TRANSFORMERS_CACHE_NAME,
		matchPathFragments: ['/lfm2.5-vl-450m-onnx/']
	},
	{
		id: 'semantic-search',
		label: 'Semantic search',
		description: 'MiniLM text embedding model.',
		cacheName: TRANSFORMERS_CACHE_NAME,
		matchPathFragments: ['/all-minilm-l6-v2/']
	},
	{
		id: 'visual-search',
		label: 'Visual search',
		description: 'CLIP text and image embedding models.',
		cacheName: TRANSFORMERS_CACHE_NAME,
		matchPathFragments: ['/clip-vit-base-patch32/']
	},
	{
		id: 'kokoro-tts',
		label: 'Kokoro voices',
		description: 'Local voice model and tokenizer.',
		cacheName: TRANSFORMERS_CACHE_NAME,
		matchPathFragments: ['/kokoro-82m-v1.0-onnx/']
	},
	{
		id: 'supertonic-tts',
		label: 'Supertonic voices',
		description: 'Local voice models and styles.',
		cacheName: ONNX_MODEL_CACHE_NAME,
		matchPathFragments: ['/supertonic-3/']
	},
	{
		id: 'moss-tts',
		label: 'MOSS voices',
		description: 'Multilingual voice and audio-tokenizer models.',
		cacheName: 'opfs',
		matchPathFragments: [],
		storage: 'moss-opfs'
	},
	{
		id: 'musicgen',
		label: 'MusicGen',
		description: 'Local music generation model and tokenizer.',
		cacheName: TRANSFORMERS_CACHE_NAME,
		matchPathFragments: ['/musicgen-small/', '/musicgen-medium/']
	}
];

const OPERATION_TIMEOUT_MS = 1500;
const MATCH_TIMEOUT_MS = 150;

function cacheStorage(): CacheStorage | null {
	if (!('caches' in globalThis)) return null;
	try {
		return globalThis.caches;
	} catch {
		return null;
	}
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = OPERATION_TIMEOUT_MS): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Model cache inspection timed out')), timeoutMs);
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function matches(definition: LocalModelCacheDefinition, request: Request): boolean {
	const url = request.url.toLowerCase();
	return definition.matchPathFragments.some((fragment) => url.includes(fragment));
}

function unavailable(
	definition: LocalModelCacheDefinition,
	state: LocalModelCacheSummary['inspectionState'],
	supported = true
): LocalModelCacheSummary {
	return {
		...definition,
		supported,
		downloaded: false,
		entryCount: 0,
		totalBytes: 0,
		sizeStatus: 'unavailable',
		inspectionState: state
	};
}

export async function inspectLocalModelCache(
	definition: LocalModelCacheDefinition
): Promise<LocalModelCacheSummary> {
	if (definition.storage === 'moss-opfs') {
		try {
			const summary = await inspectMossModelStorage();
			return {
				...definition,
				...summary,
				inspectionState: 'ready'
			};
		} catch {
			return unavailable(definition, 'error');
		}
	}
	const storage = cacheStorage();
	if (!storage) return unavailable(definition, 'error', false);
	try {
		const names = await withTimeout(storage.keys());
		if (!names.includes(definition.cacheName)) return unavailable(definition, 'ready');
		const cache = await withTimeout(storage.open(definition.cacheName));
		const requests = (await withTimeout(cache.keys())).filter((request) =>
			matches(definition, request)
		);
		if (requests.length === 0) return unavailable(definition, 'ready');
		const sizes = await Promise.allSettled(
			requests.map(async (request) => {
				const response = await withTimeout(cache.match(request), MATCH_TIMEOUT_MS);
				const raw = response?.headers.get('content-length');
				const size = raw ? Number(raw) : Number.NaN;
				return Number.isFinite(size) && size >= 0 ? size : null;
			})
		);
		let totalBytes = 0;
		let measured = 0;
		for (const result of sizes) {
			if (result.status === 'fulfilled' && result.value !== null) {
				totalBytes += result.value;
				measured += 1;
			}
		}
		return {
			...definition,
			supported: true,
			downloaded: true,
			entryCount: requests.length,
			totalBytes,
			sizeStatus:
				measured === 0 ? 'unavailable' : measured === requests.length ? 'exact' : 'partial',
			inspectionState: 'ready'
		};
	} catch (error) {
		return unavailable(
			definition,
			error instanceof Error && error.message.includes('timed out') ? 'timed-out' : 'error'
		);
	}
}

export function inspectAllLocalModelCaches(): Promise<LocalModelCacheSummary[]> {
	return Promise.all(LOCAL_MODEL_CACHE_DEFINITIONS.map(inspectLocalModelCache));
}

export async function clearLocalModelCache(
	definition: LocalModelCacheDefinition
): Promise<boolean> {
	if (definition.storage === 'moss-opfs') {
		mossTtsService.unload();
		return clearMossModelStorage();
	}
	if (definition.id === 'kokoro-tts') await kokoroTtsService.unload();
	if (definition.id === 'supertonic-tts') await supertonicTtsService.unload();
	const storage = cacheStorage();
	if (!storage) return false;
	const names = await withTimeout(storage.keys());
	if (!names.includes(definition.cacheName)) return false;
	const cache = await withTimeout(storage.open(definition.cacheName));
	const requests = (await withTimeout(cache.keys())).filter((request) =>
		matches(definition, request)
	);
	const removed = await Promise.all(
		requests.map((request) => withTimeout(cache.delete(request), MATCH_TIMEOUT_MS))
	);
	return removed.some(Boolean);
}
