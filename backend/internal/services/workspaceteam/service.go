package workspaceteam

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/openpost/backend/internal/services/notifications"
	"github.com/uptrace/bun"
)

const (
	InvitationTokenPrefix = "op_inv"
	InvitationLifetime    = 7 * 24 * time.Hour

	ActionInvitationCreated  = "invitation.created"
	ActionInvitationResent   = "invitation.resent"
	ActionInvitationRevoked  = "invitation.revoked"
	ActionInvitationAccepted = "invitation.accepted"
	ActionMemberRoleChanged  = "member.role_changed"
	ActionMemberDeactivated  = "member.deactivated"
	ActionMemberReactivated  = "member.reactivated"
	ActionMemberRemoved      = "member.removed"
)

type ErrorKind string

const (
	ErrorNotFound  ErrorKind = "not_found"
	ErrorForbidden ErrorKind = "forbidden"
	ErrorConflict  ErrorKind = "conflict"
	ErrorPayment   ErrorKind = "payment_required"
	ErrorInvalid   ErrorKind = "invalid"
)

type LifecycleError struct {
	Kind    ErrorKind
	Message string
}

func (e *LifecycleError) Error() string { return e.Message }

func lifecycleError(kind ErrorKind, message string) error {
	return &LifecycleError{Kind: kind, Message: message}
}

func ErrorKindOf(err error) ErrorKind {
	var lifecycleErr *LifecycleError
	if errors.As(err, &lifecycleErr) {
		return lifecycleErr.Kind
	}
	return ""
}

type Service struct {
	db            *bun.DB
	entitlement   entitlements.Service
	notifications *notifications.Service
	now           func() time.Time
}

func NewService(db *bun.DB, entitlement entitlements.Service, notificationService *notifications.Service) *Service {
	if entitlement == nil {
		entitlement = entitlements.NewSelfHostedService()
	}
	return &Service{
		db:            db,
		entitlement:   entitlement,
		notifications: notificationService,
		now:           func() time.Time { return time.Now().UTC() },
	}
}

type Filters struct {
	Query  string
	Role   string
	Status string
}

type Member struct {
	models.WorkspaceMember
	Email string `bun:"email" json:"email"`
}

type Invitation struct {
	models.WorkspaceInvitation
	Status string `bun:"-" json:"status"`
}

type Team struct {
	Members      []Member
	Invitations  []Invitation
	CurrentSeats int64
	CanManage    bool
}

type InviteInput struct {
	WorkspaceID string
	ActorUserID string
	Email       string
	Role        string
}

type UpdateMemberInput struct {
	WorkspaceID   string
	ActorUserID   string
	SubjectUserID string
	Role          string
	Status        string
}

func (s *Service) List(ctx context.Context, workspaceID, userID string, filters Filters) (Team, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	member, err := s.member(ctx, s.db, workspaceID, strings.TrimSpace(userID), true)
	if err != nil {
		return Team{}, err
	}
	filters = normalizeFilters(filters)

	members := []Member{}
	if filters.Status == "" || filters.Status == "all" || filters.Status == models.WorkspaceMemberStatusActive || filters.Status == models.WorkspaceMemberStatusInactive {
		query := s.db.NewSelect().
			Model(&members).
			ModelTableExpr("workspace_members AS workspace_member").
			ColumnExpr("workspace_member.*").
			ColumnExpr("u.email").
			Join("JOIN users AS u ON u.id = workspace_member.user_id").
			Where("workspace_member.workspace_id = ?", workspaceID)
		if filters.Status == models.WorkspaceMemberStatusActive || filters.Status == models.WorkspaceMemberStatusInactive {
			query = query.Where("workspace_member.status = ?", filters.Status)
		}
		if filters.Role != "" && filters.Role != "all" {
			query = query.Where("workspace_member.role = ?", filters.Role)
		}
		if filters.Query != "" {
			query = query.Where("LOWER(u.email) LIKE ?", "%"+filters.Query+"%")
		}
		if err := query.OrderExpr("CASE WHEN workspace_member.status = 'active' THEN 0 ELSE 1 END, LOWER(u.email) ASC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Team{}, fmt.Errorf("list workspace members: %w", err)
		}
	}

	now := s.now()
	invitations := []models.WorkspaceInvitation{}
	if filters.Status == "" || filters.Status == "all" || filters.Status == "pending" || filters.Status == "expired" {
		query := s.db.NewSelect().Model(&invitations).
			Where("workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", workspaceID)
		if filters.Status == "pending" {
			query = query.Where("expires_at > ?", now)
		} else if filters.Status == "expired" {
			query = query.Where("expires_at <= ?", now)
		}
		if filters.Role != "" && filters.Role != "all" {
			query = query.Where("role = ?", filters.Role)
		}
		if filters.Query != "" {
			query = query.Where("LOWER(email) LIKE ?", "%"+filters.Query+"%")
		}
		if err := query.OrderExpr("created_at DESC").Scan(ctx); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Team{}, fmt.Errorf("list workspace invitations: %w", err)
		}
	}
	inviteRows := make([]Invitation, 0, len(invitations))
	for _, invitation := range invitations {
		status := "pending"
		if !invitation.ExpiresAt.After(now) {
			status = "expired"
		}
		inviteRows = append(inviteRows, Invitation{WorkspaceInvitation: invitation, Status: status})
	}

	currentSeats, err := s.currentSeats(ctx, s.db, workspaceID, now)
	if err != nil {
		return Team{}, fmt.Errorf("count workspace seats: %w", err)
	}
	return Team{
		Members: members, Invitations: inviteRows, CurrentSeats: currentSeats,
		CanManage: member.Role == models.WorkspaceRoleAdmin,
	}, nil
}

