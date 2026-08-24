import { describe, expect, it } from 'vitest';
import {
	createEditorSettingsStore,
	DEFAULT_EDITOR_SETTINGS,
	normalizeEditorSettings
} from './editor-settings.svelte';

function memoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key)
	};
}

describe('editor settings', () => {
	it('normalizes corrupt and out-of-range persisted values', () => {
		expect(
			normalizeEditorSettings({
				maxUndoHistory: 999,
				snapByDefault: false,
				showWaveforms: 'yes',
				defaultTranscriptionModel: 'not-a-model',
				defaultTranscriptionLanguage: 'xx',
				defaultTranscriptionQuantization: 'bad'
			})
		).toEqual({
			...DEFAULT_EDITOR_SETTINGS,
			maxUndoHistory: 200,
			snapByDefault: false
		});
	});

	it('persists changes and resets the complete settings document', () => {
		const storage = memoryStorage();
		const first = createEditorSettingsStore(storage);
		first.set('maxUndoHistory', 30);
		first.set('showFilmstrips', false);
		first.set('defaultTranscriptionModel', 'whisper-small');

		const restored = createEditorSettingsStore(storage);
		expect(restored.maxUndoHistory).toBe(30);
		expect(restored.showFilmstrips).toBe(false);
		expect(restored.defaultTranscriptionModel).toBe('whisper-small');

		restored.reset();
		expect(createEditorSettingsStore(storage).value).toEqual(DEFAULT_EDITOR_SETTINGS);
	});
});
