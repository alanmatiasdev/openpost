package engagement

import (
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

func TestApplicationEnforcesWorkspaceAccessAtItsPublicSeams(t *testing.T) {
	db := engagementTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	for _, row := range []any{
		&models.User{ID: "viewer", Email: "viewer@example.test", PasswordHash: "hash", CreatedAt: now},
		&models.User{ID: "editor", Email: "editor@example.test", PasswordHash: "hash", CreatedAt: now},
		&models.Workspace{ID: "workspace-1", Name: "Workspace", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "viewer", Role: models.WorkspaceRoleViewer, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "editor", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Platform: "x", AccountID: "remote-account", Slug: "account", AccessTokenEnc: []byte("token"), IsActive: true, CreatedAt: now},
		&models.Publication{ID: "publication-1", WorkspaceID: "workspace-1", CreatedByID: "editor", Status: models.PublicationStatusPublished, CreatedAt: now, UpdatedAt: now},
		&models.Rendition{ID: "rendition-1", PublicationID: "publication-1", SocialAccountID: "account-1", Platform: "x", Status: models.RenditionStatusPublished, ExternalID: "external-1", CreatedAt: now, UpdatedAt: now},
		&models.EngagementItem{ID: "engagement-1", WorkspaceID: "workspace-1", RenditionID: "rendition-1", SocialAccountID: "account-1", Platform: "x", RemoteID: "remote-1", Body: "Hello", CreatedAt: now, UpdatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(ctx)
		require.NoError(t, err)
	}
	service := NewService(db, nil, nil)

	page, err := service.ListEngagement(ctx, Actor{UserID: "viewer"}, Query{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)

	read := true
	require.ErrorIs(t, service.SetEngagementState(ctx, Actor{UserID: "viewer"}, "workspace-1", []string{"engagement-1"}, &read, nil), ErrAccessDenied)
	require.NoError(t, service.SetEngagementState(ctx, Actor{UserID: "editor"}, "workspace-1", []string{"engagement-1"}, &read, nil))
	_, err = service.ListEngagement(ctx, Actor{UserID: "outsider"}, Query{WorkspaceID: "workspace-1"})
	require.ErrorIs(t, err, ErrAccessDenied)
}

func TestRecurringEngagementChainIsIndependentAndUnique(t *testing.T) {
	db := engagementTestDB(t)
	service := NewService(db, nil, nil)
	runAt := time.Now().UTC().Truncate(time.Second)
	require.NoError(t, service.ScheduleSweep(t.Context(), runAt))
	require.NoError(t, service.ScheduleSweep(t.Context(), runAt.Add(time.Minute)))

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", jobregistry.TypeEngagementSweep).Scan(t.Context()))
	require.Len(t, jobs, 1)
	definition, ok := jobregistry.Lookup(jobregistry.TypeEngagementSweep)
	require.True(t, ok)
	require.Equal(t, jobregistry.ExecuteEngagement, definition.Execution)
	require.Equal(t, jobregistry.RecoverySupersedeSweep, definition.Recovery)
}

func engagementTestDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", fmt.Sprintf("file:engagement-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}