func (s *Service) Invite(ctx context.Context, input InviteInput) (models.WorkspaceInvitation, string, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.Email = NormalizeEmail(input.Email)
	input.Role = strings.TrimSpace(input.Role)
	if input.Email == "" {
		return models.WorkspaceInvitation{}, "", lifecycleError(ErrorInvalid, "email is required")
	}
	if input.Role == "" {
		input.Role = models.WorkspaceRoleEditor
	}
	if !ValidRole(input.Role) {
		return models.WorkspaceInvitation{}, "", lifecycleError(ErrorInvalid, "invalid workspace role")
	}
	seatDecision, err := s.seatDecision(ctx, input.WorkspaceID)
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	if !seatDecision.Allowed {
		return models.WorkspaceInvitation{}, "", lifecycleError(ErrorPayment, decisionReason(seatDecision))
	}
	rawToken, tokenHash, err := GenerateInvitationToken()
	if err != nil {
		return models.WorkspaceInvitation{}, "", fmt.Errorf("generate invitation token: %w", err)
	}
	now := s.now()
	invitation := models.WorkspaceInvitation{
		ID: uuid.NewString(), WorkspaceID: input.WorkspaceID, Email: input.Email,
		Role: input.Role, InvitedByUserID: input.ActorUserID, TokenHash: tokenHash,
		ExpiresAt: now.Add(InvitationLifetime), LastSentAt: now, CreatedAt: now,
	}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, input.WorkspaceID, input.ActorUserID); err != nil {
			return err
		}
		if _, err := tx.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
			Set("revoked_at = ?", now).
			Where("workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= ?", input.WorkspaceID, input.Email, now).
			Exec(txCtx); err != nil {
			return err
		}
		var memberCount int
		if err := tx.NewSelect().ColumnExpr("COUNT(*)").Model((*models.WorkspaceMember)(nil)).
			Where("workspace_id = ? AND user_id IN (SELECT id FROM users WHERE LOWER(email) = ?)", input.WorkspaceID, input.Email).
			Scan(txCtx, &memberCount); err != nil {
			return err
		}
		if memberCount > 0 {
			return lifecycleError(ErrorConflict, "user is already a workspace member")
		}
		var pendingCount int
		if err := tx.NewSelect().ColumnExpr("COUNT(*)").Model((*models.WorkspaceInvitation)(nil)).
			Where("workspace_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", input.WorkspaceID, input.Email, now).
			Scan(txCtx, &pendingCount); err != nil {
			return err
		}
		if pendingCount > 0 {
			return lifecycleError(ErrorConflict, "workspace invitation already pending")
		}
		currentSeats, err := s.currentSeats(txCtx, tx, input.WorkspaceID, now)
		if err != nil {
			return err
		}
		if !seatAllowed(seatDecision, currentSeats) {
			return lifecycleError(ErrorPayment, seatDecisionReason(seatDecision, currentSeats))
		}
		if _, err := tx.NewInsert().Model(&invitation).Exec(txCtx); err != nil {
			return err
		}
		if err := insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: input.WorkspaceID, ActorUserID: input.ActorUserID,
			InvitationID: invitation.ID, SubjectEmail: input.Email,
			Action: ActionInvitationCreated, Role: input.Role, Status: "pending", CreatedAt: now,
		}); err != nil {
			return err
		}
		return s.notifyInvitation(txCtx, tx, invitation, false)
	})
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	return invitation, rawToken, nil
}

