# Composing Posts

OpenPost uses one text-and-thread composer for every publication. Add another post to create a thread. Media and connected accounts determine each destination's format.

## Steps

1. Write the shared content and add media.
2. Choose a Social Set or adjust the accounts in **Destinations**.
3. Complete the required fields shown in **All channels**.
4. Open an account tab to preview it, customize its content, or change its platform settings.
5. Fix any errors, then schedule or publish.

Open **Advanced delivery** to change repost behavior for this publication. Keep **Use workspace rules**, choose **Do not repost**, or select **Custom** to replace the target accounts, delay, evaluation window, and engagement gates. The override is saved with the draft and follows it through scheduling and publishing.

OpenPost infers posts, threads, links, documents, image sets, videos, Shorts, and other destination formats from the content. Instagram and Facebook ask for a format only when the same media can validly become more than one format. TikTok photo posts and videos are inferred from the media.

## Drafts and account versions

A draft keeps the shared text, thread parts, and media. Each selected account has its own format, nullable field and media overrides, platform settings, thread changes, and optional schedule override. Changing a shared field updates every destination that still inherits that field. An explicit empty destination field remains empty.

The destination strip shows **All channels** followed by one tab per account. A tab keeps an included but invalid destination visible and shows its issue count. The summary shows how many destinations are ready. Use **Use shared**, **Use shared media**, or **Reset inherited fields** to remove only the intended overrides.

The format field appears only when an account has a meaningful choice. OpenPost can change an inferred format as the source changes, but it never replaces a format you selected explicitly. YouTube Shorts require complete duration and orientation metadata; otherwise OpenPost uses a regular YouTube video.

## Social Sets

A Social Set is a reusable, format-independent account group. It can define a workspace default. Selecting one fills the destination strip; you can still add or remove accounts for the current draft.

The draft copies the set's current accounts. Editing or deleting the Social Set later does not add, remove, or rewrite destinations in an existing draft or scheduled publication.

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

The **Destinations** control shows each selected account, including more than one account from the same platform. Destination tabs expose the chosen format and inherited or custom content, with direct **Preview** and **Platform settings** actions. Platform settings show only the options that fit the current account, format, and media.

You can save an incomplete draft. Before scheduling or publishing, OpenPost checks the account again. It blocks old privacy choices, removed playlists, expired access, invalid media, and conflicting files.

See [Account Options](/usage/destination-options) for the options each social network supports.

## Practical advice

- Keep the shared text simple. Change it only when an account needs a different version.
- Add alt text and media tags in account settings because platforms use different media details.
- Fix all errors before scheduling. A warning may point to app review, API limits, or account limits that OpenPost cannot change.
