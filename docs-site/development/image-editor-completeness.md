# Image Editor Completeness Checklist

Reviewed: 2026-08-06

This is the implementation contract for bringing the OpenPost Image Editor to a
complete, polished editing experience. It is intentionally broader than a
feature backlog. A tool is not complete because a button exists or because one
happy-path edit renders on the canvas.

The source comparison behind this checklist is
`references/miniPaint-comparison.md` in the repository root.
The Git-ignored miniPaint checkout at `references/miniPaint/` is a behavioral
reference, not a dependency or an architecture to copy.

## Status legend

- `[x]` Verified complete in the current editor and covered by an appropriate test.
- `[~]` Implemented in part, but one or more completion requirements are missing.
- `[ ]` Not implemented.
- `[!]` Intentionally deferred or rejected; the item includes the reason.

Statuses describe the current working tree, not design intent. Update a status
only with source and test evidence.

## Definition of complete

Every persistent editor operation must satisfy all applicable requirements:

- [ ] The action is discoverable in the relevant desktop and mobile context.
- [ ] The target, scope, mode, and destructive effect are clear before commit.
- [ ] Mouse, trackpad, touch, pen, and keyboard paths work where the device can
      reasonably support them.
- [ ] `Escape` cancels transient work and `Enter` commits it without leaking an
      incomplete edit into history.
- [ ] One user gesture creates exactly one undoable command; no-op gestures do
      not create history entries.
- [ ] Undo and redo restore the exact document and selection state.
- [ ] Autosave, reload, revision restore, copy, template creation, and guest
      migration preserve the result.
- [ ] Interactive canvas, generated preview, download, Media Library export, and
      composer return render the same result.
- [ ] The operation is available through a semantic DOM control or equivalent
      keyboard path, not only through canvas pixels.
- [ ] Desktop, tablet, 390 px phone, 320 px phone, and short landscape layouts
      keep the canvas and primary actions usable.
- [ ] Limits, malformed input, missing media/fonts, offline state, cancellation,
      conflicts, and interrupted work have explicit recovery behavior.
- [ ] Long operations report progress, yield to the UI, can be cancelled when
      safe, and release workers, object URLs, decoded images, and buffers.
- [ ] Tool state changes and results are announced without flooding assistive
      technology during pointer movement.
- [ ] Unit tests cover the state/geometry contract and Playwright covers the
      highest-risk end-to-end path.

## Release gates for this program

- [x] Current focused Image Editor unit baseline: 98 tests across 18 files.
- [x] Current focused Image Editor browser baseline: seven scenarios with page
      and console error diagnostics.
- [x] Current 1280 px, 768 px, and 390 px smoke has no observed overflow or
      console errors.
- [x] Add 320 px and short-landscape browser coverage for primary action
      visibility and horizontal overflow.
- [ ] Add keyboard-only create-to-export coverage.
- [ ] Add touch/stylus gesture coverage where Playwright can represent it.
- [ ] Add light/dark and 200% browser zoom coverage.
- [ ] Add common, minimum, maximum, many-page, and many-layer performance cases.
- [x] Run `frontend-check`, `check:ui-consistency`, the focused unit suite, the
      focused browser suite, docs links/build, and the repository's broad gate.

### Verification snapshot

The 2026-08-06 working tree passed:

- `devenv shell -- verify`, covering repository checks, formatting and lint,
  333 frontend tests, backend tests, CLI tests, frontend/marketing/docs builds,
  generated contracts, docs links, and UI consistency.
- The focused Image Editor unit suite: 98 tests across 18 files.
- The isolated Image Editor Playwright suite: 7 tests with one worker, including
  crop undo/redo/reload, portable-project round-trip, guest restore, external
  stock media, selection movement, 320 px/short landscape, and Media export.
- Svelte autofixer on every changed Svelte component; no reported issues.

These gates prove the implemented paths below. They do not turn unchecked or
partial requirements into complete ones.

## 1. Shared command and tool foundations

### Typed command registry

- [~] A typed registry now owns command IDs, categories, shortcut matching,
  platform labels, collision tests, keyboard dispatch, menu labels, and the full
  help list. Tooltips, mobile actions, enabled state, and handlers still need to
  be generated from it.
- [~] Give every command a stable ID, localized name and description, category,
  platform-aware shortcut, enabled predicate, hidden predicate, handler,
  undoability, and applicable context.
- [ ] Generate menubar items, context-menu items, tooltip shortcut labels,
      shortcut help, mobile More actions, and accessible descriptions from that
      registry.
- [~] Detect duplicate shortcuts. Add tests for commands missing help or an enabled-state
  explanation in unit tests.
- [ ] Keep tool activation separate from commands that create an object. A text
      shortcut must not leave the first typed character inside the new text layer.
