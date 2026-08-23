# Third-Party Notices

OpenPost dependency licenses remain available through their upstream packages and lockfiles. OpenPost Image Editor adds:

- Fabric.js 7.4.0
- IMG.LY Background Removal 1.7.0
- ONNX Runtime Web 1.21.0
- fflate 0.8.2

The bundled background-removal runtime, quantized model, content-addressed resource filenames, source reference, and full notices are in `frontend/static/image-editor-models/`. Redistributors must keep those notices with the corresponding assets.

OpenPost Image Editor is an original implementation. It does not redistribute the commercial shadcn Designer package, its components, its CSS, or its generated utilities.

OpenPost Video Editor includes adapted source from:

- FreeCut, Copyright (c) 2025 FreeCut, under the MIT License. See `licenses/FREECUT.txt`.
- Paper Shaders, Copyright Lost Coast Labs, Inc., under the Apache License 2.0. See `licenses/PAPER_SHADERS.txt` and `licenses/PAPER_SHADERS_NOTICE.txt`.
- Kokoro 82M under Apache License 2.0 and Supertonic 3 under its OpenRAIL terms. These models download on demand for local voice generation and are not part of the application binary.
- The MOSS Nano browser pipeline, including its SentencePiece runtime, under the MIT and Apache License 2.0 terms recorded in `frontend/static/moss-tts/THIRD_PARTY_LICENSES.md`. The two on-demand model revisions are pinned there and are not part of the application binary.
