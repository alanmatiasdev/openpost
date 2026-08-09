package queue

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/jobregistry"
	"github.com/openpost/backend/internal/models"
	analyticsservice "github.com/openpost/backend/internal/services/analytics"
	"github.com/stretchr/testify/require"
)

func TestWorkerRequeuesStaleProcessingJobs(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	jobID := uuid.NewString()
	job := &models.Job{
		ID:          jobID,
		Type:        jobTypePublishPost,
		Payload:     "{}",
		Status:      jobStatusProcessing,
		RunAt:       time.Now().UTC().Add(-time.Hour),
		Attempts:    1,
		MaxAttempts: 3,
		LockedAt:    time.Now().UTC().Add(-20 * time.Minute),
		LockedBy:    "dead-worker",
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stored := new(models.Job)
	err = db.NewSelect().Model(stored).Where("id = ?", jobID).Scan(ctx)
	require.NoError(t, err)
	require.Equal(t, jobStatusPending, stored.Status)
	require.True(t, stored.LockedAt.IsZero())
	require.Empty(t, stored.LockedBy)
	require.Equal(t, 1, stored.Attempts)
}

func TestWorkerMarksStaleProviderWriteAmbiguousBeforeRequeue(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := t.Context()
	now := time.Now().UTC()
	job := &models.Job{
		ID: uuid.NewString(), Type: jobTypePublishPublication, Payload: "{}",
		Status: jobStatusProcessing, RunAt: now.Add(-time.Hour), MaxAttempts: 3,
		LockedAt: now.Add(-20 * time.Minute), LockedBy: "dead-worker",
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(job).Exec(ctx)
		return err
	}())
	attempt := &models.ProviderWriteAttempt{
		ID: uuid.NewString(), OperationID: "operation-stale", AttemptNumber: 1,
		JobID: job.ID, WorkspaceID: "workspace-1", SocialAccountID: "account-1",
		TargetKey: "x", Provider: "x", Operation: "publish",
		PayloadFingerprint: "sha256:payload", Status: "sending", SubmissionState: "unknown",
		RetrySafety: "never", CreatedAt: now.Add(-20 * time.Minute), UpdatedAt: now.Add(-20 * time.Minute),
	}
	require.NoError(t, func() error {
		_, err := db.NewInsert().Model(attempt).Exec(ctx)
		return err
	}())

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	require.NoError(t, db.NewSelect().Model(job).WherePK().Scan(ctx))
	require.Equal(t, jobStatusPending, job.Status)
	require.NoError(t, db.NewSelect().Model(attempt).WherePK().Scan(ctx))
	require.Equal(t, "ambiguous", attempt.Status)
	require.Equal(t, "unknown", attempt.SubmissionState)
	require.Equal(t, "worker_interrupted", attempt.SafeErrorClass)
}

