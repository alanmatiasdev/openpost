import type { GradeEffectSnapshot, PickedColor } from './color-grade';
import type { GpuEffect, ItemEffect } from './types';
import type { GpuParamValues } from './gpu/types';

export type ColorComparisonMode = 'after' | 'before' | 'split';
export type ColorPickerKind = 'white-balance' | 'black-point' | 'white-point';

export interface ActiveColorPicker {
	itemId: string;
	kind: ColorPickerKind;
}

export interface ColorEffectDraft {
	itemId: string;
	effectIds: string[];
	params: GpuParamValues;
}

let comparisonMode = $state<ColorComparisonMode>('after');
let splitPosition = $state(0.5);
let activePicker = $state<ActiveColorPicker | null>(null);
let pickerResolver: ((color: PickedColor | null) => void) | null = null;
let gradeClipboard = $state<GradeEffectSnapshot[] | null>(null);
let frameCaptureItemId = $state<string | null>(null);
let frameCaptureResolver: ((image: ImageData | null) => void) | null = null;
let frameCaptureTimeout: ReturnType<typeof setTimeout> | null = null;
let effectDraft = $state<ColorEffectDraft | null>(null);

function cloneGrade(grade: readonly GradeEffectSnapshot[]): GradeEffectSnapshot[] {
	return grade.map((entry) => ({
		...entry,
		params: { ...entry.params }
	}));
}

export const colorPreviewStore = {
	get comparisonMode() {
		return comparisonMode;
	},
	get splitPosition() {
		return splitPosition;
	},
	get activePicker() {
		return activePicker;
	},
	get gradeClipboard() {
		return gradeClipboard;
	},
	get frameCaptureItemId() {
		return frameCaptureItemId;
	},
	get effectDraft() {
		return effectDraft;
	},
	setComparisonMode(mode: ColorComparisonMode): void {
		comparisonMode = mode;
	},
	setSplitPosition(position: number): void {
		splitPosition = Math.max(0.05, Math.min(0.95, position));
	},
	requestPick(itemId: string, kind: ColorPickerKind): Promise<PickedColor | null> {
		this.cancelPick();
		activePicker = { itemId, kind };
		return new Promise((resolve) => {
			pickerResolver = resolve;
		});
	},
	resolvePick(color: PickedColor): void {
		const resolve = pickerResolver;
		pickerResolver = null;
		activePicker = null;
		resolve?.(color);
	},
	cancelPick(): void {
		const resolve = pickerResolver;
		pickerResolver = null;
		activePicker = null;
		resolve?.(null);
	},
	requestFrameCapture(itemId: string): Promise<ImageData | null> {
		this.cancelFrameCapture();
		frameCaptureItemId = itemId;
		return new Promise((resolve) => {
			frameCaptureResolver = resolve;
			frameCaptureTimeout = setTimeout(() => this.cancelFrameCapture(), 1500);
		});
	},
	resolveFrameCapture(itemId: string, image: ImageData): void {
		if (frameCaptureItemId !== itemId) return;
		const resolve = frameCaptureResolver;
		if (frameCaptureTimeout) clearTimeout(frameCaptureTimeout);
		frameCaptureTimeout = null;
		frameCaptureResolver = null;
		frameCaptureItemId = null;
		resolve?.(image);
	},
	cancelFrameCapture(): void {
		const resolve = frameCaptureResolver;
		if (frameCaptureTimeout) clearTimeout(frameCaptureTimeout);
		frameCaptureTimeout = null;
		frameCaptureResolver = null;
		frameCaptureItemId = null;
		resolve?.(null);
	},
	copyGrade(grade: readonly GradeEffectSnapshot[]): void {
		gradeClipboard = cloneGrade(grade);
	},
	clearGradeClipboard(): void {
		gradeClipboard = null;
	},
	setEffectDraft(
		itemId: string,
		effect: GpuEffect,
		params: GpuParamValues,
		effectIds: readonly string[] = [effect.id]
	): void {
		effectDraft = {
			itemId,
			effectIds: [...new Set([effect.id, ...effectIds])],
			params: { ...effect.params, ...params }
		};
	},
	clearEffectDraft(itemId?: string, effectId?: string): void {
		if (
			effectDraft &&
			(itemId === undefined || effectDraft.itemId === itemId) &&
			(effectId === undefined || effectDraft.effectIds.includes(effectId))
		) {
			effectDraft = null;
		}
	},
	applyEffectDraft(_itemId: string, effects: readonly ItemEffect[]): ItemEffect[] {
		const draft = effectDraft;
		if (!draft) return [...effects];
		return effects.map((effect) =>
			draft.effectIds.includes(effect.id) && effect.type === 'gpu'
				? { ...effect, params: { ...draft.params } }
				: effect
		);
	},
	__resetForTesting(): void {
		this.cancelPick();
		this.cancelFrameCapture();
		comparisonMode = 'after';
		splitPosition = 0.5;
		gradeClipboard = null;
		effectDraft = null;
	}
};
