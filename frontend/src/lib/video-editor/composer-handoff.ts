import { effectiveVideoConstraints } from '$lib/video/constraints';
import type { VideoConstraint } from '$lib/video/types';

export type VideoVariantID = 'portrait' | 'feed-portrait' | 'square' | 'landscape';

export interface VideoHandoffTarget {
	account_id: string;
	rendition_id?: string;
	output_profile: string;
	aspect_ratios: string[];
}

export interface VideoHandoffPlan {
	primary_variant: VideoVariantID;
	required_variants: VideoVariantID[];
	variant_renditions: VariantAssignments;
	variant_accounts: VariantAssignments;
}

export interface VariantAssignments {
	portrait: string[];
	'feed-portrait': string[];
	square: string[];
	landscape: string[];
}

export interface VideoReturnConstraintOverrides {
	thread_segment?: number;
	replace_media_id?: string;
}

export interface VideoReturnConstraints extends VideoReturnConstraintOverrides {
	[key: string]: string | number | string[] | undefined;
	allowed_mimes: string[];
	max_duration_ms?: number;
	max_file_size_bytes?: number;
	required_variants: VideoVariantID[];
	rendition_ids: string[];
}

const variants: Array<{ id: VideoVariantID; ratio: number }> = [
	{ id: 'portrait', ratio: 9 / 16 },
	{ id: 'feed-portrait', ratio: 4 / 5 },
	{ id: 'square', ratio: 1 },
	{ id: 'landscape', ratio: 16 / 9 }
];

function ratioValue(value: string): number | null {
	const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? width / height : null;
}

function closestVariant(ratio: number): VideoVariantID {
	return variants.reduce((best, candidate) =>
		Math.abs(Math.log(candidate.ratio / ratio)) < Math.abs(Math.log(best.ratio / ratio))
			? candidate
			: best
	).id;
}

function profilePreference(outputProfile: string): VideoVariantID | null {
	const profile = outputProfile.toLowerCase();
	if (/(?:story|reel|short|tiktok)/u.test(profile)) return 'portrait';
	if (/(?:feed-portrait|portrait-feed)/u.test(profile)) return 'feed-portrait';
	if (/(?:youtube\.video|landscape)/u.test(profile)) return 'landscape';
	return null;
}

function chooseTargetVariant(target: VideoHandoffTarget, sourceRatio: number): VideoVariantID {
	const allowed = target.aspect_ratios
		.map(ratioValue)
		.filter((value): value is number => value !== null)
		.map(closestVariant);
	const candidates = variants.filter(
		(candidate) => allowed.length === 0 || allowed.includes(candidate.id)
	);
	const preferred = profilePreference(target.output_profile);
	return candidates.reduce((best, candidate) => {
		const score =
			Math.abs(Math.log(candidate.ratio / sourceRatio)) +
			(preferred && candidate.id !== preferred ? 2 : 0);
		const bestScore =
			Math.abs(Math.log(best.ratio / sourceRatio)) + (preferred && best.id !== preferred ? 2 : 0);
		return score < bestScore ? candidate : best;
	}).id;
}

export function planVideoComposerHandoff(
	targets: VideoHandoffTarget[],
	source: { width?: number; height?: number } = {}
): VideoHandoffPlan {
	const sourceWidth = source.width ?? 0;
	const sourceHeight = source.height ?? 0;
	const sourceRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 9 / 16;
	const assignments = targets.map((target) => ({
		target,
		variant: chooseTargetVariant(target, sourceRatio)
	}));
	const required = Array.from(new Set(assignments.map((assignment) => assignment.variant)));
	if (required.length === 0) required.push(closestVariant(sourceRatio));
	const primary = required.reduce((best, candidate) => {
		const candidateRatio = variants.find((variant) => variant.id === candidate)?.ratio ?? 1;
		const bestRatio = variants.find((variant) => variant.id === best)?.ratio ?? 1;
		return Math.abs(Math.log(candidateRatio / sourceRatio)) <
			Math.abs(Math.log(bestRatio / sourceRatio))
			? candidate
			: best;
	});
	const variantRenditions = emptyVariantAssignments();
	const variantAccounts = emptyVariantAssignments();
	for (const assignment of assignments) {
		variantAccounts[assignment.variant].push(assignment.target.account_id);
		if (assignment.target.rendition_id) {
			variantRenditions[assignment.variant].push(assignment.target.rendition_id);
		}
	}
	return {
		primary_variant: primary,
		required_variants: required,
		variant_renditions: variantRenditions,
		variant_accounts: variantAccounts
	};
}

export function videoReturnConstraints(
	constraints: VideoConstraint[],
	plan: VideoHandoffPlan,
	extra: VideoReturnConstraintOverrides = {}
): VideoReturnConstraints {
	const effective = effectiveVideoConstraints(constraints);
	const result: VideoReturnConstraints = {
		allowed_mimes: effective.allowedMIMEs,
		required_variants: plan.required_variants,
		rendition_ids: Object.values(plan.variant_renditions).flat()
	};
	if (Number.isFinite(effective.maxDurationSeconds)) {
		result.max_duration_ms = Math.round(effective.maxDurationSeconds * 1_000);
	}
	if (Number.isFinite(effective.maxBytes)) result.max_file_size_bytes = effective.maxBytes;
	if (extra.thread_segment !== undefined) result.thread_segment = extra.thread_segment;
	if (extra.replace_media_id !== undefined) result.replace_media_id = extra.replace_media_id;
	return result;
}

function emptyVariantAssignments(): VariantAssignments {
	return {
		portrait: [],
		'feed-portrait': [],
		square: [],
		landscape: []
	};
}

export function replaceOrAppendMediaID(
	current: string[],
	replaceID: string | undefined,
	replacementID: string,
	limit: number
): string[] {
	const next =
		replaceID && current.includes(replaceID)
			? current.map((id) => (id === replaceID ? replacementID : id))
			: [...current, replacementID];
	return Array.from(new Set(next.filter(Boolean))).slice(0, Math.max(1, limit));
}
