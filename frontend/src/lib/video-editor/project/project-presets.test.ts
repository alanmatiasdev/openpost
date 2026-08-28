import { describe, expect, it } from 'vitest';
import {
	PROJECT_PRESETS,
	isValidProjectCreationSettings,
	projectAspectRatio
} from './project-presets';

describe('project creation presets', () => {
	it('keeps the complete FreeCut project format catalog', () => {
		expect(PROJECT_PRESETS).toEqual([
			{ id: 'youtube-1080p', width: 1920, height: 1080, fps: 30 },
			{ id: 'vertical-9-16', width: 1080, height: 1920, fps: 30 },
			{ id: 'instagram-square', width: 1080, height: 1080, fps: 30 },
			{ id: 'instagram-portrait', width: 1080, height: 1350, fps: 30 },
			{ id: 'x-landscape', width: 1200, height: 675, fps: 30 },
			{ id: 'linkedin-landscape', width: 1200, height: 627, fps: 30 }
		]);
	});

	it('validates exact dimensions and supported frame rates', () => {
		expect(isValidProjectCreationSettings({ width: 320, height: 240, fps: 24 })).toBe(true);
		expect(isValidProjectCreationSettings({ width: 7680, height: 4320, fps: 60 })).toBe(true);
		expect(isValidProjectCreationSettings({ width: 319, height: 240, fps: 24 })).toBe(false);
		expect(isValidProjectCreationSettings({ width: 1920, height: 1080, fps: 29 })).toBe(false);
		expect(projectAspectRatio(1080, 1350)).toBe('4:5');
	});
});
