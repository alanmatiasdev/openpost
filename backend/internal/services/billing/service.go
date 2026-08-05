package billing

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/PaddleHQ/paddle-go-sdk/v5"
	"github.com/google/uuid"
	"github.com/openpost/backend/internal/models"
	"github.com/openpost/backend/internal/services/entitlements"
	"github.com/uptrace/bun"
)

const (
	ProviderPaddle = models.BillingProviderPaddle
	JobTypeWebhook = "billing_paddle_webhook"
	TrialDays      = 14
)

var errConfiguration = errors.New("billing provider is not configured")

func IsConfigurationError(err error) bool {
	return errors.Is(err, errConfiguration)
}

func configurationError(format string, args ...any) error {
	return fmt.Errorf("%w: %s", errConfiguration, fmt.Sprintf(format, args...))
}

type PaddleAPI interface {
	GetSubscription(context.Context, *paddle.GetSubscriptionRequest) (*paddle.Subscription, error)
	GetTransaction(context.Context, *paddle.GetTransactionRequest) (*paddle.Transaction, error)
	GetCustomer(context.Context, *paddle.GetCustomerRequest) (*paddle.Customer, error)
	CreateCustomerPortalSession(context.Context, *paddle.CreateCustomerPortalSessionRequest) (*paddle.CustomerPortalSession, error)
}

type Service struct {
	db            *bun.DB
	webhookSecret string
	verifier      *paddle.WebhookVerifier
	now           func() time.Time
	paddle        PaddleConfig
	api           PaddleAPI
	apiInitErr    error
}

type PaddleConfig struct {
	APIKey      string
	APIBaseURL  string
	Environment string
	ClientToken string
	AppURL      string
	ReturnURL   string
	Plans       map[string]PlanConfig
}

type PaddlePriceIDs struct {
	Monthly string
	Annual  string
}

type PlanConfig struct {
	PaddlePriceIDs  PaddlePriceIDs
	MonthlyPriceUSD int
	AnnualPriceUSD  int
	Limits          map[entitlements.LimitKey]int64
}

func DefaultPlanCatalog(starter, founder, pro, team, agency PaddlePriceIDs) map[string]PlanConfig {
	return map[string]PlanConfig{
		"starter": {
			PaddlePriceIDs:  starter,
			MonthlyPriceUSD: 15,
			AnnualPriceUSD:  150,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                1,
				entitlements.LimitSocialAccounts:            3,
				entitlements.LimitScheduledPostsMonthly:     100,
				entitlements.LimitMediaBytesStored:          1_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 1_000_000_000,
				entitlements.LimitTeamMembers:               1,
			},
		},
		"founder": {
			PaddlePriceIDs:  founder,
			MonthlyPriceUSD: 25,
			AnnualPriceUSD:  250,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                3,
				entitlements.LimitSocialAccounts:            6,
				entitlements.LimitScheduledPostsMonthly:     500,
				entitlements.LimitMediaBytesStored:          5_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 5_000_000_000,
				entitlements.LimitTeamMembers:               1,
			},
		},
		"pro": {
			PaddlePriceIDs:  pro,
			MonthlyPriceUSD: 49,
			AnnualPriceUSD:  490,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                10,
				entitlements.LimitSocialAccounts:            15,
				entitlements.LimitScheduledPostsMonthly:     2_500,
				entitlements.LimitMediaBytesStored:          25_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 25_000_000_000,
				entitlements.LimitTeamMembers:               1,
			},
		},
		"team": {
			PaddlePriceIDs:  team,
			MonthlyPriceUSD: 99,
			AnnualPriceUSD:  990,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                10,
				entitlements.LimitSocialAccounts:            25,
				entitlements.LimitScheduledPostsMonthly:     5_000,
				entitlements.LimitMediaBytesStored:          50_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 50_000_000_000,
				entitlements.LimitTeamMembers:               3,
			},
		},
		"agency": {
			PaddlePriceIDs:  agency,
			MonthlyPriceUSD: 199,
			AnnualPriceUSD:  1_990,
			Limits: map[entitlements.LimitKey]int64{
				entitlements.LimitWorkspaces:                50,
				entitlements.LimitSocialAccounts:            150,
				entitlements.LimitScheduledPostsMonthly:     25_000,
				entitlements.LimitMediaBytesStored:          250_000_000_000,
				entitlements.LimitMediaBytesUploadedMonthly: 250_000_000_000,
				entitlements.LimitTeamMembers:               5,
			},
		},
	}
}

