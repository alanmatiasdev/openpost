import { afterEach, describe, expect, it } from 'vitest';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from './pool.svelte';
import { renderTimelineAudioArtifact, TimelineFrameRenderer } from './render-export';
import ac3FixtureUrl from './fixtures/tone-ac3.mkv?url';

function linkedFileHandle(file: File): FileSystemFileHandle {
	// SAFETY: resolveMediaBlob only reads name, kind, and getFile from linked handles.
	return {
		kind: 'file',
		name: file.name,
		getFile: async () => file
	} as FileSystemFileHandle;
}

afterEach(() => mediaPool.clear());

describe('render export audio decoding', () => {
	it('mixes a real AC-3 clip into a WAV export', async () => {
		const response = await fetch(ac3FixtureUrl);
		expect(response.ok).toBe(true);
		const file = new File([await response.blob()], 'tone-ac3.mkv', {
			type: 'audio/x-matroska'
		});
		mediaPool.upsert(
			{
				id: 'ac3-source',
				storageType: 'handle',
				fileHandle: linkedFileHandle(file),
				fileName: file.name,
				fileSize: file.size,
				mimeType: file.type,
				duration: 0.3,
				width: 0,
				height: 0,
				fps: 0,
				codec: '',
				audioCodec: 'ac3',
				audioCodecSupported: true,
				bitrate: 96_000,
				tags: ['audio']
			},
			'ready'
		);
		const track: TimelineTrack = {
			id: 'audio',
			name: 'Audio 1',
			kind: 'audio',
			height: 72,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			volume: 1,
			order: 0
		};
		const item: TimelineItem = {
			id: 'clip',
			trackId: track.id,
			from: 0,
			durationInFrames: 9,
			label: 'AC-3 tone',
			type: 'audio',
			mediaId: 'ac3-source',
			sourceStart: 0,
			sourceEnd: 9,
			sourceFps: 30
		};
		const project: Project = {
			id: 'project',
			name: 'AC3 export',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 0.3,
			metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#000000' },
			timeline: { tracks: [track], items: [item] }
		};

		const artifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		expect(artifact.fileName).toBe('AC3 export.wav');
		expect(artifact.blob.type).toBe('audio/wav');
		expect(artifact.blob.size).toBeGreaterThan(20_000);

		const context = new AudioContext();
		const unity = await context.decodeAudioData(await artifact.blob.arrayBuffer());
		project.timeline!.masterVolumeDb = -6.020599913279624;
		const attenuatedArtifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const attenuated = await context.decodeAudioData(await attenuatedArtifact.blob.arrayBuffer());
		const unityPeak = Math.max(...unity.getChannelData(0).map((sample) => Math.abs(sample)));
		const attenuatedPeak = Math.max(
			...attenuated.getChannelData(0).map((sample) => Math.abs(sample))
		);
		expect(attenuatedPeak / unityPeak).toBeCloseTo(0.5, 2);

		project.timeline!.masterMuted = true;
		const mutedArtifact = await renderTimelineAudioArtifact(project, { format: 'wav' });
		const muted = await context.decodeAudioData(await mutedArtifact.blob.arrayBuffer());
		expect(Math.max(...muted.getChannelData(0).map((sample) => Math.abs(sample)))).toBe(0);
		await context.close();
	});
});

describe('render export exactness', () => {
	it('rejects an export frame instead of omitting an enabled GPU effect', async () => {
		const track: TimelineTrack = {
			id: 'visual',
			name: 'Visual 1',
			kind: 'video',
			height: 72,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		};
		const item: TimelineItem = {
			id: 'shape',
			trackId: track.id,
			from: 0,
			durationInFrames: 30,
			label: 'Shape',
			type: 'shape',
			shapeType: 'rectangle',
			fillColor: '#ff0000',
			fillEnabled: true,
			transform: { width: 32, height: 32 },
			effects: [
				{
					id: 'missing-renderer',
					type: 'gpu',
					effectId: 'gpu-missing-renderer',
					enabled: true,
					params: {}
				}
			]
		};
		const project: Project = {
			id: 'exactness',
			name: 'Exact export',
			description: '',
			createdAt: 0,
			updatedAt: 0,
			duration: 1,
			metadata: { width: 64, height: 64, fps: 30, backgroundColor: '#000000' },
			timeline: { tracks: [track], items: [item] }
		};
		const renderer = new TimelineFrameRenderer(project);

		try {
			await expect(renderer.render(0)).rejects.toThrowError(
				'Video frame could not render exactly: GPU effect renderer unavailable: gpu-missing-renderer'
			);
		} finally {
			renderer.dispose();
		}
	});
});
