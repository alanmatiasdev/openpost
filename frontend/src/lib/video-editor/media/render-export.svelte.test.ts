import { afterEach, describe, expect, it } from 'vitest';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from './pool.svelte';
import { renderTimelineAudioArtifact } from './render-export';
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
	});
});
