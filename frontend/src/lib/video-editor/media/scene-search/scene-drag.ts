/** Shared drag payload for inserting exact scene ranges on the timeline. */

import type { MediaScene } from './types';

export interface SceneDragData {
	type: 'timeline-scene';
	scene: MediaScene;
}

let activeSceneDrag: SceneDragData | null = null;

export function setSceneDragData(payload: SceneDragData): void {
	activeSceneDrag = payload;
}

export function clearSceneDragData(): void {
	activeSceneDrag = null;
}

export function getSceneDragData(dataTransfer?: DataTransfer | null): SceneDragData | null {
	if (activeSceneDrag) return activeSceneDrag;
	const raw = dataTransfer?.getData('application/json');
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as Partial<SceneDragData>;
		return parsed.type === 'timeline-scene' && parsed.scene?.id ? (parsed as SceneDragData) : null;
	} catch {
		return null;
	}
}
