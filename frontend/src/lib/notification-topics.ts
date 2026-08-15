import { m } from '$lib/paraglide/messages';
import type { components } from '$lib/api/types';
import BellIcon from '@lucide/svelte/icons/bell';
import CheckCircleIcon from '@lucide/svelte/icons/check-circle-2';
import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
import MailIcon from '@lucide/svelte/icons/mail';
import MessageCircleIcon from '@lucide/svelte/icons/message-circle';
import ReplyIcon from '@lucide/svelte/icons/reply';
import UserPlusIcon from '@lucide/svelte/icons/user-plus';
import UserRoundXIcon from '@lucide/svelte/icons/user-round-x';

export type NotificationTopicDefinition = components['schemas']['TopicDefinition'];
export type NotificationEmailFrequency = 'off' | 'immediate' | 'daily';

const notificationPresentation = {
	post_published: {
		label: m.notifications_event_post_published,
		description: m.notifications_event_post_published_description,
		icon: CheckCircleIcon
	},
	publish_failed: {
		label: m.notifications_event_publish_failed,
		description: m.notifications_event_publish_failed_description,
		icon: CircleAlertIcon
	},
	account_needs_attention: {
		label: m.notifications_event_account_needs_attention,
		description: m.notifications_event_account_needs_attention_description,
		icon: UserRoundXIcon
	},
	new_engagement: {
		label: m.notifications_event_new_engagement,
		description: m.notifications_event_new_engagement_description,
		icon: MessageCircleIcon
	},
	new_message: {
		label: m.notifications_event_new_message,
		description: m.notifications_event_new_message_description,
		icon: MailIcon
	},
	reply_failed: {
		label: m.notifications_event_reply_failed,
		description: m.notifications_event_reply_failed_description,
		icon: ReplyIcon
	},
	workspace_invite: {
		label: m.notifications_event_workspace_invite,
		description: m.notifications_event_workspace_invite_description,
		icon: UserPlusIcon
	},
	ownership_transfer: {
		label: m.notifications_event_ownership_transfer,
		description: m.notifications_event_ownership_transfer_description,
		icon: UserPlusIcon
	},
	security_action: {
		label: m.notifications_event_security_action,
		description: m.notifications_event_security_action_description,
		icon: BellIcon
	},
	access_changed: {
		label: m.notifications_event_access_changed,
		description: m.notifications_event_access_changed_description,
		icon: BellIcon
	},
	critical_billing: {
		label: m.notifications_event_critical_billing,
		description: m.notifications_event_critical_billing_description,
		icon: BellIcon
	}
} as const;

type KnownNotificationTopic = keyof typeof notificationPresentation;

export function notificationTopicGroups(definitions: NotificationTopicDefinition[]) {
	const groups = new Map<string, NotificationTopicDefinition[]>();
	for (const definition of definitions) {
		groups.set(definition.group, [...(groups.get(definition.group) ?? []), definition]);
	}
	return [...groups].map(([id, topics]) => ({ id, label: groupLabel(id), topics }));
}

export function notificationTopicEmailFrequencies(
	definition: NotificationTopicDefinition
): NotificationEmailFrequency[] {
	return (definition.email_frequencies ?? []).filter(
		(frequency): frequency is NotificationEmailFrequency =>
			frequency === 'off' || frequency === 'immediate' || frequency === 'daily'
	);
}

function groupLabel(group: string): string {
	if (group === 'publishing') return m.notifications_group_publishing();
	if (group === 'conversations') return m.notifications_group_conversations();
	if (group === 'workspace') return m.notifications_group_workspace();
	if (group === 'account') return m.notifications_group_account();
	return m.notifications_type_unknown();
}

export function notificationTopicLabel(type: string): string {
	return isKnownNotificationTopic(type)
		? notificationPresentation[type].label()
		: m.notifications_type_unknown();
}

export function notificationTopicDescription(type: string): string {
	return isKnownNotificationTopic(type)
		? notificationPresentation[type].description()
		: m.notifications_type_unknown();
}

export function notificationTopicIcon(type: string) {
	return isKnownNotificationTopic(type) ? notificationPresentation[type].icon : BellIcon;
}

function isKnownNotificationTopic(type: string): type is KnownNotificationTopic {
	return type in notificationPresentation;
}
