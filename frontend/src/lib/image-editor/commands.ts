export type ImageEditorCommandID =
	| 'save'
	| 'undo'
	| 'redo'
	| 'duplicate'
	| 'group'
	| 'ungroup'
	| 'select_all'
	| 'deselect'
	| 'copy'
	| 'cut'
	| 'paste'
	| 'delete'
	| 'fit_canvas'
	| 'zoom_100'
	| 'focus_canvas'
	| 'tool_select'
	| 'tool_marquee'
	| 'tool_ellipse_marquee'
	| 'tool_lasso'
	| 'tool_magic_wand'
	| 'tool_crop'
	| 'tool_eyedropper'
	| 'tool_text'
	| 'tool_shape'
	| 'tool_pencil'
	| 'tool_eraser'
	| 'tool_magic_eraser'
	| 'tool_bucket'
	| 'tool_gradient'
	| 'tool_hand'
	| 'tool_zoom';

export type ImageEditorCommandCategory = 'file' | 'edit' | 'view' | 'select' | 'tools';

export interface ImageEditorCommandShortcut {
	key: string;
	primary?: boolean;
	shift?: boolean;
	alt?: boolean;
	display?: string;
}

export interface ImageEditorCommandDescriptor {
	id: ImageEditorCommandID;
	category: ImageEditorCommandCategory;
	shortcuts: readonly ImageEditorCommandShortcut[];
}

export const IMAGE_EDITOR_COMMANDS: readonly ImageEditorCommandDescriptor[] = [
	{ id: 'save', category: 'file', shortcuts: [{ key: 's', primary: true }] },
	{ id: 'undo', category: 'edit', shortcuts: [{ key: 'z', primary: true }] },
	{
		id: 'redo',
		category: 'edit',
		shortcuts: [
			{ key: 'z', primary: true, shift: true },
			{ key: 'y', primary: true }
		]
	},
	{ id: 'duplicate', category: 'edit', shortcuts: [{ key: 'j', primary: true }] },
	{ id: 'group', category: 'edit', shortcuts: [{ key: 'g', primary: true }] },
	{ id: 'ungroup', category: 'edit', shortcuts: [{ key: 'g', primary: true, shift: true }] },
	{ id: 'select_all', category: 'select', shortcuts: [{ key: 'a', primary: true }] },
	{ id: 'deselect', category: 'select', shortcuts: [{ key: 'd', primary: true }] },
	{ id: 'copy', category: 'edit', shortcuts: [{ key: 'c', primary: true }] },
	{ id: 'cut', category: 'edit', shortcuts: [{ key: 'x', primary: true }] },
	{ id: 'paste', category: 'edit', shortcuts: [{ key: 'v', primary: true }] },
	{
		id: 'delete',
		category: 'edit',
		shortcuts: [
			{ key: 'delete', display: 'Delete' },
			{ key: 'backspace', display: '⌫' }
		]
	},
	{ id: 'fit_canvas', category: 'view', shortcuts: [{ key: '0', primary: true }] },
	{ id: 'zoom_100', category: 'view', shortcuts: [{ key: '1', primary: true }] },
	{ id: 'focus_canvas', category: 'view', shortcuts: [{ key: 'f' }] },
	{ id: 'tool_select', category: 'tools', shortcuts: [{ key: 'v' }] },
	{ id: 'tool_marquee', category: 'tools', shortcuts: [{ key: 'm' }] },
	{ id: 'tool_ellipse_marquee', category: 'tools', shortcuts: [{ key: 'm', shift: true }] },
	{ id: 'tool_lasso', category: 'tools', shortcuts: [{ key: 'l' }] },
	{ id: 'tool_magic_wand', category: 'tools', shortcuts: [{ key: 'w' }] },
	{ id: 'tool_crop', category: 'tools', shortcuts: [{ key: 'c' }] },
	{ id: 'tool_eyedropper', category: 'tools', shortcuts: [{ key: 'i' }] },
	{ id: 'tool_text', category: 'tools', shortcuts: [{ key: 't' }] },
	{ id: 'tool_shape', category: 'tools', shortcuts: [{ key: 'u' }] },
	{
		id: 'tool_pencil',
		category: 'tools',
		shortcuts: [{ key: 'b', display: 'B / P' }, { key: 'p' }]
	},
	{ id: 'tool_eraser', category: 'tools', shortcuts: [{ key: 'e' }] },
	{ id: 'tool_magic_eraser', category: 'tools', shortcuts: [{ key: 'e', shift: true }] },
	{ id: 'tool_bucket', category: 'tools', shortcuts: [{ key: 'g', shift: true }] },
	{ id: 'tool_gradient', category: 'tools', shortcuts: [{ key: 'g' }] },
	{ id: 'tool_hand', category: 'tools', shortcuts: [{ key: 'h' }] },
	{ id: 'tool_zoom', category: 'tools', shortcuts: [{ key: 'z' }] }
] as const;

export function imageEditorCommandForKeyboardEvent(
	event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'isComposing'>
): ImageEditorCommandID | null {
	if (event.isComposing) return null;
	const key = event.key.toLowerCase();
	const primary = event.metaKey || event.ctrlKey;
	for (const command of IMAGE_EDITOR_COMMANDS) {
		for (const shortcut of command.shortcuts) {
			if (
				shortcut.key === key &&
				Boolean(shortcut.primary) === primary &&
				Boolean(shortcut.shift) === event.shiftKey &&
				Boolean(shortcut.alt) === event.altKey
			)
				return command.id;
		}
	}
	return null;
}

export function imageEditorShortcutLabel(
	command: ImageEditorCommandDescriptor,
	primaryLabel: string
): string {
	const shortcut = command.shortcuts[0];
	if (!shortcut) return '';
	if (shortcut.display) return shortcut.display;
	return [
		shortcut.primary ? primaryLabel : '',
		shortcut.shift ? '⇧' : '',
		shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key
	]
		.filter(Boolean)
		.join(' ');
}

export function duplicateImageEditorShortcuts(): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const command of IMAGE_EDITOR_COMMANDS) {
		for (const shortcut of command.shortcuts) {
			const key = [
				shortcut.primary ? 'primary' : '',
				shortcut.shift ? 'shift' : '',
				shortcut.alt ? 'alt' : '',
				shortcut.key
			].join('+');
			if (seen.has(key)) duplicates.add(key);
			else seen.add(key);
		}
	}
	return [...duplicates];
}