func NewService(db *bun.DB, webhookSecret string, paddleConfig ...PaddleConfig) *Service {
	cfg := PaddleConfig{}
	if len(paddleConfig) > 0 {
		cfg = paddleConfig[0]
	}
	service := &Service{
		db:            db,
		webhookSecret: strings.TrimSpace(webhookSecret),
		now:           func() time.Time { return time.Now().UTC() },
		paddle:        cfg,
	}
	if service.webhookSecret != "" {
		service.verifier = paddle.NewWebhookVerifier(service.webhookSecret, paddle.VerifierWithTimestampTolerance(5*time.Minute))
	}
	if strings.TrimSpace(cfg.APIKey) != "" {
		service.api, service.apiInitErr = newPaddleAPI(cfg)
	}
	return service
}

func newPaddleAPI(cfg PaddleConfig) (*paddle.SDK, error) {
	environment := strings.ToLower(strings.TrimSpace(cfg.Environment))
	opts := []paddle.Option{}
	if baseURL := strings.TrimRight(strings.TrimSpace(cfg.APIBaseURL), "/"); baseURL != "" {
		opts = append(opts, paddle.WithBaseURL(baseURL))
	}
	switch environment {
	case "production":
		return paddle.New(strings.TrimSpace(cfg.APIKey), opts...)
	case "sandbox":
		return paddle.NewSandbox(strings.TrimSpace(cfg.APIKey), opts...)
	default:
		return nil, configurationError("OPENPOST_PADDLE_ENVIRONMENT must be explicitly set to sandbox or production")
	}
}

func (s *Service) SetNowForTest(now func() time.Time) {
	if now != nil {
		s.now = now
	}
}

func (s *Service) SetPaddleClientForTest(client PaddleAPI) {
	s.api = client
	s.apiInitErr = nil
}

type CreateCheckoutInput struct {
	OrganizationID string
	WorkspaceID    string
	UserID         string
	CustomerEmail  string
	PlanID         string
	BillingPeriod  string
}

type CheckoutResult struct {
	URL             string
	ID              string
	ProviderPriceID string
	PriceIDs        map[string]string
	PlanID          string
	BillingPeriod   string
	TrialEndsAt     time.Time
	ReturnURL       string
	ClientToken     string
	Environment     string
	CustomerEmail   string
}

func (s *Service) CreateCheckout(ctx context.Context, input CreateCheckoutInput) (CheckoutResult, error) {
	period := normalizeBillingPeriod(input.BillingPeriod)
	_, providerPriceID, _, err := s.planFor(input.PlanID, period)
	if err != nil {
		return CheckoutResult{}, err
	}
	environment := strings.ToLower(strings.TrimSpace(s.paddle.Environment))
	if environment != "sandbox" && environment != "production" {
		return CheckoutResult{}, configurationError("OPENPOST_PADDLE_ENVIRONMENT must be explicitly set to sandbox or production")
	}
	clientToken := strings.TrimSpace(s.paddle.ClientToken)
	if clientToken == "" {
		return CheckoutResult{}, configurationError("OPENPOST_PADDLE_CLIENT_TOKEN is required")
	}
	organizationID := strings.TrimSpace(input.OrganizationID)
	if organizationID == "" {
		organizationID = strings.TrimSpace(input.WorkspaceID)
	}
	if organizationID == "" {
		return CheckoutResult{}, fmt.Errorf("organization id is required")
	}
	email := strings.TrimSpace(input.CustomerEmail)
	if email == "" {
		return CheckoutResult{}, fmt.Errorf("customer email is required")
	}

	now := s.now().UTC()
	attemptID := "chkat_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if s.db != nil {
		attempt := &models.BillingCheckoutAttempt{
			CheckoutAttemptID: attemptID,
			OrganizationID:    organizationID,
			WorkspaceID:       strings.TrimSpace(input.WorkspaceID),
			UserID:            strings.TrimSpace(input.UserID),
			Provider:          ProviderPaddle,
			ProviderPriceID:   providerPriceID,
			PlanID:            strings.ToLower(strings.TrimSpace(input.PlanID)),
			BillingPeriod:     period,
			Status:            "created",
			CreatedAt:         now,
			UpdatedAt:         now,
		}
		if _, err := s.db.NewInsert().Model(attempt).Exec(ctx); err != nil {
			return CheckoutResult{}, fmt.Errorf("recording checkout attempt: %w", err)
		}
	}

	return CheckoutResult{
		URL:             s.checkoutURL(input.PlanID, period),
		ID:              attemptID,
		ProviderPriceID: providerPriceID,
		PriceIDs:        s.priceIDsForPeriod(period),
		PlanID:          strings.ToLower(strings.TrimSpace(input.PlanID)),
		BillingPeriod:   period,
		TrialEndsAt:     now.AddDate(0, 0, TrialDays),
		ReturnURL:       s.returnURL(),
		ClientToken:     clientToken,
		Environment:     environment,
		CustomerEmail:   email,
	}, nil
}

