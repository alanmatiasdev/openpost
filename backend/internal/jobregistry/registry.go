// Package jobregistry owns durable job identities and scheduling policy that
// must be shared by enqueue callers, migrations, and the queue worker.
package jobregistry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusCompleted  = "completed"
	StatusFailed     = "failed"

	TypeMediaCleanup = "media_cleanup"

	mediaCleanupDedupeKey = "daily"
)

// Definition describes queue policy that must not be reimplemented by callers.
type Definition struct {
	Type               string
	DefaultMaxAttempts int
	Recurrence         time.Duration
	identity           func(string) (Identity, error)
}

// Identity is the exact database key used to deduplicate active jobs.
type Identity struct {
	ScopeID   string
	DedupeKey string
}

// MediaCleanupPayload identifies the workspace lifecycle sweep. Historical
// payloads may also contain a days field; JSON decoding deliberately ignores it
// because retention policy belongs to medialifecycle and is not configurable.
type MediaCleanupPayload struct {
	WorkspaceID string `json:"workspace_id"`
}

type InvalidPayloadError struct {
	err error
}

func (err *InvalidPayloadError) Error() string { return err.err.Error() }
func (err *InvalidPayloadError) Unwrap() error { return err.err }

func IsInvalidPayload(err error) bool {
	var invalid *InvalidPayloadError
	return errors.As(err, &invalid)
}

var definitions = map[string]Definition{
	TypeMediaCleanup: {
		Type:               TypeMediaCleanup,
		DefaultMaxAttempts: 3,
		Recurrence:         24 * time.Hour,
		identity:           mediaCleanupIdentity,
	},
}

func Lookup(jobType string) (Definition, bool) {
	definition, ok := definitions[jobType]
	return definition, ok
}

// IdentityForPayload decodes the registered payload instead of inspecting its
// serialized bytes. It is used by forward migrations as well as enqueue code.
func IdentityForPayload(jobType, payload string) (Identity, error) {
	definition, ok := Lookup(jobType)
	if !ok || definition.identity == nil {
		return Identity{}, fmt.Errorf("job type %q has no registered identity", jobType)
	}
	return definition.identity(payload)
}

func DecodeMediaCleanupPayload(payload string) (MediaCleanupPayload, error) {
	var decoded MediaCleanupPayload
	if err := json.Unmarshal([]byte(payload), &decoded); err != nil {
		return MediaCleanupPayload{}, &InvalidPayloadError{err: fmt.Errorf("decode media cleanup payload: %w", err)}
	}
	decoded.WorkspaceID = strings.TrimSpace(decoded.WorkspaceID)
	if decoded.WorkspaceID == "" {
		return MediaCleanupPayload{}, &InvalidPayloadError{err: errors.New("workspace_id is required for media cleanup")}
	}
	return decoded, nil
}

func mediaCleanupIdentity(payload string) (Identity, error) {
	decoded, err := DecodeMediaCleanupPayload(payload)
	if err != nil {
		return Identity{}, err
	}
	return MediaCleanupIdentity(decoded.WorkspaceID)
}

func MediaCleanupIdentity(workspaceID string) (Identity, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return Identity{}, errors.New("workspace_id is required for media cleanup")
	}
	return Identity{ScopeID: workspaceID, DedupeKey: mediaCleanupDedupeKey}, nil
}

// EnqueueMediaCleanup atomically creates one active recurring chain for a
// workspace. Completed and failed history never suppresses a new chain.
func EnqueueMediaCleanup(ctx context.Context, db bun.IDB, workspaceID string, runAt time.Time) (string, bool, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return "", false, errors.New("workspace_id is required for media cleanup")
	}
	if runAt.IsZero() {
		runAt = time.Now().UTC().Add(definitions[TypeMediaCleanup].Recurrence)
	}
	payload, err := json.Marshal(MediaCleanupPayload{WorkspaceID: workspaceID})
	if err != nil {
		return "", false, fmt.Errorf("encode media cleanup payload: %w", err)
	}
	identity, err := MediaCleanupIdentity(workspaceID)
	if err != nil {
		return "", false, err
	}
	job := &models.Job{
		ID:          uuid.NewString(),
		Type:        TypeMediaCleanup,
		ScopeID:     identity.ScopeID,
		DedupeKey:   identity.DedupeKey,
		Payload:     string(payload),
		Status:      StatusPending,
		RunAt:       runAt.UTC(),
		MaxAttempts: definitions[TypeMediaCleanup].DefaultMaxAttempts,
	}
	for attempt := 0; ; attempt++ {
		id, created, err := enqueueMediaCleanupOnce(ctx, db, job)
		if err == nil {
			return id, created, nil
		}
		if attempt >= 49 || !isTransientSQLiteContention(err) {
			return "", false, err
		}
		timer := time.NewTimer(2 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", false, ctx.Err()
		case <-timer.C:
		}
	}
}

func enqueueMediaCleanupOnce(ctx context.Context, db bun.IDB, job *models.Job) (string, bool, error) {
	result, err := db.NewInsert().Model(job).On("CONFLICT DO NOTHING").Exec(ctx)
	if err != nil {
		return "", false, fmt.Errorf("enqueue media cleanup: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return "", false, fmt.Errorf("inspect media cleanup enqueue: %w", err)
	}
	if rows == 1 {
		return job.ID, true, nil
	}

	var existing models.Job
	if err := db.NewSelect().Model(&existing).
		Where("type = ? AND scope_id = ? AND dedupe_key = ?", job.Type, job.ScopeID, job.DedupeKey).
		Where("status IN (?, ?)", StatusPending, StatusProcessing).
		Limit(1).
		Scan(ctx); err != nil {
		return "", false, fmt.Errorf("load active media cleanup after enqueue conflict: %w", err)
	}
	return existing.ID, false, nil
}

func isTransientSQLiteContention(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "database is locked") || strings.Contains(message, "database table is locked")
}

// EnsureActiveDedupeIndex installs the cross-database uniqueness contract.
// The forward migration backfills exact identities before calling this helper.
func EnsureActiveDedupeIndex(ctx context.Context, db bun.IDB) error {
	_, err := db.NewCreateIndex().
		Index("jobs_active_dedupe_unique_idx").
		Table("jobs").
		Column("type", "scope_id", "dedupe_key").
		Unique().
		Where("status IN ('pending', 'processing') AND scope_id <> '' AND dedupe_key <> ''").
		IfNotExists().
		Exec(ctx)
	return err
}
