import { describe, expect, it } from 'vitest';
import {
	SHORTCUT_PRESET_SCHEMA,
	browserShortcutConflict,
	createShortcutPreset,
	eventMatchesShortcut,
	findShortcutConflicts,
	formatShortcutBinding,
	normalizeShortcutBinding,
	parseShortcutPreset,
	resolveEditorShortcuts,
	shortcutBindingFromEvent
} from './keyboard-shortcuts';

describe('keyboard shortcuts', () => {
	it('normalizes aliases, physical keys, and cross-platform modifiers', () => {
		expect(normalizeShortcutBinding('Shift+Ctrl+ArrowLeft')).toBe('mod+shift+left');
		expect(
			shortcutBindingFromEvent({
				code: 'Comma',
				key: '<',
				metaKey: true,
				shiftKey: true
			})
		).toBe('mod+shift+comma');
		expect(formatShortcutBinding('mod+alt+k', 'MacIntel')).toBe('Cmd + Option + K');
		expect(formatShortcutBinding('mod+alt+k', 'Win32')).toBe('Ctrl + Alt + K');
	});

	it('matches command events from their resolved binding', () => {
		const bindings = resolveEditorShortcuts({ PLAY_PAUSE: 'shift+space' });
		expect(
			eventMatchesShortcut({ code: 'Space', key: ' ', shiftKey: true }, bindings.PLAY_PAUSE)
		).toBe(true);
		expect(eventMatchesShortcut({ code: 'Space', key: ' ' }, bindings.PLAY_PAUSE)).toBe(false);
	});

	it('reports command and browser conflicts before a binding is replaced', () => {
		const bindings = resolveEditorShortcuts({ PLAY_PAUSE: 'mod+s' });
		expect(findShortcutConflicts(bindings, 'mod+s', 'PLAY_PAUSE')).toEqual(['SAVE']);
		expect(browserShortcutConflict('Ctrl+P')).toEqual({
			binding: 'mod+p',
			browserAction: 'Print page'
		});
	});

	it('round trips custom and unassigned commands through a versioned preset', () => {
		const preset = createShortcutPreset(
			{ PLAY_PAUSE: 'Shift+Space', DELETE_SELECTED: '' },
			new Date('2026-08-25T12:00:00.000Z')
		);
		expect(preset).toMatchObject({
			schema: SHORTCUT_PRESET_SCHEMA,
			version: 1,
			exportedAt: '2026-08-25T12:00:00.000Z',
			overrides: { PLAY_PAUSE: 'shift+space', DELETE_SELECTED: '' }
		});
		expect(parseShortcutPreset(preset)).toEqual({
			overrides: { PLAY_PAUSE: 'shift+space', DELETE_SELECTED: '' },
			importedCount: 2,
			ignoredCount: 0,
			sourceSchema: SHORTCUT_PRESET_SCHEMA,
			sourceVersion: 1
		});
	});

	it('imports matching FreeCut command ids and ignores commands OpenPost does not expose', () => {
		expect(
			parseShortcutPreset({
				schema: 'freecut-hotkeys',
				version: 1,
				overrides: {
					PLAY_PAUSE: 'Shift+Space',
					WORKSPACE_COLOR: 'Alt+8',
					OPEN_SCENE_BROWSER: 'Ctrl+Shift+F'
				}
			})
		).toEqual({
			overrides: { PLAY_PAUSE: 'shift+space', WORKSPACE_COLOR: 'alt+8' },
			importedCount: 2,
			ignoredCount: 1,
			sourceSchema: 'freecut-hotkeys',
			sourceVersion: 1
		});
	});

	it('rejects malformed presets instead of partially applying them', () => {
		expect(() => parseShortcutPreset({ schema: SHORTCUT_PRESET_SCHEMA, overrides: [] })).toThrow(
			'Invalid shortcut preset'
		);
	});
});
