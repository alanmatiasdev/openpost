package migrations

import (
	"context"
	"database/sql"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

func TestOrganizationOwnershipTransferMigrationEnforcesOnePendingTransfer(t *testing.T) {
	sqlDB, err := sql.Open(sqliteshim.ShimName, ":memory:")
	require.NoError(t, err)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	ctx := context.Background()
	_, err = db.ExecContext(ctx, `CREATE TABLE users (id TEXT PRIMARY KEY); CREATE TABLE organizations (id TEXT PRIMARY KEY); INSERT INTO users VALUES ('owner'), ('nominee'), ('other'); INSERT INTO organizations VALUES ('org')`)
	require.NoError(t, err)
	raw, err := migrationFiles.ReadFile("097_organization_ownership_transfers.sql")
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, string(raw))
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO organization_ownership_transfers (id, organization_id, prior_owner_user_id, nominee_user_id, status, expires_at) VALUES ('one', 'org', 'owner', 'nominee', 'pending', CURRENT_TIMESTAMP)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO organization_ownership_transfers (id, organization_id, prior_owner_user_id, nominee_user_id, status, expires_at) VALUES ('two', 'org', 'owner', 'other', 'pending', CURRENT_TIMESTAMP)`)
	require.Error(t, err)
	_, err = db.ExecContext(ctx, `UPDATE organization_ownership_transfers SET status = 'revoked' WHERE id = 'one'`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO organization_ownership_transfers (id, organization_id, prior_owner_user_id, nominee_user_id, status, expires_at) VALUES ('two', 'org', 'owner', 'other', 'pending', CURRENT_TIMESTAMP)`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO organization_ownership_audit_events (id, organization_id, transfer_id, actor_user_id, nominee_user_id, action, result) VALUES ('audit-1', 'org', 'two', 'owner', 'other', 'ownership_transfer.initiated', 'succeeded')`)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `INSERT INTO organization_ownership_audit_events (id, organization_id, transfer_id, actor_user_id, nominee_user_id, action, result) VALUES ('audit-2', 'org', 'two', 'owner', 'other', 'ownership_transfer.failed', 'pending')`)
	require.Error(t, err, "ownership audit evidence accepts only terminal projection results")
	var transferID, nomineeUserID, result string
	require.NoError(t, db.QueryRowContext(ctx, `SELECT transfer_id, nominee_user_id, result FROM organization_ownership_audit_events WHERE id = 'audit-1'`).Scan(&transferID, &nomineeUserID, &result))
	require.Equal(t, "two", transferID)
	require.Equal(t, "other", nomineeUserID)
	require.Equal(t, "succeeded", result)
}
