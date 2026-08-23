package connectors

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type Store struct {
	db  *bun.DB
	now func() time.Time
}

func NewStore(db *bun.DB) *Store {
	return &Store{db: db, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Store) SyncRegistry(ctx context.Context, registry *Registry) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connector store is unavailable")
	}
	entries := registry.All()
	now := s.now()
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		ids := make([]string, 0, len(entries))
		for _, entry := range entries {
			ids = append(ids, entry.InstallationID)
		}
		disable := tx.NewUpdate().Model((*models.ProviderInstallation)(nil)).
			Set("status = ?", "disabled").
			Set("status_detail = ?", "Connector is not present in the current operator configuration.").
			Set("updated_at = ?", now).
			Where("kind = ?", "connector")
		if len(ids) > 0 {
			disable = disable.Where("id NOT IN (?)", bun.In(ids))
		}
		if _, err := disable.Exec(txCtx); err != nil {
			return fmt.Errorf("disable removed connector installations: %w", err)
		}

		for _, entry := range entries {
			if entry.Manifest.Provider.ID == "" {
				if _, err := tx.NewUpdate().Model((*models.ProviderInstallation)(nil)).
					Set("status = ?", entry.Status).
					Set("status_detail = ?", safeStatusDetail(entry.StatusDetail)).
					Set("required = ?", entry.Required).
					Set("config_fingerprint = ?", entry.ConfigFingerprint).
					Set("last_seen_at = ?", now).
					Set("updated_at = ?", now).
					Where("id = ? AND kind = ?", entry.InstallationID, "connector").Exec(txCtx); err != nil {
					return fmt.Errorf("update unavailable connector installation %s: %w", entry.InstallationID, err)
				}
				continue
			}
			manifestJSON, err := json.Marshal(entry.Manifest)
			if err != nil {
				return fmt.Errorf("encode connector manifest %s: %w", entry.InstallationID, err)
			}
			row := &models.ProviderInstallation{
				ID: entry.InstallationID, Kind: "connector",
				ProviderID: entry.Manifest.Provider.ID, DisplayName: entry.Manifest.Provider.DisplayName,
				Description:     entry.Manifest.Provider.Description,
				ProtocolVersion: entry.Manifest.ProtocolVersion, ImplementationVersion: entry.Manifest.ImplementationVersion,
				CapabilityRevision: entry.Manifest.CapabilityRevision, ManifestJSON: string(manifestJSON),
				ConfigFingerprint: entry.ConfigFingerprint, Status: entry.Status,
				StatusDetail: safeStatusDetail(entry.StatusDetail), Required: entry.Required,
				LastSeenAt: now, CreatedAt: now, UpdatedAt: now,
			}
			if _, err := tx.NewInsert().Model(row).
				On("CONFLICT (id) DO UPDATE").
				Set("kind = EXCLUDED.kind").
				Set("provider_id = EXCLUDED.provider_id").
				Set("display_name = EXCLUDED.display_name").
				Set("description = EXCLUDED.description").
				Set("protocol_version = EXCLUDED.protocol_version").
				Set("implementation_version = EXCLUDED.implementation_version").
				Set("capability_revision = EXCLUDED.capability_revision").
				Set("manifest_json = EXCLUDED.manifest_json").
				Set("config_fingerprint = EXCLUDED.config_fingerprint").
				Set("status = EXCLUDED.status").
				Set("status_detail = EXCLUDED.status_detail").
				Set("required = EXCLUDED.required").
				Set("last_seen_at = EXCLUDED.last_seen_at").
				Set("updated_at = EXCLUDED.updated_at").
				Exec(txCtx); err != nil {
				return fmt.Errorf("store connector installation %s: %w", entry.InstallationID, err)
			}
		}
		return nil
	})
}

