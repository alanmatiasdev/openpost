package organizationownership

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
	"github.com/uptrace/bun/driver/sqliteshim"
)

type ownershipTestReauth struct {
	mu   sync.Mutex
	used map[string]bool
}

func (r *ownershipTestReauth) ConsumeReauthGrant(_ context.Context, raw, userID, sessionID, action string) error {
	if raw == "" || userID == "" || sessionID == "" || action != ReauthAction {
		return errors.New("invalid reauthentication grant")
	}
	if raw != "one-time" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.used[raw] {
		return errors.New("reauthentication grant already used")
	}
	r.used[raw] = true
	return nil
}

func newOwnershipTestService(t *testing.T) (*Service, *bun.DB) {
	t.Helper()
	sqlDB, err := sql.Open(sqliteshim.ShimName, "file:"+uuid.NewString()+"?mode=memory&cache=shared")
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(8)
	db := bun.NewDB(sqlDB, sqlitedialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	for _, model := range []any{(*models.User)(nil), (*models.Organization)(nil), (*models.OrganizationMember)(nil), (*models.Workspace)(nil), (*models.OrganizationOwnershipTransfer)(nil), (*models.OrganizationOwnershipAuditEvent)(nil), (*models.BillingSubscription)(nil), (*models.UserNotificationPreference)(nil), (*models.UserNotification)(nil), (*models.Job)(nil)} {
		_, err := db.NewCreateTable().Model(model).Exec(t.Context())
		require.NoError(t, err)
	}
	now := time.Date(2026, 8, 14, 18, 0, 0, 0, time.UTC)
	users := []models.User{{ID: "owner", Email: "owner@example.com"}, {ID: "nominee", Email: "nominee@example.com"}, {ID: "outsider", Email: "outsider@example.com"}}
	_, err = db.NewInsert().Model(&users).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.Organization{ID: "org", Name: "Acme", CreatedByID: "owner", CreatedAt: now, UpdatedAt: now}).Exec(t.Context())
	require.NoError(t, err)
	members := []models.OrganizationMember{{OrganizationID: "org", UserID: "owner", Role: models.OrganizationRoleOwner, CreatedAt: now}, {OrganizationID: "org", UserID: "nominee", Role: models.OrganizationRoleMember, CreatedAt: now}}
	_, err = db.NewInsert().Model(&members).Exec(t.Context())
	require.NoError(t, err)
	service := NewService(db, nil, &ownershipTestReauth{used: map[string]bool{}})
	service.now = func() time.Time { return now }
	return service, db
}

func testCredential(userID string) Credential {
	return Credential{UserID: userID, SessionID: userID + "-session"}
}

func TestTransferRequiresCurrentOwnerAndEligibleMember(t *testing.T) {
	service, db := newOwnershipTestService(t)
	_, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "nominee", ActorSessionID: "nominee-session", ReauthGrant: "recent", NomineeUserID: "owner", ConfirmOrganizationName: "Acme"})
	require.ErrorIs(t, err, ErrOwnerRequired)
	_, err = service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "outsider", ConfirmOrganizationName: "Acme"})
	require.ErrorIs(t, err, ErrNomineeIneligible)
	err = service.Revoke(t.Context(), "org", testCredential("nominee"))
	require.ErrorIs(t, err, ErrOwnerRequired)
	failures, countErr := db.NewSelect().Model((*models.OrganizationOwnershipAuditEvent)(nil)).Where("result = ?", "failed").Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 3, failures)
	require.Contains(t, ownershipAuditActions(t, db), ActionRevocationFailed)
}

func TestInitiationRequiresBrowserSessionAndConsumesOneRecentGrant(t *testing.T) {
	service, db := newOwnershipTestService(t)
	input := InitiateInput{
		OrganizationID: "org", ActorUserID: "owner", NomineeUserID: "nominee",
		ConfirmOrganizationName: "Acme", ReauthGrant: "one-time",
	}

	_, err := service.Initiate(t.Context(), input)
	require.ErrorIs(t, err, ErrBrowserRequired)
	input.ActorSessionID = "owner-session"
	input.ReauthGrant = ""
	_, err = service.Initiate(t.Context(), input)
	require.ErrorIs(t, err, ErrReauthRequired)
	input.ReauthGrant = "one-time"
	_, err = service.Initiate(t.Context(), input)
	require.NoError(t, err)
	_, err = service.Initiate(t.Context(), input)
	require.ErrorIs(t, err, ErrReauthRequired)

	count, countErr := db.NewSelect().Model((*models.OrganizationOwnershipTransfer)(nil)).Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 1, count, "only the once-authenticated command may create a transfer")
}

