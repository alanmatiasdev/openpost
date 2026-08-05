-- Some operator and migration-test databases intentionally contain only a
-- subset of the application schema. Keep the lifecycle migration replayable
-- there without changing full installations, where this table already exists.
CREATE TABLE IF NOT EXISTS media_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL DEFAULT 'library',
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
);

ALTER TABLE media_attachments ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'library';
ALTER TABLE media_attachments ADD COLUMN last_used_at TIMESTAMP NULL;
ALTER TABLE media_attachments ADD COLUMN trashed_at TIMESTAMP NULL;
ALTER TABLE media_attachments ADD COLUMN purge_after TIMESTAMP NULL;
ALTER TABLE media_attachments ADD COLUMN trash_reason TEXT NOT NULL DEFAULT '';

UPDATE media_attachments
SET last_used_at = created_at
WHERE last_used_at IS NULL;

UPDATE media_attachments
SET asset_kind = 'library', retention_class = 'library'
WHERE asset_kind = 'brand_asset';

CREATE INDEX IF NOT EXISTS media_attachments_workspace_lifecycle_idx
  ON media_attachments (workspace_id, retention_class, trashed_at, last_used_at);

CREATE INDEX IF NOT EXISTS media_attachments_purge_after_idx
  ON media_attachments (purge_after)
  WHERE purge_after IS NOT NULL;
