### Added

- Added composer-native AI ideation, five-direction drafting, durable platform-specific Rendition generation, voice profiles, internal source checks, and opt-in meme recommendations.

### Changed

- Kept AI review inside the existing composer, with conflict-safe apply, original restoration, compact per-platform strategy summaries, and conservative adaptation for providers without a native creative model.
- Moved all AI requests to the official OpenAI Go SDK while preserving OpenRouter provider routing, privacy controls, web search, and multimodal inputs.

### Fixed

- Matched meme caption sizing and line spacing to the pinned memegen renderer, retried transient previews, and made meme and discovery JSON generation use strict schemas with bounded recovery.
- Kept rejected AI builds on direction selection, aligned generated directions with create limits, and made ideation start from one optional brief and an explicit choice.
- Kept the AI workspace fully inside the viewport at desktop and mobile sizes.