- [~] Support `Escape`, `Enter`, `Delete`, `Backspace`, arrow nudge, modified
  arrow nudge, select all, deselect, copy, cut, paste, duplicate, group,
  ungroup, save, zoom, and tool selection without intercepting text editing,
  dialogs, or form controls. IME composition is explicitly ignored and tested;
  complete dialog and focus coverage remains.
- [ ] Later: allow shortcut customization only after collision detection and a
      reset path exist.

### Mutation and history contract

- [~] Route document mutations through `ImageEditorController.mutate`. Audit
  remaining direct document writes and transient state changes.
- [x] Make `mutate` skip no-op documents instead of emitting unsaved state and a
      redundant history snapshot.
- [ ] Preserve and restore the active page, object selection, pixel selection,
      active tool, and relevant transient commit state with undo/redo where users
      expect it.
- [~] Coalesce continuous sliders and transforms. Verify Enter, Tab, blur,
  pointer-up, and cancellation boundaries individually.
- [~] History retains at most 100 entries within a measured 64 MiB budget and
  evicts the oldest entries first. Structural sharing or deltas are still
  needed to reduce cloning cost for large paint documents.
- [x] Expose undo/redo command names to menu items and assistive announcements.
- [~] Tests cover no-op commands, byte-budget eviction, and redo invalidation;
  maximum-size paint history still needs performance coverage.

### Shared raster-tool contract

- [~] Pencil, eraser, magic eraser, bucket, gradient, marquee, lasso, and magic
  selection share some selection helpers but not a full behavior contract.
- [ ] Standardize target layer, sample source, selection mode, preview,
      parameters, no-op detection, locked/hidden/group handling, `Escape`, undo,
      persistence, export, and option persistence.
- [ ] Provide the reason when a raster tool is disabled or has no valid target.
- [ ] Keep all document coordinates independent of viewport zoom, device pixel
      ratio, and CSS transforms.

## 2. Essential familiar editing interactions

### Interactive crop

- [~] Image layers store normalized crop data and all renderers consume it. A
  transient canvas crop mode now supports move/resize, common aspects,
  rotated/flipped geometry, reset, Apply/Cancel, keyboard nudge, and one-command
  history. Image-within-frame repositioning and rotate/flip actions remain.
- [~] Activate crop from the tool rail, image properties, keyboard, and mobile
  retouch menu. It is not yet generated from the shared command registry.
- [x] Draw a dimmed crop frame with visible rule-of-thirds lines and handles.
- [x] Use 44 px pointer targets around crop handles while keeping their visible
      marks compact.
- [ ] Move/resize the frame and reposition the image within it without changing
      the outer layer transform.
- [x] Offer free, original, square, 4:5 portrait, 1.91:1 landscape, 9:16 Story/
      Reel, and 16:9 thumbnail aspect presets.
- [~] Reset, cancel, and apply are explicit. Rotate left/right and flip actions
  inside the transient crop session remain.
- [x] Use `Enter` to apply and `Escape` to restore the pre-crop state.
- [x] Keep the crop inside source bounds and prevent zero/near-zero output.
- [x] Support already rotated/flipped layers without miniPaint's
      rasterize-first limitation.
- [~] Undo/redo and guest save/reload are covered in browser automation. Revision,
  template, cloud, and output-pixel parity coverage remain. Replacement now
  preserves normalized crop data.
- [x] Announce crop dimensions on commit, not on every pointer move.
- [ ] Test high/low zoom, touch handles, transforms, missing image dimensions,
      reset, cancel, reload, and export parity.

### Canvas eyedropper

- [~] The color picker retains the browser screen `EyeDropper` API. A canvas
  eyedropper now samples active/composited pixels, previews color and alpha, and
  targets paint color, selected fill/text, selected stroke, or page background.
  Alt temporarily samples from pencil, bucket, and gradient tools. A true
  pixel-grid magnifier remains.
- [x] Expose the canvas eyedropper in desktop and mobile tools while retaining
      screen sampling as an additional color-picker action.
- [x] Sample either the active layer or the composited page, controlled by the
      same clear source option used by magic tools.
- [x] Ignore selection outlines, transform controls, guides, grids, and other
      editor-only overlays by sampling the Fabric render below the DOM editor
      overlays.
- [~] Show a pointer-following swatch, normalized hex value, and alpha while
  hovering. Add a true magnified pixel grid.
- [x] Apply the sampled color to an explicit paint, selected text/fill, selected
      stroke, or page-background target.
- [ ] Extend explicit targeting to text highlight, active gradient stop, and
      shadow/effect color pickers.
- [~] Click, pen, and touch commit on release, and Alt temporarily activates the
  eyedropper from pencil, bucket, and gradient tools. Keyboard sampling still
  needs a movable sampling cursor.
