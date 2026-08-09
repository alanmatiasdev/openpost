package handlers

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/capabilities"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/drafts"
	"github.com/openpost/backend/internal/services/lifecycle"
	postservice "github.com/openpost/backend/internal/services/posts"
	"github.com/openpost/backend/internal/services/providerreadiness"
	"github.com/openpost/backend/internal/services/publicationauth"
	"github.com/uptrace/bun"
)

// publicationCommands is the transport-independent application boundary for
// publication mutations. Transports authenticate, decode their public schema,
// and load an authorized publication before invoking these commands.
type publicationCommands struct {
	handler *PublicationHandler
	now     func() time.Time
	newID   func() string
}

// publicationQueries is the transport-independent application boundary for
// publication queries that involve domain computation rather than response
// mapping.
type publicationQueries struct {
	handler *PublicationHandler
}

func (h *PublicationHandler) publicationCommands() publicationCommands {
	return publicationCommands{
		handler: h,
		now:     func() time.Time { return time.Now().UTC() },
		newID:   uuid.NewString,
	}
}

func (h *PublicationHandler) publicationQueries() publicationQueries {
	return publicationQueries{handler: h}
}

func (commands publicationCommands) Create(
	ctx context.Context,
	userID string,
	input CreatePublicationBody,
) (*models.Publication, error) {
	command := commands.handler.newCreateCommand()
	command.now = commands.now
	return command.Execute(ctx, userID, input)
}

// Update commits the aggregate, canonical segments, destination renditions,
// schedule job, linked text editor, and revision audit as one transaction.
// The supplied publication must already have passed transport authorization.
//
//nolint:gocyclo // Aggregate replacement and revision tracking must remain atomic.
func (commands publicationCommands) Update(
	ctx context.Context,
	userID string,
	existing *models.Publication,
	input PublicationUpdateBody,
) error {
	if existing == nil {
		return errPublicationNotFound
	}
	if input.SocialSetID != nil &&
		*input.SocialSetID != "" &&
		*input.SocialSetID != existing.SocialSetID {
		if _, err := loadSocialSetSnapshot(ctx, commands.handler.db, existing.WorkspaceID, *input.SocialSetID); err != nil {
			return err
		}
	}
	if input.Segments != nil {
		if err := commands.handler.validateMediaBelongsToWorkspace(
			ctx,
			existing.WorkspaceID,
			allPublicationMediaIDs(nil, input.Segments, nil),
		); err != nil {
			return err
		}
	}
	accountMap := map[string]models.SocialAccount{}
	if input.Renditions != nil {
		var err error
		accountMap, err = commands.handler.loadAccounts(
			ctx,
			existing.WorkspaceID,
			renditionAccountIDs(input.Renditions),
		)
		if err != nil {
			return err
		}
		if err := commands.handler.validateMediaBelongsToWorkspace(
			ctx,
			existing.WorkspaceID,
			allPublicationMediaIDs(nil, nil, input.Renditions),
		); err != nil {
			return err
		}
	}
	if input.RepostOverride != nil {
		normalized, err := commands.handler.validateRepostOverride(
			ctx,
			existing.WorkspaceID,
			userID,
			*input.RepostOverride,
		)
		if err != nil {
			return huma.Error400BadRequest(err.Error())
		}
		input.RepostOverride = &normalized
	}

	now := commands.now().UTC()
	return commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		publication, err := commands.handler.loadEditablePublicationTx(txCtx, tx, existing.ID)
		if err != nil {
			return err
		}
		if publication.Revision != input.ExpectedRevision {
			return commands.handler.publicationRevisionConflict(txCtx, tx, publication, input.ExpectedRevision)
		}
		editor, err := postservice.EnsurePublicationEditorTx(txCtx, tx, publication)
		if err != nil {
			return err
		}
		clearQueuedSchedule, rescheduleQueuedJob, err := applyPublicationScheduleUpdate(
			publication,
			input.ScheduledAt,
			input.ClearSchedule,
			now,
		)
		if err != nil {
			return err
		}
		changedDomains := publicationChangedDomains(input)
		applyPublicationFieldUpdates(publication, input)
		publication.UpdatedAt = now
		publication.Revision++
		if clearQueuedSchedule {
			if err := commands.handler.clearPublicationScheduleTx(txCtx, tx, publication.ID, now); err != nil {
				return err
			}
		}
		result, err := tx.NewUpdate().
			Model(publication).
			Where("id = ? AND revision = ?", publication.ID, input.ExpectedRevision).
			Exec(txCtx)
		if err != nil {
			return err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return commands.handler.publicationRevisionConflict(txCtx, tx, publication, input.ExpectedRevision)
		}
		if input.Segments != nil {
			if err := commands.handler.replacePublicationSegments(txCtx, tx, publication, input.Segments); err != nil {
				return err
			}
		} else if input.SourceText != nil {
			if err := syncPublicationFirstSegmentBodyTx(
				txCtx,
				tx,
				publication.ID,
				*input.SourceText,
				now,
			); err != nil {
				return err
			}
		}
		if input.Renditions != nil {
			if err := commands.handler.replaceAllPublicationRenditions(
				txCtx,
				tx,
				publication,
				input.Segments,
				input.Renditions,
				accountMap,
			); err != nil {
				return err
			}
		}
		if rescheduleQueuedJob {
			if _, err := commands.handler.replacePublicationJobTx(
				txCtx,
				tx,
				publication.ID,
				publication.ScheduledAt,
			); err != nil {
				return err
			}
		}
		if err := postservice.SyncPublicationEditorTx(txCtx, tx, publication, editor); err != nil {
			return err
		}
		if err := commands.handler.syncTextPostRevisionsTx(
			txCtx,
			tx,
			publication.ID,
			input.ExpectedRevision,
			publication.Revision,
			changedDomains,
			userID,
			now,
		); err != nil {
			return err
		}
		return drafts.RecordChange(
			txCtx,
			tx,
			drafts.AggregatePublication,
			publication.ID,
			publication.Revision,
			changedDomains,
			userID,
			now,
		)
	})
}

