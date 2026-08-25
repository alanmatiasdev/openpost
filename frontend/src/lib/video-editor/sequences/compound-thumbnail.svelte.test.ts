import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTimeline } from '../project/defaults';
import type { SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import {
	compoundThumbnailFrame,
	compoundThumbnailService,
	compoundThumbnailSignature,
	compoundThumbnailSize
} from './compound-thumbnail';
import { sequenceStore } from './sequence-store.svelte';

const visualTrack: TimelineTrack = {
	id: 'visual',
	name: 'Visual',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

function shape(fillColor: string): TimelineItem {
	return {
		id: 'shape',
		trackId: visualTrack.id,
		from: 0,
		durationInFrames: 60,
		label: 'Color card',
		type: 'shape',
		shapeType: 'rectangle',
		fillColor,
		fillEnabled: true,
		transform: { width: 200, height: 100 }
	};
}

function composition(id: string, items: TimelineItem[]): SubComposition {
	return {
		id,
		name: id,
		items,
		tracks: [visualTrack],
		transitions: [],
		fps: 30,
		width: 200,
		height: 100,
		durationInFrames: 60,
		backgroundColor: '#000000'
	};
}

beforeEach(() => {
	sequenceStore.reset();
	sequenceStore.load(
		{
			...createEmptyTimeline(),
			tracks: [visualTrack],
			compositions: [composition('card', [shape('#ff0000')])]
		},
		{ width: 200, height: 100, fps: 30 }
	);
});

afterEach(() => {
	compoundThumbnailService.clearAll();
	sequenceStore.reset();
});

describe('compound thumbnails', () => {
	it('renders a real cached frame and invalidates it after visual edits', async () => {
		const first = await compoundThumbnailService.getThumbnailUrl('card');
		expect(first).toMatch(/^blob:/);
		expect(await compoundThumbnailService.getThumbnailUrl('card')).toBe(first);
		const firstBlob = await fetch(first!).then((response) => response.blob());
		expect(firstBlob.type).toBe('image/jpeg');
		const firstBitmap = await createImageBitmap(firstBlob);
		const canvas = new OffscreenCanvas(firstBitmap.width, firstBitmap.height);
		const context = canvas.getContext('2d', { willReadFrequently: true });
		if (!context) throw new Error('Canvas2D is required for thumbnail validation.');
		context.drawImage(firstBitmap, 0, 0);
		const red = [...context.getImageData(firstBitmap.width / 2, firstBitmap.height / 2, 1, 1).data];
		firstBitmap.close();
		expect(red[0]).toBeGreaterThan(200);
		expect(red[1]).toBeLessThan(40);

		const current = sequenceStore.compositionById.get('card');
		if (!current) throw new Error('Expected the test composition.');
		sequenceStore.updateComposition('card', { items: [shape('#0000ff')] });
		const second = await compoundThumbnailService.getThumbnailUrl('card');
		expect(second).toMatch(/^blob:/);
		expect(second).not.toBe(first);
	});

	it('tracks nested changes and keeps bounded aspect-correct dimensions', () => {
		const child = composition('child', [shape('#00ff00')]);
		const parent = composition('parent', [
			{
				id: 'nested',
				trackId: visualTrack.id,
				from: 0,
				durationInFrames: 60,
				label: 'Nested',
				type: 'composition',
				compositionId: child.id
			}
		]);
		const compositions = new Map([
			[parent.id, parent],
			[child.id, child]
		]);
		const first = compoundThumbnailSignature(parent.id, compositions);
		compositions.set(child.id, { ...child, items: [shape('#ffffff')] });
		expect(compoundThumbnailSignature(parent.id, compositions)).not.toBe(first);
		expect(compoundThumbnailFrame(100)).toBe(20);
		expect(compoundThumbnailFrame(1)).toBe(0);
		expect(compoundThumbnailSize(1920, 1080)).toEqual({
			width: 320,
			height: 180
		});
	});
});