- [~] Correctly sample transparent pixels and document coordinates independent
  of zoom. Add browser proof for high-DPI, clipped images, masks, blend modes,
  and page backgrounds.
- [x] Store the RGB result in recent colors and carry alpha separately. Create
      history only when a document property changes.

### External file drop and paste

- [~] Internal Media Library drags and external OS image drops place images at
  document coordinates. Clipboard image paste uploads one image. Cloud batches
  support cancellation and retry from the failed file without duplicating the
  successful prefix; guest OPFS writes cannot be interrupted mid-write.
- [x] Detect `DataTransfer.files` without confusing them with OpenPost's
      internal media MIME.
- [x] Prevent browser navigation when supported image files are dragged over
      the editor.
- [ ] Validate image MIME, decoded dimensions, byte limits, SVG safety, and
      document limits before upload.
- [x] Place one file at the exact document point and cascade multiple files in
      stable source order around that point.
- [~] Show per-file preparation/upload progress, failure, retry, and cloud-upload
  cancellation. A full-canvas drag-enter overlay is still missing.
- [x] Use OPFS for guest media and Media Library retention for signed-in media.
- [x] Refresh uploaded assets into Media Library immediately and retain them
      across design close/reopen.
- [x] Undo removes inserted layers without deleting the reusable library/OPFS
      source asset.
- [x] Retry resumes at the failed file and never uploads the successful prefix
      twice. General content-hash deduplication remains the media service's policy.
- [ ] Keep page-thumbnail and panel drop zones explicit so files never land in
      an unexpected page.
- [ ] Test multiple files, SVG, unsupported content, partial upload failure,
      guest mode, signed-in mode, exact positioning, undo, immediate library
      visibility, and reopen.

### Pixel selection as content

- [x] Rectangular, ellipse, lasso, and magic masks support boolean modes, constrain
      paint tools, and feed non-flattened delete, promote, cut, copy, and paste
      operations for image and paint layers.
- [x] Distinguish “move selection boundary” from “move selected pixels” with
      explicit Cut/New layer actions, floating-mode guidance, and a move cursor.
- [x] Move selected pixels on image and paint layers by pointer or keyboard, with
      a transparent source hole for Cut and a live floating preview.
- [~] Delete selected pixels with a toolbar action or Delete/Backspace. Copy,
  cut, and paste use isolated structured content; Duplicate still follows
  object-layer semantics until content is floating.
- [x] Promote selected pixels to a new paint/image layer while preserving alpha
      and document coordinates and leaving the source intact.
- [~] A floating selection can be repositioned, committed, cancelled, or deleted;
  tool changes commit it predictably. Resize and rotation handles remain.
- [ ] Define active-layer versus composited-page behavior and prevent silent
      edits across locked/hidden layers.
- [x] Keep one history entry per committed promote/delete operation and no entry
      for an empty operation.
- [x] Preserve the original mask on cancel and clear it after commit/delete.
- [x] Support arrow nudge and Shift-modified nudge for floating content.
- [~] Paint-layer state/history/cancel and image-layer pointer/keyboard/save/reload
  paths are covered. Broader alpha, masks, groups, transformed edges, empty
  selections, revision restore, and every-renderer parity remain.

### Brand resources in the editor

- [~] Brand colors, fonts, solid backgrounds, and whole-layer text styles are
  now consumed. Background media assets are not part of the current brand-kit
  schema.
- [x] Show saved solid brand backgrounds in the page background editor with
      accurate swatches.
- [x] Apply a background by copying a revision-safe value snapshot into the
      page, not by keeping a mutable implicit dependency.
- [x] Show saved brand text styles for compatible text selection.
- [x] Apply font, weight, style, size, color, line height, and letter spacing in
      one undoable command.
- [~] Support one or many compatible text layers in one command. Add mixed-value
  display and a clear explanation when part of a selection is incompatible.
- [ ] Resolve missing fonts/media with a visible fallback and recovery action.
- [ ] Test brand revision changes, deleted assets, template instantiation,
      multi-selection, undo/redo, save/reload, and export.

## 3. Precision, selection, and placement

### Snapping controls

- [~] Fabric move/resize snapping uses objects, page centers/edges, persistent
  guides, and the optional grid behind a persistent View/mobile toggle. Crop,
  drawing, guide movement, and rotation do not yet share every snap source.
- [x] Add a persistent snap toggle in View and mobile More with an accessible
      checked state and local preference.
- [x] Add a temporary Command/Control-drag bypass that does not conflict with Alt-duplicate,
      selection subtraction, browser gestures, or text input.
- [ ] Consider separate object, guide, grid, and pixel snap sources only if one
      toggle becomes ambiguous in testing.
