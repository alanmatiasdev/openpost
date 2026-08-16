package messaging

import (
	"context"
	"database/sql"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/providerwrite"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type staticTokenSource struct{}

func (staticTokenSource) GetValidAccessToken(context.Context, string) (string, error) {
	return "access-token", nil
}

type fakeMessenger struct {
	platform.Adapter
	fetches     int
	sends       int
	requests    []platform.FetchMessagesRequest
	result      platform.FetchMessagesResult
	results     map[string]platform.FetchMessagesResult
	support     platform.MessagingSupport
	sendMessage func(context.Context, string, platform.SendMessageRequest) (platform.SendMessageResult, error)
}

func (f *fakeMessenger) MessagingSupport() platform.MessagingSupport {
	if !f.support.Enabled && !f.support.CanSend {
		return platform.MessagingSupport{Enabled: true, CanSend: true, RequiresOptIn: true}
	}
	return f.support
}

func (f *fakeMessenger) FetchMessages(_ context.Context, _ string, input platform.FetchMessagesRequest) (platform.FetchMessagesResult, error) {
	f.fetches++
	f.requests = append(f.requests, input)
	if f.results != nil {
		return f.results[input.Cursor], nil
	}
	return f.result, nil
}

func (f *fakeMessenger) SendMessage(ctx context.Context, token string, req platform.SendMessageRequest) (platform.SendMessageResult, error) {
	f.sends++
	if f.sendMessage != nil {
		return f.sendMessage(ctx, token, req)
	}
	return platform.SendMessageResult{RemoteMessageID: "sent-1", CreatedAt: time.Now().UTC()}, nil
}

func TestMessageSendRecoveryDoesNotReplayAcceptedProviderWrite(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := t.Context()
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "facebook",
		AccountID: "page-1", Slug: "page-1", AccessTokenEnc: []byte("token"), IsActive: true,
		CapabilityState: `{"messages_enabled":"true"}`,
	}
	conversation := &models.Conversation{
		ID: "conversation-1", WorkspaceID: "workspace-1", SocialAccountID: account.ID,
		Platform: account.Platform, RemoteConversationID: "remote-conversation-1",
		CreatedAt: now, UpdatedAt: now,
	}
	message := &models.DirectMessage{
		ID: "message-1", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
		Direction: "outbound", Body: "Hello", AttachmentsJSON: "[]", SendStatus: "queued",
		CreatedAt: now, UpdatedAt: now,
	}
	insertModel(ctx, t, db, account, conversation, message)

	messenger := &fakeMessenger{}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("facebook", messenger)
	require.NoError(t, service.sendMessage(ctx, message.ID))
	require.Equal(t, 1, messenger.sends)

	// Simulate a crash after the provider accepted the write but before the
	// lifecycle write committed: a worker restart requeues the message.
	_, err := db.NewUpdate().Model((*models.DirectMessage)(nil)).
		Set("send_status = 'queued'").Set("remote_message_id = ''").
		Where("id = ?", message.ID).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Conversation)(nil)).
		Set("last_remote_message_id = ''").Where("id = ?", conversation.ID).Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, service.sendMessage(ctx, message.ID))
	require.Equal(t, 1, messenger.sends, "recovery after a local commit failure must reuse the accepted message result")
	require.NoError(t, db.NewSelect().Model(message).WherePK().Scan(ctx))
	require.Equal(t, "sent", message.SendStatus)
	require.Equal(t, "sent-1", message.RemoteMessageID)
}

