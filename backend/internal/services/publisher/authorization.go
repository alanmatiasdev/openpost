package publisher

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/publicationauth"
)

type publicationAuthorizationPreflight struct {
	BatchID       string
	PublicationID string
	RenditionID   string
	Action        string
	ScheduledAt   string
	Content       any
	Media         any
	Settings      any
	Explicit      bool
}

func (s *Service) preflightPublicationAuthorization(
	ctx context.Context,
	input publicationAuthorizationPreflight,
) ([]models.PublicationAuthorization, error) {
	execution, ok := jobExecutionFromContext(ctx)
	if !ok || strings.TrimSpace(execution.ID) == "" {
		return nil, fmt.Errorf("publication authorization validation required: job identity is missing")
	}
	scheduledAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ScheduledAt))
	if err != nil {
		return nil, fmt.Errorf("publication authorization validation required: invalid scheduled time")
	}
	action := strings.TrimSpace(input.Action)
	if action == "" {
		action = publicationauth.ActionPublish
	}
	receipts, err := publicationauth.ValidateBatch(ctx, s.db, publicationauth.ValidateInput{
		BatchID: input.BatchID, PublicationID: input.PublicationID,
		RenditionID: input.RenditionID, JobID: execution.ID, Action: action,
		Content: input.Content, Media: input.Media, Settings: input.Settings,
		Explicit: input.Explicit, ScheduledAt: scheduledAt,
	})
	if err != nil {
		return nil, fmt.Errorf("publication authorization validation failed: %w", err)
	}
	return receipts, nil
}

func jobExecutionFromContext(ctx context.Context) (jobExecution, bool) {
	execution, ok := ctx.Value(jobExecutionContextKey{}).(jobExecution)
	return execution, ok
}
