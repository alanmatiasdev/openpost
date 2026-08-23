/** Shared text and subtitle rasterization for live preview and export. */

import type { TimelineItem } from '../project/types';
import {
	layoutTextBlock,
	lineInkWidth,
	type LaidOutLine,
	type TextBlockLayout
} from '../typography/text-block-layout';
import { applyCanvasLetterSpacing, createCanvasTextMeasurer } from '../typography/text-measurer';
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
	context.save();
	const layout = layoutTextBlock(item, width, height, createCanvasTextMeasurer(context));
	paintTextBackground(context, item, layout);
	if (item.textShadow) {
		context.shadowColor = item.textShadow.color;
		context.shadowBlur = item.textShadow.blur;
		context.shadowOffsetX = item.textShadow.offsetX;
		context.shadowOffsetY = item.textShadow.offsetY;
	}

	if (
		item.textMotion &&
		frame &&
		isTextMotionActive(item.textMotion, frame.absoluteFrame - item.from, item.durationInFrames)
	) {
		renderMotionText(context, item, layout, width, height, frame.absoluteFrame - item.from);
		context.restore();
		return;
	}
	for (const line of layout.lines) paintLaidOutLine(context, item, line);
	context.restore();
}

function paintTextBackground(
	context: TextRasterContext,
	item: TimelineItem,
	layout: TextBlockLayout
): void {
	if (!item.backgroundColor || !layout.background) return;
	const background = layout.background;
	context.fillStyle = item.backgroundColor;
	context.beginPath();
	if (background.radius > 0) {
		context.roundRect(
			background.x,
			background.y,
			background.width,
			background.height,
			background.radius
		);
	} else {
		context.rect(background.x, background.y, background.width, background.height);
	}
	context.fill();
}

function renderMotionText(
	context: TextRasterContext,
	item: TimelineItem,
	layout: TextBlockLayout,
	width: number,
	height: number,
	relativeFrame: number
): void {
	const spec = item.textMotion;
	if (!spec) return;
	const slot = getActiveTextMotionSlot(spec, relativeFrame, item.durationInFrames);
	const effect = slot ? spec[slot] : undefined;
	if (!effect) {
		for (const line of layout.lines) paintLaidOutLine(context, item, line);
		return;
	}
	const unit = effect.unit ?? getTextMotionPreset(effect.presetId).unit;
	const segmentation = segmentTextUnits(
		layout.lines.map((line) => line.text),
		unit
	);
	for (const [lineIndex, line] of layout.lines.entries()) {
		if (!line.text) continue;
		context.font = line.cssFont;
		applyCanvasLetterSpacing(context, 0);
		const runColors = line.runs?.flatMap((run) => Array.from(run.text, () => run.color));
		let currentX = line.startX;
		let characterIndex = 0;
		for (const character of line.text) {
			const glyphWidth = context.measureText(character).width;
			const unitIndex = segmentation.lineUnitIndices[lineIndex]?.[characterIndex];
			if (character !== ' ' && unitIndex !== null && unitIndex !== undefined) {
				const motion = evaluateGlyphMotion(spec, {
					relativeFrame,
					durationInFrames: item.durationInFrames,
					unitIndex,
					unitCount: segmentation.unitCount,
					fontSize: line.fontSize,
					boxWidth: width,
					boxHeight: height
				});
				if (!motion || motion.alpha > 0) {
					drawMotionGlyph(
						context,
						item,
						line,
						character,
						currentX,
						glyphWidth,
						motion,
						runColors?.[characterIndex]
					);
				}
			}
			currentX += glyphWidth + line.letterSpacing;
			characterIndex += 1;
		}
		if (line.underline) drawUnderline(context, line, line.startX, line.baselineY);
	}
}

function paintLaidOutLine(context: TextRasterContext, item: TimelineItem, line: LaidOutLine): void {
	if (!line.text) return;
	context.font = line.cssFont;
	context.textAlign = 'left';
	context.textBaseline = 'alphabetic';
	applyCanvasLetterSpacing(context, line.letterSpacing);
	if ((item.strokeWidth ?? 0) > 0) {
		context.strokeStyle = item.strokeColor ?? '#000000';
		context.lineWidth = (item.strokeWidth ?? 0) * 2;
		context.lineJoin = 'round';
		context.strokeText(line.text, line.startX, line.baselineY);
	}
	if (!line.runs?.length) {
		context.fillStyle = line.color;
		context.fillText(line.text, line.startX, line.baselineY);
		if (line.underline) drawUnderline(context, line, line.startX, line.baselineY);
		return;
	}
	for (const run of line.runs) {
		context.fillStyle = run.color;
		context.fillText(run.text, line.startX + run.offsetX, line.baselineY);
		if (run.underline) {
			drawUnderline(
				context,
				{ ...line, width: run.width, color: run.color },
				line.startX + run.offsetX,
				line.baselineY
			);
		}
	}
}

function drawMotionGlyph(
	context: TextRasterContext,
	item: TimelineItem,
	line: LaidOutLine,
	character: string,
	x: number,
	advance: number,
	motion: ReturnType<typeof evaluateGlyphMotion>,
	color?: string
): void {
	context.save();
	if (motion) {
		const centerX = x + advance / 2;
		const centerY = line.baselineY - line.fontSize * 0.3;
		context.translate(motion.dx, motion.dy);
		context.translate(centerX, centerY);
		if (motion.rotation !== 0) context.rotate(motion.rotation);
		if (motion.scale !== 1) context.scale(motion.scale, motion.scale);
		context.translate(-centerX, -centerY);
		context.globalAlpha *= motion.alpha;
		if (motion.soften > 0) context.filter = `blur(${motion.soften}px)`;
	}
	context.font = line.cssFont;
	context.textAlign = 'left';
	context.textBaseline = 'alphabetic';
	context.fillStyle = color ?? line.color;
	if ((item.strokeWidth ?? 0) > 0) {
		context.strokeStyle = item.strokeColor ?? '#000000';
		context.lineWidth = (item.strokeWidth ?? 0) * 2;
		context.lineJoin = 'round';
		context.strokeText(character, x, line.baselineY);
	}
	context.fillText(character, x, line.baselineY);
	context.restore();
}

function drawUnderline(
	context: TextRasterContext,
	line: LaidOutLine,
	x: number,
	baselineY: number
): void {
	const thickness = Math.max(1, line.fontSize * 0.055);
	context.fillStyle = line.color;
	context.fillRect(x, baselineY + Math.max(1, line.fontSize * 0.08), lineInkWidth(line), thickness);
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