func TestMessageSendNeverReplaysAmbiguousProviderWrite(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := t.Context()
	now := time.Date(2026, 8, 9, 12, 0, 0, 0, time.UTC)
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "facebook",
		AccountID: "page-1", Slug: "page-1", AccessTokenEnc: []byte("token"), IsActive: true,
		CapabilityState: `{"messages_enabled":"true"}`,
	}
	conversation := &models.Conversation{
		ID: "conversation-1", WorkspaceID: "workspace-1", SocialAccountID: account.ID,
		Platform: account.Platform, RemoteConversationID: "remote-conversation-1",
		CreatedAt: now, UpdatedAt: now,
	}
	message := &models.DirectMessage{
		ID: "message-1", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
		Direction: "outbound", Body: "Hello", AttachmentsJSON: "[]", SendStatus: "queued",
		CreatedAt: now, UpdatedAt: now,
	}
	insertModel(ctx, t, db, account, conversation, message)

	var calls atomic.Int32
	provider := &fakeMessenger{
		support: platform.MessagingSupport{Enabled: true, CanSend: true, RequiresOptIn: false},
		sendMessage: func(context.Context, string, platform.SendMessageRequest) (platform.SendMessageResult, error) {
			calls.Add(1)
			return platform.SendMessageResult{}, context.DeadlineExceeded
		},
	}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("facebook", provider)

	require.Error(t, service.sendMessage(ctx, message.ID))
	require.Error(t, service.sendMessage(ctx, message.ID))
	require.Equal(t, int32(1), calls.Load(), "an ambiguous provider write must never be replayed")

	var attempt models.ProviderWriteAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).
		Where("operation_id = ?", "messaging:"+message.ID).Scan(ctx))
	require.Equal(t, providerwrite.StatusAmbiguous, attempt.Status)
	require.NoError(t, db.NewSelect().Model(message).WherePK().Scan(ctx))
	require.Equal(t, "failed", message.SendStatus)
	require.Contains(t, message.ErrorMessage, "may have accepted")
}

func TestMessageSyncRequiresOptInAndIsIdempotent(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := context.Background()
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "bluesky",
		AccountID: "did:plc:openpost", AccountUsername: "openpost.test",
		AccessTokenEnc: []byte("encrypted"), CapabilityState: `{}`, IsActive: true,
	}
	insertModel(ctx, t, db, account)
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	messenger := &fakeMessenger{result: platform.FetchMessagesResult{
		Conversations: []platform.ProviderConversation{{
			ID: "convo-1", CounterpartRemoteID: "did:plc:ada", CounterpartName: "Ada",
			LastMessageAt: now, LastMessagePreview: "Hello", LastRemoteMessageID: "message-1",
			Messages: []platform.ProviderMessage{{
				ID: "message-1", Direction: "inbound", AuthorRemoteID: "did:plc:ada",
				Body: "Hello", RemoteCreatedAt: now,
			}},
		}},
	}}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("bluesky", messenger)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Zero(t, messenger.fetches)
	var state models.MessagingSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "messages:account:account-1").Scan(ctx))
	require.Equal(t, "disabled", state.Status)

	account.CapabilityState = `{"messages_enabled":"true"}`
	_, err := db.NewUpdate().Model(account).Column("capability_state_json").WherePK().Exec(ctx)
	require.NoError(t, err)
	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, 2, messenger.fetches)

	var conversations []models.Conversation
	require.NoError(t, db.NewSelect().Model(&conversations).Scan(ctx))
	require.Len(t, conversations, 1)
	require.Equal(t, 1, conversations[0].UnreadCount)
	var messages []models.DirectMessage
	require.NoError(t, db.NewSelect().Model(&messages).Scan(ctx))
	require.Len(t, messages, 1)
	require.Equal(t, "Hello", messages[0].Body)
}

func TestListMessagesOrdersStoredMessagesByProviderTime(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.UTC)
	conversation := &models.Conversation{
		ID: "conversation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		Platform: "mastodon", RemoteConversationID: "remote-conversation-1",
		CreatedAt: now, UpdatedAt: now,
	}
	insertModel(ctx, t, db, conversation)
	messages := []models.DirectMessage{
		{
			ID: "message-later", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
			Direction: "inbound", Body: "Later", RemoteCreatedAt: now.Add(time.Minute),
			CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: "message-earlier", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
			Direction: "outbound", Body: "Earlier", RemoteCreatedAt: now.Add(-time.Minute),
			CreatedAt: now.Add(time.Minute), UpdatedAt: now.Add(time.Minute),
		},
	}
	insertModel(ctx, t, db, &messages)

	service := NewService(db, staticTokenSource{}, nil)
	page, err := service.ListMessages(ctx, Actor{UserID: "user-1"}, MessageQuery{WorkspaceID: "workspace-1", ConversationID: conversation.ID, Limit: 100})
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	require.Equal(t, "message-earlier", page.Items[0].ID)
	require.Equal(t, "message-later", page.Items[1].ID)
	require.Nil(t, page.NextCursor)

	_, err = service.ListMessages(ctx, Actor{UserID: "user-1"}, MessageQuery{WorkspaceID: "workspace-2", ConversationID: conversation.ID, Limit: 100})
	require.ErrorIs(t, err, ErrAccessDenied)

	_, err = service.ListMessages(ctx, Actor{UserID: "user-1"}, MessageQuery{WorkspaceID: "workspace-1", ConversationID: "missing", Limit: 100})
	require.ErrorIs(t, err, ErrNotFound)
}