func (s *Service) ResendInvitation(ctx context.Context, workspaceID, invitationID, actorUserID string) (models.WorkspaceInvitation, string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	actorUserID = strings.TrimSpace(actorUserID)
	seatDecision, err := s.seatDecision(ctx, workspaceID)
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	rawToken, tokenHash, err := GenerateInvitationToken()
	if err != nil {
		return models.WorkspaceInvitation{}, "", fmt.Errorf("generate invitation token: %w", err)
	}
	now := s.now()
	var invitation models.WorkspaceInvitation
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, workspaceID, actorUserID); err != nil {
			return err
		}
		if err := tx.NewSelect().Model(&invitation).
			Where("id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitationID, workspaceID).
			Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return lifecycleError(ErrorNotFound, "workspace invitation not found")
		} else if err != nil {
			return err
		}
		// A still-pending invitation already reserves its seat. Resending an
		// expired invitation makes it pending again, so reserve that seat under
		// the same workspace lock used by invites and member reactivation.
		if !invitation.ExpiresAt.After(now) {
			currentSeats, err := s.currentSeats(txCtx, tx, workspaceID, now)
			if err != nil {
				return err
			}
			if !seatAllowed(seatDecision, currentSeats) {
				return lifecycleError(ErrorPayment, seatDecisionReason(seatDecision, currentSeats))
			}
		}
		invitation.TokenHash = tokenHash
		invitation.ExpiresAt = now.Add(InvitationLifetime)
		invitation.LastSentAt = now
		invitation.InvitedByUserID = actorUserID
		if _, err := tx.NewUpdate().Model(&invitation).
			Column("token_hash", "expires_at", "last_sent_at", "invited_by_user_id").
			WherePK().Exec(txCtx); err != nil {
			return err
		}
		if err := insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: workspaceID, ActorUserID: actorUserID, InvitationID: invitation.ID,
			SubjectEmail: invitation.Email, Action: ActionInvitationResent,
			Role: invitation.Role, Status: "pending", CreatedAt: now,
		}); err != nil {
			return err
		}
		return s.notifyInvitation(txCtx, tx, invitation, true)
	})
	if err != nil {
		return models.WorkspaceInvitation{}, "", err
	}
	return invitation, rawToken, nil
}

func (s *Service) RevokeInvitation(ctx context.Context, workspaceID, invitationID, actorUserID string) error {
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, workspaceID, actorUserID); err != nil {
			return err
		}
		var invitation models.WorkspaceInvitation
		if err := tx.NewSelect().Model(&invitation).
			Where("id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitationID, workspaceID).
			Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return lifecycleError(ErrorNotFound, "workspace invitation not found")
		} else if err != nil {
			return err
		}
		result, err := tx.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).Set("revoked_at = ?", now).
			Where("id = ? AND workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitationID, workspaceID).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return lifecycleError(ErrorConflict, "workspace invitation is no longer pending")
		}
		return insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: workspaceID, ActorUserID: actorUserID, InvitationID: invitation.ID,
			SubjectEmail: invitation.Email, Action: ActionInvitationRevoked,
			Role: invitation.Role, PreviousStatus: "pending", Status: "revoked", CreatedAt: now,
		})
	})
}

func (s *Service) FindInvitationByToken(ctx context.Context, token string) (models.WorkspaceInvitation, error) {
	var invitation models.WorkspaceInvitation
	err := s.db.NewSelect().Model(&invitation).Where("token_hash = ?", HashInvitationToken(token)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceInvitation{}, lifecycleError(ErrorNotFound, "workspace invitation not found")
	}
	return invitation, err
}

