/** CPU-baked RGB curves LUT. Ported from FreeCut (MIT). */
import type { GpuParamSchema, GpuParamValues, GpuShaderDefinition } from './types';

interface Point {
	x: number;
	y: number;
}
const CHANNELS = ['master', 'red', 'green', 'blue'] as const;
const defaults = { shadowX: 0.25, shadowY: 0.25, highlightX: 0.75, highlightY: 0.75 };

const schema: GpuParamSchema[] = CHANNELS.flatMap((channel) => {
	const label = `${channel.slice(0, 1).toUpperCase()}${channel.slice(1)}`;
	return [
		{
			name: `${channel}ShadowX`,
			label: `${label} shadow X`,
			min: 0.02,
			max: 0.94,
			step: 0.01,
			default: defaults.shadowX
		},
		{
			name: `${channel}ShadowY`,
			label: `${label} shadow Y`,
			min: 0,
			max: 1,
			step: 0.01,
			default: defaults.shadowY
		},
		{
			name: `${channel}HighlightX`,
			label: `${label} highlight X`,
			min: 0.06,
			max: 0.98,
			step: 0.01,
			default: defaults.highlightX
		},
		{
			name: `${channel}HighlightY`,
			label: `${label} highlight Y`,
			min: 0,
			max: 1,
			step: 0.01,
			default: defaults.highlightY
		}
	];
});

export const curves: GpuShaderDefinition = {
	id: 'gpu-curves',
	label: 'Curves',
	category: 'color',
	entryPoint: 'curvesFragment',
	fragmentSource: `
uniform sampler2D uDataTex;
vec3 sampleCurveLut(float value) {
  float u = (clamp(value, 0.0, 1.0) * 255.0 + 0.5) / 256.0;
  return texture(uDataTex, vec2(u, 0.5)).rgb;
}
vec4 curvesFragment(vec2 vUv) {
  vec4 color = texture(uInputTex, vUv);
  return vec4(sampleCurveLut(color.r).r, sampleCurveLut(color.g).g, sampleCurveLut(color.b).b, color.a);
}`,
	schema,
	uniformValues: () => ({}),
	dataTexture: {
		key: (params) => schema.map((entry) => params[entry.name] ?? entry.default).join('|'),
		build: (params) => ({ width: 256, height: 1, data: buildCurvesLut(params) })
	}
};

export function buildCurvesLut(params: GpuParamValues): Uint8Array {
	const channelPoints = new Map(CHANNELS.map((channel) => [channel, pointsFor(params, channel)]));
	const data = new Uint8Array(256 * 4);
	for (let index = 0; index < 256; index++) {
		const input = index / 255;
		const master = evaluateMonotoneCurve(channelPoints.get('master'), input);
		data[index * 4] = Math.round(evaluateMonotoneCurve(channelPoints.get('red'), master) * 255);
		data[index * 4 + 1] = Math.round(
			evaluateMonotoneCurve(channelPoints.get('green'), master) * 255
		);
		data[index * 4 + 2] = Math.round(
			evaluateMonotoneCurve(channelPoints.get('blue'), master) * 255
		);
		data[index * 4 + 3] = 255;
	}
	return data;
}

function pointsFor(params: GpuParamValues, channel: (typeof CHANNELS)[number]): Point[] {
	return [
		{ x: 0, y: 0 },
		{
			x: finite(params[`${channel}ShadowX`], defaults.shadowX),
			y: finite(params[`${channel}ShadowY`], defaults.shadowY)
		},
		{
			x: finite(params[`${channel}HighlightX`], defaults.highlightX),
			y: finite(params[`${channel}HighlightY`], defaults.highlightY)
		},
		{ x: 1, y: 1 }
	].toSorted((left, right) => left.x - right.x);
}

function finite(value: string | number | undefined, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

export function evaluateMonotoneCurve(points: Point[] | undefined, inputValue: number): number {
	const source = points?.length
		? points
		: [
				{ x: 0, y: 0 },
				{ x: 1, y: 1 }
			];
	const input = clamp(inputValue);
	const slopes = source.slice(0, -1).map((point, index) => {
		const next = source[index + 1] ?? point;
		return (next.y - point.y) / Math.max(0.000001, next.x - point.x);
	});
	const tangents = source.map((_, index) => {
		if (index === 0) return slopes[0] ?? 0;
		if (index === source.length - 1) return slopes[index - 1] ?? 0;
		const previous = slopes[index - 1] ?? 0;
		const next = slopes[index] ?? 0;
		return previous * next <= 0 ? 0 : (previous + next) / 2;
	});
	for (let index = 0; index < slopes.length; index++) {
		const slope = slopes[index] ?? 0;
		if (Math.abs(slope) < 0.000001) {
			tangents[index] = 0;
			tangents[index + 1] = 0;
			continue;
		}
		const a = (tangents[index] ?? 0) / slope;
		const b = (tangents[index + 1] ?? 0) / slope;
		if (a * a + b * b > 9) {
			const scale = 3 / Math.sqrt(a * a + b * b);
			tangents[index] = scale * a * slope;
			tangents[index + 1] = scale * b * slope;
		}
	}
	let segment = source.length - 2;
	for (let index = 0; index < source.length - 1; index++) {
		if (input <= (source[index + 1]?.x ?? 1)) {
			segment = index;
			break;
		}
	}
	const left = source[segment] ?? source[0];
	const right = source[segment + 1] ?? left;
	const width = Math.max(0.000001, right.x - left.x);
	const t = clamp((input - left.x) / width);
	const t2 = t * t;
	const t3 = t2 * t;
	return clamp(
		(2 * t3 - 3 * t2 + 1) * left.y +
			(t3 - 2 * t2 + t) * width * (tangents[segment] ?? 0) +
			(-2 * t3 + 3 * t2) * right.y +
			(t3 - t2) * width * (tangents[segment + 1] ?? 0)
	);
}

function clamp(value: number): number {
	return Math.max(0, Math.min(1, value));
}
