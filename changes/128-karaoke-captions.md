### Added
- Video Editor karaoke captions: per-word highlight mode for subtitle items using existing `SubtitleCue.words` timings with configurable active-word foreground and optional active-word background, exposed compactly in the subtitle properties panel.
- Shared deterministic karaoke word selection and cached subtitle layout so preview and export resolve the identical active word at exact frame boundaries, with untimed cues falling back to normal captions without flicker and with line wrapping preserved.
