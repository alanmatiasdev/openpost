/** CPU scope bins for the live grading panel. Ported from FreeCut (MIT). */
export interface ScopeBins {
	histogram: { red: Uint32Array; green: Uint32Array; blue: Uint32Array; luma: Uint32Array };
	vectorscope: Uint32Array;
	waveform: Uint32Array;
}

export function buildScopeBins(data: Uint8ClampedArray, width: number, height: number): ScopeBins {
	const red = new Uint32Array(256);
	const green = new Uint32Array(256);
	const blue = new Uint32Array(256);
	const luma = new Uint32Array(256);
	const vectorscope = new Uint32Array(128 * 128);
	const waveform = new Uint32Array(256 * 128);
	for (let index = 0; index < data.length; index += 4) {
		const r = data[index] ?? 0;
		const g = data[index + 1] ?? 0;
		const b = data[index + 2] ?? 0;
		red[r]++;
		green[g]++;
		blue[b]++;
		const y = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
		luma[y]++;
		const pixel = index / 4;
		const x = pixel % width;
		const waveX = Math.min(255, Math.floor((x / Math.max(1, width - 1)) * 255));
		const waveY = 127 - Math.min(127, Math.floor((y / 255) * 127));
		waveform[waveY * 256 + waveX]++;
		const cb = Math.max(0, Math.min(127, Math.round(64 + (-0.169 * r - 0.331 * g + 0.5 * b) / 2)));
		const cr = Math.max(0, Math.min(127, Math.round(64 + (0.5 * r - 0.419 * g - 0.081 * b) / 2)));
		vectorscope[(127 - cr) * 128 + cb]++;
	}
	return { histogram: { red, green, blue, luma }, vectorscope, waveform };
}