func TestEveryInteractiveUseCaseEnforcesOrganizationIdentityAssurance(t *testing.T) {
	service, db := newOwnershipTestService(t)
	transfer, err := service.Initiate(t.Context(), InitiateInput{
		OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session",
		ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme",
	})
	require.NoError(t, err)
	_, err = db.NewCreateTable().Model((*models.OrganizationSSOPolicy)(nil)).Exec(t.Context())
	require.NoError(t, err)
	_, err = db.NewInsert().Model(&models.OrganizationSSOPolicy{
		OrganizationID: "org", Mode: models.OrganizationSSOModeRequired, ProviderIDs: "[]",
		AssuranceMaxAgeSeconds: 3600, APITokenMode: models.OrganizationSSOTokensScoped,
		MaxTokenLifetimeSeconds: 3600, CreatedAt: service.now(), UpdatedAt: service.now(),
	}).Exec(t.Context())
	require.NoError(t, err)
	owner := testCredential("owner")
	nominee := testCredential("nominee")
	initiation := InitiateInput{
		OrganizationID: "org", ActorUserID: owner.UserID, ActorSessionID: owner.SessionID,
		ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme",
	}

	checks := map[string]func() error{
		"get": func() error {
			_, checkErr := service.GetForOrganization(t.Context(), "org", owner)
			return checkErr
		},
		"initiate": func() error {
			_, checkErr := service.Initiate(t.Context(), initiation)
			return checkErr
		},
		"revoke": func() error { return service.Revoke(t.Context(), "org", owner) },
		"resolve": func() error {
			_, checkErr := service.Resolve(t.Context(), transfer.ID, nominee)
			return checkErr
		},
		"accept": func() error {
			_, checkErr := service.Accept(t.Context(), transfer.ID, nominee)
			return checkErr
		},
		"decline": func() error {
			_, checkErr := service.Decline(t.Context(), transfer.ID, nominee)
			return checkErr
		},
	}
	for name, check := range checks {
		t.Run(name, func(t *testing.T) { require.ErrorIs(t, check(), ErrIdentityAssurance) })
	}
}

func TestNominationKeepsOwnerAndTerminalActionsPreserveAuthority(t *testing.T) {
	service, db := newOwnershipTestService(t)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	require.Equal(t, StatusPending, transfer.Status)
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "owner"))

	_, err = service.Decline(t.Context(), transfer.ID, testCredential("nominee"))
	require.NoError(t, err)
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "owner"))
	require.Equal(t, models.OrganizationRoleMember, memberRole(t, db, "nominee"))

	transfer, err = service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	require.NoError(t, service.Revoke(t.Context(), "org", testCredential("owner")))
	_, err = service.Accept(t.Context(), transfer.ID, testCredential("nominee"))
	require.ErrorIs(t, err, ErrNotPending)
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "owner"))
	actions := ownershipAuditActions(t, db)
	require.Contains(t, actions, ActionInitiated)
	require.Contains(t, actions, ActionDeclined)
	require.Contains(t, actions, ActionRevoked)
	require.Contains(t, actions, ActionAcceptanceFailed)
}