func (queries publicationQueries) Validate(
	ctx context.Context,
	publicationID string,
) ([]capabilities.ValidationIssue, error) {
	return queries.handler.validatePublicationByID(ctx, publicationID)
}

func (commands publicationCommands) Schedule(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	if err := commands.validateForEnqueue(ctx, publicationID); err != nil {
		return "", err
	}
	return commands.handler.queueScheduledPublicationExpected(ctx, publicationID, expectedRevision, intent)
}

func (commands publicationCommands) PublishNow(
	ctx context.Context,
	publicationID string,
	expectedRevision int,
	intent providerreadiness.ExecutionIntent,
) (string, error) {
	if err := commands.validateForEnqueue(ctx, publicationID); err != nil {
		return "", err
	}
	return commands.handler.queuePublicationNowExpected(ctx, publicationID, expectedRevision, intent)
}

func (commands publicationCommands) validateForEnqueue(ctx context.Context, publicationID string) error {
	issues, err := commands.handler.publicationQueries().Validate(ctx, publicationID)
	if err != nil {
		return err
	}
	if hasBlockingIssues(issues) {
		return errPublicationValidationBlocked
	}
	return nil
}

func (commands publicationCommands) RetryRendition(
	ctx context.Context,
	publication *models.Publication,
	accountID string,
) (string, error) {
	if publication == nil {
		return "", errPublicationNotFound
	}
	var rendition models.Rendition
	if err := commands.handler.db.NewSelect().
		Model(&rendition).
		Where("publication_id = ?", publication.ID).
		Where("social_account_id = ?", accountID).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", huma.Error404NotFound("rendition not found")
		}
		return "", huma.Error500InternalServerError("failed to load rendition")
	}
	if rendition.Status != models.RenditionStatusFailed {
		return "", huma.Error409Conflict("only a failed destination can be retried")
	}
	if !rendition.ErrorRetryable {
		return "", huma.Error409Conflict("this failure requires the recommended account or content action")
	}

	jobID := commands.newID()
	batchID := commands.newID()
	now := commands.now().UTC()
	payload := mustJSON(map[string]string{
		"publication_id":             publication.ID,
		"rendition_id":               rendition.ID,
		"authorization_batch_id":     batchID,
		"authorization_scheduled_at": now.Format(time.RFC3339Nano),
	})
	err := commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		result, err := tx.NewUpdate().
			Model((*models.Rendition)(nil)).
			Set("status = ?", models.RenditionStatusScheduled).
			Set("error_retry_at = NULL").
			Set("updated_at = ?", now).
			Where("id = ?", rendition.ID).
			Where("status = ?", models.RenditionStatusFailed).
			Where("error_retryable = ?", true).
			Exec(txCtx)
		if err != nil {
			return err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return errPublicationAlreadyProcessing
		}
		if _, err := tx.NewUpdate().
			Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusScheduled).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Where("status = ?", models.PublicationStatusFailed).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().
			Model((*models.Post)(nil)).
			Set("status = ?", models.PostStatusScheduled).
			Where("publication_id = ?", publication.ID).
			Where("status = ?", models.PostStatusFailed).
			Exec(txCtx); err != nil && !isMissingLegacyPostsTable(err) {
			return err
		}
		job := &models.Job{
			ID:          jobID,
			Type:        jobTypePublishPublication,
			Payload:     payload,
			Status:      jobStatusPending,
			RunAt:       now,
			MaxAttempts: 3,
		}
		if _, err = tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return err
		}
		_, _, err = publicationauth.CreateBatch(txCtx, tx, publicationauth.BatchInput{
			BatchID: batchID, PublicationID: publication.ID,
			Actor:  publicationAuthorizationActor(txCtx, publication.CreatedByID),
			Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyRetry, ConfirmedAt: now,
			Targets: []publicationauth.JobTarget{{JobID: jobID, RenditionID: rendition.ID, RunAt: now}},
		})
		return err
	})
	return jobID, err
}