- [~] Move and resize share object/guide/grid candidates. Drawing, crop, guide
  movement, and rotation still need the same contract.
- [ ] Exclude hidden layers, locked layers when appropriate, and members of the
      active multi-selection from candidates.
- [ ] Announce snap on/off and show the active target without noisy pointer-move
      announcements.

### Rulers, guides, grid, and coordinates

- [x] Add document-space horizontal and vertical rulers that remain correct at
      every zoom/pan and adapt major/minor tick density.
- [~] Drag guides from rulers; add horizontal/vertical guides numerically; move,
  delete, clear, show/hide, and snap objects to them. Guide locking remains.
- [x] Show axis-specific guide geometry and intersections without relying on
      color alone.
- [x] Guides are deliberately page-specific, matching OpenPost's multi-page
      document model.
- [x] Persist guides as optional, validated page data; preserve them in clone,
      template, project import/export, and save/reload paths, but never in rendered
      image output.
- [x] Add a configurable visual grid, show/hide, snap-to-grid, and manual spacing.
- [~] Show cursor document coordinates in the desktop canvas status area. The
  mobile View sheet exposes view controls but not a continuously changing readout.
- [x] Provide keyboard movement/deletion and numeric creation as alternatives to
      precise ruler dragging; ruler targets are touch-sized.
- [ ] Test negative pasteboard positions, all zoom levels, high-DPI, resize,
      page switching, templates, reload, and non-export.

### Numeric transforms

- [~] Properties expose transform values, but the complete mixed-selection and
  commit contract needs verification.
- [~] Provide x, y, width, height, rotation, and aspect-locked sizing with
  consistent pixels/degrees. Anchor and one-click transform reset remain.
- [ ] Commit on Enter, Tab, and blur; cancel on Escape; coalesce continuous
      changes; never create a history entry for invalid/no-op input.
- [ ] Explain whether multi-selection values are absolute, relative, or mixed.
- [ ] Preserve group/child geometry and flipped layers.

### Alpha-aware hit testing

- [~] Normal image/paint selection now uses Fabric per-pixel targeting and
  tool-assisted topmost lookup filters bounds then tests rendered alpha. Cached
  adaptive masks and layer cycling remain incomplete.
- [x] Filter top-down by transformed bounding boxes, then test image/paint alpha
      at the local source coordinate.
- [x] Account for normalized crop, fit mode, masks, erase masks, object opacity,
      and selection-root group ancestry through the rendered-object alpha sample.
- [ ] Cache or adapt alpha masks so large images do not introduce a fixed
      quality cliff or synchronous full-canvas readback.
- [ ] Add overlapping-layer cycling and a “Select layer” context submenu for
      intentionally choosing transparent or covered objects.
- [x] Preserve locked/hidden semantics and select the appropriate root group.
- [ ] Test transparent PNG padding, clipped/rotated/flipped/scaled images, paint,
      masks, groups, very large media, and exact edge pixels.

## 4. Raster tool quality

### Pencil and brush

- [~] Pencil supports size, opacity, roughness, smoothing, pressure, selection
  masks, compact spans, a live size cursor, and undo. It lacks hardness,
  spacing, alternate tips, and palm rejection.
- [~] Record coalesced pointer events and pressure. Rejecting accidental touch
  while a pen is active remains.
- [~] Add smoothing and a precise size cursor. Hardness, spacing, round/square
  tip selection, and hardness visualization remain.
- [ ] Keep lines continuous at high pointer speed and canvas edges.
- [ ] Support pen eraser-end behavior and define mouse fallback pressure.
- [x] Keep pressure/smoothing output deterministic enough for persistence and
      renderer parity by committing the resulting bounded pixel spans.
- [ ] Bound points/spans, history cost, and rendering time on long strokes.

### Eraser

- [~] Paint erasing compacts spans and image erasing stores a non-destructive
  source-space mask.
- [ ] Add hardness/tip preview and reuse brush sampling semantics.
- [~] Paint erase strokes that change no spans are removed by document-level
  no-op detection. Image erase still needs visible-alpha intersection before it
  appends a stroke.
- [ ] Verify selection intersection, transformed coordinates, clipping, masks,
      image replacement, and mask compaction.
- [x] Add an explicit, undoable restore control for non-destructive image erase
      masks.

### Magic selection, bucket, and magic erase

- [~] All three have tolerance and contiguous/global behavior; magic selection
  and bucket can sample all layers.
- [ ] Share one named sampling contract so “contiguous” and “all layers” mean the
      same thing everywhere.
- [ ] Add transparent-pixel behavior, optional feather/antialias, and an outline
      preview before destructive commit.