func TestListMessagesCursorReachesEveryRecordWithoutGapsOrDuplicates(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := t.Context()
	timestamp := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	conversation := &models.Conversation{
		ID: "conversation-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		Platform: "bluesky", RemoteConversationID: "remote-conversation-1",
		CreatedAt: timestamp, UpdatedAt: timestamp,
	}
	insertModel(ctx, t, db, conversation)
	messages := make([]models.DirectMessage, 0, 235)
	for index := range 235 {
		messages = append(messages, models.DirectMessage{
			ID: fmt.Sprintf("message-%03d", index), WorkspaceID: "workspace-1",
			ConversationID: conversation.ID, Direction: "inbound", Body: fmt.Sprintf("Message %d", index),
			RemoteCreatedAt: timestamp, CreatedAt: timestamp, UpdatedAt: timestamp,
		})
	}
	insertModel(ctx, t, db, &messages)
	service := NewService(db, staticTokenSource{}, nil)

	seen := make([]string, 0, len(messages))
	var cursor *MessageCursor
	for {
		page, err := service.ListMessages(ctx, Actor{UserID: "user-1"}, MessageQuery{
			WorkspaceID: "workspace-1", ConversationID: conversation.ID, Limit: 37, Cursor: cursor,
		})
		require.NoError(t, err)
		pageIDs := make([]string, 0, len(page.Items))
		for _, message := range page.Items {
			pageIDs = append(pageIDs, message.ID)
		}
		seen = append(pageIDs, seen...)
		if cursor == nil {
			_, err = db.NewInsert().Model(&models.DirectMessage{
				ID: "message-new", WorkspaceID: "workspace-1", ConversationID: conversation.ID,
				Direction: "inbound", Body: "Concurrent arrival", RemoteCreatedAt: timestamp.Add(time.Hour),
				CreatedAt: timestamp.Add(time.Hour), UpdatedAt: timestamp.Add(time.Hour),
			}).Exec(ctx)
			require.NoError(t, err)
		}
		cursor = page.NextCursor
		if cursor == nil {
			break
		}
	}
	require.Len(t, seen, 235)
	require.Equal(t, len(seen), len(uniqueStrings(seen)))
	require.NotContains(t, seen, "message-new")
	for index, id := range seen {
		require.Equal(t, fmt.Sprintf("message-%03d", index), id)
	}
}

func TestMessageSyncAlwaysChecksNewestPageWhileBackfilling(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "bluesky",
		AccountID: "did:plc:openpost", AccessTokenEnc: []byte("encrypted"),
		CapabilityState: `{"messages_enabled":"true"}`, IsActive: true,
	}
	insertModel(ctx, t, db, account)
	conversation := func(id, message string, createdAt time.Time) platform.ProviderConversation {
		return platform.ProviderConversation{
			ID: id, CounterpartRemoteID: "did:plc:" + id, CounterpartName: id,
			LastMessageAt: createdAt, LastMessagePreview: message, LastRemoteMessageID: "message-" + id,
			Messages: []platform.ProviderMessage{{
				ID: "message-" + id, Direction: "inbound", Body: message, RemoteCreatedAt: createdAt,
			}},
		}
	}
	messenger := &fakeMessenger{results: map[string]platform.FetchMessagesResult{
		"": {
			Conversations: []platform.ProviderConversation{conversation("newest", "New", now)},
			NextCursor:    "older-page",
		},
		"older-page": {
			Conversations: []platform.ProviderConversation{conversation("older", "Old", now.Add(-24*time.Hour))},
		},
	}}
	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("bluesky", messenger)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, "", messenger.requests[0].Cursor)
	var state models.MessagingSyncState
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "messages:account:account-1").Scan(ctx))
	require.Equal(t, "older-page", state.Cursor)
	require.False(t, state.BackfillComplete)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, []string{"", "older-page"}, []string{messenger.requests[1].Cursor, messenger.requests[2].Cursor})
	require.NoError(t, db.NewSelect().Model(&state).Where("id = ?", "messages:account:account-1").Scan(ctx))
	require.Empty(t, state.Cursor)
	require.True(t, state.BackfillComplete)

	require.NoError(t, service.HandleJob(ctx, JobTypeMessagesSync, `{"id":"account-1"}`))
	require.Equal(t, "", messenger.requests[3].Cursor)
	require.Len(t, messenger.requests, 4)
	count, countErr := db.NewSelect().Model((*models.Conversation)(nil)).Count(ctx)
	require.NoError(t, countErr)
	require.Equal(t, 2, count)
}