func (s *Service) checkoutURL(planID, period string) string {
	base := strings.TrimRight(strings.TrimSpace(s.paddle.AppURL), "/")
	if base == "" {
		return ""
	}
	values := url.Values{}
	values.Set("plan", strings.ToLower(strings.TrimSpace(planID)))
	values.Set("billing_period", normalizeBillingPeriod(period))
	return base + "/checkout?" + values.Encode()
}

func (s *Service) priceIDsForPeriod(period string) map[string]string {
	prices := make(map[string]string, len(s.paddle.Plans))
	for planID, plan := range s.paddle.Plans {
		priceID := plan.PaddlePriceIDs.Monthly
		if normalizeBillingPeriod(period) == "annual" {
			priceID = plan.PaddlePriceIDs.Annual
		}
		if strings.TrimSpace(priceID) != "" {
			prices[planID] = priceID
		}
	}
	return prices
}

type CustomerPortalResult struct {
	ID  string
	URL string
}

func (s *Service) CreateCustomerPortalSession(ctx context.Context, organizationID string) (CustomerPortalResult, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return CustomerPortalResult{}, fmt.Errorf("organization id is required")
	}
	if s.db == nil {
		return CustomerPortalResult{}, fmt.Errorf("billing database is not configured")
	}
	if err := s.ensureAPI(); err != nil {
		return CustomerPortalResult{}, err
	}
	var subscription models.BillingSubscription
	if err := s.db.NewSelect().Model(&subscription).Where("organization_id = ?", organizationID).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return CustomerPortalResult{}, fmt.Errorf("no subscription found for this organization")
		}
		return CustomerPortalResult{}, fmt.Errorf("loading billing subscription: %w", err)
	}
	if subscription.Provider != ProviderPaddle || strings.TrimSpace(subscription.ProviderCustomerID) == "" {
		return CustomerPortalResult{}, fmt.Errorf("paddle customer portal is not ready for this subscription")
	}
	session, err := s.api.CreateCustomerPortalSession(ctx, &paddle.CreateCustomerPortalSessionRequest{
		CustomerID:      subscription.ProviderCustomerID,
		SubscriptionIDs: []string{subscription.ProviderSubscriptionID},
	})
	if err != nil {
		return CustomerPortalResult{}, fmt.Errorf("creating Paddle customer portal session: %w", err)
	}
	if session == nil || strings.TrimSpace(session.URLs.General.Overview) == "" {
		return CustomerPortalResult{}, fmt.Errorf("paddle customer portal response missing overview URL")
	}
	return CustomerPortalResult{ID: session.ID, URL: session.URLs.General.Overview}, nil
}

func (s *Service) ensureAPI() error {
	if s.apiInitErr != nil {
		return configurationError("initializing Paddle API client: %v", s.apiInitErr)
	}
	if s.api == nil {
		return configurationError("OPENPOST_PADDLE_API_KEY is required")
	}
	return nil
}