- [ ] Move large scans to cancellable workers with progress and adaptive limits.
- [ ] Handle edges, transformed layers, empty samples, no target, locked target,
      and no-op results explicitly.
- [ ] Test global versus contiguous regions, tolerance boundaries, alpha,
      selection intersection, sample-all layers, and export parity.

### Gradient

- [~] Linear, radial, angle, reflected, and diamond gradients with two colors,
  reverse, alpha, and selection constraints are stored and rendered.
- [ ] Keep post-creation start/end handles editable on canvas.
- [ ] Add, remove, reorder, and select color stops; edit stop alpha.
- [ ] Support Shift angle constraints, reverse, reset, and precise numeric
      positions.
- [ ] Reuse one gradient editor for paint and page backgrounds.
- [ ] Verify identical output in Fabric, static preview, download, media export,
      composer return, and templates.

### Background removal

- [~] Local worker inference, progress, cancellation, GPU/CPU fallback, size
  safeguards, and non-destructive result creation exist.
- [ ] Separate model-download, decode, inference, mask, and upload progress.
- [ ] Add before/after and checkerboard preview before commit.
- [ ] Cache the loaded model safely; cancel and release obsolete jobs.
- [ ] Preserve the original layer/source and expose retry/reset after failure.
- [x] Retain the result as reusable media and refresh it into Media Library
      immediately.
- [ ] Define offline, missing model, WebGPU failure, memory pressure, auth expiry,
      duplicate request, and navigation recovery.
- [ ] Store enough provenance to explain the derived result without retaining
      private model intermediates.

### Retouch tools after the core is complete

- [ ] Add non-destructive clone/heal with explicit source selection and preview.
- [ ] Add local blur, sharpen, and desaturate brushes using the shared brush
      engine.
- [ ] Add replace-color and color-to-alpha with preview, tolerance, alpha,
      selection, cancellation, and renderer parity.
- [!] Do not add semantic/content-aware fill until a local, privacy-preserving,
  cancellable implementation and honest product language are available.

## 5. Text completeness

- [~] Fabric direct text editing, whole-layer formatting, fonts, stroke,
  highlight, shadows, letter spacing, line height, and curved text exist.
- [ ] Verify double-click/direct focus, caret/selection, `Escape`, Command/Control
      +A, clipboard, context menu, IME, emoji, newlines, very long text, and mobile
      keyboard behavior.
- [ ] Ensure the text tool creates and focuses a layer without inserting the
      activation shortcut character.
- [ ] Expose auto-width versus fixed-width boxes and resize-versus-scale
      semantics.
- [~] Add explicit word and character wrapping. Minimum width, overflow policy,
  and vertical alignment remain.
- [x] Add persisted underline and strike before introducing rich spans.
- [ ] Define curved multiline behavior and a reliable way back to normal text.
- [ ] Reconcile font metrics after async load without moving committed layout
      unexpectedly.
- [ ] Show missing/deleted font, unavailable weight, synthetic style, and export
      fallback states.
- [ ] Wait for fonts before preview/export and test reload, templates, licensed
      uploads, fallback, emoji, RTL content, and every output path.
- [ ] Later: rich formatting spans only after edit, serialization, clipboard,
      accessibility, and renderer contracts are designed together.

## 6. Shapes and object geometry

- [~] Rectangle, rounded rectangle, ellipse, and line have structured fill,
  stroke, radius, transform, effects, masks, persistence, and export.
- [ ] Perfect drawing gestures and modifiers for all existing shapes before
      adding more kinds.
- [~] Support explicit no-fill and no-stroke states, alpha, radius constraints,
  rotation, flip, and numeric transforms. Stroke scaling, editable line
  endpoints, and complete reset remain.
- [ ] Verify alignment, distribution, groups, masks, effects, keyboard, touch,
      accessibility, and zero/near-zero dimensions.
- [ ] Add arrow, triangle, polygon, star, and callout as the first expanded set,
      each with structured parameters rather than raster insertion.
- [ ] Defer novelty shapes until the core set has full renderer and test parity.

## 7. Layers, groups, and multi-selection

### Selection synchronization

- [~] Canvas and layer-tree selection, toggle/range selection, lock, visibility,
  rename, reorder, grouping, alignment, and distribution exist.
- [ ] Make canvas/tree/page selection deterministic after add, delete, reorder,
      group, ungroup, undo, redo, and page switch.
- [x] After deletion, preserve locked roots and descendants, then select the
      nearest sensible visible, unlocked sibling/parent.
- [x] Auto-scroll the selected tree row into view without stealing focus.
- [ ] Keep collapsed groups, hidden descendants, locked ancestors, and range
      selection semantics consistent.

### Nested groups

- [~] Nested group data and descendant traversal exist.
- [ ] Verify transforms, reparenting, lock/hide inheritance, selection root,
      duplicate ID remapping, clipboard, persistence, renderer order, and undo.
