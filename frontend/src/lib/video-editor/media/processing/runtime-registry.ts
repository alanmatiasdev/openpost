let unloadFrameInterpolation: (() => void) | null = null;

export function registerFrameInterpolationRuntime(unload: () => void): () => void {
	unloadFrameInterpolation = unload;
	return () => {
		if (unloadFrameInterpolation === unload) unloadFrameInterpolation = null;
	};
}

export function unloadFrameInterpolationRuntime(): void {
	unloadFrameInterpolation?.();
}
