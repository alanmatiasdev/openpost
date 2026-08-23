/** Geometry shared by preview and export. Ported from FreeCut (MIT). */
import type { TimelineItem } from '$lib/video-editor/project/types';

export interface MediaDrawGeometry {
	centerX: number;
	centerY: number;
	drawWidth: number;
	drawHeight: number;
	sourceX: number;
	sourceY: number;
	sourceWidth: number;
	sourceHeight: number;
	anchorX: number;
	anchorY: number;
}

/** Scale project-space geometry and text metrics to a different export size. */
export function scaleItemForCanvas(
	item: TimelineItem,
	scaleX: number,
	scaleY: number
): TimelineItem {
	const radiusScale = Math.min(scaleX, scaleY);
	const transform = item.transform;
	return {
		...item,
		transform: transform
			? {
					...transform,
					x: transform.x === undefined ? undefined : transform.x * scaleX,
					y: transform.y === undefined ? undefined : transform.y * scaleY,
					width: transform.width === undefined ? undefined : transform.width * scaleX,
					height: transform.height === undefined ? undefined : transform.height * scaleY,
					anchorX: transform.anchorX === undefined ? undefined : transform.anchorX * scaleX,
					anchorY: transform.anchorY === undefined ? undefined : transform.anchorY * scaleY,
					cornerRadius:
						transform.cornerRadius === undefined ? undefined : transform.cornerRadius * radiusScale
				}
			: undefined,
		fontSize: item.fontSize === undefined ? undefined : item.fontSize * scaleY,
		letterSpacing: item.letterSpacing === undefined ? undefined : item.letterSpacing * scaleX,
		strokeWidth: item.strokeWidth === undefined ? undefined : item.strokeWidth * radiusScale,
		shapeCornerRadius:
			item.shapeCornerRadius === undefined ? undefined : item.shapeCornerRadius * radiusScale,
		maskFeather: item.maskFeather === undefined ? undefined : item.maskFeather * radiusScale,
		paddingX: item.paddingX === undefined ? undefined : item.paddingX * scaleX,
		paddingY: item.paddingY === undefined ? undefined : item.paddingY * scaleY,
		borderRadius: item.borderRadius === undefined ? undefined : item.borderRadius * radiusScale,
		textShadow: item.textShadow
			? {
					...item.textShadow,
					blur: item.textShadow.blur * radiusScale,
					offsetX: item.textShadow.offsetX * scaleX,
					offsetY: item.textShadow.offsetY * scaleY
				}
			: undefined
	};
}

export function mediaDrawGeometry(
	item: TimelineItem,
	sourceWidth: number,
	sourceHeight: number,
	canvasWidth: number,
	canvasHeight: number
): MediaDrawGeometry {
	const transform = item.transform ?? {};
	const fit = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
	const defaultWidth = sourceWidth * fit;
	const defaultHeight = sourceHeight * fit;
	const drawWidth = Math.max(1, transform.width ?? defaultWidth);
	const drawHeight = Math.max(1, transform.height ?? defaultHeight);
	const crop = item.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
	const left = clampFraction(crop.left);
	const right = clampFraction(crop.right);
	const top = clampFraction(crop.top);
	const bottom = clampFraction(crop.bottom);
	const sourceX = sourceWidth * left;
	const sourceY = sourceHeight * top;
	return {
		centerX: canvasWidth / 2 + (transform.x ?? 0),
		centerY: canvasHeight / 2 + (transform.y ?? 0),
		drawWidth,
		drawHeight,
		sourceX,
		sourceY,
		sourceWidth: Math.max(1, sourceWidth * Math.max(0.001, 1 - left - right)),
		sourceHeight: Math.max(1, sourceHeight * Math.max(0.001, 1 - top - bottom)),
		anchorX: transform.anchorX ?? drawWidth / 2,
		anchorY: transform.anchorY ?? drawHeight / 2
	};
}

function clampFraction(value: number | undefined): number {
	return Math.min(0.999, Math.max(0, value ?? 0));
}