func TestAcceptanceAtomicallySwapsExactlyOneOwnerAndIsSingleUse(t *testing.T) {
	service, db := newOwnershipTestService(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID: "org", Provider: models.BillingProviderPaddle,
		ProviderCustomerID: "customer", ProviderSubscriptionID: "subscription",
		Status: "active", PlanID: "pro", EntitlementSnapshot: `{"limits":{"social_accounts":10}}`,
	}).Exec(t.Context())
	require.NoError(t, err)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)

	var wg sync.WaitGroup
	results := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, acceptErr := service.Accept(context.Background(), transfer.ID, testCredential("nominee"))
			results <- acceptErr
		}()
	}
	wg.Wait()
	close(results)
	successes := 0
	for result := range results {
		if result == nil {
			successes++
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, ownerCount(t, db))
	require.Equal(t, models.OrganizationRoleAdmin, memberRole(t, db, "owner"))
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "nominee"))
	var creatorID string
	require.NoError(t, db.NewSelect().Model((*models.Organization)(nil)).Column("created_by").Where("id = ?", "org").Scan(t.Context(), &creatorID))
	require.Equal(t, "nominee", creatorID)
	linkedSubscriptions, countErr := db.NewSelect().Model((*models.BillingSubscription)(nil)).
		Join("JOIN organizations AS o ON o.id = billing_subscription.organization_id").
		Where("billing_subscription.organization_id = ? AND o.created_by = ?", "org", "nominee").Count(t.Context())
	require.NoError(t, countErr)
	require.Equal(t, 1, linkedSubscriptions, "billing authority remains attached to the transferred Organization")
	legacyOrganizations := []models.Organization{
		{ID: "nominee-legacy", Name: "Nominee legacy", CreatedByID: "nominee"},
		{ID: "owner-legacy", Name: "Prior owner legacy", CreatedByID: "owner"},
	}
	_, err = db.NewInsert().Model(&legacyOrganizations).Exec(t.Context())
	require.NoError(t, err)
	legacyWorkspaces := []models.Workspace{
		{ID: "nominee-workspace", OrganizationID: "nominee-legacy", Name: "Nominee workspace"},
		{ID: "owner-workspace", OrganizationID: "owner-legacy", Name: "Prior owner workspace"},
	}
	_, err = db.NewInsert().Model(&legacyWorkspaces).Exec(t.Context())
	require.NoError(t, err)
	subscriptions := entitlements.NewSubscriptionService(db, entitlements.NewCloudBootstrapService())
	newOwnerDecision, entitlementErr := subscriptions.Check(t.Context(), entitlements.Request{
		UserID: "nominee", WorkspaceID: "nominee-workspace", Limit: entitlements.LimitSocialAccounts, Amount: 1,
	})
	require.NoError(t, entitlementErr)
	require.True(t, newOwnerDecision.Allowed, "the accepted Owner receives creator-backed subscription authority")
	priorOwnerDecision, entitlementErr := subscriptions.Check(t.Context(), entitlements.Request{
		UserID: "owner", WorkspaceID: "owner-workspace", Limit: entitlements.LimitSocialAccounts, Amount: 1,
	})
	require.NoError(t, entitlementErr)
	require.False(t, priorOwnerDecision.Allowed, "the prior Owner loses creator-backed subscription authority")
	actions := ownershipAuditActions(t, db)
	require.Contains(t, actions, ActionAccepted)
	require.Contains(t, actions, ActionAcceptanceFailed)
}

func TestAcceptanceRollsBackRolesWhenCreatorAuthorityChanged(t *testing.T) {
	service, db := newOwnershipTestService(t)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	_, err = db.NewUpdate().Model((*models.Organization)(nil)).Set("created_by = ?", "outsider").Where("id = ?", "org").Exec(t.Context())
	require.NoError(t, err)

	_, err = service.Accept(t.Context(), transfer.ID, testCredential("nominee"))
	require.ErrorIs(t, err, ErrOwnerRequired)
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "owner"))
	require.Equal(t, models.OrganizationRoleMember, memberRole(t, db, "nominee"))
	var stored models.OrganizationOwnershipTransfer
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", transfer.ID).Scan(t.Context()))
	require.Equal(t, StatusPending, stored.Status)
}

func TestAcceptanceRollsBackCreatorAndRolesWhenSuccessAuditFails(t *testing.T) {
	service, db := newOwnershipTestService(t)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `CREATE TRIGGER fail_acceptance_audit BEFORE INSERT ON organization_ownership_audit_events
		WHEN NEW.action = 'ownership_transfer.accepted'
		BEGIN SELECT RAISE(ABORT, 'acceptance audit unavailable'); END`)
	require.NoError(t, err)

	_, err = service.Accept(t.Context(), transfer.ID, testCredential("nominee"))
	require.ErrorContains(t, err, "acceptance audit unavailable")
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "owner"))
	require.Equal(t, models.OrganizationRoleMember, memberRole(t, db, "nominee"))
	var organization models.Organization
	require.NoError(t, db.NewSelect().Model(&organization).Where("id = ?", "org").Scan(t.Context()))
	require.Equal(t, "owner", organization.CreatedByID)
	var stored models.OrganizationOwnershipTransfer
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", transfer.ID).Scan(t.Context()))
	require.Equal(t, StatusPending, stored.Status)
	require.Contains(t, ownershipAuditActions(t, db), ActionAcceptanceFailed)
}

func TestExpiredAcceptanceIsRecordedAndKeepsOwner(t *testing.T) {
	service, db := newOwnershipTestService(t)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	service.now = func() time.Time { return time.Date(2026, 8, 22, 18, 0, 1, 0, time.UTC) }
	_, err = service.Accept(t.Context(), transfer.ID, testCredential("nominee"))
	require.ErrorIs(t, err, ErrExpired)
	require.Equal(t, models.OrganizationRoleOwner, memberRole(t, db, "owner"))
	_, err = service.GetForOrganization(t.Context(), "org", testCredential("owner"))
	require.ErrorIs(t, err, ErrNotFound)
	var pending models.OrganizationOwnershipTransfer
	require.NoError(t, db.NewSelect().Model(&pending).Where("id = ?", transfer.ID).Scan(t.Context()))
	require.Equal(t, StatusPending, pending.Status, "page reads must not materialize expiry")
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", JobTypeExpiry).Scan(t.Context()))
	require.NoError(t, service.HandleJob(t.Context(), job.Type, job.Payload))
	var stored models.OrganizationOwnershipTransfer
	require.NoError(t, db.NewSelect().Model(&stored).Where("organization_id = ?", "org").Scan(t.Context()))
	require.Equal(t, StatusExpired, stored.Status)
	var actions []string
	require.NoError(t, db.NewSelect().Model((*models.OrganizationOwnershipAuditEvent)(nil)).Column("action").Order("created_at ASC").Scan(t.Context(), &actions))
	require.Contains(t, actions, ActionExpired)
}

