package jobregistry

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func TestEnqueueMediaCleanupIsIdempotentOnlyWhileTheChainIsActive(t *testing.T) {
	t.Parallel()

	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	_, err = db.NewCreateTable().Model((*models.Job)(nil)).Exec(context.Background())
	require.NoError(t, err)
	require.NoError(t, EnsureActiveDedupeIndex(context.Background(), db))

	runAt := time.Now().UTC().Add(time.Hour)
	firstID, created, err := EnqueueMediaCleanup(t.Context(), db, "workspace-1", runAt)
	require.NoError(t, err)
	require.True(t, created)
	secondID, created, err := EnqueueMediaCleanup(t.Context(), db, "workspace-1", runAt.Add(time.Hour))
	require.NoError(t, err)
	require.False(t, created)
	require.Equal(t, firstID, secondID)

	_, err = db.NewUpdate().Model((*models.Job)(nil)).
		Set("status = ?", StatusCompleted).
		Where("id = ?", firstID).
		Exec(t.Context())
	require.NoError(t, err)
	thirdID, created, err := EnqueueMediaCleanup(t.Context(), db, "workspace-1", runAt.Add(2*time.Hour))
	require.NoError(t, err)
	require.True(t, created)
	require.NotEqual(t, firstID, thirdID)
}
