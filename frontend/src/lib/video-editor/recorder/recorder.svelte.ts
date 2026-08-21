/**
 * Recorder module: screen / camera / microphone capture with combined
 * compositing, writing WebM chunks to a downloadable file. Shared by the
 * /record page and the editor's record entry.
 */

export type RecorderSource = 'screen' | 'camera' | 'audio' | 'screen-camera';

export interface RecorderDeviceLists {
	cameras: MediaDeviceInfo[];
	microphones: MediaDeviceInfo[];
}

const MIME_CANDIDATES = [
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm',
	'audio/webm'
];

export function recorderMimeType(includeVideo: boolean): string {
	for (const candidate of MIME_CANDIDATES) {
		if (!includeVideo && !candidate.startsWith('audio')) continue;
		if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(candidate)) {
			return candidate;
		}
	}
	return '';
}

export async function listRecorderDevices(): Promise<RecorderDeviceLists> {
	const devices = await navigator.mediaDevices.enumerateDevices();
	return {
		cameras: devices.filter((d) => d.kind === 'videoinput'),
		microphones: devices.filter((d) => d.kind === 'audioinput')
	};
}

export class RecorderSession {
	stream = $state<MediaStream | null>(null);
	recording = $state(false);
	elapsedSeconds = $state(0);

	private mediaRecorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private timer: ReturnType<typeof setInterval> | null = null;
	private composited = false;

	async start(
		source: RecorderSource,
		options: { cameraId?: string; micId?: string; systemAudio?: boolean } = {}
	): Promise<void> {
		if (this.recording || this.stream) throw new Error('Already active');

		let displayStream: MediaStream | null = null;
		let cameraStream: MediaStream | null = null;
		let micStream: MediaStream | null = null;

		if (source === 'screen' || source === 'screen-camera') {
			displayStream = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: options.systemAudio !== false
			});
			displayStream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop());
		}
		if (source === 'camera') {
			cameraStream = await navigator.mediaDevices.getUserMedia({
				video: options.cameraId ? { deviceId: options.cameraId } : true,
				audio: false
			});
		}
		const wantsMic =
			source === 'audio' ||
			source === 'screen-camera' ||
			(source === 'camera' && Boolean(options.micId));
		if (wantsMic) {
			micStream = await navigator.mediaDevices.getUserMedia({
				audio: options.micId ? { deviceId: options.micId } : true
			});
		}

		let recordStream: MediaStream;
		if (source === 'screen-camera' && displayStream && cameraStream) {
			this.composited = true;
			recordStream = this.composite(displayStream, cameraStream, micStream);
		} else {
			recordStream = new MediaStream();
			for (const stream of [displayStream, cameraStream, micStream]) {
				if (!stream) continue;
				for (const track of stream.getTracks()) recordStream.addTrack(track);
			}
			if (source === 'audio' && micStream) {
				this.composited = false;
			}
		}

		this.stream = recordStream;
		const mimeType = recorderMimeType(source !== 'audio');
		this.chunks = [];
		this.mediaRecorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
		this.mediaRecorder.ondataavailable = (event) => {
			if (event.data.size > 0) this.chunks.push(event.data);
		};
		this.mediaRecorder.start(2000);
		this.recording = true;
		this.elapsedSeconds = 0;
		this.timer = setInterval(() => {
			this.elapsedSeconds += 1;
		}, 1000);
	}

	/** PiP-composite the camera over the screen at 30fps into one stream. */
	private composite(
		screen: MediaStream,
		camera: MediaStream,
		mic: MediaStream | null
	): MediaStream {
		const videoTrack = screen.getVideoTracks()[0];
		const settings = videoTrack?.getSettings() ?? {};
		const width = Math.max(640, settings.width ?? 1280);
		const height = Math.max(360, settings.height ?? 720);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context2d = canvas.getContext('2d');
		if (!context2d) throw new Error('Canvas unavailable');

		const screenVideo = document.createElement('video');
		screenVideo.srcObject = new MediaStream(screen.getVideoTracks());
		void screenVideo.play();
		const cameraVideo = document.createElement('video');
		cameraVideo.srcObject = new MediaStream(camera.getVideoTracks());
		void cameraVideo.play();

		const draw = () => {
			context2d.drawImage(screenVideo, 0, 0, width, height);
			const pipWidth = Math.round(width * 0.22);
			const pipHeight = Math.round(
				pipWidth * (cameraVideo.videoHeight / (cameraVideo.videoWidth || 1))
			);
			context2d.drawImage(
				cameraVideo,
				width - pipWidth - 16,
				height - pipHeight - 16,
				pipWidth,
				pipHeight
			);
			requestAnimationFrame(draw);
		};
		requestAnimationFrame(draw);

		const canvasStream = canvas.captureStream(30);
		const result = new MediaStream(canvasStream.getVideoTracks());
		for (const track of screen.getAudioTracks()) result.addTrack(track);
		if (mic) {
			const context = new AudioContext();
			const destination = context.createMediaStreamDestination();
			for (const source of [screen, mic]) {
				for (const track of source.getAudioTracks()) {
					destination.stream.addTrack(track);
					void context.createMediaStreamSource(new MediaStream([track])).connect(destination);
				}
			}
			for (const track of destination.stream.getAudioTracks()) result.addTrack(track);
		}
		return result;
	}

	stop(): { blob: Blob; mimeType: string; seconds: number } | null {
		if (!this.recording || !this.mediaRecorder) return null;
		const stopped = new Promise<void>((resolve) => {
			this.mediaRecorder!.onstop = () => resolve();
		});
		this.mediaRecorder.stop();
		this.recording = false;
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		void stopped.then(() => {
			for (const track of this.stream?.getTracks() ?? []) track.stop();
			this.stream = null;
		});
		const seconds = this.elapsedSeconds;
		const mimeType = this.mediaRecorder.mimeType || 'video/webm';
		const blob = new Blob(this.chunks, { type: mimeType });
		this.mediaRecorder = null;
		this.composited = false;
		return { blob, mimeType, seconds };
	}

	get usesCompositing(): boolean {
		return this.composited;
	}
}
