---
issue: 128
type: performance
area: video-editor
---

The timeline now loads waveforms only for visible clips and a bounded area ahead of scrolling. Large projects no longer start waveform workers for every offscreen audio source when the editor opens.
