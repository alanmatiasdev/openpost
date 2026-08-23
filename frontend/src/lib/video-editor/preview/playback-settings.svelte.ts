import { browser } from '$app/environment';
import { clampMonitorVolume, normalizePreviewZoom } from './playback-settings';

const STORAGE_KEY = 'openpost-video-editor-playback';

interface StoredPlaybackSettings {
	zoom?: number;
	volume?: number;
	muted?: boolean;
	audioSkimmingEnabled?: boolean;
}

function readStored(): StoredPlaybackSettings {
	if (!browser) return {};
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
		if (!parsed || typeof parsed !== 'object') return {};
		return {
			zoom: 'zoom' in parsed && typeof parsed.zoom === 'number' ? parsed.zoom : undefined,
			volume: 'volume' in parsed && typeof parsed.volume === 'number' ? parsed.volume : undefined,
			muted: 'muted' in parsed && typeof parsed.muted === 'boolean' ? parsed.muted : undefined,
			audioSkimmingEnabled:
				'audioSkimmingEnabled' in parsed && typeof parsed.audioSkimmingEnabled === 'boolean'
					? parsed.audioSkimmingEnabled
					: undefined
		};
	} catch {
		return {};
	}
}

const stored = readStored();
const state = $state({
	zoom: normalizePreviewZoom(stored.zoom ?? -1),
	volume: clampMonitorVolume(stored.volume ?? 1),
	muted: stored.muted ?? false,
	audioSkimmingEnabled: stored.audioSkimmingEnabled ?? true
});

function persist(): void {
	if (!browser) return;
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			zoom: state.zoom,
			volume: state.volume,
			muted: state.muted,
			audioSkimmingEnabled: state.audioSkimmingEnabled
		})
	);
}

export const previewPlaybackSettings = {
	get zoom(): number {
		return state.zoom;
	},
	get volume(): number {
		return state.volume;
	},
	get muted(): boolean {
		return state.muted;
	},
	get audioSkimmingEnabled(): boolean {
		return state.audioSkimmingEnabled;
	},
	setZoom(value: number): void {
		state.zoom = normalizePreviewZoom(value);
		persist();
	},
	setVolume(value: number): void {
		state.volume = clampMonitorVolume(value);
		if (state.volume > 0) state.muted = false;
		persist();
	},
	toggleMute(): void {
		state.muted = !state.muted;
		persist();
	},
	toggleAudioSkimming(): void {
		state.audioSkimmingEnabled = !state.audioSkimmingEnabled;
		persist();
	}
};
