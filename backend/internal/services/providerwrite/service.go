package providerwrite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/platform"
	"github.com/uptrace/bun"
)

var safeStateValue = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{0,128}$`)

type Service struct {
	db  *bun.DB
	now func() time.Time
}

func New(db *bun.DB) *Service {
	return &Service{db: db, now: func() time.Time { return time.Now().UTC() }}
}

type Control struct {
	service *Service
	attempt *models.ProviderWriteAttempt
	ctx     context.Context
}

// BindPublishRequest attaches the persisted logical identity and durable
// checkpoints to a per-attempt request copy. It never exposes database state
// outside the process or adds any secret material to the request.
func (c *Control) BindPublishRequest(req *platform.PublishRequest) {
	if c == nil || c.attempt == nil || req == nil {
		return
	}
	req.OperationID = c.attempt.OperationID
	req.IdempotencyKey = c.attempt.IdempotencyKey
	req.ResumeProviderState = c.attempt.ProviderState
	req.ResumeProviderReference = c.attempt.ProviderReference
	req.ResumeExternalID = c.attempt.ExternalID
	req.SetWriteFence(c.Begin, c.Checkpoint)
}

func (c *Control) Begin(result platform.PublishResult) error {
	if c == nil || c.service == nil || c.attempt == nil {
		return errors.New("provider write control is unavailable")
	}
	now := c.service.now()
	result = normalizeResult(result)
	retrySafety := result.RetrySafety
	if retrySafety == "" {
		retrySafety = platform.PublishRetryNever
	}
	query := c.service.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
		Set("status = ?", StatusSending).
		Set("submission_state = ?", platform.PublishSubmissionUnknown).
		Set("provider_state = ?", result.ProviderState).
		Set("provider_reference = ?", result.ProviderReference).
		Set("retry_safety = ?", retrySafety).
		Set("sending_started_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ? AND status = ?", c.attempt.ID, StatusPrepared)
	if result.IdempotencyTTL > 0 {
		query = query.Set("idempotency_expires_at = ?", now.Add(result.IdempotencyTTL))
	}
	durableCtx, cancel := durableContext(c.ctx)
	defer cancel()
	updated, err := query.Exec(durableCtx)
	if err != nil {
		return fmt.Errorf("enter provider write fence: %w", err)
	}
	rows, _ := updated.RowsAffected()
	if rows != 1 {
		return ErrWriteInProgress
	}
	c.attempt.Status = StatusSending
	c.attempt.SubmissionState = string(platform.PublishSubmissionUnknown)
	c.attempt.ProviderState = result.ProviderState
	c.attempt.ProviderReference = result.ProviderReference
	c.attempt.RetrySafety = string(retrySafety)
	c.attempt.SendingStartedAt = now
	if result.IdempotencyTTL > 0 {
		c.attempt.IdempotencyExpiresAt = now.Add(result.IdempotencyTTL)
	}
	return nil
}

func (c *Control) Checkpoint(result platform.PublishResult) error {
	if c == nil || c.service == nil || c.attempt == nil {
		return errors.New("provider write control is unavailable")
	}
	result = normalizeResult(result)
	if result.SubmissionState != platform.PublishSubmissionAccepted &&
		result.SubmissionState != platform.PublishSubmissionPending {
		return fmt.Errorf("unsupported provider write checkpoint state %q", result.SubmissionState)
	}
	return c.service.persistResult(c.ctx, c.attempt, result, nil)
}

func (s *Service) Execute(
	ctx context.Context,
	input Input,
	send SendFunc,
	reconcile ReconcileFunc,
) (platform.PublishResult, error) {
	input = normalizeInput(input)
	if err := validateInput(input); err != nil {
		return platform.PublishResult{}, err
	}
	if send == nil {
		return platform.PublishResult{}, errors.New("provider write send function is required")
	}
	attempt, err := s.loadOrCreateAttempt(ctx, input)
	if err != nil {
		return platform.PublishResult{}, err
	}
	if err := validateAttempt(input, attempt); err != nil {
		return platform.PublishResult{}, err
	}
	return s.executeAttempt(ctx, input, attempt, send, reconcile)
}

func (s *Service) executeAttempt(
	ctx context.Context,
	input Input,
	attempt *models.ProviderWriteAttempt,
	send SendFunc,
	reconcile ReconcileFunc,
) (platform.PublishResult, error) {
	switch attempt.Status {
	case StatusAccepted:
		return resultFromAttempt(attempt), nil
	case StatusPrepared:
		return s.sendPrepared(ctx, attempt, send)
	case StatusSending:
		if attempt.SubmissionState == string(platform.PublishSubmissionPending) && attempt.ProviderReference != "" && reconcile != nil {
			return s.reconcile(ctx, attempt, reconcile)
		}
		return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: ErrWriteInProgress}
	case StatusAmbiguous:
		return s.resumeAmbiguous(ctx, input, attempt, send, reconcile)
	case StatusDefiniteFailure:
		return s.resumeDefiniteFailure(ctx, input, attempt, send)
	default:
		return platform.PublishResult{}, fmt.Errorf("invalid provider write attempt status %q", attempt.Status)
	}
}

func (s *Service) resumeAmbiguous(
	ctx context.Context,
	input Input,
	attempt *models.ProviderWriteAttempt,
	send SendFunc,
	reconcile ReconcileFunc,
) (platform.PublishResult, error) {
	if attempt.ProviderReference != "" && reconcile != nil {
		return s.reconcile(ctx, attempt, reconcile)
	}
	if !idempotentRetryAvailable(attempt, s.now()) {
		return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: ErrOutcomeAmbiguous}
	}
	next, err := s.createNextAttempt(ctx, input, attempt.AttemptNumber+1)
	if err != nil {
		return platform.PublishResult{}, err
	}
	return s.sendPrepared(ctx, next, send)
}

func (s *Service) resumeDefiniteFailure(
	ctx context.Context,
	input Input,
	attempt *models.ProviderWriteAttempt,
	send SendFunc,
) (platform.PublishResult, error) {
	if attempt.RetrySafety != string(platform.PublishRetrySafe) && !idempotentRetryAvailable(attempt, s.now()) {
		return platform.PublishResult{}, storedAttemptError(attempt)
	}
	next, err := s.createNextAttempt(ctx, input, attempt.AttemptNumber+1)
	if err != nil {
		return platform.PublishResult{}, err
	}
	return s.sendPrepared(ctx, next, send)
}

func (s *Service) sendPrepared(ctx context.Context, attempt *models.ProviderWriteAttempt, send SendFunc) (platform.PublishResult, error) {
	control := &Control{service: s, attempt: attempt, ctx: ctx}
	result, sendErr := send(ctx, control)
	current, loadErr := s.loadAttempt(context.WithoutCancel(ctx), attempt.ID)
	if loadErr != nil {
		return platform.PublishResult{}, loadErr
	}
	if current.Status == StatusAccepted {
		return resultFromAttempt(current), nil
	}
	if current.Status == StatusPrepared {
		if sendErr == nil {
			sendErr = ErrFenceNotEntered
		}
		if err := s.persistDefiniteFailure(ctx, current, platform.PublishSubmissionNotSent, platform.PublishRetrySafe, sendErr); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, sendErr
	}
	if current.Status != StatusSending {
		return platform.PublishResult{}, fmt.Errorf("provider write attempt changed to %q during send", current.Status)
	}
	result = mergeResult(resultFromAttempt(current), result)
	if sendErr == nil && result.SubmissionState == "" {
		result.SubmissionState = platform.PublishSubmissionAccepted
	}
	if result.SubmissionState == platform.PublishSubmissionAccepted && sendErr == nil {
		if err := s.persistResult(ctx, current, result, sendErr); err != nil {
			return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: errors.Join(ErrOutcomeAmbiguous, err)}
		}
		return result, nil
	}
	if result.SubmissionState == platform.PublishSubmissionPending {
		if err := s.persistResult(ctx, current, result, sendErr); err != nil {
			return platform.PublishResult{}, &OutcomeError{Kind: StatusAmbiguous, Err: errors.Join(ErrOutcomeAmbiguous, err)}
		}
		return platform.PublishResult{}, pendingError(result)
	}
	return s.persistSendFailure(ctx, current, result, sendErr)
}

func (s *Service) reconcile(ctx context.Context, attempt *models.ProviderWriteAttempt, reconcile ReconcileFunc) (platform.PublishResult, error) {
	if !attempt.ReconcileAfter.IsZero() && s.now().Before(attempt.ReconcileAfter) {
		return platform.PublishResult{}, pendingError(resultFromAttempt(attempt))
	}
	result, reconcileErr := reconcile(ctx, attempt.ProviderReference)
	result = mergeResult(resultFromAttempt(attempt), result)
	switch result.SubmissionState {
	case platform.PublishSubmissionAccepted:
		if err := s.persistResult(ctx, attempt, result, reconcileErr); err != nil {
			return platform.PublishResult{}, err
		}
		return result, nil
	case platform.PublishSubmissionRejected:
		if reconcileErr == nil {
			reconcileErr = errors.New("provider rejected the submitted write")
		}
		if err := s.persistDefiniteFailure(ctx, attempt, platform.PublishSubmissionRejected, platform.PublishRetryNever, reconcileErr); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, reconcileErr
	default:
		result.SubmissionState = platform.PublishSubmissionPending
		result.RetrySafety = platform.PublishRetryReconcileOnly
		if err := s.persistResult(ctx, attempt, result, reconcileErr); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, pendingError(result)
	}
}

func (s *Service) persistSendFailure(
	ctx context.Context,
	attempt *models.ProviderWriteAttempt,
	result platform.PublishResult,
	sendErr error,
) (platform.PublishResult, error) {
	if sendErr == nil {
		sendErr = errors.New("provider returned an unknown submission state")
	}
	if result.SubmissionState == platform.PublishSubmissionRejected || definitelyRejected(sendErr) {
		if err := s.persistDefiniteFailure(ctx, attempt, platform.PublishSubmissionRejected, platform.PublishRetrySafe, sendErr); err != nil {
			return platform.PublishResult{}, err
		}
		return platform.PublishResult{}, sendErr
	}
	if err := s.persistAmbiguous(ctx, attempt, result, sendErr); err != nil {
		return platform.PublishResult{}, errors.Join(sendErr, err)
	}
	retryable := idempotentRetryAvailable(attempt, s.now())
	return platform.PublishResult{}, &OutcomeError{
		Kind: StatusAmbiguous, Retryable: retryable, RetryAfter: 30 * time.Second,
		Err: errors.Join(ErrOutcomeAmbiguous, sendErr),
	}
}

func (s *Service) persistResult(ctx context.Context, attempt *models.ProviderWriteAttempt, result platform.PublishResult, resultErr error) error {
	result = normalizeResult(result)
	now := s.now()
	status := StatusSending
	completedAt := any(nil)
	if result.SubmissionState == platform.PublishSubmissionAccepted {
		status = StatusAccepted
		completedAt = now
	}
	reconcileAt := any(nil)
	if result.ReconcileAfter > 0 {
		reconcileAt = now.Add(result.ReconcileAfter)
	}
	errorClass, errorCode, httpStatus := safeError(resultErr)
	durableCtx, cancel := durableContext(ctx)
	defer cancel()
	updated, err := s.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
		Set("status = ?", status).
		Set("submission_state = ?", result.SubmissionState).
		Set("provider_state = ?", result.ProviderState).
		Set("provider_reference = ?", result.ProviderReference).
		Set("retry_safety = ?", firstRetrySafety(result.RetrySafety, platform.PublishRetryNever)).
		Set("external_id = ?", result.ExternalID).
		Set("external_url = ?", result.ExternalURL).
		Set("safe_error_class = ?", errorClass).
		Set("safe_error_code = ?", errorCode).
		Set("error_http_status = ?", httpStatus).
		Set("reconcile_after = ?", reconcileAt).
		Set("completed_at = ?", completedAt).
		Set("updated_at = ?", now).
		Where("id = ? AND status IN (?, ?)", attempt.ID, StatusSending, StatusAmbiguous).
		Exec(durableCtx)
	if err != nil {
		return fmt.Errorf("persist provider write result: %w", err)
	}
	rows, _ := updated.RowsAffected()
	if rows != 1 {
		return fmt.Errorf("persist provider write result: attempt is no longer active")
	}
	return nil
}

func (s *Service) persistDefiniteFailure(
	ctx context.Context,
	attempt *models.ProviderWriteAttempt,
	submission platform.PublishSubmissionState,
	retrySafety platform.PublishRetrySafety,
	failure error,
) error {
	now := s.now()
	errorClass, errorCode, httpStatus := safeError(failure)
	durableCtx, cancel := durableContext(ctx)
	defer cancel()
	_, err := s.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
		Set("status = ?", StatusDefiniteFailure).
		Set("submission_state = ?", submission).
		Set("retry_safety = ?", retrySafety).
		Set("safe_error_class = ?", errorClass).
		Set("safe_error_code = ?", errorCode).
		Set("error_http_status = ?", httpStatus).
		Set("completed_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ? AND status IN (?, ?)", attempt.ID, StatusPrepared, StatusSending).
		Exec(durableCtx)
	return err
}

func (s *Service) persistAmbiguous(ctx context.Context, attempt *models.ProviderWriteAttempt, result platform.PublishResult, failure error) error {
	now := s.now()
	errorClass, errorCode, httpStatus := safeError(failure)
	retrySafety := firstRetrySafety(result.RetrySafety, platform.PublishRetryNever)
	durableCtx, cancel := durableContext(ctx)
	defer cancel()
	_, err := s.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
		Set("status = ?", StatusAmbiguous).
		Set("submission_state = ?", platform.PublishSubmissionUnknown).
		Set("provider_state = ?", result.ProviderState).
		Set("provider_reference = ?", result.ProviderReference).
		Set("retry_safety = ?", retrySafety).
		Set("safe_error_class = ?", errorClass).
		Set("safe_error_code = ?", errorCode).
		Set("error_http_status = ?", httpStatus).
		Set("completed_at = ?", now).
		Set("updated_at = ?", now).
		Where("id = ? AND status = ?", attempt.ID, StatusSending).
		Exec(durableCtx)
	return err
}

func (s *Service) loadOrCreateAttempt(ctx context.Context, input Input) (*models.ProviderWriteAttempt, error) {
	var attempt models.ProviderWriteAttempt
	err := s.db.NewSelect().Model(&attempt).
		Where("operation_id = ?", input.OperationID).
		Order("attempt_number DESC").
		Limit(1).
		Scan(ctx)
	if err == nil {
		return &attempt, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("load provider write attempt: %w", err)
	}
	return s.createNextAttempt(ctx, input, 1)
}

func (s *Service) createNextAttempt(ctx context.Context, input Input, number int) (*models.ProviderWriteAttempt, error) {
	now := s.now()
	attempt := &models.ProviderWriteAttempt{
		ID: uuid.NewString(), OperationID: input.OperationID, AttemptNumber: number,
		JobID: input.JobID, AuthorizationID: input.AuthorizationID,
		WorkspaceID: input.WorkspaceID, PublicationID: input.PublicationID,
		RenditionID: input.RenditionID, SocialAccountID: input.SocialAccountID,
		TargetKey: input.TargetKey, Provider: input.Provider, Operation: input.Operation,
		PayloadFingerprint: input.PayloadFingerprint, Status: StatusPrepared,
		SubmissionState: string(platform.PublishSubmissionNotSent),
		RetrySafety:     string(platform.PublishRetrySafe),
		IdempotencyKey:  operationIdempotencyKey(input.OperationID),
		CreatedAt:       now, UpdatedAt: now,
	}
	if _, err := s.db.NewInsert().Model(attempt).Exec(ctx); err != nil {
		var active models.ProviderWriteAttempt
		loadErr := s.db.NewSelect().Model(&active).
			Where("operation_id = ?", input.OperationID).
			Order("attempt_number DESC").Limit(1).Scan(ctx)
		if loadErr == nil {
			return &active, nil
		}
		return nil, fmt.Errorf("create provider write attempt: %w", err)
	}
	return attempt, nil
}

func (s *Service) loadAttempt(ctx context.Context, id string) (*models.ProviderWriteAttempt, error) {
	var attempt models.ProviderWriteAttempt
	if err := s.db.NewSelect().Model(&attempt).Where("id = ?", id).Scan(ctx); err != nil {
		return nil, fmt.Errorf("reload provider write attempt: %w", err)
	}
	return &attempt, nil
}

// MarkStaleJobAttempts converts every sending attempt owned by a stale worker
// lease into an explicit ambiguous outcome before the jobs are requeued.
func (s *Service) MarkStaleJobAttempts(ctx context.Context, cutoff time.Time) (int64, error) {
	result, err := s.db.NewUpdate().Model((*models.ProviderWriteAttempt)(nil)).
		Set("status = ?", StatusAmbiguous).
		Set("submission_state = CASE WHEN submission_state = ? THEN submission_state ELSE ? END", platform.PublishSubmissionPending, platform.PublishSubmissionUnknown).
		Set("retry_safety = CASE WHEN submission_state = ? THEN ? ELSE retry_safety END", platform.PublishSubmissionPending, platform.PublishRetryReconcileOnly).
		Set("safe_error_class = ?", "worker_interrupted").
		Set("completed_at = ?", s.now()).
		Set("updated_at = ?", s.now()).
		Where("status = ?", StatusSending).
		Where("job_id IN (SELECT id FROM jobs WHERE status = ? AND locked_at IS NOT NULL AND locked_at <= ?)", "processing", cutoff.UTC()).
		Exec(ctx)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func normalizeInput(input Input) Input {
	input.OperationID = strings.TrimSpace(input.OperationID)
	input.JobID = strings.TrimSpace(input.JobID)
	input.AuthorizationID = strings.TrimSpace(input.AuthorizationID)
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.PublicationID = strings.TrimSpace(input.PublicationID)
	input.RenditionID = strings.TrimSpace(input.RenditionID)
	input.SocialAccountID = strings.TrimSpace(input.SocialAccountID)
	input.TargetKey = strings.TrimSpace(input.TargetKey)
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Operation = strings.ToLower(strings.TrimSpace(input.Operation))
	input.PayloadFingerprint = strings.TrimSpace(input.PayloadFingerprint)
	return input
}

func validateInput(input Input) error {
	if input.OperationID == "" || input.WorkspaceID == "" || input.SocialAccountID == "" ||
		input.TargetKey == "" || input.Provider == "" || input.Operation == "" {
		return errors.New("provider write identity and ownership are required")
	}
	if !strings.HasPrefix(input.PayloadFingerprint, "sha256:") {
		return errors.New("provider write payload fingerprint is required")
	}
	return nil
}

func validateAttempt(input Input, attempt *models.ProviderWriteAttempt) error {
	if attempt == nil || attempt.OperationID != input.OperationID ||
		attempt.WorkspaceID != input.WorkspaceID || attempt.PublicationID != input.PublicationID ||
		attempt.RenditionID != input.RenditionID || attempt.SocialAccountID != input.SocialAccountID ||
		attempt.TargetKey != input.TargetKey || attempt.Provider != input.Provider ||
		attempt.Operation != input.Operation || attempt.PayloadFingerprint != input.PayloadFingerprint ||
		attempt.AuthorizationID != input.AuthorizationID {
		return ErrOperationChanged
	}
	return nil
}

func normalizeResult(result platform.PublishResult) platform.PublishResult {
	result.ProviderState = safeShortValue(result.ProviderState, 128)
	if !validProviderState(result.ProviderState) {
		result.ProviderState = ""
	}
	result.ProviderReference = safeProviderReference(result.ProviderReference)
	result.ExternalID = safeShortValue(result.ExternalID, 4096)
	result.ExternalURL = safeExternalURL(result.ExternalURL)
	if !validSubmissionState(result.SubmissionState) {
		result.SubmissionState = ""
	}
	if !validRetrySafety(result.RetrySafety) {
		result.RetrySafety = ""
	}
	return result
}

func mergeResult(stored, returned platform.PublishResult) platform.PublishResult {
	if returned.ExternalID == "" {
		returned.ExternalID = stored.ExternalID
	}
	if returned.ExternalURL == "" {
		returned.ExternalURL = stored.ExternalURL
	}
	if returned.SubmissionState == "" {
		returned.SubmissionState = stored.SubmissionState
	}
	if returned.ProviderState == "" {
		returned.ProviderState = stored.ProviderState
	}
	if returned.ProviderReference == "" {
		returned.ProviderReference = stored.ProviderReference
	}
	if returned.RetrySafety == "" {
		returned.RetrySafety = stored.RetrySafety
	}
	return normalizeResult(returned)
}

func resultFromAttempt(attempt *models.ProviderWriteAttempt) platform.PublishResult {
	if attempt == nil {
		return platform.PublishResult{}
	}
	result := platform.PublishResult{
		ExternalID: attempt.ExternalID, ExternalURL: attempt.ExternalURL,
		SubmissionState: platform.PublishSubmissionState(attempt.SubmissionState),
		ProviderState:   attempt.ProviderState, ProviderReference: attempt.ProviderReference,
		RetrySafety: platform.PublishRetrySafety(attempt.RetrySafety),
	}
	if !attempt.ReconcileAfter.IsZero() {
		result.ReconcileAfter = max(0, time.Until(attempt.ReconcileAfter))
	}
	return result
}

func pendingError(result platform.PublishResult) error {
	delay := result.ReconcileAfter
	if delay <= 0 {
		delay = time.Minute
	}
	return &OutcomeError{Kind: string(platform.PublishSubmissionPending), RetryAfter: delay, Err: ErrOutcomePending}
}

func definitelyRejected(err error) bool {
	var providerErr *platform.HTTPError
	if !errors.As(err, &providerErr) {
		return false
	}
	return providerErr.StatusCode >= 400 && providerErr.StatusCode < 500 && providerErr.StatusCode != http.StatusRequestTimeout
}

func safeError(err error) (string, string, int) {
	if err == nil {
		return "", "", 0
	}
	var providerErr *platform.HTTPError
	if errors.As(err, &providerErr) {
		class := "provider_rejected"
		if providerErr.StatusCode >= 500 || providerErr.StatusCode == http.StatusRequestTimeout {
			class = "provider_unknown"
		}
		return class, safeShortValue(providerErr.Code, 96), providerErr.StatusCode
	}
	var outcome *OutcomeError
	if errors.As(err, &outcome) {
		return safeShortValue(outcome.Kind, 96), "", 0
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return "transport_interrupted", "", 0
	}
	return "provider_unknown", "", 0
}

func storedAttemptError(attempt *models.ProviderWriteAttempt) error {
	err := errors.New("provider write definitely failed")
	if attempt.ErrorHTTPStatus > 0 {
		err = &platform.HTTPError{StatusCode: attempt.ErrorHTTPStatus, Code: attempt.SafeErrorCode}
	}
	return &OutcomeError{Kind: attempt.Status, Err: err}
}

func idempotentRetryAvailable(attempt *models.ProviderWriteAttempt, now time.Time) bool {
	return attempt.RetrySafety == string(platform.PublishRetryIdempotent) &&
		!attempt.IdempotencyExpiresAt.IsZero() && now.Before(attempt.IdempotencyExpiresAt)
}

func firstRetrySafety(value, fallback platform.PublishRetrySafety) platform.PublishRetrySafety {
	if value != "" {
		return value
	}
	return fallback
}

func safeShortValue(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if len(value) > maximum {
		return ""
	}
	return value
}

func safeProviderReference(value string) string {
	value = safeShortValue(value, 512)
	if value == "" || strings.Contains(value, "://") || strings.ContainsAny(value, "?#\r\n\t") {
		return ""
	}
	return value
}

func safeExternalURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parsed, err := url.Parse(value)
	if err != nil || !platform.IsSafeContentURL(value) {
		return ""
	}
	for key := range parsed.Query() {
		normalized := strings.ToLower(strings.ReplaceAll(key, "-", "_"))
		switch normalized {
		case "access_token", "token", "auth", "authorization", "signature", "sig", "key", "code":
			return ""
		}
	}
	return value
}

func validSubmissionState(value platform.PublishSubmissionState) bool {
	switch value {
	case "", platform.PublishSubmissionNotSent, platform.PublishSubmissionAccepted,
		platform.PublishSubmissionPending, platform.PublishSubmissionRejected,
		platform.PublishSubmissionUnknown:
		return true
	default:
		return false
	}
}

func validRetrySafety(value platform.PublishRetrySafety) bool {
	switch value {
	case "", platform.PublishRetrySafe, platform.PublishRetryIdempotent,
		platform.PublishRetryReconcileOnly, platform.PublishRetryNever:
		return true
	default:
		return false
	}
}

func durableContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
}

func validProviderState(value string) bool {
	return safeStateValue.MatchString(value)
}
