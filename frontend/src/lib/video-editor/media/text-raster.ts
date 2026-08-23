/** Shared text and subtitle rasterization for live preview and export. */

import type { TimelineItem } from '../project/types';
import {
	evaluateGlyphMotion,
	getActiveTextMotionSlot,
	isTextMotionActive
} from '../timeline/text-motion-eval';
import { getTextMotionPreset } from '../timeline/text-motion-presets';
import { segmentTextUnits } from '../timeline/text-motion-segmentation';

export type TextRasterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface TextRasterFrame {
	absoluteFrame: number;
}

export function renderTextItemRaster(
	context: TextRasterContext,
	item: TimelineItem,
	width: number,
	height: number,
	frame?: TextRasterFrame
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
	if (
		item.textMotion &&
		frame &&
		isTextMotionActive(item.textMotion, frame.absoluteFrame - item.from, item.durationInFrames)
	) {
		renderMotionText(context, item, lines, {
			width,
			height,
			contentWidth,
			fontSize,
			lineHeight,
			firstY,
			relativeFrame: frame.absoluteFrame - item.from
		});
		context.restore();
		return;
	}
	for (const [index, line] of lines.entries()) {
		const y = firstY + index * lineHeight;
		if ((item.strokeWidth ?? 0) > 0) context.strokeText(line, x, y, contentWidth);
		context.fillText(line, x, y, contentWidth);
	}
	context.restore();
}

interface MotionTextLayout {
	width: number;
	height: number;
	contentWidth: number;
	fontSize: number;
	lineHeight: number;
	firstY: number;
	relativeFrame: number;
}

function renderMotionText(
	context: TextRasterContext,
	item: TimelineItem,
	lines: readonly string[],
	layout: MotionTextLayout
): void {
	const spec = item.textMotion;
	if (!spec) return;
	const slot = getActiveTextMotionSlot(spec, layout.relativeFrame, item.durationInFrames);
	const effect = slot ? spec[slot] : undefined;
	if (!effect) {
		renderSettledLines(context, item, lines, layout);
		return;
	}
	const unit = effect.unit ?? getTextMotionPreset(effect.presetId).unit;
	const segmentation = segmentTextUnits(lines, unit);
	const letterSpacing = item.letterSpacing ?? 0;
	if ('letterSpacing' in context) context.letterSpacing = '0px';
	for (const [lineIndex, line] of lines.entries()) {
		const characters = Array.from(line);
		const advances = characters.map((character) => context.measureText(character).width);
		const naturalWidth =
			advances.reduce((total, advance) => total + advance, 0) +
			Math.max(0, characters.length - 1) * letterSpacing;
		const scaleX = naturalWidth > layout.contentWidth ? layout.contentWidth / naturalWidth : 1;
		const drawnWidth = naturalWidth * scaleX;
		const startX =
			item.textAlign === 'left'
				? Math.max(0, item.paddingX ?? 0)
				: item.textAlign === 'right'
					? layout.width - Math.max(0, item.paddingX ?? 0) - drawnWidth
					: (layout.width - drawnWidth) / 2;
		const y = layout.firstY + lineIndex * layout.lineHeight;
		let measuredX = 0;
		for (const [characterIndex, character] of characters.entries()) {
			const glyphWidth = advances[characterIndex] ?? 0;
			const unitIndex = segmentation.lineUnitIndices[lineIndex]?.[characterIndex];
			if (unitIndex !== null && unitIndex !== undefined) {
				const motion = evaluateGlyphMotion(spec, {
					relativeFrame: layout.relativeFrame,
					durationInFrames: item.durationInFrames,
					unitIndex,
					unitCount: segmentation.unitCount,
					fontSize: layout.fontSize,
					boxWidth: layout.width,
					boxHeight: layout.height
				});
				drawMotionGlyph(
					context,
					item,
					character,
					startX + (measuredX + glyphWidth / 2) * scaleX,
					y,
					scaleX,
					motion
				);
			}
			measuredX += glyphWidth + letterSpacing;
		}
	}
}

function renderSettledLines(
	context: TextRasterContext,
	item: TimelineItem,
	lines: readonly string[],
	layout: MotionTextLayout
): void {
	const x =
		item.textAlign === 'left'
			? Math.max(0, item.paddingX ?? 0)
			: item.textAlign === 'right'
				? layout.width - Math.max(0, item.paddingX ?? 0)
				: layout.width / 2;
	for (const [index, line] of lines.entries()) {
		const y = layout.firstY + index * layout.lineHeight;
		if ((item.strokeWidth ?? 0) > 0) context.strokeText(line, x, y, layout.contentWidth);
		context.fillText(line, x, y, layout.contentWidth);
	}
}

function drawMotionGlyph(
	context: TextRasterContext,
	item: TimelineItem,
	character: string,
	x: number,
	y: number,
	lineScaleX: number,
	motion: ReturnType<typeof evaluateGlyphMotion>
): void {
	context.save();
	context.translate(x + (motion?.dx ?? 0), y + (motion?.dy ?? 0));
	context.rotate(motion?.rotation ?? 0);
	context.scale((motion?.scale ?? 1) * lineScaleX, motion?.scale ?? 1);
	context.globalAlpha *= motion?.alpha ?? 1;
	context.textAlign = 'center';
	if (motion && motion.soften > 0) context.filter = `blur(${motion.soften}px)`;
	if ((item.strokeWidth ?? 0) > 0) context.strokeText(character, 0, 0);
	context.fillText(character, 0, 0);
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
