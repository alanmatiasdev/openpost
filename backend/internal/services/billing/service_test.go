package billing

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"testing"
	"time"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/sqlitedialect"
)

type fakePaddleAPI struct {
	subscription *paddle.Subscription
	transaction  *paddle.Transaction
	customer     *paddle.Customer
	portal       *paddle.CustomerPortalSession
	subGets      int
	customerGets int
}

func (f *fakePaddleAPI) GetSubscription(context.Context, *paddle.GetSubscriptionRequest) (*paddle.Subscription, error) {
	f.subGets++
	return f.subscription, nil
}

func (f *fakePaddleAPI) GetTransaction(context.Context, *paddle.GetTransactionRequest) (*paddle.Transaction, error) {
	return f.transaction, nil
}

func (f *fakePaddleAPI) GetCustomer(context.Context, *paddle.GetCustomerRequest) (*paddle.Customer, error) {
	f.customerGets++
	return f.customer, nil
}

func (f *fakePaddleAPI) CreateCustomerPortalSession(context.Context, *paddle.CreateCustomerPortalSessionRequest) (*paddle.CustomerPortalSession, error) {
	return f.portal, nil
}

func newBillingTestDB(t *testing.T) *bun.DB {
	t.Helper()
	sqldb, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?mode=memory&cache=shared", uuid.NewString()))
	require.NoError(t, err)
	sqldb.SetMaxOpenConns(1)
	db := bun.NewDB(sqldb, sqlitedialect.New())
	for _, model := range []interface{}{
		(*models.Workspace)(nil),
		(*models.BillingSubscription)(nil),
		(*models.BillingWebhookEvent)(nil),
		(*models.BillingCheckoutAttempt)(nil),
		(*models.BillingCustomer)(nil),
		(*models.Job)(nil),
	} {
		_, err := db.NewCreateTable().Model(model).IfNotExists().Exec(context.Background())
		require.NoError(t, err)
	}
	_, err = db.NewInsert().Model(&models.Workspace{ID: "ws-1", Name: "Launch"}).Exec(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

func paddleSignature(secret string, now time.Time, body []byte) string {
	timestamp := fmt.Sprintf("%d", now.Unix())
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(timestamp + ":" + string(body)))
	return "ts=" + timestamp + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

func testCatalog() map[string]PlanConfig {
	return DefaultPlanCatalog(
		PaddlePriceIDs{Monthly: "pri_starter_month", Annual: "pri_starter_year"},
		PaddlePriceIDs{Monthly: "pri_founder_month", Annual: "pri_founder_year"},
		PaddlePriceIDs{Monthly: "pri_pro_month", Annual: "pri_pro_year"},
		PaddlePriceIDs{Monthly: "pri_team_month", Annual: "pri_team_year"},
		PaddlePriceIDs{Monthly: "pri_agency_month", Annual: "pri_agency_year"},
	)
}

func TestDefaultPlanCatalogUsesUSDPricesAndMonotonicSeatLimits(t *testing.T) {
	t.Parallel()
	catalog := testCatalog()
	require.Equal(t, 15, catalog["starter"].MonthlyPriceUSD)
	require.Equal(t, 250, catalog["founder"].AnnualPriceUSD)
	require.Equal(t, 199, catalog["agency"].MonthlyPriceUSD)
	require.Equal(t, int64(1), catalog["pro"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(3), catalog["team"].Limits[entitlements.LimitTeamMembers])
	require.Equal(t, int64(5), catalog["agency"].Limits[entitlements.LimitTeamMembers])
}

func TestCreateCheckoutRecordsOpaquePaddleAttempt(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	service := NewService(db, "", PaddleConfig{
		Environment: "sandbox",
		ClientToken: "test_client_token",
		AppURL:      "https://app.openpost.test",
		Plans:       testCatalog(),
	})
	service.SetNowForTest(func() time.Time { return now })

	result, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{
		OrganizationID: "org-1",
		WorkspaceID:    "ws-1",
		UserID:         "user-1",
		CustomerEmail:  "user@example.com",
		PlanID:         "founder",
		BillingPeriod:  "annual",
	})

	require.NoError(t, err)
	require.Regexp(t, `^chkat_[a-f0-9]{32}$`, result.ID)
	require.Equal(t, "https://app.openpost.test/checkout?billing_period=annual&plan=founder", result.URL)
	require.Equal(t, "pri_founder_year", result.ProviderPriceID)
	require.Equal(t, "pri_agency_year", result.PriceIDs["agency"])
	require.Equal(t, "sandbox", result.Environment)
	require.Equal(t, "test_client_token", result.ClientToken)
	require.Equal(t, now.AddDate(0, 0, TrialDays), result.TrialEndsAt)
	require.Equal(t, "https://app.openpost.test/checkout?status=success", result.ReturnURL)

	var attempt models.BillingCheckoutAttempt
	require.NoError(t, db.NewSelect().Model(&attempt).Where("checkout_attempt_id = ?", result.ID).Scan(context.Background()))
	require.Equal(t, ProviderPaddle, attempt.Provider)
	require.Equal(t, "org-1", attempt.OrganizationID)
	require.Equal(t, "founder", attempt.PlanID)
	require.Equal(t, "annual", attempt.BillingPeriod)
}

func TestCreateCheckoutRejectsImplicitEnvironmentAndMissingPrice(t *testing.T) {
	t.Parallel()
	service := NewService(nil, "", PaddleConfig{ClientToken: "test_token", Plans: testCatalog()})
	_, err := service.CreateCheckout(context.Background(), CreateCheckoutInput{OrganizationID: "org", CustomerEmail: "a@b.com", PlanID: "founder"})
	require.True(t, IsConfigurationError(err))
	require.ErrorContains(t, err, "OPENPOST_PADDLE_ENVIRONMENT")

	catalog := testCatalog()
	catalog["founder"] = PlanConfig{MonthlyPriceUSD: 25, AnnualPriceUSD: 250}
	service = NewService(nil, "", PaddleConfig{Environment: "sandbox", ClientToken: "test_token", Plans: catalog})
	_, err = service.CreateCheckout(context.Background(), CreateCheckoutInput{OrganizationID: "org", CustomerEmail: "a@b.com", PlanID: "founder"})
	require.True(t, IsConfigurationError(err))
	require.ErrorContains(t, err, "OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID")
}

func TestAcceptPaddleWebhookQueuesSupportedEventOnce(t *testing.T) {
	db := newBillingTestDB(t)
	secret := "pdl_webhook_secret"
	service := NewService(db, secret)
	body := []byte(`{"event_id":"evt_1","event_type":"subscription.updated","occurred_at":"2026-08-05T12:00:00Z","data":{"id":"sub_1"}}`)
	signature := paddleSignature(secret, time.Now(), body)

	first, err := service.AcceptPaddleWebhook(context.Background(), body, signature)
	require.NoError(t, err)
	require.False(t, first.Duplicate)
	second, err := service.AcceptPaddleWebhook(context.Background(), body, signature)
	require.NoError(t, err)
	require.True(t, second.Duplicate)

	var count int
	require.NoError(t, db.NewSelect().ColumnExpr("COUNT(*)").TableExpr("jobs").Where("type = ?", JobTypeWebhook).Scan(context.Background(), &count))
	require.Equal(t, 1, count)
}

func TestAcceptPaddleWebhookRejectsInvalidSignature(t *testing.T) {
	t.Parallel()
	service := NewService(newBillingTestDB(t), "pdl_webhook_secret")
	body := []byte(`{"event_id":"evt_1","event_type":"subscription.updated","data":{"id":"sub_1"}}`)
	_, err := service.AcceptPaddleWebhook(context.Background(), body, "ts=1;h1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
	require.ErrorContains(t, err, "invalid Paddle webhook signature")
}

func TestHandleJobFetchesCanonicalPaddleStateAndKeepsScheduledCancelActive(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	_, err := db.NewInsert().Model(&models.BillingCheckoutAttempt{
		CheckoutAttemptID: "chkat_1",
		OrganizationID:    "org-1",
		WorkspaceID:       "ws-1",
		Provider:          ProviderPaddle,
		ProviderPriceID:   "pri_founder_month",
		PlanID:            "founder",
		BillingPeriod:     "monthly",
		Status:            "created",
		CreatedAt:         now,
		UpdatedAt:         now,
	}).Exec(context.Background())
	require.NoError(t, err)
	name := "OpenPost Customer"
	api := &fakePaddleAPI{
		subscription: &paddle.Subscription{
			ID:                   "sub_1",
			Status:               paddle.SubscriptionStatusTrialing,
			CustomerID:           "ctm_1",
			CustomData:           paddle.CustomData{"checkout_id": "chkat_1"},
			Items:                []paddle.SubscriptionItem{{Recurring: true, Price: paddle.Price{ID: "pri_founder_month", ProductID: "pro_founder"}}},
			CurrentBillingPeriod: &paddle.TimePeriod{EndsAt: "2026-08-19T12:00:00Z"},
			ScheduledChange:      &paddle.SubscriptionScheduledChange{Action: paddle.ScheduledChangeActionCancel, EffectiveAt: "2026-08-19T12:00:00Z"},
		},
		customer: &paddle.Customer{ID: "ctm_1", Email: "customer@example.com", Name: &name},
	}
	service := NewService(db, "", PaddleConfig{Plans: testCatalog()})
	service.SetPaddleClientForTest(api)
	service.SetNowForTest(func() time.Time { return now })
	payload := `{"event_id":"evt_old","event_type":"subscription.updated","data":{"id":"sub_1","status":"active"}}`

	require.NoError(t, service.HandleJob(context.Background(), JobTypeWebhook, payload))
	require.Equal(t, 1, api.subGets)
	var sub models.BillingSubscription
	require.NoError(t, db.NewSelect().Model(&sub).Where("organization_id = ?", "org-1").Scan(context.Background()))
	require.Equal(t, ProviderPaddle, sub.Provider)
	require.Equal(t, "trialing", sub.Status)
	require.True(t, sub.CancelAtPeriodEnd)
	require.Equal(t, time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC), sub.CurrentPeriodEnd)
	require.Contains(t, sub.EntitlementSnapshot, "scheduled_posts_monthly")

	var customer models.BillingCustomer
	require.NoError(t, db.NewSelect().Model(&customer).Where("provider = ? AND provider_customer_id = ?", ProviderPaddle, "ctm_1").Scan(context.Background()))
	require.Equal(t, "customer@example.com", customer.Email)
}

func TestCreateCustomerPortalSessionReturnsFreshPaddleURL(t *testing.T) {
	t.Parallel()
	db := newBillingTestDB(t)
	_, err := db.NewInsert().Model(&models.BillingSubscription{
		OrganizationID:         "org-1",
		WorkspaceID:            "ws-1",
		Provider:               ProviderPaddle,
		ProviderCustomerID:     "ctm_1",
		ProviderSubscriptionID: "sub_1",
		Status:                 "active",
		PlanID:                 "founder",
	}).Exec(context.Background())
	require.NoError(t, err)
	api := &fakePaddleAPI{portal: &paddle.CustomerPortalSession{
		ID:   "cpls_1",
		URLs: paddle.CustomerPortalSessionURLs{General: paddle.CustomerPortalSessionGeneralURLs{Overview: "https://customer-portal.paddle.com/overview?token=fresh"}},
	}}
	service := NewService(db, "")
	service.SetPaddleClientForTest(api)

	result, err := service.CreateCustomerPortalSession(context.Background(), "org-1")
	require.NoError(t, err)
	require.Equal(t, "cpls_1", result.ID)
	require.Equal(t, "https://customer-portal.paddle.com/overview?token=fresh", result.URL)
}
