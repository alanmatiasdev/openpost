package messaging

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

type messagingTestProvider struct{ platform.Adapter }

func (messagingTestProvider) MessagingSupport() platform.MessagingSupport {
	return platform.MessagingSupport{Enabled: true, CanSend: true, RequiresOptIn: true}
}

func (messagingTestProvider) FetchMessages(context.Context, string, platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	return platform.FetchMessagesResult{}, nil
}

func (messagingTestProvider) SendMessage(context.Context, string, platform.SendMessageRequest) (platform.SendMessageResult, error) {
	return platform.SendMessageResult{RemoteMessageID: "remote-message-1"}, nil
}

func TestApplicationEnforcesWorkspaceAccessAndConversationOwnershipAtPublicSeams(t *testing.T) {
	db := messagingTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	for _, row := range []any{
		&models.User{ID: "viewer", Email: "viewer@example.test", PasswordHash: "hash", CreatedAt: now},
		&models.User{ID: "editor", Email: "editor@example.test", PasswordHash: "hash", CreatedAt: now},
		&models.Organization{ID: "organization-1", Name: "Organization", CreatedAt: now},
		&models.Organization{ID: "organization-2", Name: "Other", CreatedAt: now},
		&models.Workspace{ID: "workspace-1", OrganizationID: "organization-1", Name: "Workspace", CreatedAt: now},
		&models.Workspace{ID: "workspace-2", OrganizationID: "organization-2", Name: "Other", CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "viewer", Role: models.WorkspaceRoleViewer, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&models.WorkspaceMember{WorkspaceID: "workspace-1", UserID: "editor", Role: models.WorkspaceRoleEditor, Status: models.WorkspaceMemberStatusActive, CreatedAt: now},
		&models.SocialAccount{ID: "account-1", WorkspaceID: "workspace-1", Platform: "facebook", AccountID: "remote-account", Slug: "account", AccessTokenEnc: []byte("token"), CapabilityState: `{"messages_enabled":"true"}`, IsActive: true, CreatedAt: now},
		&models.Conversation{ID: "conversation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1", Platform: "facebook", RemoteConversationID: "remote-conversation-1", MessagingWindowExpiresAt: now.Add(time.Hour), CreatedAt: now, UpdatedAt: now},
	} {
		_, err := db.NewInsert().Model(row).Exec(ctx)
		require.NoError(t, err)
	}
	service := NewService(db, nil, nil)
	service.SetProvider("facebook", messagingTestProvider{})

	page, err := service.ListConversations(ctx, Actor{UserID: "viewer"}, ConversationQuery{WorkspaceID: "workspace-1"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)

	read := true
	require.ErrorIs(t, service.SetConversationState(ctx, Actor{UserID: "viewer"}, "workspace-1", "conversation-1", &read, nil), ErrAccessDenied)
	_, err = service.QueueMessage(ctx, Actor{UserID: "viewer"}, "conversation-1", "Hello")
	require.ErrorIs(t, err, ErrAccessDenied)
	_, err = service.QueueMessage(ctx, Actor{UserID: "editor"}, "conversation-1", "Hello")
	require.NoError(t, err)
	_, err = service.QueueMessage(ctx, Actor{UserID: "editor"}, "missing-conversation", "Hello")
	require.ErrorIs(t, err, ErrNotFound)
	_, err = service.ListConversations(ctx, Actor{UserID: "outsider"}, ConversationQuery{WorkspaceID: "workspace-1"})
	require.ErrorIs(t, err, ErrAccessDenied)
}

func TestRecurringMessagingChainIsIndependentAndUnique(t *testing.T) {
	db := messagingTestDB(t)
	service := NewService(db, nil, nil)
	runAt := time.Now().UTC().Truncate(time.Second)
	require.NoError(t, service.ScheduleSweep(t.Context(), runAt))
	require.NoError(t, service.ScheduleSweep(t.Context(), runAt.Add(time.Minute)))

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", jobregistry.TypeMessagingSweep).Scan(t.Context()))
	require.Len(t, jobs, 1)
	definition, ok := jobregistry.Lookup(jobregistry.TypeMessagingSweep)
	require.True(t, ok)
	require.Equal(t, jobregistry.ExecuteMessaging, definition.Execution)
	require.Equal(t, jobregistry.RecoverySupersedeSweep, definition.Recovery)
}

func messagingTestDB(t *testing.T) *bun.DB {
	t.Helper()
	db, err := database.InitDBWithDriver("sqlite", fmt.Sprintf("file:messaging-%d?mode=memory&cache=shared", time.Now().UnixNano()))
	require.NoError(t, err)
	require.NoError(t, database.CreateSchema(db))
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}