func (s *Service) FindInvitationByID(ctx context.Context, invitationID string) (models.WorkspaceInvitation, error) {
	var invitation models.WorkspaceInvitation
	err := s.db.NewSelect().Model(&invitation).Where("id = ?", strings.TrimSpace(invitationID)).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceInvitation{}, lifecycleError(ErrorNotFound, "workspace invitation not found")
	}
	return invitation, err
}

func (s *Service) AcceptInvitation(ctx context.Context, invitation models.WorkspaceInvitation, userID, userEmail string) error {
	userID = strings.TrimSpace(userID)
	userEmail = NormalizeEmail(userEmail)
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := lockWorkspace(txCtx, tx, invitation.WorkspaceID); err != nil {
			return err
		}
		if err := tx.NewSelect().Model(&invitation).Where("id = ?", invitation.ID).Scan(txCtx); errors.Is(err, sql.ErrNoRows) {
			return lifecycleError(ErrorNotFound, "workspace invitation not found")
		} else if err != nil {
			return err
		}
		if !invitation.AcceptedAt.IsZero() {
			return lifecycleError(ErrorConflict, "workspace invitation already accepted")
		}
		if !invitation.RevokedAt.IsZero() {
			return lifecycleError(ErrorConflict, "workspace invitation was revoked")
		}
		if !invitation.ExpiresAt.After(now) {
			return lifecycleError(ErrorConflict, "workspace invitation expired")
		}
		if invitation.Email != userEmail {
			return lifecycleError(ErrorForbidden, "workspace invitation belongs to a different email address")
		}
		var existing int
		if err := tx.NewSelect().ColumnExpr("COUNT(*)").Model((*models.WorkspaceMember)(nil)).
			Where("workspace_id = ? AND user_id = ?", invitation.WorkspaceID, userID).Scan(txCtx, &existing); err != nil {
			return err
		}
		if existing > 0 {
			return lifecycleError(ErrorConflict, "user is already a workspace member")
		}
		member := &models.WorkspaceMember{
			WorkspaceID: invitation.WorkspaceID, UserID: userID, Role: invitation.Role,
			Status: models.WorkspaceMemberStatusActive, CreatedAt: now, UpdatedAt: now,
		}
		if _, err := tx.NewInsert().Model(member).Exec(txCtx); err != nil {
			return err
		}
		var workspace models.Workspace
		if err := tx.NewSelect().Model(&workspace).Column("id", "organization_id").Where("id = ?", invitation.WorkspaceID).Scan(txCtx); err != nil {
			return err
		}
		organizationMember := &models.OrganizationMember{
			OrganizationID: workspace.OrganizationID, UserID: userID,
			Role: models.OrganizationRoleMember, CreatedAt: now,
		}
		if _, err := tx.NewInsert().Model(organizationMember).On("CONFLICT (organization_id, user_id) DO NOTHING").Exec(txCtx); err != nil {
			return err
		}
		result, err := tx.NewUpdate().Model((*models.WorkspaceInvitation)(nil)).
			Set("accepted_by_user_id = ?", userID).Set("accepted_at = ?", now).
			Where("id = ? AND accepted_at IS NULL AND revoked_at IS NULL", invitation.ID).Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return lifecycleError(ErrorConflict, "workspace invitation is no longer pending")
		}
		return insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: invitation.WorkspaceID, ActorUserID: userID, SubjectUserID: userID,
			InvitationID: invitation.ID, SubjectEmail: invitation.Email,
			Action: ActionInvitationAccepted, Role: invitation.Role,
			PreviousStatus: "pending", Status: models.WorkspaceMemberStatusActive, CreatedAt: now,
		})
	})
}

