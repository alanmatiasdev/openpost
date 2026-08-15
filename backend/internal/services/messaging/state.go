package messaging

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	messagingCapability = "messages"
	messagingSubject    = "account"
)

type stateRepository interface {
	load(context.Context, string) (*models.CommunicationSyncState, error)
	due(context.Context, string, time.Time) bool
	record(context.Context, models.SocialAccount, string, string, string, string, bool, time.Duration, int, time.Time) error
	list(context.Context, string) ([]models.CommunicationSyncState, error)
}

type bunStateRepository struct{ db *bun.DB }

func newStateRepository(db *bun.DB) stateRepository { return bunStateRepository{db: db} }

func (r bunStateRepository) load(ctx context.Context, accountID string) (*models.CommunicationSyncState, error) {
	var state models.CommunicationSyncState
	err := r.db.NewSelect().Model(&state).Where("id = ?", stateID(accountID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &state, err
}

func (r bunStateRepository) due(ctx context.Context, accountID string, now time.Time) bool {
	state, err := r.load(ctx, accountID)
	return err == nil && (state == nil || state.NextSyncAt.IsZero() || !state.NextSyncAt.After(now))
}

func (r bunStateRepository) list(ctx context.Context, workspaceID string) ([]models.CommunicationSyncState, error) {
	states := []models.CommunicationSyncState{}
	err := r.db.NewSelect().Model(&states).
		Where("workspace_id = ? AND capability = ?", workspaceID, messagingCapability).
		Order("platform ASC", "social_account_id ASC").Scan(ctx)
	return states, err
}

func (r bunStateRepository) record(
	ctx context.Context,
	account models.SocialAccount,
	status, code, message, cursor string,
	backfillComplete bool,
	cadence time.Duration,
	emptyStreak int,
	now time.Time,
) error {
	state := &models.CommunicationSyncState{
		ID: stateID(account.ID), WorkspaceID: account.WorkspaceID,
		Capability: messagingCapability, SubjectType: messagingSubject, SubjectID: account.ID,
		SocialAccountID: account.ID, Platform: account.Platform, Status: status,
		ErrorCode: code, ErrorMessage: message, Cursor: cursor, BackfillComplete: backfillComplete,
		LastAttemptedAt: now, EmptyStreak: emptyStreak, CreatedAt: now, UpdatedAt: now,
	}
	if status == "ok" {
		state.LastSuccessAt = now
	}
	if cadence > 0 {
		state.NextSyncAt = now.Add(cadence)
	}
	_, err := r.db.NewInsert().Model(state).
		On("CONFLICT (id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").Set("social_account_id = EXCLUDED.social_account_id").
		Set("platform = EXCLUDED.platform").Set("status = EXCLUDED.status").
		Set("error_code = EXCLUDED.error_code").Set("error_message = EXCLUDED.error_message").
		Set("cursor = EXCLUDED.cursor").Set("backfill_complete = EXCLUDED.backfill_complete").
		Set("last_attempted_at = EXCLUDED.last_attempted_at").
		Set("last_success_at = CASE WHEN EXCLUDED.status = 'ok' THEN EXCLUDED.last_success_at ELSE communication_sync_state.last_success_at END").
		Set("next_sync_at = EXCLUDED.next_sync_at").Set("empty_streak = EXCLUDED.empty_streak").
		Set("updated_at = EXCLUDED.updated_at").Exec(ctx)
	return err
}

func stateID(accountID string) string {
	return messagingCapability + ":" + messagingSubject + ":" + accountID
}