func (s *Store) BindAccount(ctx context.Context, binding models.ProviderAccountBinding) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("connector store is unavailable")
	}
	if binding.SocialAccountID == "" || binding.WorkspaceID == "" || binding.InstallationID == "" || binding.ExternalAccountID == "" {
		return fmt.Errorf("connector account binding identity is required")
	}
	var account models.SocialAccount
	if err := s.db.NewSelect().Model(&account).
		Where("id = ? AND workspace_id = ?", binding.SocialAccountID, binding.WorkspaceID).Scan(ctx); err != nil {
		return fmt.Errorf("load connector social account: %w", err)
	}
	var installation models.ProviderInstallation
	if err := s.db.NewSelect().Model(&installation).
		Where("id = ? AND kind = ?", binding.InstallationID, "connector").Scan(ctx); err != nil {
		return fmt.Errorf("load connector installation: %w", err)
	}
	if account.Platform != installation.ProviderID {
		return fmt.Errorf("connector account provider does not match its installation")
	}
	now := s.now()
	binding.CreatedAt = now
	binding.UpdatedAt = now
	_, err := s.db.NewInsert().Model(&binding).
		On("CONFLICT (social_account_id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").
		Set("installation_id = EXCLUDED.installation_id").
		Set("connection_ref = EXCLUDED.connection_ref").
		Set("external_account_id = EXCLUDED.external_account_id").
		Set("capability_revision = EXCLUDED.capability_revision").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("store connector account binding: %w", err)
	}
	return nil
}

func (s *Store) BindingForAccount(ctx context.Context, workspaceID, socialAccountID string) (models.ProviderAccountBinding, error) {
	var binding models.ProviderAccountBinding
	err := s.db.NewSelect().Model(&binding).
		Where("workspace_id = ? AND social_account_id = ?", workspaceID, socialAccountID).
		Scan(ctx)
	if err != nil {
		return models.ProviderAccountBinding{}, fmt.Errorf("load connector account binding: %w", err)
	}
	return binding, nil
}

func (s *Store) BeginConnection(ctx context.Context, workspaceID, installationID string, ttl time.Duration) (models.ConnectorConnectionSession, error) {
	if ttl <= 0 || ttl > 24*time.Hour {
		return models.ConnectorConnectionSession{}, fmt.Errorf("connector connection session TTL is invalid")
	}
	now := s.now()
	session := models.ConnectorConnectionSession{
		ID: uuid.NewString(), WorkspaceID: workspaceID, InstallationID: installationID,
		State: "pending", ExpiresAt: now.Add(ttl), CreatedAt: now, UpdatedAt: now,
	}
	if _, err := s.db.NewInsert().Model(&session).Exec(ctx); err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("begin connector connection: %w", err)
	}
	return session, nil
}

func (s *Store) CompleteConnection(
	ctx context.Context,
	sessionID, connectionRef string,
	accounts []ConnectionAccount,
) (models.ConnectorConnectionSession, error) {
	if strings.TrimSpace(connectionRef) == "" || len(accounts) == 0 {
		return models.ConnectorConnectionSession{}, fmt.Errorf("connector connection result is incomplete")
	}
	accountsJSON, err := json.Marshal(accounts)
	if err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("encode connector connection accounts: %w", err)
	}
	now := s.now()
	result, err := s.db.NewUpdate().Model((*models.ConnectorConnectionSession)(nil)).
		Set("state = ?", "complete").
		Set("connection_ref = ?", connectionRef).
		Set("accounts_json = ?", string(accountsJSON)).
		Set("updated_at = ?", now).
		Where("id = ? AND state = ? AND expires_at > ?", sessionID, "pending", now).
		Exec(ctx)
	if err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("complete connector connection: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("check connector connection completion: %w", err)
	}
	if rows != 1 {
		return models.ConnectorConnectionSession{}, fmt.Errorf("connector connection session is not pending or has expired")
	}
	var session models.ConnectorConnectionSession
	if err := s.db.NewSelect().Model(&session).Where("id = ?", sessionID).Scan(ctx); err != nil {
		return models.ConnectorConnectionSession{}, fmt.Errorf("load completed connector connection: %w", err)
	}
	return session, nil
}

func safeStatusDetail(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > 240 {
		value = value[:240]
	}
	return value
}
