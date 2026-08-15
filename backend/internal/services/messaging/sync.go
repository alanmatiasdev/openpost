package messaging

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/uptrace/bun"
)

type receivedMessage struct {
	conversationID string
	messageID      string
	senderName     string
	provider       string
}

func (s *Service) syncMessages(ctx context.Context, accountID string) error {
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).Where("id = ? AND is_active = ?", accountID, true).Scan(ctx); err != nil {
		return err
	}
	provider := s.provider(account)
	if provider == nil || !provider.MessagingSupport().Enabled {
		return s.states.record(ctx, account, "unsupported", "unsupported", "Messages are not supported for this provider.", "", false, 0, 0, s.now())
	}
	if provider.MessagingSupport().RequiresOptIn && !accountMessagesEnabled(account) {
		return s.states.record(ctx, account, "disabled", "opt_in_required", "Enable inbox sync for this account to collect messages.", "", false, 0, 0, s.now())
	}
	state, err := s.states.load(ctx, account.ID)
	if err != nil {
		return err
	}
	cursor, backfillComplete, emptyStreak := "", false, 0
	if state != nil {
		cursor, backfillComplete, emptyStreak = state.Cursor, state.BackfillComplete, state.EmptyStreak
	}
	if s.tokens == nil {
		return errors.New("messaging token source is unavailable")
	}
	token, err := s.tokens.GetValidAccessToken(ctx, account.ID)
	if err != nil {
		return s.states.record(ctx, account, "failed", "authentication", "Reconnect this account to resume messages.", cursor, backfillComplete, time.Hour, emptyStreak, s.now())
	}
	result, err := provider.FetchMessages(ctx, token, platform.FetchMessagesRequest{AccountID: account.AccountID, Limit: 100})
	if err != nil {
		return s.states.record(ctx, account, "failed", "provider_error", "OpenPost could not collect messages from this provider.", cursor, backfillComplete, time.Hour, emptyStreak, s.now())
	}
	received, err := s.persistConversations(ctx, account, result.Conversations)
	if err != nil {
		return err
	}
	fetchedCount := len(result.Conversations)
	nextCursor := cursor
	if !backfillComplete {
		if cursor == "" {
			nextCursor = result.NextCursor
			backfillComplete = nextCursor == ""
		} else {
			older, fetchErr := provider.FetchMessages(ctx, token, platform.FetchMessagesRequest{AccountID: account.AccountID, Cursor: cursor, Limit: 100})
			if fetchErr != nil {
				return s.states.record(ctx, account, "failed", "backfill_failed", "Current messages were collected, but OpenPost could not collect older message history.", cursor, false, time.Hour, emptyStreak, s.now())
			}
			olderReceived, persistErr := s.persistConversations(ctx, account, older.Conversations)
			if persistErr != nil {
				return persistErr
			}
			received = append(received, olderReceived...)
			fetchedCount += len(older.Conversations)
			nextCursor, backfillComplete = older.NextCursor, older.NextCursor == ""
		}
	}
	s.notifyReceivedMessages(ctx, account, received)
	if fetchedCount == 0 {
		emptyStreak++
	} else {
		emptyStreak = 0
	}
	return s.states.record(ctx, account, "ok", "", "", nextCursor, backfillComplete, messageCadence(emptyStreak), emptyStreak, s.now())
}

func (s *Service) persistConversations(ctx context.Context, account models.SocialAccount, fetched []platform.ProviderConversation) ([]receivedMessage, error) {
	now := s.now()
	received := make([]receivedMessage, 0)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		for _, remote := range fetched {
			if remote.ID == "" {
				continue
			}
			conversationID, unreadCount, err := upsertConversation(txCtx, tx, account, remote, now)
			if err != nil {
				return err
			}
			newInbound := 0
			for _, remoteMessage := range remote.Messages {
				inserted, err := insertProviderMessage(txCtx, tx, account, conversationID, remoteMessage, now)
				if err != nil {
					return err
				}
				if inserted && remoteMessage.Direction == "inbound" {
					newInbound++
					received = append(received, receivedMessage{
						conversationID: conversationID, messageID: remoteMessage.ID,
						senderName: firstNonEmpty(remote.CounterpartName, remote.CounterpartHandle, "a social account"),
						provider:   account.Platform,
					})
				}
			}
			if newInbound > 0 {
				_, err = tx.NewUpdate().Model((*models.Conversation)(nil)).
					Set("unread_count = ?", unreadCount+newInbound).Set("read_at = NULL").
					Where("id = ?", conversationID).Exec(txCtx)
				if err != nil {
					return err
				}
			}
		}
		return nil
	})
	return received, err
}

