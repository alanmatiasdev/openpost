import { describe, expect, it } from 'vitest';
import { AudioMixerRouting } from './audio-mixer-routing';

const SAMPLE_RATE = 48_000;
const FRAME_COUNT = 256;

async function renderStereo(options: {
	left: number;
	right: number;
	trackGain?: number;
	masterDb?: number;
	masterMuted?: boolean;
}): Promise<AudioBuffer> {
	const context = new OfflineAudioContext(2, FRAME_COUNT, SAMPLE_RATE);
	const routing = new AudioMixerRouting(context);
	const buffer = context.createBuffer(2, FRAME_COUNT, SAMPLE_RATE);
	buffer.getChannelData(0).fill(options.left);
	buffer.getChannelData(1).fill(options.right);
	const source = context.createBufferSource();
	source.buffer = buffer;
	const detach = routing.attach(source, 'dialogue');
	routing.setTrackPreviewGain('dialogue', options.trackGain ?? 1);
	routing.setMaster(options.masterDb ?? 0, options.masterMuted ?? false);
	source.start();
	const rendered = await context.startRendering();
	detach();
	routing.dispose();
	return rendered;
}

describe('production audio mixer routing', () => {
	it('keeps asymmetric stereo intact and applies each fader exactly once', async () => {
		const rendered = await renderStereo({
			left: 0.8,
			right: -0.4,
			trackGain: 0.5,
			masterDb: -6.020599913279624
		});
		expect(rendered.getChannelData(0)[128]).toBeCloseTo(0.2, 5);
		expect(rendered.getChannelData(1)[128]).toBeCloseTo(-0.1, 5);
	});

	it('silences the audible output at the master without changing channel layout', async () => {
		const rendered = await renderStereo({ left: 0.7, right: 0.2, masterMuted: true });
		expect(Math.max(...rendered.getChannelData(0).map(Math.abs))).toBe(0);
		expect(Math.max(...rendered.getChannelData(1).map(Math.abs))).toBe(0);
	});

	it('upmixes a mono source to both speakers without changing its level', async () => {
		const context = new OfflineAudioContext(2, FRAME_COUNT, SAMPLE_RATE);
		const routing = new AudioMixerRouting(context);
		const buffer = context.createBuffer(1, FRAME_COUNT, SAMPLE_RATE);
		buffer.getChannelData(0).fill(0.3);
		const source = context.createBufferSource();
		source.buffer = buffer;
		routing.attach(source, 'voice');
		source.start();
		const rendered = await context.startRendering();
		expect(rendered.getChannelData(0)[128]).toBeCloseTo(0.3, 5);
		expect(rendered.getChannelData(1)[128]).toBeCloseTo(0.3, 5);
		routing.dispose();
	});

	it('owns one track bus until the final source detaches', () => {
		const context = new OfflineAudioContext(2, FRAME_COUNT, SAMPLE_RATE);
		const routing = new AudioMixerRouting(context);
		const first = context.createGain();
		const second = context.createGain();
		const detachFirst = routing.attach(first, 'music');
		const detachSecond = routing.attach(second, 'music');
		expect(routing.activeTrackIds()).toEqual(['music']);
		expect(routing.attachmentCount('music')).toBe(2);

		detachFirst();
		detachFirst();
		expect(routing.attachmentCount('music')).toBe(1);
		detachSecond();
		expect(routing.activeTrackIds()).toEqual([]);
		expect(routing.readTrackLevels('music')).toEqual({
			left: 0,
			right: 0,
			peakLeft: 0,
			peakRight: 0
		});
		routing.dispose();
	});
});
