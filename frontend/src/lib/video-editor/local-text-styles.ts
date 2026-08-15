import type { TextStyle } from '@openpost/video-project';

const VIDEO_TEXT_COLOR = /^#[0-9a-f]{3,8}$/iu;

export interface LocalVideoTextStyle {
	id: string;
	name: string;
	style: TextStyle;
}

type StoredTextStyleValue =
	| string
	| number
	| boolean
	| null
	| StoredTextStyleValue[]
	| { [key: string]: StoredTextStyleValue };

function valueEntries(value: StoredTextStyleValue | undefined): Map<string, StoredTextStyleValue> {
	if (value === null || Array.isArray(value) || !(value instanceof Object)) return new Map();
	return new Map(Object.entries(value));
}

function stringValue(value: StoredTextStyleValue | undefined): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

function finiteNumber(value: StoredTextStyleValue | undefined): number | undefined {
	return Number.isFinite(value) ? Number(value) : undefined;
}

function textAlignment(value: StoredTextStyleValue | undefined): TextStyle['align'] | undefined {
	switch (stringValue(value)) {
		case 'left':
			return 'left';
		case 'center':
			return 'center';
		case 'right':
			return 'right';
		default:
			return undefined;
	}
}

function textAnimation(
	value: StoredTextStyleValue | undefined
): TextStyle['animation'] | undefined {
	switch (stringValue(value)) {
		case 'none':
			return 'none';
		case 'fade':
			return 'fade';
		case 'rise':
			return 'rise';
		case 'pop':
			return 'pop';
		case 'typewriter':
			return 'typewriter';
		default:
			return undefined;
	}
}

function parseTextStyle(value: StoredTextStyleValue | undefined): TextStyle | undefined {
	const fields = valueEntries(value);
	const fontFamily = stringValue(fields.get('font_family'));
	const fontSize = finiteNumber(fields.get('font_size'));
	const fontWeight = finiteNumber(fields.get('font_weight'));
	const color = stringValue(fields.get('color'));
	const align = textAlignment(fields.get('align'));
	const backgroundColor = stringValue(fields.get('background_color'));
	const outlineColor = stringValue(fields.get('outline_color'));
	const outlineWidth = finiteNumber(fields.get('outline_width'));
	const shadowBlur = finiteNumber(fields.get('shadow_blur'));
	const animation = textAnimation(fields.get('animation'));
	if (
		!fontFamily ||
		fontSize === undefined ||
		fontSize < 1 ||
		fontSize > 1_000 ||
		fontWeight === undefined ||
		!Number.isInteger(fontWeight) ||
		fontWeight < 100 ||
		fontWeight > 1_000 ||
		!color ||
		!VIDEO_TEXT_COLOR.test(color) ||
		!align ||
		!backgroundColor ||
		!VIDEO_TEXT_COLOR.test(backgroundColor) ||
		!outlineColor ||
		!VIDEO_TEXT_COLOR.test(outlineColor) ||
		outlineWidth === undefined ||
		outlineWidth < 0 ||
		outlineWidth > 100 ||
		shadowBlur === undefined ||
		shadowBlur < 0 ||
		shadowBlur > 1_000 ||
		!animation
	) {
		return undefined;
	}
	return {
		font_family: fontFamily,
		font_size: fontSize,
		font_weight: fontWeight,
		color,
		align,
		background_color: backgroundColor,
		outline_color: outlineColor,
		outline_width: outlineWidth,
		shadow_blur: shadowBlur,
		animation
	};
}

export function parseLocalVideoTextStyles(source: string): LocalVideoTextStyle[] {
	const value: StoredTextStyleValue = JSON.parse(source);
	if (!Array.isArray(value)) return [];
	const styles: LocalVideoTextStyle[] = [];
	for (const entry of value.slice(-12)) {
		const fields = valueEntries(entry);
		const id = stringValue(fields.get('id'));
		const name = stringValue(fields.get('name'));
		const style = parseTextStyle(fields.get('style'));
		if (id && name && style) styles.push({ id, name, style });
	}
	return styles;
}