func TestExpiredRevocationRecordsExpiryAndFailedRevocation(t *testing.T) {
	service, db := newOwnershipTestService(t)
	_, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	service.now = func() time.Time { return time.Date(2026, 8, 22, 18, 0, 1, 0, time.UTC) }

	err = service.Revoke(t.Context(), "org", testCredential("owner"))
	require.ErrorIs(t, err, ErrExpired)
	var stored models.OrganizationOwnershipTransfer
	require.NoError(t, db.NewSelect().Model(&stored).Where("organization_id = ?", "org").Scan(t.Context()))
	require.Equal(t, StatusExpired, stored.Status)
	actions := ownershipAuditActions(t, db)
	require.Contains(t, actions, ActionExpired)
	require.Contains(t, actions, ActionRevocationFailed)
}

func TestExpiryJobRecordsDurableFailureWhenExpiryAuditFails(t *testing.T) {
	service, db := newOwnershipTestService(t)
	transfer, err := service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `CREATE TRIGGER fail_expired_audit BEFORE INSERT ON organization_ownership_audit_events
		WHEN NEW.action = 'ownership_transfer.expired'
		BEGIN SELECT RAISE(ABORT, 'expired audit unavailable'); END`)
	require.NoError(t, err)
	service.now = func() time.Time { return time.Date(2026, 8, 22, 18, 0, 1, 0, time.UTC) }
	var job models.Job
	require.NoError(t, db.NewSelect().Model(&job).Where("type = ?", JobTypeExpiry).Scan(t.Context()))

	err = service.HandleJob(t.Context(), job.Type, job.Payload)
	require.ErrorContains(t, err, "expired audit unavailable")
	var stored models.OrganizationOwnershipTransfer
	require.NoError(t, db.NewSelect().Model(&stored).Where("id = ?", transfer.ID).Scan(t.Context()))
	require.Equal(t, StatusPending, stored.Status, "expiry and its success audit roll back together")
	require.Contains(t, ownershipAuditActions(t, db), ActionExpiryFailed)
}

func TestAuditInsertErrorsAreReturnedToTheCaller(t *testing.T) {
	service, db := newOwnershipTestService(t)
	_, err := db.ExecContext(t.Context(), `CREATE TRIGGER fail_all_ownership_audit BEFORE INSERT ON organization_ownership_audit_events
		BEGIN SELECT RAISE(ABORT, 'ownership audit unavailable'); END`)
	require.NoError(t, err)

	_, err = service.Initiate(t.Context(), InitiateInput{OrganizationID: "org", ActorUserID: "owner", ActorSessionID: "owner-session", ReauthGrant: "recent", NomineeUserID: "nominee", ConfirmOrganizationName: "Acme"})
	require.ErrorContains(t, err, "ownership audit unavailable")
	count, countErr := db.NewSelect().Model((*models.OrganizationOwnershipTransfer)(nil)).Count(t.Context())
	require.NoError(t, countErr)
	require.Zero(t, count, "a transfer cannot commit without its audit evidence")
}

func ownershipAuditActions(t *testing.T, db *bun.DB) []string {
	t.Helper()
	var actions []string
	require.NoError(t, db.NewSelect().Model((*models.OrganizationOwnershipAuditEvent)(nil)).Column("action").Order("created_at ASC", "id ASC").Scan(t.Context(), &actions))
	return actions
}

func memberRole(t *testing.T, db *bun.DB, userID string) string {
	t.Helper()
	var role string
	require.NoError(t, db.NewSelect().Model((*models.OrganizationMember)(nil)).Column("role").Where("organization_id = ? AND user_id = ?", "org", userID).Scan(t.Context(), &role))
	return role
}

func ownerCount(t *testing.T, db *bun.DB) int {
	t.Helper()
	count, err := db.NewSelect().Model((*models.OrganizationMember)(nil)).Where("organization_id = ? AND role = ?", "org", models.OrganizationRoleOwner).Count(t.Context())
	require.NoError(t, err)
	return count
}
