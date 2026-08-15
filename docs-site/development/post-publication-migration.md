# Post to Publication migration

Legacy Post HTTP routes, older Post links, CLI command names, and post-named MCP tools are now compatibility surfaces. Publication is the authoring record to use for new API and automation work.

## Sunset

The Post compatibility sunset starts on 2026-08-15. OpenPost will keep the retained Post surfaces for at least 90 days and at least two later stable releases. The earliest removal date is 2026-11-13, and removal still requires the registry evidence gates in [API Compatibility](/development/compatibility-policy).

## Field mapping

| Legacy Post field                       | Publication replacement                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------- |
| `id`                                    | Use `publication_id` returned by compatibility responses, then call `/publications/{id}`. |
| `content`                               | `source_text` and the first segment `body`.                                               |
| `thread_draft` or `/posts/thread` items | `creation_preset: "thread"` with one segment per thread item.                             |
| `social_account_ids`                    | One Rendition per destination `social_account_id`.                                        |
| `media_ids`                             | Segment or Rendition `media` entries.                                                     |
| Post variants                           | Publication Renditions.                                                                   |
| `scheduled_at`                          | `POST /publications/{id}/schedule` after the draft is saved.                              |
| `random_delay_minutes`                  | Publication `random_delay_minutes`.                                                       |
| `status`                                | Publication lifecycle status plus each Rendition status.                                  |

## Route mapping

| Deprecated surface             | Replacement                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `POST /posts`                  | `POST /publications`, then `POST /publications/{id}/schedule` when scheduling.     |
| `GET /posts`                   | `GET /publications`.                                                               |
| `GET /posts/{id}`              | Resolve the alias to `publication_id`, then use `GET /publications/{id}`.          |
| `PATCH /posts/{id}`            | `PATCH /publications/{id}` or schedule and cancel endpoints.                       |
| `DELETE /posts/{id}`           | `DELETE /publications/{id}` with `expected_revision`.                              |
| `POST /posts/draft`            | `POST /publications`.                                                              |
| `PUT /posts/{id}/draft`        | `PATCH /publications/{id}`.                                                        |
| `/posts/{id}/variants`         | `GET /publications/{id}` and `PUT /publications/{id}/renditions`.                  |
| `GET /posts/schedule-overview` | `GET /publications` with `calendar_from` and `calendar_before`, then group by day. |

## CLI and MCP

The maintained CLI already calls Publication endpoints under the `openpost post` and `openpost thread` command names. Keep using the returned Publication IDs in scripts.

MCP post-named tools are compatibility aliases over Publication operations. Prefer `create_publication`, `update_publication`, `schedule_publication`, `cancel_publication`, and Publication reads when the client can discover them.
