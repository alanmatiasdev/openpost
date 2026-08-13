package migrations

import (
	"context"
	"testing"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
)

func TestRunMigrationsBackfillsSubmittedWorkspaceActivationOnce(t *testing.T) {
	db := newMigrationsTestDB(t)
	ctx := context.Background()
	for _, model := range []any{
		(*models.Workspace)(nil), (*models.SocialAccount)(nil), (*models.Publication)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err := db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Activated"}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.SocialAccount{
		ID: "account-1", WorkspaceID: "ws-1", Slug: "main", Platform: "x", AccountID: "1",
		AccessTokenEnc: []byte("token"), IsActive: true,
	}).Exec(ctx)
	require.NoError(t, err)
	now := time.Now().UTC()
	publications := []models.Publication{
		{ID: "failed-first", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusFailed, ScheduledAt: now, UpdatedAt: now.Add(2 * time.Hour)},
		{ID: "published-later", WorkspaceID: "ws-1", CreatedByID: "user-1", Status: models.PublicationStatusPublished, ScheduledAt: now.Add(time.Hour), UpdatedAt: now.Add(time.Hour)},
	}
	_, err = db.NewInsert().Model(&publications).Exec(ctx)
	require.NoError(t, err)

	require.NoError(t, runTestMigrations(t, db))
	var activation models.WorkspaceActivation
	require.NoError(t, db.NewSelect().Model(&activation).Where("workspace_id = ?", "ws-1").Scan(ctx))
	require.Equal(t, "failed-first", activation.PublicationID)
	eventCount, err := db.NewSelect().Model((*models.ProductAnalyticsEvent)(nil)).Where("workspace_id = ?", "ws-1").Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, eventCount)
}
