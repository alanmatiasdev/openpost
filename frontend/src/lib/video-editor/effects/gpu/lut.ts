/** Adobe/Resolve .cube parser and WebGL LUT effect. Ported from FreeCut (MIT). */
import type { GpuParamValues, GpuShaderDefinition } from './types';

export interface EncodedCubeLut {
	size: number;
	data: string;
}

export function encodeCubeLut(text: string): EncodedCubeLut {
	let size = 0;
	let domainMin = [0, 0, 0];
	let domainMax = [1, 1, 1];
	const values: number[][] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue;
		const parts = line.split(/\s+/);
		if (parts[0] === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported.');
		if (parts[0] === 'LUT_3D_SIZE') {
			size = Number.parseInt(parts[1] ?? '', 10);
			continue;
		}
		if (parts[0] === 'DOMAIN_MIN') {
			domainMin = parts.slice(1, 4).map(Number);
			continue;
		}
		if (parts[0] === 'DOMAIN_MAX') {
			domainMax = parts.slice(1, 4).map(Number);
			continue;
		}
		if (/^[+-.\d]/.test(line)) values.push(parts.slice(0, 3).map(Number));
	}
	if (!Number.isInteger(size) || size < 2 || size > 64)
		throw new Error('LUT_3D_SIZE must be between 2 and 64.');
	if (values.length !== size ** 3)
		throw new Error(`Expected ${size ** 3} LUT entries, got ${values.length}.`);
	const packed = new Uint8Array(size ** 3 * 4);
	for (const [index, triple] of values.entries()) {
		for (let channel = 0; channel < 3; channel++) {
			const low = domainMin[channel] ?? 0;
			const high = domainMax[channel] ?? 1;
			const value = triple[channel];
			if (value === undefined || !Number.isFinite(value))
				throw new Error(`Invalid LUT value at entry ${index + 1}.`);
			packed[index * 4 + channel] = Math.round(
				Math.max(0, Math.min(1, (value - low) / Math.max(0.000001, high - low))) * 255
			);
		}
		packed[index * 4 + 3] = 255;
	}
	return { size, data: bytesToBase64(packed) };
}

export const lut: GpuShaderDefinition = {
	id: 'gpu-lut',
	label: '3D LUT',
	category: 'color',
	entryPoint: 'lutFragment',
	fragmentSource: `
uniform sampler2D uDataTex;
uniform float u_lutSize;
uniform float u_intensity;
vec3 lutSample(vec3 color) {
  float size = max(2.0, u_lutSize);
  vec3 p = clamp(color, 0.0, 1.0) * (size - 1.0);
  float z0 = floor(p.b); float z1 = min(z0 + 1.0, size - 1.0); float fz = fract(p.b);
  vec2 uv0 = vec2((p.r + z0 * size + 0.5) / (size * size), (p.g + 0.5) / size);
  vec2 uv1 = vec2((p.r + z1 * size + 0.5) / (size * size), (p.g + 0.5) / size);
  return mix(texture(uDataTex, uv0).rgb, texture(uDataTex, uv1).rgb, fz);
}
vec4 lutFragment(vec2 vUv) { vec4 source = texture(uInputTex, vUv); return vec4(mix(source.rgb, lutSample(source.rgb), u_intensity), source.a); }`,
	schema: [{ name: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 1 }],
	uniformValues: (params) => ({
		u_lutSize: numeric(params.lutSize, 2),
		u_intensity: numeric(params.intensity, 1)
	}),
	dataTexture: {
		key: (params) => String(params.lutData ?? ''),
		build: (params) => {
			const size = numeric(params.lutSize, 2);
			const encoded = String(params.lutData ?? '');
			const data = encoded ? base64ToBytes(encoded) : identityLut(size);
			return { width: size * size, height: size, data };
		}
	}
};

function numeric(value: string | number | undefined, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}
function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function identityLut(size: number): Uint8Array {
	const data = new Uint8Array(size ** 3 * 4);
	let offset = 0;
	for (let blue = 0; blue < size; blue++)
		for (let green = 0; green < size; green++)
			for (let red = 0; red < size; red++) {
				data[offset++] = Math.round((red / (size - 1)) * 255);
				data[offset++] = Math.round((green / (size - 1)) * 255);
				data[offset++] = Math.round((blue / (size - 1)) * 255);
				data[offset++] = 255;
			}
	return data;
}
