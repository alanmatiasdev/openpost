import type { TimelineMarker } from '../project/types';

export function markerBefore(markers: TimelineMarker[], frame: number): TimelineMarker | undefined {
	let result: TimelineMarker | undefined;
	for (const marker of markers) {
		if (marker.frame < frame && (!result || marker.frame > result.frame)) result = marker;
	}
	return result;
}

export function markerAfter(markers: TimelineMarker[], frame: number): TimelineMarker | undefined {
	let result: TimelineMarker | undefined;
	for (const marker of markers) {
		if (marker.frame > frame && (!result || marker.frame < result.frame)) result = marker;
	}
	return result;
}

export function markerDisplayName(
	marker: TimelineMarker,
	index: number,
	fallback: (number: number) => string
): string {
	return marker.label?.trim() || fallback(index + 1);
}
