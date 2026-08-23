import { describe, expect, it } from 'vitest';
import type { TimelineMarker } from '../project/types';
import { markerAfter, markerBefore, markerDisplayName } from './markers';

const markers: TimelineMarker[] = [
	{ id: 'late', frame: 90, color: '#fff' },
	{ id: 'early', frame: 10, color: '#fff' },
	{ id: 'middle', frame: 40, color: '#fff', label: '  Beat  ' }
];

describe('timeline marker navigation', () => {
	it('finds the closest strict marker regardless of storage order', () => {
		expect(markerBefore(markers, 50)?.id).toBe('middle');
		expect(markerAfter(markers, 20)?.id).toBe('middle');
		expect(markerBefore(markers, 10)).toBeUndefined();
		expect(markerAfter(markers, 90)).toBeUndefined();
	});

	it('uses trimmed labels and numbered fallbacks', () => {
		const fallback = (number: number) => `Marker ${number}`;
		expect(markerDisplayName(markers[2]!, 2, fallback)).toBe('Beat');
		expect(markerDisplayName(markers[0]!, 0, fallback)).toBe('Marker 1');
	});
});
