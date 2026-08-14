import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import { presentNotification } from './notification-presentation';

const notification = {
	id: 'notification-1',
	user_id: 'nominee',
	workspace_id: '',
	type: 'ownership_transfer',
	title: '',
	body: '',
	href: '/ownership-transfer?id=transfer-1',
	payload_json: '{"kind":"organization_ownership_nomination","organization_name":"Equipa Açores"}',
	read_at: '',
	created_at: '2026-08-14T12:00:00Z',
	actions: [
		{
			label: 'ownership_transfer.review',
			href: '/ownership-transfer?id=transfer-1',
			kind: 'primary'
		}
	]
};

describe('ownership notification presentation', () => {
	afterEach(() => setLocale('en', { reload: false }));

	it('renders semantic ownership data in English', () => {
		setLocale('en', { reload: false });
		const presented = presentNotification(notification);
		expect(presented.title).toBe('Organization ownership nomination');
		expect(presented.body).toContain('Equipa Açores');
		expect(presented.actions[0]?.label).toBe('Review transfer');
	});

	it('renders the same semantic ownership data in Portuguese', () => {
		setLocale('pt', { reload: false });
		const presented = presentNotification(notification);
		expect(presented.title).toBe('Nomeação de propriedade da Organização');
		expect(presented.body).toContain('Equipa Açores');
		expect(presented.actions[0]?.label).toBe('Rever transferência');
	});
});
