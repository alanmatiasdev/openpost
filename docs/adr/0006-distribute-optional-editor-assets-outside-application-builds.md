---
status: rejected
---

# Distribute optional editor assets outside application builds

OpenPost considered distributing browser model weights, ONNX Runtime WASM, and the full built-in editor audio library as separate versioned Model packs and Media packs. That design would have required a configurable Model source, versioned Model adapters, content-addressed browser storage, and new administration controls for compatibility, integrity, licensing, size, and local downloads.

OpenPost does not use that release boundary. The tracked immutable editor assets remain part of the complete web, Go embed, and Android application artifacts so one revision stays self-contained and portable. Build-tool inputs, build caches, generated trees, and CI checkouts may omit or hard-link those files to reduce duplicate storage, but the owning packaging boundary checks the declared bundle inventory and sizes, restores the files, and validates the complete application artifact. A future separate-distribution design must supersede this decision explicitly and provide the complete trust, compatibility, offline, upgrade, and self-hosting contract first.
