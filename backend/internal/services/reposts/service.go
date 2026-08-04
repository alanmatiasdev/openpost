package reposts

import (
	"context"
	"sync"

	"github.com/openpost/backend/internal/platform"
	"github.com/openpost/backend/internal/services/lifecycle"
	"github.com/uptrace/bun"
)

type TokenSource interface {
	GetValidAccessToken(ctx context.Context, accountID string) (string, error)
}

type Service struct {
	db          *bun.DB
	tokenSource TokenSource
	lifecycle   *lifecycle.Service
	providersMu sync.RWMutex
	providers   map[string]platform.Adapter
}

func NewService(db *bun.DB, tokenSource TokenSource) *Service {
	return &Service{
		db:          db,
		tokenSource: tokenSource,
		lifecycle:   lifecycle.NewService(db),
		providers:   make(map[string]platform.Adapter),
	}
}

func (s *Service) SetProvider(name string, adapter platform.Adapter) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()
	s.providers[name] = adapter
}
