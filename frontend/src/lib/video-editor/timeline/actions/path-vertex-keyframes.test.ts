import { beforeEach, describe, expect, it } from 'vitest';
import type { ShapePathVertex, TimelineItem } from '../../project/types';
import { commandHistory } from '../commands/command-store.svelte';
import { resolveAnimatedItemAt } from '../animated-properties';
import { timelineStore } from '../stores/timeline-store.svelte';
import { transitionsStore } from './transitions-store.svelte';
import {
	clearPathVertexKeyframes,
	commitPathGeometryAtFrame,
	keyPathVerticesAtFrame
} from './path-vertex-keyframes';

const vertices: ShapePathVertex[] = [
	{
		position: [0.1, 0.2],
		inHandle: [-0.1, 0],
		outHandle: [0.1, 0],
		tangentMode: 'continuous'
	},
	{
		position: [0.8, 0.7],
		inHandle: [-0.1, 0],
		outHandle: [0.1, 0],
		tangentMode: 'continuous'
	}
];

function path(overrides: Partial<TimelineItem> = {}): TimelineItem {
	return {
		id: 'path',
		trackId: 'visual',
		from: 10,
		durationInFrames: 60,
		label: 'Path',
		type: 'shape',
		shapeType: 'path',
		pathVertices: structuredClone(vertices),
		pathClosed: false,
		...overrides
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	transitionsStore.clear();
	timelineStore._setItems([path()]);
});

describe('path vertex keyframe actions', () => {
	it('updates base geometry directly before animation starts', () => {
		const next = structuredClone(vertices);
		next[0]!.position[0] = 0.25;
		expect(commitPathGeometryAtFrame('path', 20, next)).toBe('committed');
		expect(timelineStore.itemById.get('path')?.pathVertices?.[0]?.position[0]).toBe(0.25);
		expect(timelineStore.itemById.get('path')?.keyframes).toBeUndefined();
		expect(commandHistory.undoStack).toHaveLength(1);
	});

	it('keys the selected or all vertices as one undoable edit', () => {
		expect(keyPathVerticesAtFrame('path', 20, [1])).toBe(true);
		let item = timelineStore.itemById.get('path');
		expect(Object.keys(item?.keyframes ?? {})).toHaveLength(6);
		expect(item?.keyframes?.['pathVertex:1:positionX']).toMatchObject({
			frames: [10],
			values: [0.8]
		});

		expect(keyPathVerticesAtFrame('path', 30, 'all')).toBe(true);
		item = timelineStore.itemById.get('path');
		expect(Object.keys(item?.keyframes ?? {})).toHaveLength(12);
		expect(item?.keyframes?.['pathVertex:0:positionX']?.frames).toEqual([20]);
		expect(item?.keyframes?.['pathVertex:1:positionX']?.frames).toEqual([10, 20]);
		expect(commandHistory.undoStack).toHaveLength(2);
	});

	it('writes changed animated coordinates at the playhead without changing base geometry', () => {
		keyPathVerticesAtFrame('path', 10, 'all');
		const next = structuredClone(vertices);
		next[0]!.position[0] = 0.6;
		next[1]!.outHandle[1] = 0.3;
		expect(commitPathGeometryAtFrame('path', 40, next)).toBe('committed');

		const stored = timelineStore.itemById.get('path');
		expect(stored?.pathVertices?.[0]?.position[0]).toBe(0.1);
		expect(stored?.keyframes?.['pathVertex:0:positionX']?.frames).toEqual([0, 30]);
		expect(stored?.keyframes?.['pathVertex:1:outY']?.frames).toEqual([0, 30]);
		const resolved = stored ? resolveAnimatedItemAt(stored, 40) : undefined;
		expect(resolved?.pathVertices?.[0]?.position[0]).toBe(0.6);
		expect(resolved?.pathVertices?.[1]?.outHandle[1]).toBe(0.3);
	});

	it('locks topology until all path lanes are cleared', () => {
		keyPathVerticesAtFrame('path', 20, [0]);
		expect(commitPathGeometryAtFrame('path', 20, vertices.slice(0, 1))).toBe('topology');
		expect(clearPathVertexKeyframes('path')).toBe(true);
		expect(timelineStore.itemById.get('path')?.keyframes).toBeUndefined();
		expect(commitPathGeometryAtFrame('path', 20, vertices.slice(0, 1))).toBe('committed');
	});
});