func (s *Service) planFor(planID, billingPeriod string) (PlanConfig, string, int, error) {
	planID = strings.ToLower(strings.TrimSpace(planID))
	if planID == "" {
		return PlanConfig{}, "", 0, fmt.Errorf("plan id is required")
	}
	plan, ok := s.paddle.Plans[planID]
	if !ok {
		return PlanConfig{}, "", 0, fmt.Errorf("unknown billing plan %q", planID)
	}
	period := normalizeBillingPeriod(billingPeriod)
	providerPriceID := plan.PaddlePriceIDs.Monthly
	priceUSD := plan.MonthlyPriceUSD
	if period == "annual" {
		providerPriceID = plan.PaddlePriceIDs.Annual
		priceUSD = plan.AnnualPriceUSD
	}
	if strings.TrimSpace(providerPriceID) == "" {
		return PlanConfig{}, "", 0, configurationError("%s is required for billing plan %q", paddlePriceEnvVar(planID, period), planID)
	}
	return plan, providerPriceID, priceUSD, nil
}

func normalizeBillingPeriod(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), "annual") || strings.EqualFold(strings.TrimSpace(value), "yearly") {
		return "annual"
	}
	return "monthly"
}

func paddlePriceEnvVar(planID, period string) string {
	return "OPENPOST_PADDLE_" + strings.ToUpper(strings.ReplaceAll(planID, "-", "_")) + "_" + strings.ToUpper(normalizeBillingPeriod(period)) + "_PRICE_ID"
}

func (s *Service) returnURL() string {
	if value := strings.TrimSpace(s.paddle.ReturnURL); value != "" {
		return value
	}
	base := strings.TrimRight(strings.TrimSpace(s.paddle.AppURL), "/")
	if base == "" {
		return ""
	}
	return base + "/checkout?status=success"
}

type WebhookResult struct {
	EventID   string
	EventType string
	Duplicate bool
}

type paddleEvent struct {
	EventID    string          `json:"event_id"`
	EventType  string          `json:"event_type"`
	OccurredAt string          `json:"occurred_at"`
	Data       json.RawMessage `json:"data"`
}

func (s *Service) AcceptPaddleWebhook(ctx context.Context, body []byte, signature string) (WebhookResult, error) {
	if s.verifier == nil {
		return WebhookResult{}, configurationError("OPENPOST_PADDLE_WEBHOOK_SECRET is required")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/billing/paddle/webhook", bytes.NewReader(body))
	if err != nil {
		return WebhookResult{}, err
	}
	req.Header.Set("Paddle-Signature", strings.TrimSpace(signature))
	verified, err := s.verifier.Verify(req)
	if err != nil || !verified {
		if err == nil {
			err = errors.New("signature mismatch")
		}
		return WebhookResult{}, fmt.Errorf("invalid Paddle webhook signature: %w", err)
	}
	if s.db == nil {
		return WebhookResult{}, fmt.Errorf("billing database is not configured")
	}
	var event paddleEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return WebhookResult{}, fmt.Errorf("invalid webhook payload: %w", err)
	}
	if strings.TrimSpace(event.EventID) == "" || strings.TrimSpace(event.EventType) == "" {
		return WebhookResult{}, fmt.Errorf("webhook event_id and event_type are required")
	}

	result := WebhookResult{EventID: event.EventID, EventType: event.EventType}
	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		inserted, err := insertWebhookEvent(txCtx, tx, event.EventID, event.EventType, s.now())
		if err != nil {
			return err
		}
		if !inserted {
			result.Duplicate = true
			return nil
		}
		if !eventNeedsReconciliation(event.EventType) {
			return nil
		}
		job := &models.Job{
			ID:          uuid.NewString(),
			Type:        JobTypeWebhook,
			Payload:     string(body),
			Status:      "pending",
			RunAt:       s.now().UTC(),
			MaxAttempts: 8,
		}
		if _, err := tx.NewInsert().Model(job).Exec(txCtx); err != nil {
			return fmt.Errorf("queueing Paddle webhook: %w", err)
		}
		return nil
	})
	return result, err
}

func eventNeedsReconciliation(eventType string) bool {
	switch eventType {
	case "customer.created", "customer.updated",
		"subscription.created", "subscription.updated", "subscription.activated", "subscription.trialing",
		"subscription.past_due", "subscription.paused", "subscription.resumed", "subscription.canceled",
		"transaction.completed":
		return true
	default:
		return false
	}
}