func TestQueueMessageEnforcesProviderWindowBeforeCreatingJob(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := context.Background()
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	account := &models.SocialAccount{
		ID: "account-1", WorkspaceID: "workspace-1", Platform: "facebook", AccountID: "page-1",
		AccessTokenEnc: []byte("encrypted"), CapabilityState: `{"messages_enabled":"true"}`, IsActive: true,
	}
	insertModel(ctx, t, db, account)
	conversation := &models.Conversation{
		ID: "convo-1", WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		Platform: "facebook", RemoteConversationID: "remote-1",
		MessagingWindowExpiresAt: now.Add(-time.Minute), CreatedAt: now, UpdatedAt: now,
	}
	insertModel(ctx, t, db, conversation)

	service := NewService(db, staticTokenSource{}, nil)
	service.now = func() time.Time { return now }
	service.SetProvider("facebook", &fakeMessenger{})
	_, err := service.QueueMessage(ctx, Actor{UserID: "user-1"}, "convo-1", "Too late")
	require.ErrorContains(t, err, "reply window has closed")
	count, countErr := db.NewSelect().Model((*models.Job)(nil)).Count(ctx)
	require.NoError(t, countErr)
	require.Zero(t, count)

	conversation.MessagingWindowExpiresAt = now.Add(time.Hour)
	_, err = db.NewUpdate().Model(conversation).Column("messaging_window_expires_at").WherePK().Exec(ctx)
	require.NoError(t, err)
	message, err := service.QueueMessage(ctx, Actor{UserID: "user-1"}, "convo-1", " On time ")
	require.NoError(t, err)
	require.Equal(t, "On time", message.Body)
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", JobTypeMessageSend).Scan(ctx))
	require.Equal(t, 1, job.MaxAttempts)
	require.NoError(t, db.NewSelect().Model(conversation).Where("id = ?", "convo-1").Scan(ctx))
	require.Equal(t, "On time", conversation.LastMessagePreview)
}

func TestListConversationsCursorReachesEveryRecordWithoutGapsOrDuplicates(t *testing.T) {
	db := messagingBehaviorTestDB(t)
	ctx := t.Context()
	timestamp := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	conversations := make([]models.Conversation, 0, 235)
	for index := range 235 {
		conversations = append(conversations, models.Conversation{
			ID: fmt.Sprintf("conversation-%03d", index), WorkspaceID: "workspace-1",
			SocialAccountID: "account-1", Platform: "bluesky",
			RemoteConversationID: fmt.Sprintf("remote-%03d", index), LastMessageAt: timestamp,
			CreatedAt: timestamp, UpdatedAt: timestamp,
		})
	}
	insertModel(ctx, t, db, &conversations)
	service := NewService(db, staticTokenSource{}, nil)

	seen := make([]string, 0, len(conversations))
	var cursor *ConversationCursor
	for {
		page, err := service.ListConversations(ctx, Actor{UserID: "user-1"}, ConversationQuery{
			WorkspaceID: "workspace-1", Platform: "bluesky", AccountID: "account-1",
			Limit: 37, Cursor: cursor,
		})
		require.NoError(t, err)
		for _, conversation := range page.Items {
			seen = append(seen, conversation.ID)
		}
		if cursor == nil {
			_, err = db.NewInsert().Model(&models.Conversation{
				ID: "conversation-new", WorkspaceID: "workspace-1", SocialAccountID: "account-1",
				Platform: "bluesky", RemoteConversationID: "remote-new",
				LastMessageAt: timestamp.Add(time.Hour), CreatedAt: timestamp.Add(time.Hour),
				UpdatedAt: timestamp.Add(time.Hour),
			}).Exec(ctx)
			require.NoError(t, err)
		}
		cursor = page.NextCursor
		if cursor == nil {
			break
		}
	}
	require.Len(t, seen, 235)
	require.Equal(t, len(seen), len(uniqueStrings(seen)))
	require.NotContains(t, seen, "conversation-new")
	for index, id := range seen {
		require.Equal(t, fmt.Sprintf("conversation-%03d", 234-index), id)
	}
}

