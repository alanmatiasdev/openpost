package workspaceaccess

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/identity"
	"github.com/uptrace/bun"
)

// Level is the required Workspace access level for an application action.
type Level string

const (
	LevelRead       Level = "read"
	LevelEdit       Level = "edit"
	LevelAdminister Level = "administer"
)

// ActorFacts are the transport-independent facts known after authentication.
type ActorFacts struct {
	UserID                string
	SessionID             string
	TokenID               string
	CredentialWorkspaceID string
}

// Decision separates a safe authorization denial from an operational failure.
type Decision struct {
	Allowed bool
	Level   Level
	Role    string
	Reason  string
}

// Authorizer evaluates Workspace access using credential scope, Organization
// identity policy, active Workspace membership, and the role level required by
// the action. The DB may be a transaction so mutation callers can authorize
// against locked rows before writing.
type Authorizer struct {
	db bun.IDB
}

func NewAuthorizer(db bun.IDB) Authorizer {
	return Authorizer{db: db}
}

func (a Authorizer) Authorize(ctx context.Context, workspaceID string, actor ActorFacts, level Level) (Decision, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	actor = normalizeActor(actor)
	level = normalizeLevel(level)
	decision := Decision{Level: level}
	if workspaceID == "" || actor.UserID == "" {
		decision.Reason = "workspace access denied"
		return decision, nil
	}
	if actor.CredentialWorkspaceID != "" && actor.CredentialWorkspaceID != workspaceID {
		decision.Reason = "credential is bound to another workspace"
		return decision, nil
	}

	member, ok, err := Member(ctx, a.db, workspaceID, actor.UserID)
	if err != nil {
		return Decision{}, err
	}
	if !ok {
		decision.Reason = "active workspace membership required"
		return decision, nil
	}
	decision.Role = member.Role
	if !roleMeetsLevel(member.Role, level) {
		decision.Reason = "workspace role does not allow this action"
		return decision, nil
	}

	identityDecision, err := identity.EvaluateWorkspaceAccess(
		ctx,
		a.db,
		workspaceID,
		actor.UserID,
		actor.SessionID,
		actor.TokenID,
	)
	if err != nil {
		return Decision{}, err
	}
	if !identityDecision.Allowed {
		decision.Reason = firstNonEmpty(identityDecision.Reason, "credential does not satisfy organization policy")
		return decision, nil
	}
	decision.Allowed = true
	return decision, nil
}

func normalizeActor(actor ActorFacts) ActorFacts {
	actor.UserID = strings.TrimSpace(actor.UserID)
	actor.SessionID = strings.TrimSpace(actor.SessionID)
	actor.TokenID = strings.TrimSpace(actor.TokenID)
	actor.CredentialWorkspaceID = strings.TrimSpace(actor.CredentialWorkspaceID)
	return actor
}

func normalizeLevel(level Level) Level {
	switch level {
	case LevelEdit, LevelAdminister:
		return level
	default:
		return LevelRead
	}
}

func roleMeetsLevel(role string, level Level) bool {
	switch normalizeLevel(level) {
	case LevelRead:
		return role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor || role == models.WorkspaceRoleViewer
	case LevelEdit:
		return role == models.WorkspaceRoleAdmin || role == models.WorkspaceRoleEditor
	case LevelAdminister:
		return role == models.WorkspaceRoleAdmin
	default:
		return false
	}
}

// Member returns an active workspace membership. Inactive members must not be
// treated as authorized by API, OAuth, MCP, notification, or background-job
// paths.
func Member(ctx context.Context, db bun.IDB, workspaceID, userID string) (models.WorkspaceMember, bool, error) {
	var member models.WorkspaceMember
	err := db.NewSelect().
		Model(&member).
		Where("workspace_id = ? AND user_id = ? AND status = ?", strings.TrimSpace(workspaceID), strings.TrimSpace(userID), models.WorkspaceMemberStatusActive).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.WorkspaceMember{}, false, nil
	}
	if err != nil {
		return models.WorkspaceMember{}, false, err
	}
	return member, true, nil
}

func Allows(ctx context.Context, db bun.IDB, workspaceID, userID string) (bool, error) {
	decision, err := NewAuthorizer(db).Authorize(ctx, workspaceID, ActorFacts{UserID: userID}, LevelRead)
	return decision.Allowed, err
}

func IsAdmin(ctx context.Context, db bun.IDB, workspaceID, userID string) (bool, error) {
	decision, err := NewAuthorizer(db).Authorize(ctx, workspaceID, ActorFacts{UserID: userID}, LevelAdminister)
	return decision.Allowed, err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
