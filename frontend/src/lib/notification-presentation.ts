import type { components } from '$lib/api/types';
import { m } from '$lib/paraglide/messages';

type Notification = components['schemas']['UserNotification'];
type NotificationAction = components['schemas']['NotificationAction'];

const ownershipKind = 'organization_ownership_nomination';
const ownershipReviewAction = 'ownership_transfer.review';

interface NotificationPresentation {
	title: string;
	body: string;
	actions: NotificationAction[];
}

export function presentNotification(notification: Notification): NotificationPresentation {
	const actions = notification.actions ?? [];
	if (notification.type !== 'ownership_transfer') {
		return { title: notification.title, body: notification.body, actions };
	}
	const payload = semanticPayload(notification.payload_json);
	if (payload.kind !== ownershipKind || !payload.organization_name) {
		return { title: notification.title, body: notification.body, actions };
	}
	return {
		title: m.notifications_ownership_transfer_title(),
		body: m.notifications_ownership_transfer_body({ organization: payload.organization_name }),
		actions: actions.map((action) =>
			action.label === ownershipReviewAction
				? { ...action, label: m.notifications_ownership_transfer_review() }
				: action
		)
	};
}

function semanticPayload(raw: string): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string'
			)
		);
	} catch {
		return {};
	}
}
