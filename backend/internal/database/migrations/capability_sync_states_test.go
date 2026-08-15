package migrations

import (
	"context"
	"testing"
	"testing/fstest"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestCapabilitySyncStateMigrationPreservesRecoveryState(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	_, err := db.Exec(`
CREATE TABLE communication_sync_states (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, capability TEXT NOT NULL,
 subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, social_account_id TEXT NOT NULL,
 platform TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT NOT NULL DEFAULT '',
 error_message TEXT NOT NULL DEFAULT '', cursor TEXT NOT NULL DEFAULT '',
 backfill_complete BOOLEAN NOT NULL DEFAULT FALSE, last_attempted_at TIMESTAMP,
 last_success_at TIMESTAMP, next_sync_at TIMESTAMP, empty_streak INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL
);
CREATE TABLE renditions (id TEXT PRIMARY KEY);
CREATE TABLE social_accounts (id TEXT PRIMARY KEY);
CREATE TABLE jobs (type TEXT, status TEXT, locked_at TIMESTAMP, locked_by TEXT, last_error TEXT);
INSERT INTO renditions (id) VALUES ('rendition-1');
INSERT INTO social_accounts (id) VALUES ('account-1'), ('account-2');
INSERT INTO communication_sync_states VALUES
 ('engagement:rendition:rendition-1', 'workspace-1', 'engagement', 'rendition', 'rendition-1', 'account-1', 'x', 'error', 'rate_limit', 'Try later', 'eng-cursor', 1, '2026-08-15 10:00:00', '2026-08-15 09:00:00', '2026-08-15 11:00:00', 2, '2026-08-15 08:00:00', '2026-08-15 10:00:00'),
 ('messages:account:account-2', 'workspace-1', 'messages', 'account', 'account-2', 'mastodon', 'permission_required', 'authentication', 'Reconnect', 'msg-cursor', 0, '2026-08-15 10:00:00', '2026-08-15 09:00:00', '2026-08-16 10:00:00', 3, '2026-08-15 08:00:00', '2026-08-15 10:00:00');
INSERT INTO jobs VALUES ('communications_sweep', 'pending', NULL, '', '');
`)
	require.NoError(t, err)

	sql, err := migrationFiles.ReadFile("104_capability_sync_states.sql")
	require.NoError(t, err)
	require.NoError(t, runMigrations(db, fstest.MapFS{
		"104_capability_sync_states.sql": {Data: sql},
	}))

	var engagement models.EngagementSyncState
	require.NoError(t, db.NewSelect().Model(&engagement).Where("id = ?", "engagement:rendition:rendition-1").Scan(ctx))
	require.Equal(t, "rendition-1", engagement.RenditionID)
	require.Equal(t, "eng-cursor", engagement.Cursor)
	require.Equal(t, "rate_limit", engagement.ErrorCode)
	require.WithinDuration(t, time.Date(2026, 8, 15, 11, 0, 0, 0, time.UTC), engagement.NextSyncAt, time.Second)

	var messaging models.MessagingSyncState
	require.NoError(t, db.NewSelect().Model(&messaging).Where("id = ?", "messages:account:account-2").Scan(ctx))
	require.Equal(t, "msg-cursor", messaging.Cursor)
	require.Equal(t, "authentication", messaging.ErrorCode)
	require.False(t, messaging.BackfillComplete)

	var status, lastError string
	require.NoError(t, db.QueryRowContext(ctx, "SELECT status, last_error FROM jobs WHERE type = 'communications_sweep'").Scan(&status, &lastError))
	require.Equal(t, "completed", status)
	require.Contains(t, lastError, "Superseded")
}
