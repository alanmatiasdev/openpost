# Third-Party Notices

OpenPost dependency licenses remain available through their upstream packages and lockfiles. OpenPost Image Editor adds:

- Fabric.js 7.4.0
- IMG.LY Background Removal 1.7.0
- ONNX Runtime Web 1.21.0
- fflate 0.8.2

The bundled background-removal runtime, quantized model, content-addressed resource filenames, source reference, and full notices are in `frontend/static/image-editor-models/`. Redistributors must keep those notices with the corresponding assets.

OpenPost Image Editor is an original implementation. It does not redistribute the commercial shadcn Designer package, its components, its CSS, or its generated utilities.

OpenPost Meme Maker includes a pinned catalog snapshot from Memegen at commit `aa0fc3af4dd1c669cc35039a7d8efcca7d4eb98a`, Copyright (c) 2015 Jace Browning, under the MIT License. The bundled source notice is in `backend/internal/memes/catalog/LICENSE-MEMEGEN.txt`. Bundled fonts retain their SIL Open Font License notices in `backend/internal/memes/catalog/fonts/`.

Template source links provide provenance only. Rights in photos, characters, trademarks, and other depicted material can differ by template and use. Redistributors and users must confirm their own right to publish a chosen template.

OpenPost Video Editor includes adapted source from:

- FreeCut, Copyright (c) 2025 FreeCut, under the MIT License. See `licenses/FREECUT.txt`.
- Paper Shaders, Copyright Lost Coast Labs, Inc., under the Apache License 2.0. See `licenses/PAPER_SHADERS.txt` and `licenses/PAPER_SHADERS_NOTICE.txt`.
- Kokoro 82M under Apache License 2.0 and Supertonic 3 under its OpenRAIL terms. These models download on demand for local voice generation and are not part of the application binary.
- The MOSS Nano browser pipeline, including its SentencePiece runtime, under the MIT and Apache License 2.0 terms recorded in `frontend/static/moss-tts/THIRD_PARTY_LICENSES.md`. The two on-demand model revisions are pinned there and are not part of the application binary.
- `@lottiefiles/dotlottie-web` 0.76.0 under the MIT License. Public animations imported from LottieFiles remain subject to the license stored with each media record and are not bundled with OpenPost.
