# Retire Post as an authoring model

Publication is OpenPost's only stored authoring aggregate. The web composer, HTTP API, CLI, MCP tools, durable publishing work, media ownership, and historical content converge on Publications and Renditions.

Post was removed in stages. First, retained `/posts` operations translated through a compatibility adapter and a legacy identifier alias while the deep Publication module, composer session, and cross-cutting ownership moved onto Publication and Rendition. Once historical content and non-terminal Jobs migrated safely and the compatibility sunset passed, the Post runtime, storage, and compatibility surfaces were removed: the Post HTTP routes, post-named MCP tools, the `publish_post` Job kind, the `posts` service, and the `posts`, `post_destinations`, `post_media`, `post_variants`, and `thread_drafts` tables are gone.

Two things remain intentionally:

- Historical migration files still reference the legacy schema so an older database can upgrade in place; a retirement boundary drops the legacy tables only after the backfill completes and no Post rows or pending `publish_post` Jobs remain.
- Immutable `legacy_post` and `legacy_post_variant` aliases resolve old links to the canonical Publication (and, for thread children, the canonical segment). The aliases store no content, status, schedule, or provider state.

"Post" remains ordinary user-facing language, and reusable posting schedules and shared Media remain independent domain concepts.
