---
type: enhancement
scope: video-editor
---

Quick Cut can now keep lossless keyframe cuts and exact re-encoded cuts in the same project. Each segment may follow the project mode or choose its own cut strategy, and project files, preflight, separate exports, and merged exports preserve that choice.

Quick Cut now verifies saved keyframe data against the real encoded packets before claiming a lossless result. If a stream-copy assumption becomes stale, it cleans up the partial file and re-encodes safely. Long copies and transcodes report live progress, written bytes, segment counts, and ETA, while merged A/V exports scan only the selected audio packet ranges.

Long source files now build their complete cut index by visiting verified key packets directly instead of scanning every encoded video frame.
