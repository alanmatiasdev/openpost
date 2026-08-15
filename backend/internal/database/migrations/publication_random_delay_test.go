package migrations

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsAddsPublicationRandomDelayState(t *testing.T) {
	t.Parallel()
	db := newMigrationsTestDB(t)
	require.NoError(t, runTestMigrations(t, db))

	ctx := context.Background()
	seedMigrationUser(ctx, t, db)
	_, err := db.NewInsert().Model(&models.Workspace{ID: "workspace-delay", Name: "Delay"}).Exec(ctx)
	require.NoError(t, err)
	publication := &models.Publication{
		ID: "publication-delay", WorkspaceID: "workspace-delay", CreatedByID: "user-1",
		Title: "Delayed", SourceContent: "Delayed", MetadataJSON: "{}", ReleasePlanJSON: "{}",
	}
	_, err = db.NewInsert().Model(publication).Exec(ctx)
	require.NoError(t, err)

	var stored models.Publication
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", publication.ID).Scan(ctx))
	require.Zero(t, stored.RandomDelayMinutes)
	require.False(t, stored.RandomDelayExplicit)
}