func insertWebhookEvent(ctx context.Context, tx bun.Tx, eventID, eventType string, now time.Time) (bool, error) {
	event := &models.BillingWebhookEvent{
		EventID:     eventID,
		Provider:    ProviderPaddle,
		EventType:   eventType,
		ProcessedAt: now.UTC(),
	}
	res, err := tx.NewInsert().Model(event).On("CONFLICT (event_id) DO NOTHING").Exec(ctx)
	if err != nil {
		return false, fmt.Errorf("recording webhook event: %w", err)
	}
	rows, _ := res.RowsAffected()
	return rows > 0, nil
}

func (s *Service) HandleJob(ctx context.Context, jobType, payload string) error {
	if jobType != JobTypeWebhook {
		return fmt.Errorf("unsupported billing job type %q", jobType)
	}
	if err := s.ensureAPI(); err != nil {
		return err
	}
	var event paddleEvent
	if err := json.Unmarshal([]byte(payload), &event); err != nil {
		return fmt.Errorf("invalid queued Paddle webhook: %w", err)
	}
	entityID := eventEntityID(event.Data)
	switch {
	case strings.HasPrefix(event.EventType, "subscription."):
		return s.handleSubscriptionEvent(ctx, entityID)
	case event.EventType == "transaction.completed":
		return s.handleCompletedTransaction(ctx, entityID)
	case strings.HasPrefix(event.EventType, "customer."):
		if entityID == "" {
			return fmt.Errorf("paddle customer event missing entity id")
		}
		return s.reconcileCustomerByID(ctx, entityID)
	default:
		return nil
	}
}

func (s *Service) handleSubscriptionEvent(ctx context.Context, entityID string) error {
	if entityID == "" {
		return fmt.Errorf("paddle subscription event missing entity id")
	}
	subscription, err := s.api.GetSubscription(ctx, &paddle.GetSubscriptionRequest{SubscriptionID: entityID})
	if err != nil {
		return fmt.Errorf("fetching current Paddle subscription: %w", err)
	}
	return s.reconcileSubscription(ctx, subscription, nil)
}

func (s *Service) handleCompletedTransaction(ctx context.Context, entityID string) error {
	if entityID == "" {
		return fmt.Errorf("paddle transaction event missing entity id")
	}
	transaction, err := s.api.GetTransaction(ctx, &paddle.GetTransactionRequest{TransactionID: entityID})
	if err != nil {
		return fmt.Errorf("fetching current Paddle transaction: %w", err)
	}
	if transaction.SubscriptionID != nil && strings.TrimSpace(*transaction.SubscriptionID) != "" {
		subscription, err := s.api.GetSubscription(ctx, &paddle.GetSubscriptionRequest{SubscriptionID: *transaction.SubscriptionID})
		if err != nil {
			return fmt.Errorf("fetching Paddle subscription for transaction: %w", err)
		}
		return s.reconcileSubscription(ctx, subscription, transaction.CustomData)
	}
	if transaction.CustomerID != nil {
		return s.reconcileCustomerByID(ctx, *transaction.CustomerID)
	}
	return nil
}

func eventEntityID(data json.RawMessage) string {
	var entity struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(data, &entity) != nil {
		return ""
	}
	return strings.TrimSpace(entity.ID)
}

func (s *Service) reconcileCustomerByID(ctx context.Context, customerID string) error {
	customer, err := s.api.GetCustomer(ctx, &paddle.GetCustomerRequest{CustomerID: customerID})
	if err != nil {
		return fmt.Errorf("fetching current Paddle customer: %w", err)
	}
	return s.upsertCustomer(ctx, customer)
}