func (s *Service) UpdateMember(ctx context.Context, input UpdateMemberInput) (Member, error) {
	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ActorUserID = strings.TrimSpace(input.ActorUserID)
	input.SubjectUserID = strings.TrimSpace(input.SubjectUserID)
	input.Role = strings.TrimSpace(input.Role)
	input.Status = strings.TrimSpace(input.Status)
	if input.Role == "" && input.Status == "" {
		return Member{}, lifecycleError(ErrorInvalid, "role or status is required")
	}
	if input.Role != "" && !ValidRole(input.Role) {
		return Member{}, lifecycleError(ErrorInvalid, "invalid workspace role")
	}
	if input.Status != "" && input.Status != models.WorkspaceMemberStatusActive && input.Status != models.WorkspaceMemberStatusInactive {
		return Member{}, lifecycleError(ErrorInvalid, "invalid workspace member status")
	}
	var seatDecision entitlements.Decision
	var err error
	if input.Status == models.WorkspaceMemberStatusActive {
		seatDecision, err = s.seatDecision(ctx, input.WorkspaceID)
		if err != nil {
			return Member{}, err
		}
		if !seatDecision.Allowed {
			return Member{}, lifecycleError(ErrorPayment, decisionReason(seatDecision))
		}
	}
	now := s.now()
	var updated Member
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, input.WorkspaceID, input.ActorUserID); err != nil {
			return err
		}
		member, err := s.member(txCtx, tx, input.WorkspaceID, input.SubjectUserID, false)
		if err != nil {
			if ErrorKindOf(err) == ErrorForbidden {
				return lifecycleError(ErrorNotFound, "workspace member not found")
			}
			return err
		}
		var user models.User
		if err := tx.NewSelect().Model(&user).Column("id", "email").Where("id = ?", input.SubjectUserID).Scan(txCtx); err != nil {
			return err
		}
		newRole := member.Role
		if input.Role != "" {
			newRole = input.Role
		}
		newStatus := member.Status
		if input.Status != "" {
			newStatus = input.Status
		}
		if member.Role == models.WorkspaceRoleAdmin && member.Status == models.WorkspaceMemberStatusActive &&
			(newRole != models.WorkspaceRoleAdmin || newStatus != models.WorkspaceMemberStatusActive) {
			if err := s.requireAnotherActiveAdmin(txCtx, tx, input.WorkspaceID, input.SubjectUserID); err != nil {
				return err
			}
		}
		if member.Status == models.WorkspaceMemberStatusInactive && newStatus == models.WorkspaceMemberStatusActive {
			currentSeats, err := s.currentSeats(txCtx, tx, input.WorkspaceID, now)
			if err != nil {
				return err
			}
			if !seatAllowed(seatDecision, currentSeats) {
				return lifecycleError(ErrorPayment, seatDecisionReason(seatDecision, currentSeats))
			}
		}
		if newRole == member.Role && newStatus == member.Status {
			updated = Member{WorkspaceMember: member, Email: user.Email}
			return nil
		}
		deactivatedAt := member.DeactivatedAt
		if member.Status != newStatus {
			if newStatus == models.WorkspaceMemberStatusInactive {
				deactivatedAt = now
			} else {
				deactivatedAt = time.Time{}
			}
		}
		result, err := tx.NewUpdate().Model((*models.WorkspaceMember)(nil)).
			Set("role = ?", newRole).Set("status = ?", newStatus).Set("updated_at = ?", now).
			Set("deactivated_at = ?", nullTime(deactivatedAt)).
			Where("workspace_id = ? AND user_id = ? AND role = ? AND status = ?", input.WorkspaceID, input.SubjectUserID, member.Role, member.Status).
			Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return lifecycleError(ErrorConflict, "workspace member changed; reload and try again")
		}
		if member.Role != newRole {
			if err := insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
				WorkspaceID: input.WorkspaceID, ActorUserID: input.ActorUserID, SubjectUserID: input.SubjectUserID,
				SubjectEmail: user.Email, Action: ActionMemberRoleChanged,
				PreviousRole: member.Role, Role: newRole, Status: newStatus, CreatedAt: now,
			}); err != nil {
				return err
			}
		}
		if member.Status != newStatus {
			action := ActionMemberDeactivated
			if newStatus == models.WorkspaceMemberStatusActive {
				action = ActionMemberReactivated
			}
			if err := insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
				WorkspaceID: input.WorkspaceID, ActorUserID: input.ActorUserID, SubjectUserID: input.SubjectUserID,
				SubjectEmail: user.Email, Action: action, Role: newRole,
				PreviousStatus: member.Status, Status: newStatus, CreatedAt: now,
			}); err != nil {
				return err
			}
		}
		member.Role = newRole
		member.Status = newStatus
		member.UpdatedAt = now
		member.DeactivatedAt = deactivatedAt
		updated = Member{WorkspaceMember: member, Email: user.Email}
		return nil
	})
	return updated, err
}