- [ ] Make tree drop targets and nesting intent clear for mouse, touch, and
      keyboard users.
- [ ] Add accessible collapse/expand, move in/out of group, and context menus.

### Layer tree scale and polish

- [~] Rows expose common actions and support drag/keyboard reorder.
- [ ] Keep every action reachable at coarse-pointer sizes and explain disabled
      actions.
- [ ] Verify rename commit on Enter, Tab, blur, outside click, and cancellation.
- [ ] Use cheap type icons; add thumbnails only with a bounded cache and clear
      value.
- [ ] Virtualize or incrementally render large trees before 500-layer documents
      become visibly slow.

### Multi-selection properties

- [~] Transform/alignment/group actions support multiple layers. Property-panel
  compatibility and mixed state are incomplete.
- [ ] Display mixed values explicitly and apply compatible properties to all
      eligible layers in one command.
- [ ] Explain partial application instead of silently ignoring incompatible,
      hidden, or locked layers.
- [ ] Define relative versus absolute transform, opacity, visibility, lock,
      blend, effect, and text-style changes.

## 8. Persistence, recovery, and conflicts

### Full operation audit

- [ ] For every operation in this checklist, record: history entry, dirty state,
      autosave, reload, revision restore, clipboard, template, migration, renderer,
      and media references.
- [ ] Add schema migrations for every new persistent field and validate both
      fresh and upgraded documents on frontend and backend.
- [ ] Reject or repair malformed finite numbers, invalid references, cycles,
      oversized masks, and unsupported future schema versions safely.

### Guest storage

- [~] IndexedDB documents and OPFS media support guest editing and migration.
- [ ] Handle storage unavailable, private browsing, quota pressure, browser
      eviction, missing OPFS files, corrupt records, schema upgrades, and two tabs.
- [ ] Explain what “clear local designs” removes before destructive action.
- [ ] Preserve a recoverable copy when sign-up/migration partially fails.

### Cloud save and revisions

- [~] Debounced save, local recovery, expected-revision conflicts, checkpoints,
  history, soft deletion, and restore exist.
- [ ] Test slow/offline transitions, auth expiry, read-only permissions, deleted
      designs, concurrent browser edits, media removal, navigation, and crash
      recovery.
- [ ] Make conflict choices name the local/server versions and preserve a copy
      before overwriting either side.
- [ ] Verify restored designs retain pages, revision links, media, previews,
      latest exports, and composer return behavior.

### Portable OpenPost project

- [x] Add versioned `.openpost-image` project export containing the complete
      document and an explicit bundled-media manifest.
- [x] Add streaming archive import with schema validation, entry/file/archive
      size limits, a strict path allowlist, no remote fetching, media remapping, page
      and layer ID remapping, missing-media errors, and creation of a new design
      instead of implicit overwrite.
- [~] Guest and workspace imports strip source workspace/brand identifiers and
  re-home bundled media. Dedicated licensed-font import policy still needs a
  first-class path.
- [~] Unit tests cover round trip, missing media, unexpected paths, malformed
  metadata, and size/reference validation. Future-version, duplicate-ID,
  partial-upload, browser media, and renderer-pixel coverage remain.

## 9. Renderer and export parity

- [~] Fabric and static renderers support current text, images, shapes, paint,
  groups, crop, adjustments, gradients, masks, erase masks, blend, opacity,
  borders, shadows, background, transparency, and matte.
- [ ] Maintain one feature-parity test matrix for interactive canvas, template
      preview, generated design preview, download, Media Library, and composer
      return.
- [ ] Verify fonts, emoji, curved/wrapped text, crop/rotation/flip, nested groups,
      paint/erase, gradient types/stops, blends, masks, effects, transparent page,
      JPEG matte, and maximum dimensions.
- [~] Export active/all pages, stable order, format, quality, matte, progress,
  and partial page results exist; complete cancellation and retry semantics.
- [ ] Use stable sanitized filenames and document MIME-specific controls.
- [ ] Estimate memory/output cost before starting and refuse unsafe work with a
      useful remediation.
- [ ] Make multi-page partial failure resumable and idempotent without duplicating
      Media Library assets.
- [ ] Keep successful exports visible immediately in Media Library.
- [ ] Handle expired composer tokens and repeated return attempts without losing
      the exported pages.
- [ ] Store derivation/provenance for exported results where useful.
- [ ] Add optional selected-layer export only after the main paths are complete.

## 10. Mobile and responsive completeness

- [~] Mobile bottom actions, contextual sheets, pinch zoom, panning, page strip,
  and core tools exist.
