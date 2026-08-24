import { describe, expect, it } from 'vitest';
import {
	buildEffectKeyframeProperty,
	parseEffectKeyframeProperty
} from '../effects/effect-keyframes';
import { createBlankProject } from './defaults';
import { cloneProjectDocument } from './project-clone';
import type { TimelineItem } from './types';

function ids() {
	let index = 0;
	return () => `new-${++index}`;
}

describe('cloneProjectDocument', () => {
	it('deeply remaps linked timeline references, media, and animation ids', () => {
		const project = createBlankProject('Launch');
		const effectProperty = buildEffectKeyframeProperty('gpu-contrast', 'gpu-effect', 'amount');
		const source: TimelineItem = {
			id: 'source',
			trackId: 'track-video-main',
			from: 0,
			durationInFrames: 60,
			label: 'launch.mp4',
			type: 'video',
			mediaId: 'old-media',
			originId: 'lineage',
			linkedGroupId: 'pair',
			effects: [
				{ id: 'effect', type: 'brightness', enabled: true, amount: 1.2 },
				{
					id: 'gpu-effect',
					type: 'gpu',
					effectId: 'gpu-contrast',
					enabled: true,
					params: { amount: 1 }
				}
			],
			keyframes: {
				opacity: { frames: [0], values: [1], ids: ['key'] },
				[effectProperty]: { frames: [0], values: [1], ids: ['effect-key'] }
			},
			vectorKeyframes: {
				position: [{ id: 'vector-key', frame: 0, value: { x: 0, y: 0 }, easing: 'linear' }]
			}
		};
		project.animationPresets = [
			{
				id: 'preset',
				name: 'Contrast in',
				sourceItemType: 'video',
				properties: [
					{
						property: effectProperty,
						keyframes: [{ id: 'preset-key', frame: 0, value: 1, easing: 'linear' }]
					}
				],
				effects: [
					{
						id: 'gpu-effect',
						type: 'gpu',
						effectId: 'gpu-contrast',
						enabled: true,
						params: { amount: 1 }
					}
				],
				sourceDurationInFrames: 60,
				createdAt: 1
			}
		];
		const follower: TimelineItem = {
			...source,
			id: 'follower',
			from: 60,
			transformParent: {
				parentItemId: 'source',
				parentReference: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
				childLocalReference: { x: 10, y: 0, width: 50, height: 50, rotation: 0 },
				childWorldReference: { x: 10, y: 0, width: 50, height: 50, rotation: 0 }
			},
			propertyLinks: [
				{
					type: 'link',
					targetProperty: 'x',
					sourceItemId: 'source',
					sourceProperty: 'x',
					enabled: true,
					timeOffsetFrames: 0
				}
			],
			expressions: [
				{
					type: 'expression',
					targetProperty: 'y',
					source: 'value + prop("source", "y")',
					enabled: true
				}
			]
		};
		project.timeline!.items = [source, follower];
		project.timeline!.transitions = [
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'source',
				toItemId: 'follower'
			}
		];

		const clone = cloneProjectDocument(project, {
			name: 'Launch backup',
			now: 500,
			createId: ids(),
			mediaIdMap: new Map([['old-media', 'new-media']])
		});
		const [clonedSource, clonedFollower] = clone.timeline!.items;
		if (!clonedSource || !clonedFollower) throw new Error('Expected cloned items.');

		expect(clone).toMatchObject({ name: 'Launch backup', createdAt: 500, updatedAt: 500 });
		expect(clonedSource.id).not.toBe(source.id);
		expect(clonedSource.mediaId).toBe('new-media');
		expect(clonedSource.linkedGroupId).toBe(clonedFollower.linkedGroupId);
		expect(clonedSource.originId).toBe(clonedFollower.originId);
		expect(clonedSource.effects?.[0]?.id).not.toBe('effect');
		expect(clonedSource.keyframes?.opacity?.ids).not.toEqual(['key']);
		const clonedEffect = clonedSource.effects?.find((effect) => effect.type === 'gpu');
		const clonedEffectProperty = Object.keys(clonedSource.keyframes ?? {}).find((property) =>
			property.startsWith('effect:')
		);
		expect(parseEffectKeyframeProperty(clonedEffectProperty ?? '')?.effectId).toBe(
			clonedEffect?.id
		);
		expect(clonedSource.vectorKeyframes?.position?.[0]?.id).not.toBe('vector-key');
		expect(clonedFollower.propertyLinks?.[0]?.sourceItemId).toBe(clonedSource.id);
		expect(clonedFollower.transformParent?.parentItemId).toBe(clonedSource.id);
		expect(clonedFollower.expressions?.[0]?.source).toContain(`"${clonedSource.id}"`);
		expect(clone.timeline!.transitions?.[0]).toMatchObject({
			fromItemId: clonedSource.id,
			toItemId: clonedFollower.id
		});
		const clonedPreset = clone.animationPresets?.[0];
		expect(parseEffectKeyframeProperty(clonedPreset?.properties[0]?.property ?? '')?.effectId).toBe(
			clonedPreset?.effects[0]?.id
		);
		expect(project.timeline!.items[0]?.id).toBe('source');
	});

	it('remaps nested composition references and caption source ids', () => {
		const project = createBlankProject('Nested');
		project.timeline!.compositions = [
			{
				id: 'sequence',
				name: 'Sequence',
				items: [],
				tracks: [],
				transitions: [],
				fps: 30,
				width: 1920,
				height: 1080,
				durationInFrames: 30
			}
		];
		project.timeline!.topLevelSequenceIds = ['sequence'];
		project.timeline!.items = [
			{
				id: 'source',
				trackId: 'track-video-main',
				from: 0,
				durationInFrames: 30,
				label: 'Source',
				type: 'video',
				mediaId: 'media'
			},
			{
				id: 'captions',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 30,
				label: 'Captions',
				type: 'subtitle',
				captionSource: { type: 'transcript', clipId: 'source', mediaId: 'media' },
				cues: [{ id: 'cue', startFrame: 0, endFrame: 30, text: 'Hello' }]
			},
			{
				id: 'nested',
				trackId: 'track-video-main',
				from: 30,
				durationInFrames: 30,
				label: 'Nested',
				type: 'composition',
				compositionId: 'sequence'
			}
		];

		const clone = cloneProjectDocument(project, { createId: ids() });
		const [source, captions, nested] = clone.timeline!.items;
		const sequenceId = clone.timeline!.compositions?.[0]?.id;
		expect(clone.timeline!.topLevelSequenceIds).toEqual([sequenceId]);
		expect(nested?.compositionId).toBe(sequenceId);
		expect(captions?.captionSource?.clipId).toBe(source?.id);
		expect(captions?.cues?.[0]?.id).not.toBe('cue');
	});
});
