import { describe, expect, it } from 'vitest';
import type { KeyframeProperty } from '../project/types';
import { visiblePathVertexProperties } from './path-vertex-visibility';

const properties: KeyframeProperty[] = [
	'x',
	'pathVertex:0:positionX',
	'pathVertex:0:positionY',
	'pathVertex:1:positionX',
	'pathVertex:1:positionY',
	'opacity'
];

describe('visiblePathVertexProperties', () => {
	it('shows the selected vertex while keeping non-path lanes', () => {
		expect(visiblePathVertexProperties(properties, { selectedVertexIndices: [1] })).toEqual([
			'x',
			'pathVertex:1:positionX',
			'pathVertex:1:positionY',
			'opacity'
		]);
	});

	it('never hides keyed or actively graphed path lanes', () => {
		expect(
			visiblePathVertexProperties(properties, {
				itemKeyframes: {
					'pathVertex:0:positionX': { frames: [0], values: [0] }
				},
				selectedVertexIndices: [1],
				alwaysInclude: 'pathVertex:0:positionY'
			})
		).toEqual(properties);
	});

	it('falls back to vertex one and can reveal every vertex', () => {
		expect(visiblePathVertexProperties(properties)).toEqual([
			'x',
			'pathVertex:0:positionX',
			'pathVertex:0:positionY',
			'opacity'
		]);
		expect(visiblePathVertexProperties(properties, { showAllVertices: true })).toEqual(properties);
	});
});
