package handlers

import (
	"context"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/openpost/backend/internal/database"
	"github.com/openpost/backend/internal/models"
	"github.com/uptrace/bun"
)

type synchronizeXRequestSelectsHook struct {
	mu       sync.Mutex
	arrivals int
	release  chan struct{}
}

func (hook *synchronizeXRequestSelectsHook) BeforeQuery(ctx context.Context, event *bun.QueryEvent) context.Context {
	if event.Operation() != "SELECT" || !strings.Contains(event.Query, "x_oauth_request_tokens") {
		return ctx
	}

	hook.mu.Lock()
	hook.arrivals++
	if hook.arrivals == 2 {
		close(hook.release)
	}
	hook.mu.Unlock()
	<-hook.release
	return ctx
}

func (*synchronizeXRequestSelectsHook) AfterQuery(context.Context, *bun.QueryEvent) {}

func TestXRequestStoreReturnsSecretToOneConcurrentConsumer(t *testing.T) {
	ctx := context.Background()
	db, err := database.InitDBWithDriver("sqlite", "file:"+filepath.Join(t.TempDir(), "x-request.db")+"?mode=rwc")
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	if _, err := db.NewCreateTable().Model((*models.XOAuthRequestToken)(nil)).Exec(ctx); err != nil {
		t.Fatalf("create X request-token table: %v", err)
	}

	store := newXRequestStore(db)
	if err := store.Save("request-token", "request-secret", "workspace-1", "user-1", "connect", time.Now()); err != nil {
		t.Fatalf("save X request token: %v", err)
	}

	// Force an implementation that selects before deleting to let both callbacks
	// observe the secret. An atomic delete-and-return implementation skips this hook.
	db.AddQueryHook(&synchronizeXRequestSelectsHook{release: make(chan struct{})})

	type consumeResult struct {
		secret string
		ok     bool
		err    error
	}
	results := make(chan consumeResult, 2)
	start := make(chan struct{})
	for range 2 {
		go func() {
			<-start
			meta, ok, consumeErr := store.Consume("request-token", time.Minute)
			results <- consumeResult{secret: meta.Secret, ok: ok, err: consumeErr}
		}()
	}
	close(start)

	var successes, rejected int
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf("consume X request token: %v", result.err)
		}
		if result.ok {
			successes++
			if result.secret != "request-secret" {
				t.Fatalf("successful consumer received the wrong secret: %q", result.secret)
			}
			continue
		}
		rejected++
		if result.secret != "" {
			t.Fatalf("rejected consumer received X request secret: %q", result.secret)
		}
	}
	if successes != 1 || rejected != 1 {
		t.Fatalf("expected one successful and one rejected consumer, got successes=%d rejected=%d", successes, rejected)
	}
}
