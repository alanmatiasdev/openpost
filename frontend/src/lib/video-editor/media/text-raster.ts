/** Shared text and subtitle rasterization for live preview and export. */

import type { TimelineItem } from '../project/types';

export type TextRasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function renderTextItemRaster(
	context: TextRasterContext,
	item: TimelineItem,
	width: number,
	height: number
): void {
	context.clearRect(0, 0, width, height);
	const fontSize = item.fontSize ?? Math.round(height / 15);
	const paddingX = Math.max(0, item.paddingX ?? 0);
	const paddingY = Math.max(0, item.paddingY ?? 0);
	const contentWidth = Math.max(1, width - paddingX * 2);
	const lines = (item.text ?? item.label).split('\n');
	const lineHeight = fontSize * (item.lineHeight ?? 1.2);
	const blockHeight = lines.length * lineHeight;

	context.save();
	if (item.backgroundColor) {
		context.fillStyle = item.backgroundColor;
		context.beginPath();
		const radius = Math.max(0, item.borderRadius ?? 0);
		if (radius > 0 && 'roundRect' in context) context.roundRect(0, 0, width, height, radius);
		else context.rect(0, 0, width, height);
		context.fill();
	}
	context.font = `${item.fontWeight ?? 600} ${fontSize}px ${item.fontFamily ?? 'sans-serif'}`;
	if ('letterSpacing' in context) context.letterSpacing = `${item.letterSpacing ?? 0}px`;
	context.textAlign = item.textAlign ?? 'center';
	context.textBaseline = 'middle';
	context.fillStyle = item.color ?? '#ffffff';
	context.strokeStyle = item.strokeColor ?? '#000000';
	context.lineWidth = item.strokeWidth ?? 0;
	if (item.textShadow) {
		context.shadowColor = item.textShadow.color;
		context.shadowBlur = item.textShadow.blur;
		context.shadowOffsetX = item.textShadow.offsetX;
		context.shadowOffsetY = item.textShadow.offsetY;
	}

	const x =
		item.textAlign === 'left'
			? paddingX
			: item.textAlign === 'right'
				? width - paddingX
				: width / 2;
	const firstY =
		item.verticalAlign === 'top'
			? paddingY + lineHeight / 2
			: item.verticalAlign === 'bottom'
				? height - paddingY - blockHeight + lineHeight / 2
				: (height - blockHeight) / 2 + lineHeight / 2;
	for (const [index, line] of lines.entries()) {
		const y = firstY + index * lineHeight;
		if ((item.strokeWidth ?? 0) > 0) context.strokeText(line, x, y, contentWidth);
		context.fillText(line, x, y, contentWidth);
	}
	context.restore();
}

export function renderSubtitleRaster(
	context: TextRasterContext,
	text: string,
	item: TimelineItem,
	width: number,
	height: number
): void {
	context.clearRect(0, 0, width, height);
	const fontSize = (height / 18) * (item.subtitleStyleScale ?? 1);
	const lines = text.split('\n');
	const lineHeight = fontSize * 1.25;
	const bottomOffset = height * 0.05;
	context.save();
	context.font = `600 ${fontSize}px sans-serif`;
	context.textAlign = 'center';
	context.textBaseline = 'bottom';
	context.shadowColor = 'rgba(0, 0, 0, 0.9)';
	context.shadowBlur = fontSize / 6;
	context.shadowOffsetY = Math.max(2, fontSize / 24);
	context.fillStyle = '#ffffff';
	for (const [index, line] of lines.entries()) {
		const y = height - bottomOffset - (lines.length - 1 - index) * lineHeight;
		context.fillText(line, width / 2, y, width * 0.9);
	}
	context.restore();
}