func (s *Service) upsertCustomer(ctx context.Context, customer *paddle.Customer) error {
	if customer == nil || strings.TrimSpace(customer.ID) == "" {
		return fmt.Errorf("paddle customer payload missing id")
	}
	name := ""
	if customer.Name != nil {
		name = strings.TrimSpace(*customer.Name)
	}
	raw, _ := json.Marshal(customer)
	now := s.now().UTC()
	model := &models.BillingCustomer{
		Provider:           ProviderPaddle,
		ProviderCustomerID: customer.ID,
		Email:              strings.TrimSpace(customer.Email),
		Name:               name,
		RawPayload:         string(raw),
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	_, err := s.db.NewInsert().Model(model).
		On("CONFLICT (provider, provider_customer_id) DO UPDATE").
		Set("email = EXCLUDED.email").
		Set("name = EXCLUDED.name").
		Set("raw_payload = EXCLUDED.raw_payload").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("upserting Paddle customer: %w", err)
	}
	return nil
}

type resolvedPaddleSubscription struct {
	Attempt   models.BillingCheckoutAttempt
	Plan      PlanConfig
	PlanID    string
	PriceID   string
	ProductID string
}

func (s *Service) resolvePaddleSubscription(ctx context.Context, subscription *paddle.Subscription, fallbackCustom paddle.CustomData) (resolvedPaddleSubscription, error) {
	customData := subscription.CustomData
	if len(customData) == 0 {
		customData = fallbackCustom
	}
	attempt, err := s.checkoutAttempt(ctx, customDataString(customData, "checkout_id"))
	if err != nil {
		return resolvedPaddleSubscription{}, err
	}
	if attempt.OrganizationID == "" {
		attempt, err = s.checkoutAttemptForSubscription(ctx, subscription.ID)
		if err != nil {
			return resolvedPaddleSubscription{}, err
		}
	}
	priceID, productID := subscriptionCatalogIDs(subscription)
	planID := attempt.PlanID
	if planID == "" {
		planID = s.planIDForProviderPrice(priceID)
	}
	if attempt.OrganizationID == "" {
		return resolvedPaddleSubscription{}, fmt.Errorf("paddle subscription missing a valid OpenPost checkout_id")
	}
	plan, ok := s.paddle.Plans[planID]
	if !ok {
		return resolvedPaddleSubscription{}, fmt.Errorf("paddle subscription references unknown OpenPost plan %q", planID)
	}
	return resolvedPaddleSubscription{
		Attempt:   attempt,
		Plan:      plan,
		PlanID:    planID,
		PriceID:   priceID,
		ProductID: productID,
	}, nil
}

func (s *Service) reconcileSubscription(ctx context.Context, subscription *paddle.Subscription, fallbackCustom paddle.CustomData) error {
	if subscription == nil || strings.TrimSpace(subscription.ID) == "" {
		return fmt.Errorf("paddle subscription payload missing id")
	}
	resolved, err := s.resolvePaddleSubscription(ctx, subscription, fallbackCustom)
	if err != nil {
		return err
	}

	if strings.TrimSpace(subscription.CustomerID) != "" {
		if err := s.reconcileCustomerByID(ctx, subscription.CustomerID); err != nil {
			return err
		}
	}
	status := strings.ToLower(string(subscription.Status))
	periodEnd := time.Time{}
	if subscription.CurrentBillingPeriod != nil {
		periodEnd = parsePaddleTime(subscription.CurrentBillingPeriod.EndsAt)
	}
	cancelAtPeriodEnd := status != string(paddle.SubscriptionStatusCanceled) &&
		subscription.ScheduledChange != nil && subscription.ScheduledChange.Action == paddle.ScheduledChangeActionCancel
	now := s.now().UTC()
	raw, _ := json.Marshal(subscription)
	snapshot, _ := json.Marshal(map[string]any{
		"provider":   ProviderPaddle,
		"plan_id":    resolved.PlanID,
		"status":     status,
		"product_id": resolved.ProductID,
		"price_id":   resolved.PriceID,
		"limits":     resolved.Plan.Limits,
	})
	model := &models.BillingSubscription{
		OrganizationID:         resolved.Attempt.OrganizationID,
		WorkspaceID:            resolved.Attempt.WorkspaceID,
		Provider:               ProviderPaddle,
		ProviderCustomerID:     subscription.CustomerID,
		ProviderSubscriptionID: subscription.ID,
		ProviderProductID:      resolved.ProductID,
		ProviderPriceID:        resolved.PriceID,
		Status:                 status,
		PlanID:                 resolved.PlanID,
		EntitlementSnapshot:    string(snapshot),
		CurrentPeriodEnd:       periodEnd,
		CancelAtPeriodEnd:      cancelAtPeriodEnd,
		RawPayload:             string(raw),
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(txCtx context.Context, tx bun.Tx) error {
		if err := upsertSubscription(txCtx, tx, model); err != nil {
			return err
		}
		if resolved.Attempt.CheckoutAttemptID != "" {
			if _, err := tx.NewUpdate().Model((*models.BillingCheckoutAttempt)(nil)).
				Set("status = ?", status).
				Set("provider_subscription_id = ?", subscription.ID).
				Set("updated_at = ?", now).
				Where("checkout_attempt_id = ?", resolved.Attempt.CheckoutAttemptID).
				Exec(txCtx); err != nil {
				return fmt.Errorf("updating Paddle checkout attempt: %w", err)
			}
		}
		return nil
	})
}

