# Third-Party Notices

This page is for operators and contributors reviewing vendored browser assets and their licences.

OpenPost Image Editor uses these pinned runtime dependencies:

- **Fabric.js 7.4.0** for interactive canvas objects, transforms, filters, and offscreen rendering. OpenPost persists its own versioned document schema rather than Fabric JSON.
- **IMG.LY Background Removal 1.7.0** for local background removal.
- **ONNX Runtime Web 1.21.0** for WebGPU and CPU inference.
- **fflate 0.8.2** for multi-page ZIP downloads.

The quantized background-removal model, WASM files, and their notices ship under `frontend/static/image-editor-models/`. `ThirdPartyLicenses.json`, the model license, content-addressed resource filenames, and the source URL used for the pinned artifact are kept beside the files. Operators that set `OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL` must serve the matching release assets and preserve their notices.

OpenPost Video Editor uses:

- **Mediabunny 1.51.x** for media inspection, bounded sample access, demuxing, streaming MP4/WebM muxing, and its MPL-2.0 ProRes extension with TurboRes for local ProRes decode.
- **Transformers.js 3.8.1** and **ONNX Runtime Web 1.21.0** for local worker-based analysis.
- **FreeCut** source adapted under the MIT License. The retained license is in `licenses/FREECUT.txt`.
- **Paper Shaders** source adapted under the Apache License 2.0. Its retained license and notice are in `licenses/PAPER_SHADERS.txt` and `licenses/PAPER_SHADERS_NOTICE.txt`.
- **Whisper Tiny multilingual**, pinned to the exact model commit listed in `frontend/static/video-editor-models/THIRD_PARTY_LICENSES.md`, for local transcription under Apache License 2.0.
- **Silero VAD 6.2** for local voice-activity detection under the MIT License.
- **Kokoro 82M** under Apache License 2.0, **Supertonic 3** under its OpenRAIL terms, and **MOSS Nano** under Apache License 2.0 for on-device voice generation. Supertonic and both MOSS repositories use fixed revisions. The MOSS browser runtime, model revisions, download sizes, and retained MIT and Apache terms are recorded in `frontend/static/moss-tts/THIRD_PARTY_LICENSES.md`.
- **Microsoft Fluent Emoji Flat** under the MIT License for the local sticker browser. The app loads the bundled Iconify JSON catalog only when the user opens Stickers and stores Microsoft, the source item, and the MIT license with each imported sticker. The retained license is in `licenses/FLUENT_EMOJI.txt`.

The model files, hashes, source revisions, and notices ship under `frontend/static/video-editor-models/`. Operators that set `OPENPOST_VIDEO_MODEL_BASE_URL` must serve the matching content and keep those notices. The checked-in mastered audio assets and machine-readable hashes under `frontend/static/video-editor-audio/` are dedicated under CC0 1.0 as stated beside the files.

OpenPost does not include or import code, styles, utilities, or components from the commercial shadcn Designer package.
