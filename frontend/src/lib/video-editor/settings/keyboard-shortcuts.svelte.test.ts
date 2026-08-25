import { describe, expect, it } from 'vitest';
import { createKeyboardShortcutStore } from './keyboard-shortcuts.svelte';

function memoryStorage(initial?: string) {
	const values = new Map<string, string>();
	if (initial) values.set('openpost-video-editor-shortcuts-v1', initial);
	return {
		getItem(key: string) {
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			values.set(key, value);
		},
		removeItem(key: string) {
			values.delete(key);
		},
		value() {
			return values.get('openpost-video-editor-shortcuts-v1') ?? null;
		}
	};
}

describe('keyboard shortcut settings', () => {
	it('persists valid overrides and explicit unassigned commands', () => {
		const storage = memoryStorage();
		const shortcuts = createKeyboardShortcutStore(storage);
		shortcuts.setBinding('PLAY_PAUSE', 'Shift+Space');
		shortcuts.unbind('DELETE_SELECTED');
		expect(shortcuts.bindings.PLAY_PAUSE).toBe('shift+space');
		expect(shortcuts.bindings.DELETE_SELECTED).toBe('');
		expect(JSON.parse(storage.value() ?? '{}')).toEqual({
			PLAY_PAUSE: 'shift+space',
			DELETE_SELECTED: ''
		});

		const restored = createKeyboardShortcutStore(storage);
		expect(restored.overrides).toEqual(shortcuts.overrides);
	});

	it('drops corrupt state and removes storage after reset', () => {
		const storage = memoryStorage('{broken');
		const shortcuts = createKeyboardShortcutStore(storage);
		expect(shortcuts.customCount).toBe(0);
		shortcuts.setBinding('SAVE', 'mod+alt+s');
		shortcuts.resetAll();
		expect(shortcuts.bindings.SAVE).toBe('mod+s');
		expect(storage.value()).toBeNull();
	});
});
