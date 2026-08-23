import { reverseAudioWindow } from './reverse-audio';

let context: AudioContext | null = null;
const decodedByUrl = new Map<string, Promise<AudioBuffer>>();
const reversedByWindow = new Map<string, Promise<AudioBuffer>>();

export function previewAudioContext(): AudioContext {
	context ??= new AudioContext({ latencyHint: 'interactive' });
	return context;
}

async function decodedPreviewAudio(url: string): Promise<AudioBuffer> {
	let pending = decodedByUrl.get(url);
	if (!pending) {
		pending = fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error(`Could not read preview audio (${response.status}).`);
				return response.arrayBuffer();
			})
			.then((bytes) => previewAudioContext().decodeAudioData(bytes));
		decodedByUrl.set(url, pending);
		pending.catch(() => decodedByUrl.delete(url));
	}
	return pending;
}

/** Decode one source only once, then cache each exact reversed clip window. */
export async function reversedPreviewAudio(
	url: string,
	startSeconds: number,
	endSeconds: number
): Promise<AudioBuffer> {
	const key = `${url}\u0000${startSeconds.toFixed(6)}\u0000${endSeconds.toFixed(6)}`;
	let pending = reversedByWindow.get(key);
	if (!pending) {
		pending = decodedPreviewAudio(url).then((decoded) => {
			const window = reverseAudioWindow(decoded, endSeconds, endSeconds - startSeconds);
			const audioContext = previewAudioContext();
			const buffer = audioContext.createBuffer(
				window.channels.length,
				Math.max(1, window.channels[0]?.length ?? 0),
				window.sampleRate
			);
			for (let channel = 0; channel < window.channels.length; channel++) {
				buffer.getChannelData(channel).set(window.channels[channel]!);
			}
			return buffer;
		});
		reversedByWindow.set(key, pending);
		pending.catch(() => reversedByWindow.delete(key));
	}
	return pending;
}