func insertModel(ctx context.Context, t *testing.T, db *bun.DB, models ...any) {
	t.Helper()
	for _, model := range models {
		_, err := db.NewInsert().Model(model).Exec(ctx)
		require.NoError(t, err)
	}
}

func uniqueStrings(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}

// messagingBehaviorTestDB builds a narrow in-memory schema for messaging
// behavior tests. Full-schema fixtures (service_test.go) cover authorization
// at the public seams; these tests focus on cursor, opt-in, reply-window,
// backfill, and provider-write-fence behavior.
func messagingBehaviorTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.Organization)(nil),
		(*models.Workspace)(nil),
		(*models.WorkspaceMember)(nil),
		(*models.User)(nil),
		(*models.SocialAccount)(nil),
		(*models.Job)(nil),
		(*models.ProviderWriteAttempt)(nil),
		(*models.MessagingSyncState)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	now := time.Now().UTC()
	_, err = db.NewInsert().Model(&models.Organization{ID: "organization-1", Name: "Studio", CreatedByID: "user-1", CreatedAt: now, UpdatedAt: now}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&[]models.Workspace{
		{ID: "workspace-1", OrganizationID: "organization-1", Name: "Primary", CreatedAt: now},
		{ID: "workspace-2", OrganizationID: "organization-1", Name: "Secondary", CreatedAt: now},
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{
		ID: "user-1", Email: "user-1@example.test", PasswordHash: "hash", CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.WorkspaceMember{
		WorkspaceID: "workspace-1", UserID: "user-1", Role: models.WorkspaceRoleEditor,
		Status: models.WorkspaceMemberStatusActive, CreatedAt: now,
	}).Exec(ctx)
	require.NoError(t, err)
	_, err = db.ExecContext(ctx, `
CREATE TABLE conversations (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, social_account_id TEXT NOT NULL,
	platform TEXT NOT NULL, remote_conversation_id TEXT NOT NULL,
	counterpart_remote_id TEXT NOT NULL DEFAULT '', counterpart_name TEXT NOT NULL DEFAULT '',
	counterpart_handle TEXT NOT NULL DEFAULT '', counterpart_avatar_url TEXT NOT NULL DEFAULT '',
	last_message_at TIMESTAMP, last_message_preview TEXT NOT NULL DEFAULT '',
	last_remote_message_id TEXT NOT NULL DEFAULT '', unread_count INTEGER NOT NULL DEFAULT 0,
	read_at TIMESTAMP, archived_at TIMESTAMP, messaging_window_expires_at TIMESTAMP,
	created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL,
	UNIQUE (social_account_id, remote_conversation_id)
);
CREATE TABLE direct_messages (
	id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
	remote_message_id TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL,
	author_remote_id TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
	attachments_json TEXT NOT NULL DEFAULT '[]', send_status TEXT NOT NULL DEFAULT 'received',
	error_message TEXT NOT NULL DEFAULT '', remote_created_at TIMESTAMP,
	created_at TIMESTAMP NOT NULL, updated_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX direct_messages_remote_test_idx
	ON direct_messages (conversation_id, remote_message_id) WHERE remote_message_id <> '';
CREATE UNIQUE INDEX messaging_subject_active_unique_test_idx
	ON jobs (type, payload)
	WHERE status IN ('pending', 'processing') AND type IN ('messages_sync', 'message_send');
`)
	require.NoError(t, err)
	return db
}
