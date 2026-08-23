import { describe, expect, it } from 'vitest';
import type { ShapePathVertex } from '../project/types';
import {
	changedPathVertexValues,
	clonePathVertices,
	hasPathVertexKeyframes,
	pathVertexKeyframeProperties,
	pathVertexPropertyLabel,
	pathVertexPropertyValue,
	setPathVertexPropertyValue
} from './path-vertex-keyframes';

const vertices: ShapePathVertex[] = [
	{
		position: [0.25, 0.5],
		inHandle: [-0.1, 0],
		outHandle: [0.2, 0.1],
		tangentMode: 'broken'
	}
];

describe('path vertex keyframes', () => {
	it('maps every vertex coordinate to a stable scalar lane', () => {
		expect(pathVertexKeyframeProperties(vertices)).toEqual([
			'pathVertex:0:positionX',
			'pathVertex:0:positionY',
			'pathVertex:0:inX',
			'pathVertex:0:inY',
			'pathVertex:0:outX',
			'pathVertex:0:outY'
		]);
		expect(pathVertexPropertyValue(vertices, 'pathVertex:0:positionY')).toBe(0.5);
		expect(pathVertexPropertyLabel('pathVertex:0:outY')).toBe('Vertex 1 Out Y');
	});

	it('updates one channel without mutating the remaining topology', () => {
		const next = clonePathVertices(vertices);
		expect(setPathVertexPropertyValue(next, 'pathVertex:0:outY', 0.35)).toBe(true);
		expect(next[0]?.outHandle).toEqual([0.2, 0.35]);
		expect(next[0]?.position).toEqual(vertices[0]?.position);
		expect(vertices[0]?.outHandle).toEqual([0.2, 0.1]);
	});

	it('reports coordinate changes only when topology matches', () => {
		const next = clonePathVertices(vertices);
		next[0]!.position = [0.75, 0.5];
		expect(changedPathVertexValues(vertices, next)).toEqual([
			{ property: 'pathVertex:0:positionX', value: 0.75 }
		]);
		expect(changedPathVertexValues(vertices, [...next, ...vertices])).toEqual([]);
	});

	it('detects any persisted path lane with keys', () => {
		expect(hasPathVertexKeyframes(undefined)).toBe(false);
		expect(
			hasPathVertexKeyframes({
				'pathVertex:0:positionX': { frames: [0], values: [0.25] }
			})
		).toBe(true);
	});
});
