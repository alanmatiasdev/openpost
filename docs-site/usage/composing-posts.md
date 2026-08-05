# Composing Posts

OpenPost uses one publication workflow for Post, Thread, Story, Short video, and Video. These choices are starter presets: they set the initial source shape, while every selected account keeps its own format and independently valid rendition.

Choose your authoring layout under **Settings → Composer**:

- **Specialized** keeps the spacious text-and-thread writing canvas and uses focused composers for Story, Short video, and Video. This is the default.
- **Unified** uses the rendition-first publication composer for every starter preset.

Both experiences edit the same publication, shared content, account renditions, and canonical `/publications/:id` draft. You can change the setting at any time and continue editing the same drafts.

## Steps

1. Choose Post, Thread, Story, Short video, or Video.
2. Write the shared content and add media.
3. Choose a Social Set or select connected accounts in **Publish to**.
4. Use **All channels** for shared text and media, then open each destination tab to review its format, content, media, and options.
5. Fix any errors, then save, check, schedule, or publish.

Use **Repost settings** to decide what happens after the publication completes. Keep **Use workspace rules**, choose **Do not repost**, or select **Custom** to replace the target accounts, delay, evaluation window, and engagement gates for this publication. The override is saved with the draft and follows it through scheduling and publishing.

Multiple images stay in the Post. OpenPost sends them as an image, carousel, multi-image post, or photo post based on the platform. If you add a video to Post, the editor asks you to switch to Short video or Video.

## Drafts and account versions

A draft keeps the shared text, thread parts, and media. Each selected account has its own format, nullable field and media overrides, platform settings, thread changes, and optional schedule override. Changing a shared field updates every destination that still inherits that field. An explicit empty destination field remains empty.

The destination strip shows **All channels** followed by one tab per account. A tab keeps an included but invalid destination visible and shows its issue count. The summary shows how many destinations are ready. Use **Use shared**, **Use shared media**, or **Reset inherited fields** to remove only the intended overrides.

The format selector appears only when an account has a meaningful choice. OpenPost can change an inferred format as the source changes, but it never replaces a format you selected explicitly. It never infers Story unless the creation preset or a saved account default requests it.

## Social Sets

A Social Set is a reusable, format-independent account group. It can define a workspace default and an optional default format for each account. Selecting one fills the destination strip; you can still add or remove accounts for the current draft.

The draft copies the set's current accounts and format defaults. Editing or deleting the Social Set later does not add, remove, or rewrite destinations in an existing draft or scheduled publication.

Deselecting an account keeps its saved version and settings. Use **Delete account version** only when you want to remove them.

Each save includes the draft version loaded by the editor. OpenPost saves shared content, thread parts, media, selected accounts, custom text, and settings together. It finishes one save before starting the next. Scheduling and publishing wait for an active save.

If another tab or teammate saves first, OpenPost stops instead of overwriting their work. The conflict dialog lists the affected areas and lets you:

- reload the saved version;
- save your current work as a new draft;
- overwrite only after reviewing the latest revision;
- keep editing without taking an action yet.

When OpenPost knows who made the latest change, the dialog names that person without showing draft content or other workspace data. **Overwrite** first loads the latest saved version, then saves your copy over it.

Closing or hiding a tab triggers a best-effort save, but browsers do not guarantee unload requests. Wait for the saved state before closing when the content matters.

## Platform previews

The **Publish to** menu shows each selected account, including more than one account from the same platform. Each row shows the final output and a short settings summary. Destination tabs expose the chosen format and inherited or custom content. **Platform settings** shows only the options that fit the current account, format, and media.

You can save an incomplete draft. Before scheduling or publishing, OpenPost checks the account again. It blocks old privacy choices, removed playlists, expired access, invalid media, and conflicting files.

See [Account Options](/usage/destination-options) for the options each social network supports.

## Practical advice

- Keep the shared text simple. Change it only when an account needs a different version.
- Add alt text and media tags in account settings because platforms use different media details.
- Fix all errors before scheduling. A warning may point to app review, API limits, or account limits that OpenPost cannot change.