- [ ] Verify outcome parity for create, add media/text/shape, select, transform,
      crop, draw, erase, magic tools, bucket, background removal, layers/groups,
      pages, brand application, undo/recovery, export, and composer return.
- [ ] Keep undo/redo and the active tool family in the thumb zone; remember the
      last sub-tool without hiding the active state.
- [ ] Preserve canvas position, selection, focus, and unsaved edits across sheet
      open/close, orientation changes, safe-area changes, browser chrome, mobile
      keyboard, and split-screen resizing.
- [ ] Use at least 44 px coarse-pointer targets for handles and actions without
      making the desktop UI oversized.
- [ ] Distinguish canvas gestures from sheet dragging and browser navigation.
- [ ] Support stylus drawing without accidental palm/touch edits.
- [~] Test 390 px, 320 px, short landscape, iOS safe areas, Android browser
  chrome, 200% zoom, and long translations. Automated 320 px and short-landscape
  primary-action/overflow coverage is now present; device chrome, safe areas,
  zoom, and long-locale coverage remain.

## 11. Accessibility completeness

- [~] DOM Layers/Properties provide accessible alternatives to many canvas-only
  actions and common controls have labels/focus states.
- [ ] Complete keyboard paths for crop, guides, numeric transforms, reorder,
      text editing, pixel selections/content, floating selection commit/cancel, and
      every dialog.
- [ ] Restore focus predictably after dialogs, sheets, uploads, errors, and
      destructive confirmations.
- [ ] Announce active tool/mode, selection summary, save/upload/removal/export
      state, snap/zoom/page changes, reorder/group results, history actions, and
      errors at appropriate priority.
- [ ] Keep announcements summarized during continuous input.
- [ ] Verify 200% browser zoom, light/dark contrast, forced colors, reduced
      motion, no flashing, non-color guide/selection distinction, and keyboard focus
      on the pasteboard.
- [ ] Provide useful text alternatives for page/layer previews and current
      selection without pretending the visual artwork has a full semantic model.

## 12. Performance and resource budgets

- [ ] Define interaction budgets for drawing, transform, selection, tree/page
      operations, undo, autosave, preview, export, magic tools, bucket, and
      background removal.
- [ ] Measure 25 MP selection masks, sample-all rendering, document cloning,
      history snapshots, paint spans, decoded media, object URLs, fonts, offscreen
      pages, and ML model memory.
- [ ] Move expensive scans/rendering to workers with cancellation and progress.
- [ ] Use adaptive previews during interaction and full-quality work only at
      commit/export.
- [~] Bound history to 100 entries and an estimated 64 MiB. Decoded-image,
  alpha-mask, thumbnail, font, object URL, and model caches still need measured
  budgets and explicit cleanup contracts.
- [ ] Lazy-load offscreen pages and virtualize large trees where measurements
      show a need.
- [ ] Yield during large synchronous document work and refuse operations that
      cannot safely fit the client budget.
- [ ] Add performance regression fixtures at minimum/common/maximum dimensions,
      35 pages, 500 layers, large paint masks, and repeated undo/redo.

## 13. Micro-interaction and error-state polish

- [ ] Give every tool the right cursor and live size/shape preview.
- [ ] Make hover, pressed, selected, disabled, focus, and destructive states
      visually distinct in both themes.
- [ ] Keep outlines and transform handles visible against light, dark,
      transparent, and high-detail artwork.
- [ ] Standardize double-click, context menu, `Escape`, `Enter`, click-away,
      accidental deselection prevention, and no-op history behavior.
- [ ] Double-click sliders to reset and provide per-property/group reset where a
      non-default state matters.
- [x] Remember bounded, safe last-used selection, pencil, eraser, bucket,
      gradient, and eyedropper options; keep the sampling target visible.
- [ ] Explain disabled actions in tooltips or nearby copy.
- [ ] Complete empty, loading, error, retry, partial success, success, and
      cancellation states for media, fonts, save, revisions, templates, background
      removal, and export.
- [ ] Keep layer/page insertion and reorder feedback immediate; use accurate drag
      ghosts and snap targets.
- [~] Replacing the selected image from Media Library preserves transform, crop,
  masks, adjustments, and effects. A dedicated properties action and explicit
  keep/reset-fit choice remain.
- [ ] Preserve sensible export defaults per document and avoid surprising
      format changes when transparency changes.

## 14. High-value end-to-end scenarios

- [~] Crop an image, undo, redo, and reload in browser automation. Direct
  download-pixel comparison remains.
- [x] Export a portable editable project, import it as a new design, and prove
      the source design is not overwritten.
- [ ] Drop external files, see them immediately in Media Library, close, and
      reopen the design.
- [~] Select pixels, move/cut/copy/paste them, save, and reload. Magic-selection,
  promote, and exported-pixel coverage remain for this combined scenario.