func subscriptionCatalogIDs(subscription *paddle.Subscription) (string, string) {
	for _, item := range subscription.Items {
		if item.Recurring {
			return item.Price.ID, item.Price.ProductID
		}
	}
	if len(subscription.Items) > 0 {
		return subscription.Items[0].Price.ID, subscription.Items[0].Price.ProductID
	}
	return "", ""
}

func customDataString(data paddle.CustomData, key string) string {
	value, ok := data[key]
	if !ok {
		return ""
	}
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func (s *Service) checkoutAttempt(ctx context.Context, attemptID string) (models.BillingCheckoutAttempt, error) {
	var attempt models.BillingCheckoutAttempt
	if strings.TrimSpace(attemptID) == "" {
		return attempt, nil
	}
	err := s.db.NewSelect().Model(&attempt).
		Where("checkout_attempt_id = ?", attemptID).
		Where("provider = ?", ProviderPaddle).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.BillingCheckoutAttempt{}, nil
	}
	if err != nil {
		return models.BillingCheckoutAttempt{}, fmt.Errorf("loading Paddle checkout attempt: %w", err)
	}
	return attempt, nil
}

func (s *Service) checkoutAttemptForSubscription(ctx context.Context, subscriptionID string) (models.BillingCheckoutAttempt, error) {
	var attempt models.BillingCheckoutAttempt
	err := s.db.NewSelect().Model(&attempt).
		Where("provider = ?", ProviderPaddle).
		Where("provider_subscription_id = ?", subscriptionID).
		Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return models.BillingCheckoutAttempt{}, nil
	}
	if err != nil {
		return models.BillingCheckoutAttempt{}, fmt.Errorf("loading Paddle checkout attempt by subscription: %w", err)
	}
	return attempt, nil
}

func (s *Service) planIDForProviderPrice(providerPriceID string) string {
	for planID, plan := range s.paddle.Plans {
		if providerPriceID == plan.PaddlePriceIDs.Monthly || providerPriceID == plan.PaddlePriceIDs.Annual {
			return planID
		}
	}
	return ""
}

func upsertSubscription(ctx context.Context, tx bun.Tx, subscription *models.BillingSubscription) error {
	_, err := tx.NewInsert().Model(subscription).
		On("CONFLICT (organization_id) DO UPDATE").
		Set("workspace_id = EXCLUDED.workspace_id").
		Set("provider = EXCLUDED.provider").
		Set("provider_customer_id = EXCLUDED.provider_customer_id").
		Set("provider_subscription_id = EXCLUDED.provider_subscription_id").
		Set("provider_product_id = EXCLUDED.provider_product_id").
		Set("provider_price_id = EXCLUDED.provider_price_id").
		Set("status = EXCLUDED.status").
		Set("plan_id = EXCLUDED.plan_id").
		Set("entitlement_snapshot = EXCLUDED.entitlement_snapshot").
		Set("current_period_end = EXCLUDED.current_period_end").
		Set("cancel_at_period_end = EXCLUDED.cancel_at_period_end").
		Set("raw_payload = EXCLUDED.raw_payload").
		Set("updated_at = EXCLUDED.updated_at").
		Exec(ctx)
	if err != nil {
		return fmt.Errorf("upserting billing subscription: %w", err)
	}
	return nil
}

func parsePaddleTime(value string) time.Time {
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}
