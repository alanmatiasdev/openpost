let sample = $state<{ itemId: string; image: ImageData } | null>(null);

export const scopeSamples = {
	get current() {
		return sample;
	},
	publish(itemId: string, image: ImageData): void {
		sample = { itemId, image };
	},
	clear(itemId: string): void {
		if (sample?.itemId === itemId) sample = null;
	}
};
