package notifications

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/passwordmail"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

func notificationsTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	t.Cleanup(func() { _ = db.Close() })
	ctx := context.Background()
	for _, model := range []any{
		(*models.User)(nil),
		(*models.UserNotification)(nil),
		(*models.UserNotificationPreference)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(ctx)
		require.NoError(t, err)
	}
	_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX user_notifications_dedup_test_idx
		ON user_notifications (user_id, dedup_key) WHERE dedup_key <> ''`)
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.User{ID: "user-1", Email: "one@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	return db
}

type recordingNotificationSender struct {
	messages []passwordmail.NotificationMessage
	err      error
}

func (s *recordingNotificationSender) SendPasswordReset(_ context.Context, _ passwordmail.ResetMessage) error {
	return s.err
}

func (s *recordingNotificationSender) SendEmailVerification(_ context.Context, _ passwordmail.VerificationMessage) error {
	return s.err
}

func (s *recordingNotificationSender) SendNotification(_ context.Context, message passwordmail.NotificationMessage) error {
	s.messages = append(s.messages, message)
	return s.err
}

func TestNotificationDedupKeyIsIdempotent(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	input := CreateInput{
		UserID: "user-1", Type: TypePostPublished, Title: "Published",
		DedupKey: "publication:one:published",
	}
	require.NoError(t, service.Create(ctx, input))
	require.NoError(t, service.Create(ctx, input))
	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, count)
}

func TestNotificationPreferencesSuppressOptionalButKeepCritical(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	now := time.Date(2026, 7, 26, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypeNewMessage:    {InApp: false},
		TypePublishFailed: {InApp: false},
	})
	require.NoError(t, err)
	require.False(t, preferences[TypeNewMessage].InApp)
	require.True(t, preferences[TypePublishFailed].InApp)

	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypeNewMessage, Title: "Optional",
	}))
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Critical",
	}))
	page, err := service.List(ctx, "user-1", "", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, "Critical", page.Items[0].Title)
	require.Equal(t, 1, page.UnreadCount)
}

func TestLegacyNotificationPreferencesAdoptNewEmailDefaults(t *testing.T) {
	db := notificationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.UserNotificationPreference{
		UserID:          "user-1",
		PreferencesJSON: `{"publish_failed":{"in_app":true},"post_published":{"in_app":false}}`,
		UpdatedAt:       time.Now().UTC(),
	}).Exec(ctx)
	require.NoError(t, err)

	preferences, err := NewService(db).GetPreferences(ctx, "user-1")
	require.NoError(t, err)
	require.True(t, preferences[TypePublishFailed].Email)
	require.False(t, preferences[TypePostPublished].Email)
	require.False(t, preferences[TypePostPublished].InApp)
}

func TestNotificationEmailDeliveryIsDurableDeduplicatedAndPreferenceAware(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test/"})
	now := time.Date(2026, 8, 4, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	ctx := context.Background()

	require.True(t, DefaultPreferences()[TypePublishFailed].Email)
	require.False(t, DefaultPreferences()[TypePostPublished].Email)
	input := CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Publication failed",
		Body: "OpenPost could not publish to Mastodon.", Href: "/activity?publication=publication-1",
		DedupKey: "publication:publication-1:failed",
	}
	require.NoError(t, service.Create(ctx, input))
	require.NoError(t, service.Create(ctx, input))

	var jobs []models.Job
	require.NoError(t, db.NewSelect().Model(&jobs).Where("type = ?", JobTypeEmailDelivery).Scan(ctx))
	require.Len(t, jobs, 1)
	require.Equal(t, "pending", jobs[0].Status)
	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Equal(t, []passwordmail.NotificationMessage{{
		Recipient:      "one@example.com",
		Title:          "Publication failed",
		Body:           "OpenPost could not publish to Mastodon.",
		ActionURL:      "https://app.openpost.test/activity?publication=publication-1",
		PreferencesURL: "https://app.openpost.test/settings?tab=notifications",
		IdempotencyKey: "notification-" + jobs[0].ID,
	}}, sender.messages)

	preferences, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypePublishFailed: {InApp: true, Email: false},
	})
	require.NoError(t, err)
	require.False(t, preferences[TypePublishFailed].Email)
	require.NoError(t, service.HandleJob(ctx, jobs[0].Type, jobs[0].Payload))
	require.Len(t, sender.messages, 1)
}

func TestNotificationCanDeliverEmailWithoutCreatingOptionalInAppItem(t *testing.T) {
	db := notificationsTestDB(t)
	sender := &recordingNotificationSender{}
	service := NewService(db, Options{Sender: sender, PublicURL: "https://app.openpost.test"})
	ctx := context.Background()

	_, err := service.UpdatePreferences(ctx, "user-1", Preferences{
		TypePostPublished: {InApp: false, Email: true},
	})
	require.NoError(t, err)
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePostPublished, Title: "Publication completed",
		DedupKey: "publication:publication-1:published",
	}))

	count, err := db.NewSelect().Model((*models.UserNotification)(nil)).Count(ctx)
	require.NoError(t, err)
	require.Zero(t, count)
	jobs, err := db.NewSelect().Model((*models.Job)(nil)).Where("type = ?", JobTypeEmailDelivery).Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, jobs)
}

func TestNotificationListScopesMarksAndDeletesByUser(t *testing.T) {
	db := notificationsTestDB(t)
	ctx := context.Background()
	_, err := db.NewInsert().Model(&models.User{ID: "user-2", Email: "two@example.com", PasswordHash: "hash"}).Exec(ctx)
	require.NoError(t, err)
	service := NewService(db)
	for _, input := range []CreateInput{
		{UserID: "user-1", WorkspaceID: "workspace-1", Type: TypePostPublished, Title: "Workspace one"},
		{UserID: "user-1", WorkspaceID: "workspace-2", Type: TypePostPublished, Title: "Workspace two"},
		{UserID: "user-1", Type: TypeWorkspaceInvite, Title: "Global"},
		{UserID: "user-2", WorkspaceID: "workspace-1", Type: TypePostPublished, Title: "Other user"},
	} {
		require.NoError(t, service.Create(ctx, input))
	}

	page, err := service.List(ctx, "user-1", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 2)
	require.Equal(t, 2, page.UnreadCount)
	require.NoError(t, service.MarkRead(ctx, "user-1", []string{page.Items[0].ID}, false))

	page, err = service.List(ctx, "user-1", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Equal(t, 1, page.UnreadCount)
	require.NoError(t, service.Delete(ctx, "user-1", nil, true))

	other, err := service.List(ctx, "user-2", "workspace-1", "", 30)
	require.NoError(t, err)
	require.Len(t, other.Items, 1)
}

func TestNotificationActionsKeepOnlySafeLocalOperations(t *testing.T) {
	db := notificationsTestDB(t)
	service := NewService(db)
	ctx := context.Background()
	require.NoError(t, service.Create(ctx, CreateInput{
		UserID: "user-1", Type: TypePublishFailed, Title: "Partial failure",
		Actions: []models.NotificationAction{
			{Label: "Retry failed", Operation: "retry_failed_publication", TargetID: "publication-1", Kind: "primary"},
			{Label: "View results", Href: "/activity?tab=failed"},
			{Label: "Mixed", Href: "https://provider.example/private", Operation: "retry_failed_publication", TargetID: "publication-2"},
			{Label: "Unsafe", Href: "https://provider.example/private"},
			{Label: "Backslash", Href: `/\provider.example/private`},
			{Label: "Unknown", Operation: "delete_everything", TargetID: "publication-1"},
		},
	}))

	page, err := service.List(ctx, "user-1", "", "", 30)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	require.Equal(t, []models.NotificationAction{
		{Label: "Retry failed", Kind: "primary", Operation: "retry_failed_publication", TargetID: "publication-1"},
		{Label: "View results", Href: "/activity?tab=failed", Kind: "secondary"},
		{Label: "Mixed", Kind: "secondary", Operation: "retry_failed_publication", TargetID: "publication-2"},
	}, page.Items[0].Actions)
}