func (s *Service) RemoveMember(ctx context.Context, workspaceID, subjectUserID, actorUserID string) error {
	workspaceID = strings.TrimSpace(workspaceID)
	subjectUserID = strings.TrimSpace(subjectUserID)
	actorUserID = strings.TrimSpace(actorUserID)
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := s.lockWorkspaceAndRequireAdmin(txCtx, tx, workspaceID, actorUserID); err != nil {
			return err
		}
		member, err := s.member(txCtx, tx, workspaceID, subjectUserID, false)
		if err != nil {
			if ErrorKindOf(err) == ErrorForbidden {
				return lifecycleError(ErrorNotFound, "workspace member not found")
			}
			return err
		}
		if member.Role == models.WorkspaceRoleAdmin && member.Status == models.WorkspaceMemberStatusActive {
			if err := s.requireAnotherActiveAdmin(txCtx, tx, workspaceID, subjectUserID); err != nil {
				return err
			}
		}
		var user models.User
		if err := tx.NewSelect().Model(&user).Column("id", "email").Where("id = ?", subjectUserID).Scan(txCtx); err != nil {
			return err
		}
		result, err := tx.NewDelete().Model((*models.WorkspaceMember)(nil)).
			Where("workspace_id = ? AND user_id = ?", workspaceID, subjectUserID).Exec(txCtx)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return lifecycleError(ErrorNotFound, "workspace member not found")
		}
		return insertAudit(txCtx, tx, models.WorkspaceAccessAuditEvent{
			WorkspaceID: workspaceID, ActorUserID: actorUserID, SubjectUserID: subjectUserID,
			SubjectEmail: user.Email, Action: ActionMemberRemoved,
			PreviousRole: member.Role, Role: member.Role,
			PreviousStatus: member.Status, Status: "removed", CreatedAt: now,
		})
	})
}

func (s *Service) ListAudit(ctx context.Context, workspaceID, actorUserID string, limit int) ([]models.WorkspaceAccessAuditEvent, error) {
	member, err := s.member(ctx, s.db, workspaceID, actorUserID, true)
	if err != nil {
		return nil, err
	}
	if member.Role != models.WorkspaceRoleAdmin {
		return nil, lifecycleError(ErrorForbidden, "workspace admin role required")
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	events := []models.WorkspaceAccessAuditEvent{}
	err = s.db.NewSelect().Model(&events).Where("workspace_id = ?", workspaceID).
		OrderExpr("created_at DESC, id DESC").Limit(limit).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return events, nil
	}
	return events, err
}

func (s *Service) member(ctx context.Context, db bun.IDB, workspaceID, userID string, activeOnly bool) (models.WorkspaceMember, error) {
	var member models.WorkspaceMember
	query := db.NewSelect().Model(&member).Where("workspace_id = ? AND user_id = ?", workspaceID, userID)
	if activeOnly {
		query = query.Where("status = ?", models.WorkspaceMemberStatusActive)
	}
	if err := query.Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceMember{}, lifecycleError(ErrorForbidden, "workspace not accessible")
	} else if err != nil {
		return models.WorkspaceMember{}, err
	}
	return member, nil
}

func (s *Service) lockWorkspaceAndRequireAdmin(ctx context.Context, tx bun.Tx, workspaceID, actorUserID string) error {
	if err := lockWorkspace(ctx, tx, workspaceID); err != nil {
		return err
	}
	member, err := s.member(ctx, tx, workspaceID, actorUserID, true)
	if err != nil {
		return err
	}
	if member.Role != models.WorkspaceRoleAdmin {
		return lifecycleError(ErrorForbidden, "workspace admin role required")
	}
	return nil
}

func lockWorkspace(ctx context.Context, tx bun.Tx, workspaceID string) error {
	result, err := tx.NewUpdate().Model((*models.Workspace)(nil)).Set("name = name").Where("id = ?", workspaceID).Exec(ctx)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return lifecycleError(ErrorNotFound, "workspace not found")
	}
	return nil
}

func (s *Service) requireAnotherActiveAdmin(ctx context.Context, db bun.IDB, workspaceID, excludedUserID string) error {
	count, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND user_id != ? AND role = ? AND status = ?", workspaceID, excludedUserID, models.WorkspaceRoleAdmin, models.WorkspaceMemberStatusActive).
		Count(ctx)
	if err != nil {
		return err
	}
	if count == 0 {
		return lifecycleError(ErrorConflict, "the workspace must keep at least one active administrator")
	}
	return nil
}

