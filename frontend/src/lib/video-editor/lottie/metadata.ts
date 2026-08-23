/** WASM-free metadata extraction for raw Lottie JSON and dotLottie archives. */

import { unzipSync } from 'fflate';

export interface LottieMetadata {
	width: number;
	height: number;
	frameRate: number;
	totalFrames: number;
	durationSeconds: number;
	markers: LottieMarker[];
}

export interface LottieMarker {
	name: string;
	start: number;
	duration: number;
}

interface LottieJsonMarker {
	tm?: number;
	cm?: string;
	dr?: number;
}

interface LottieJson {
	w?: number;
	h?: number;
	fr?: number;
	ip?: number;
	op?: number;
	layers?: object[];
	markers?: LottieJsonMarker[];
}

function readMarkers(value: LottieJsonMarker[] | undefined): LottieMarker[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((marker) => {
		const name = marker.cm?.trim() ?? '';
		if (!name) return [];
		return [
			{
				name,
				start:
					marker.tm !== undefined && Number.isFinite(marker.tm) && marker.tm >= 0 ? marker.tm : 0,
				duration:
					marker.dr !== undefined && Number.isFinite(marker.dr) && marker.dr > 0 ? marker.dr : 0
			}
		];
	});
}

function finitePositive(value: number | undefined): value is number {
	return value !== undefined && Number.isFinite(value) && value > 0;
}

/** Parse the timing and dimensions from a decoded Lottie animation object. */
export function parseLottieMetadata(data: LottieJson): LottieMetadata | null {
	if (!Array.isArray(data.layers)) return null;

	const { w, h, fr, op } = data;
	const ip = data.ip !== undefined && Number.isFinite(data.ip) ? data.ip : 0;
	if (!finitePositive(w) || !finitePositive(h) || !finitePositive(fr) || !finitePositive(op)) {
		return null;
	}
	const totalFrames = Math.round(op - ip);
	if (totalFrames < 1) return null;
	return {
		width: Math.round(w),
		height: Math.round(h),
		frameRate: fr,
		totalFrames,
		durationSeconds: totalFrames / fr,
		markers: readMarkers(data.markers)
	};
}

function parseLottieJson(text: string): LottieMetadata | null {
	try {
		// SAFETY: parseLottieMetadata validates every field used from this external JSON boundary.
		return parseLottieMetadata(JSON.parse(text) as LottieJson);
	} catch {
		return null;
	}
}

function isZip(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		bytes[2] === 0x03 &&
		bytes[3] === 0x04
	);
}

function animationEntries(files: Record<string, Uint8Array>): string[] {
	const entries = Object.keys(files).filter((path) =>
		/(^|\/)(?:animations|a)\/[^/]+\.json$/i.test(path)
	);
	if (entries.length < 2) return entries;

	const manifestPath = Object.keys(files).find((path) => /(^|\/)manifest\.json$/i.test(path));
	if (!manifestPath) return entries;
	try {
		// SAFETY: only the optional first animation id is read after a string check.
		const manifest = JSON.parse(new TextDecoder().decode(files[manifestPath]!)) as {
			animations?: Array<{ id?: string }>;
		};
		const id = manifest.animations?.[0]?.id;
		if (!id) return entries;
		const fileName = `${id}.json`.toLowerCase();
		const primary = entries.find((path) => path.split('/').pop()?.toLowerCase() === fileName);
		return primary ? [primary, ...entries.filter((path) => path !== primary)] : entries;
	} catch {
		return entries;
	}
}

/** Parse a raw `.json` Lottie or the primary animation in a `.lottie` archive. */
export function parseLottieFileBytes(bytes: Uint8Array): LottieMetadata | null {
	if (!isZip(bytes)) {
		return parseLottieJson(new TextDecoder().decode(bytes));
	}

	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch {
		return null;
	}
	const decoder = new TextDecoder();
	for (const path of animationEntries(files)) {
		const metadata = parseLottieJson(decoder.decode(files[path]!));
		if (metadata) return metadata;
	}
	return null;
}

export function isLottieFile(file: Pick<File, 'name' | 'type'>): boolean {
	return (
		/\.(?:json|lottie)$/i.test(file.name) ||
		file.type === 'application/json' ||
		file.type === 'application/zip'
	);
}