func upsertConversation(ctx context.Context, db bun.IDB, account models.SocialAccount, remote platform.ProviderConversation, now time.Time) (string, int, error) {
	var existing models.Conversation
	err := db.NewSelect().Model(&existing).
		Where("social_account_id = ? AND remote_conversation_id = ?", account.ID, remote.ID).Scan(ctx)
	conversationID := existing.ID
	if errors.Is(err, sql.ErrNoRows) {
		conversationID = uuid.NewString()
	} else if err != nil {
		return "", 0, err
	}
	conversation := &models.Conversation{
		ID: conversationID, WorkspaceID: account.WorkspaceID, SocialAccountID: account.ID,
		Platform: account.Platform, RemoteConversationID: remote.ID,
		CounterpartRemoteID: remote.CounterpartRemoteID, CounterpartName: remote.CounterpartName,
		CounterpartHandle: remote.CounterpartHandle, CounterpartAvatarURL: remote.CounterpartAvatarURL,
		LastMessageAt: remote.LastMessageAt, LastMessagePreview: remote.LastMessagePreview,
		LastRemoteMessageID: remote.LastRemoteMessageID, UnreadCount: existing.UnreadCount,
		MessagingWindowExpiresAt: remote.ReplyWindowExpiresAt, CreatedAt: now, UpdatedAt: now,
	}
	_, err = db.NewInsert().Model(conversation).On("CONFLICT (social_account_id, remote_conversation_id) DO UPDATE").
		Set("counterpart_remote_id = EXCLUDED.counterpart_remote_id").Set("counterpart_name = EXCLUDED.counterpart_name").
		Set("counterpart_handle = EXCLUDED.counterpart_handle").Set("counterpart_avatar_url = EXCLUDED.counterpart_avatar_url").
		Set("last_message_at = EXCLUDED.last_message_at").Set("last_message_preview = EXCLUDED.last_message_preview").
		Set("last_remote_message_id = EXCLUDED.last_remote_message_id").
		Set("messaging_window_expires_at = EXCLUDED.messaging_window_expires_at").Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
	return conversationID, existing.UnreadCount, err
}

func insertProviderMessage(ctx context.Context, db bun.IDB, account models.SocialAccount, conversationID string, remote platform.ProviderMessage, now time.Time) (bool, error) {
	if remote.ID == "" {
		return false, nil
	}
	exists, err := db.NewSelect().Model((*models.DirectMessage)(nil)).
		Where("conversation_id = ? AND remote_message_id = ?", conversationID, remote.ID).Exists(ctx)
	if err != nil || exists {
		return false, err
	}
	attachments, _ := json.Marshal(remote.Attachments)
	status := "received"
	if remote.Direction == "outbound" {
		status = "sent"
	}
	message := &models.DirectMessage{
		ID: uuid.NewString(), WorkspaceID: account.WorkspaceID, ConversationID: conversationID,
		RemoteMessageID: remote.ID, Direction: remote.Direction, AuthorRemoteID: remote.AuthorRemoteID,
		Body: remote.Body, AttachmentsJSON: string(attachments), SendStatus: status,
		RemoteCreatedAt: remote.RemoteCreatedAt, CreatedAt: now, UpdatedAt: now,
	}
	result, err := db.NewInsert().Model(message).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return false, err
	}
	rows, err := result.RowsAffected()
	return rows == 1, err
}

func (s *Service) notifyReceivedMessages(ctx context.Context, account models.SocialAccount, received []receivedMessage) {
	if s.notifications == nil {
		return
	}
	for _, message := range received {
		for _, userID := range s.workspaceMemberIDs(ctx, account.WorkspaceID) {
			outcome, err := notifications.NewMessageReceivedOutcome(notifications.MessageReceivedFacts{
				RecipientUserID: userID, WorkspaceID: account.WorkspaceID,
				ConversationID: message.conversationID, MessageID: message.messageID,
				Provider: message.provider, SenderName: message.senderName,
			})
			if err == nil {
				_ = s.notifications.Record(ctx, outcome)
			}
		}
	}
}

func (s *Service) workspaceMemberIDs(ctx context.Context, workspaceID string) []string {
	var ids []string
	_ = s.db.NewSelect().Model((*models.WorkspaceMember)(nil)).Column("user_id").
		Where("workspace_id = ? AND status = ?", workspaceID, models.WorkspaceMemberStatusActive).Scan(ctx, &ids)
	return ids
}

func messageCadence(emptyStreak int) time.Duration {
	switch {
	case emptyStreak >= 12:
		return 6 * time.Hour
	case emptyStreak >= 4:
		return time.Hour
	default:
		return 15 * time.Minute
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}