- [ ] Click through transparent PNG padding to the layer below and cycle layers.
- [ ] Move/resize with guides and snapping; bypass snapping temporarily.
- [ ] Apply brand text style and background, instantiate a template, and render.
- [ ] Replace an image while preserving transform/crop/effects/masks.
- [ ] Resume a multi-page export after one page fails without duplicate assets.
- [ ] Hit guest storage quota and preserve the last recoverable document.
- [ ] Edit offline in two browser contexts and preserve both conflict versions.
- [ ] Transform, duplicate, save, reload, and export a nested group.
- [ ] Draw a large paint document until history compacts/evicts within budget.
- [ ] Cancel background removal, retry, close, and reopen the derived result.
- [ ] Complete create-to-export using only the keyboard.
- [ ] Complete create-to-composer return at 390 px and 320 px widths.

## 15. Deliberate scope order

### Required for parity and completeness

- [~] Interactive crop; image-within-frame repositioning remains.
- [~] Canvas eyedropper; magnifier and keyboard sampling remain.
- [~] Exact external file drops; full drag-overlay and validation matrix remain.
- [~] Selected-pixel content operations; pointer/keyboard floating move,
  commit/cancel/delete, and structured copy/cut/paste are complete. Floating
  resize/rotation, duplicate semantics, and the broader renderer matrix remain.
- [~] Snap controls, rulers, guides, grid, and coordinates; shared snap behavior
  for crop/drawing/guide motion remains.
- [~] Alpha-aware hit testing; caching and covered-layer cycling remain.
- [~] Pressure, smoothing, hardness, spacing, and brush cursor; hardness,
  spacing, alternate tips, and palm rejection remain.
- [ ] Clear feather/antialias semantics for magic tools.
- [~] Complete generated shortcut/help reference; menu/tooltip/action generation
  and enabled-state reasons remain.
- [~] Text wrapping, underline, and strike; fixed-width overflow and vertical
  alignment remain.
- [ ] High-quality, memory-safe resize.
- [~] Portable project import/export; licensed-font transfer and renderer-pixel
  round-trip coverage remain.
- [~] Brand backgrounds and text styles in the editor; missing-asset recovery
  and mixed-value UI remain.

### Areas where OpenPost should stay ahead

- [~] Non-destructive image erasing and masks.
- [~] Local background removal.
- [x] Multi-page documents and social presets.
- [x] Autosave, revisions, recovery, and conflict protection.
- [x] Templates, Media Library, and composer return.
- [~] Multi-selection, nested groups, alignment, and structured clipboard.
- [~] Touch/mobile and accessibility coverage.
- [~] Provenance, validation, managed media, and deletion protection.

### Add after the completeness contract is green

- [ ] Clone/heal and localized correction brushes.
- [ ] Replace color and color to alpha.
- [ ] Expanded structured shapes and blend modes.
- [ ] Rich text spans.
- [ ] Creative non-destructive effects.
- [ ] Trim, histogram, palette, and safe EXIF tools.
- [ ] Selected-layer/separated-layer export.

### Not current product goals

- [!] BMP/TIFF/Data URL export, recursive directory import, print/CMYK workflows,
  sprite/keypoint utilities, animation-as-layer-frames, novelty effects,
  miniPaint-style localStorage quicksave, and remote URL import. These do not
  improve OpenPost's core social design and publishing workflow enough to carry
  their security, compatibility, and maintenance cost.

## Source map

- Controller and mutation model: `frontend/src/lib/image-editor/editor.svelte.ts`
- Document schema and limits: `frontend/src/lib/image-editor/types.ts` and
  `frontend/src/lib/image-editor/document.ts`
- Canvas gestures: `frontend/src/lib/image-editor/components/image-editor-canvas.svelte`
- Menus, shortcuts, save/export/recovery: `frontend/src/lib/image-editor/components/image-editor-shell.svelte`
- Fabric interaction/rendering: `frontend/src/lib/image-editor/fabric-adapter.ts`
- Static output: `frontend/src/lib/image-editor/static-renderer.ts`
- Selection algorithms: `frontend/src/lib/image-editor/selection.ts`
- Command and shortcut catalog: `frontend/src/lib/image-editor/commands.ts`
- Crop geometry: `frontend/src/lib/image-editor/crop.ts`
- Portable archive boundary: `frontend/src/lib/image-editor/portable-project.ts`
- History: `frontend/src/lib/image-editor/history.ts`
- Guest persistence: `frontend/src/lib/image-editor/local-persistence.ts`
- Browser coverage: `e2e-app/image-editor.spec.ts`
- miniPaint tools: `references/miniPaint/src/js/tools/`
- miniPaint view precision: `references/miniPaint/src/js/modules/view/`