func TestWorkerKeepsRecentProcessingJobsLocked(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	jobID := uuid.NewString()
	lockedAt := time.Now().UTC().Add(-5 * time.Minute)
	job := &models.Job{
		ID:          jobID,
		Type:        jobTypePublishPost,
		Payload:     "{}",
		Status:      jobStatusProcessing,
		RunAt:       time.Now().UTC().Add(-time.Hour),
		Attempts:    0,
		MaxAttempts: 3,
		LockedAt:    lockedAt,
		LockedBy:    "active-worker",
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stored := new(models.Job)
	err = db.NewSelect().Model(stored).Where("id = ?", jobID).Scan(ctx)
	require.NoError(t, err)
	require.Equal(t, jobStatusProcessing, stored.Status)
	require.False(t, stored.LockedAt.IsZero())
	require.Equal(t, "active-worker", stored.LockedBy)
}

func TestWorkerRecoversTheSameMediaCleanupChainAfterCrash(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	job := &models.Job{
		ID: "cleanup-chain", Type: jobTypeMediaCleanup,
		ScopeID: "workspace-1", DedupeKey: "daily",
		Payload: `{"workspace_id":"workspace-1","days":14}`,
		Status:  jobregistry.StatusProcessing, RunAt: time.Now().UTC().Add(-time.Hour),
		LockedAt: time.Now().UTC().Add(-20 * time.Minute), LockedBy: "dead-worker",
		MaxAttempts: 3,
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	var rows []models.Job
	require.NoError(t, db.NewSelect().Model(&rows).
		Where("type = ? AND scope_id = ? AND dedupe_key = ?", jobTypeMediaCleanup, "workspace-1", "daily").
		Scan(ctx))
	require.Len(t, rows, 1)
	require.Equal(t, "cleanup-chain", rows[0].ID)
	require.Equal(t, jobStatusPending, rows[0].Status)
	require.True(t, rows[0].LockedAt.IsZero())
}

func TestMediaCleanupChainSurvivesExhaustedOperationalRetries(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	job := &models.Job{
		ID: "cleanup-chain", Type: jobTypeMediaCleanup,
		ScopeID: "workspace-1", DedupeKey: "daily",
		Payload: `{"workspace_id":"workspace-1","days":14}`,
		Status:  jobStatusPending, RunAt: time.Now().UTC().Add(-time.Minute), MaxAttempts: 1,
	}
	_, err := db.NewInsert().Model(job).Exec(ctx)
	require.NoError(t, err)

	worker := NewWorker(db, "worker-test", time.Second, nil, nil, stubStorage{})
	require.True(t, worker.processNextJobIfAvailable(ctx))

	var stored models.Job
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", job.ID).Scan(ctx))
	require.Equal(t, jobStatusPending, stored.Status)
	require.Zero(t, stored.Attempts)
	require.NotEmpty(t, stored.LastError)
	require.WithinDuration(t, time.Now().UTC().Add(24*time.Hour), stored.RunAt, 5*time.Second)
}

func TestWorkerSupersedesStaleAnalyticsSweepWhenSuccessorIsPending(t *testing.T) {
	t.Parallel()

	db := createTestDB(t)
	ctx := context.Background()
	_, err := db.NewCreateIndex().
		Index("analytics_sweep_pending_unique_idx").
		Table("jobs").
		Column("type").
		Unique().
		Where("status = 'pending' AND type = 'analytics_sweep'").
		Exec(ctx)
	require.NoError(t, err)

	staleID := uuid.NewString()
	for _, job := range []*models.Job{
		{
			ID:          staleID,
			Type:        analyticsservice.JobTypeSweep,
			Payload:     `{"scheduled_for":"2026-07-26T10:00:00Z"}`,
			Status:      jobStatusProcessing,
			RunAt:       time.Now().UTC().Add(-time.Hour),
			MaxAttempts: 3,
			LockedAt:    time.Now().UTC().Add(-20 * time.Minute),
			LockedBy:    "dead-worker",
		},
		{
			ID:          uuid.NewString(),
			Type:        analyticsservice.JobTypeSweep,
			Payload:     `{"scheduled_for":"2026-07-26T10:15:00Z"}`,
			Status:      jobStatusPending,
			RunAt:       time.Now().UTC().Add(time.Minute),
			MaxAttempts: 3,
		},
	} {
		_, err = db.NewInsert().Model(job).Exec(ctx)
		require.NoError(t, err)
	}

	worker := &BackgroundWorker{db: db, workerID: "worker-test"}
	worker.requeueStaleProcessingJobs(ctx)

	stale := new(models.Job)
	require.NoError(t, db.NewSelect().Model(stale).Where("id = ?", staleID).Scan(ctx))
	require.Equal(t, jobStatusCompleted, stale.Status)
	require.Contains(t, stale.LastError, "later analytics sweep")

	pending, err := db.NewSelect().
		Model((*models.Job)(nil)).
		Where("type = ? AND status = ?", analyticsservice.JobTypeSweep, jobStatusPending).
		Count(ctx)
	require.NoError(t, err)
	require.Equal(t, 1, pending)
}
