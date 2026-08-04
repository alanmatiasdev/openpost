# Local References

This directory is for local, gitignored source checkouts used as implementation references.

- `postiz/` is a shallow clone of <https://github.com/gitroomhq/postiz-app>. It is useful when comparing social provider OAuth, account selection, validation, posting, plug automation, multi-account reposts, and delayed workflows.
- `shoutrrr/` is a shallow clone of <https://github.com/coollabsio/shoutrrr>. It is useful when comparing durable repost jobs, engagement thresholds, delay ranges, plateau detection, and per-post overrides.

Both checkouts are ignored by Git. Keep them in this directory as local implementation references; never vendor or commit their contents.

Refresh the checkout when needed:

```sh
git -C references/postiz pull --ff-only
git -C references/shoutrrr pull --ff-only
```