func (s *Service) currentSeats(ctx context.Context, db bun.IDB, workspaceID string, now time.Time) (int64, error) {
	activeMembers, err := db.NewSelect().Model((*models.WorkspaceMember)(nil)).
		Where("workspace_id = ? AND status = ?", workspaceID, models.WorkspaceMemberStatusActive).Count(ctx)
	if err != nil {
		return 0, err
	}
	pendingInvites, err := db.NewSelect().Model((*models.WorkspaceInvitation)(nil)).
		Where("workspace_id = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?", workspaceID, now).Count(ctx)
	if err != nil {
		return 0, err
	}
	return int64(activeMembers + pendingInvites), nil
}

func (s *Service) seatDecision(ctx context.Context, workspaceID string) (entitlements.Decision, error) {
	decision, err := s.entitlement.Check(ctx, entitlements.Request{
		WorkspaceID: workspaceID, Limit: entitlements.LimitTeamMembers, Current: 0, Amount: 1,
	})
	if err != nil {
		return entitlements.Decision{}, fmt.Errorf("check team member limit: %w", err)
	}
	return decision, nil
}

func seatAllowed(decision entitlements.Decision, current int64) bool {
	return decision.Allowed && (decision.Unlimited || current+1 <= decision.Limit)
}

func decisionReason(decision entitlements.Decision) string {
	if strings.TrimSpace(decision.Reason) != "" {
		return decision.Reason
	}
	return "team member limit exceeded"
}

func seatDecisionReason(decision entitlements.Decision, current int64) string {
	if strings.TrimSpace(decision.Reason) != "" {
		return decision.Reason
	}
	if !decision.Unlimited && decision.Limit >= 0 {
		return fmt.Sprintf("team_members limit exceeded: current %d + requested 1 > limit %d", current, decision.Limit)
	}
	return "team member limit exceeded"
}

func insertAudit(ctx context.Context, db bun.IDB, event models.WorkspaceAccessAuditEvent) error {
	if event.ID == "" {
		event.ID = uuid.NewString()
	}
	_, err := db.NewInsert().Model(&event).Exec(ctx)
	return err
}

func (s *Service) notifyInvitation(ctx context.Context, tx bun.Tx, invitation models.WorkspaceInvitation, resent bool) error {
	if s.notifications == nil {
		return nil
	}
	var user models.User
	if err := tx.NewSelect().Model(&user).Where("LOWER(email) = ?", invitation.Email).Scan(ctx); errors.Is(err, sql.ErrNoRows) {
		return nil
	} else if err != nil {
		return err
	}
	var workspace models.Workspace
	if err := tx.NewSelect().Model(&workspace).Column("id", "name").Where("id = ?", invitation.WorkspaceID).Scan(ctx); err != nil {
		return err
	}
	dedupKey := "workspace-invitation:" + invitation.ID
	if resent {
		dedupKey += ":" + invitation.LastSentAt.UTC().Format(time.RFC3339Nano)
	}
	return s.notifications.CreateWithDB(ctx, tx, notifications.CreateInput{
		// The invitee does not have workspace access yet, so this notification
		// must remain visible outside any workspace-scoped notification feed.
		UserID: user.ID,
		Type:   notifications.TypeWorkspaceInvite, Title: "Workspace invitation",
		Body: "You were invited to " + workspace.Name + ".",
		Href: "/invite?id=" + invitation.ID, DedupKey: dedupKey,
		Actions: []models.NotificationAction{{Label: "Review invitation", Href: "/invite?id=" + invitation.ID, Kind: "primary"}},
	})
}

func normalizeFilters(filters Filters) Filters {
	filters.Query = NormalizeEmail(filters.Query)
	filters.Role = strings.ToLower(strings.TrimSpace(filters.Role))
	filters.Status = strings.ToLower(strings.TrimSpace(filters.Status))
	return filters
}

func NormalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func ValidRole(role string) bool {
	switch role {
	case models.WorkspaceRoleAdmin, models.WorkspaceRoleEditor, models.WorkspaceRoleViewer:
		return true
	default:
		return false
	}
}

func GenerateInvitationToken() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(buf)
	token := InvitationTokenPrefix + "_" + secret
	return token, HashInvitationToken(token), nil
}

func HashInvitationToken(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func nullTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}
