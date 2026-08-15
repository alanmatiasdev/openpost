package notifications

import (
	"context"
	"testing"

	"github.com/openpost/backend/internal/services/transactionalmail"
	"github.com/stretchr/testify/require"
)

type notificationOnlyEmailDelivery struct {
	notifications []EmailMessage
	invitations   []transactionalmail.WorkspaceInvitationMessage
}

func (delivery *notificationOnlyEmailDelivery) DeliverNotificationEmail(_ context.Context, message EmailMessage) error {
	delivery.notifications = append(delivery.notifications, message)
	return nil
}

func (delivery *notificationOnlyEmailDelivery) DeliverWorkspaceInvitationEmail(
	_ context.Context,
	message transactionalmail.WorkspaceInvitationMessage,
) error {
	delivery.invitations = append(delivery.invitations, message)
	return nil
}

func TestNotificationServiceAcceptsItsNarrowEmailDeliveryPort(t *testing.T) {
	delivery := &notificationOnlyEmailDelivery{}
	service := NewService(notificationsTestDB(t), Options{EmailDelivery: delivery})
	require.NotNil(t, service)
}