// RetryFailedRenditions atomically replaces any pending primary publication
// job with one retry batch for the remaining transient destination failures.
//
//nolint:gocyclo // Retry selection, jobs, receipts, and audit must commit together.
func (commands publicationCommands) RetryFailedRenditions(
	ctx context.Context,
	publication *models.Publication,
) (string, error) {
	if publication == nil {
		return "", errPublicationNotFound
	}
	jobID := commands.newID()
	batchID := commands.newID()
	now := commands.now().UTC()
	payload := mustJSON(map[string]string{
		"publication_id":             publication.ID,
		"authorization_batch_id":     batchID,
		"authorization_scheduled_at": now.Format(time.RFC3339Nano),
	})
	err := commands.handler.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := lockPublicationMutationTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		if err := commands.handler.lockActivePrimaryPublicationJobsTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		if err := commands.handler.rejectProcessingPrimaryPublicationJobTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		if err := commands.handler.deletePendingPrimaryPublicationJobsTx(txCtx, tx, publication.ID); err != nil {
			return err
		}
		var retryRenditions []models.Rendition
		if err := tx.NewSelect().Model(&retryRenditions).
			Where("publication_id = ?", publication.ID).
			Where("status = ?", models.RenditionStatusFailed).
			Where("error_retryable = ?", true).
			Order("created_at ASC", "id ASC").
			Scan(txCtx); err != nil {
			return err
		}
		result, err := tx.NewUpdate().
			Model((*models.Rendition)(nil)).
			Set("status = ?", models.RenditionStatusScheduled).
			Set("error_retry_at = NULL").
			Set("updated_at = ?", now).
			Where("publication_id = ?", publication.ID).
			Where("status = ?", models.RenditionStatusFailed).
			Where("error_retryable = ?", true).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return huma.Error409Conflict("no retryable failed destinations remain")
		}
		if _, err := tx.NewUpdate().
			Model((*models.Publication)(nil)).
			Set("status = ?", models.PublicationStatusScheduled).
			Set("updated_at = ?", now).
			Where("id = ?", publication.ID).
			Exec(txCtx); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().
			Model((*models.Post)(nil)).
			Set("status = ?", models.PostStatusScheduled).
			Where("publication_id = ?", publication.ID).
			Where("status = ?", models.PostStatusFailed).
			Exec(txCtx); err != nil && !isMissingLegacyPostsTable(err) {
			return err
		}
		if _, err := tx.NewInsert().Model(&models.Job{
			ID:          jobID,
			Type:        jobTypePublishPublication,
			Payload:     payload,
			Status:      jobStatusPending,
			RunAt:       now,
			MaxAttempts: 3,
		}).Exec(txCtx); err != nil {
			return err
		}
		targets := make([]publicationauth.JobTarget, 0, len(retryRenditions))
		for _, retryRendition := range retryRenditions {
			targets = append(targets, publicationauth.JobTarget{
				JobID: jobID, RenditionID: retryRendition.ID, RunAt: now,
			})
		}
		if _, _, err := publicationauth.CreateBatch(txCtx, tx, publicationauth.BatchInput{
			BatchID: batchID, PublicationID: publication.ID,
			Actor:  publicationAuthorizationActor(txCtx, publication.CreatedByID),
			Action: publicationauth.ActionPublish, PolicyMode: publicationauth.PolicyRetry, ConfirmedAt: now,
			Targets: targets,
		}); err != nil {
			return err
		}
		event := &models.PublicationLifecycleEvent{
			ID:             commands.newID(),
			WorkspaceID:    publication.WorkspaceID,
			PublicationID:  publication.ID,
			Type:           lifecycle.EventRetried,
			Status:         lifecycle.StatusStarted,
			Message:        "Retry queued for failed destinations",
			MetadataJSON:   mustJSON(map[string]any{"destination_count": affected}),
			IdempotencyKey: "retry-failed:" + jobID,
			CreatedAt:      now,
		}
		_, err = tx.NewInsert().Model(event).Exec(txCtx)
		return err
	})
	return jobID, err
}
