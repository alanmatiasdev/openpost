### Added

- Local post-capture noise reduction for recorded mic/webcam/audio clips: per-clip persisted `audioNoiseReductionEnabled`/`audioNoiseReductionAmount` (0-100), compact accessible controls in clip properties, deterministic spectral gate that runs entirely on-device with identical preview and export output, bounded CPU/memory and abort/cleanup, no cloud upload, and correct ordering with EQ, pitch/speed, ducking and mixer.
