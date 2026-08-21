import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '$lib/api/client';
import { listImageEditorDesigns } from '$lib/image-editor/api';

const mocks = { get: vi.fn(), delete: vi.fn() };
vi.spyOn(client, 'GET').mockImplementation(mocks.get);
vi.spyOn(client, 'DELETE').mockImplementation(mocks.delete);

describe('editor catalog API pagination', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('forwards scoped image search, pagination, and cancellation', async () => {
		mocks.get.mockResolvedValue({
			data: { designs: [], total: 123, can_edit: true },
			error: null
		});
		const controller = new AbortController();

		await expect(
			listImageEditorDesigns('workspace-a', {
				search: 'launch',
				limit: 50,
				offset: 100,
				signal: controller.signal
			})
		).resolves.toMatchObject({ total: 123, can_edit: true });
		expect(mocks.get).toHaveBeenCalledWith('/image-editor/designs', {
			params: {
				query: {
					workspace_id: 'workspace-a',
					search: 'launch',
					limit: 50,
					offset: 100
				}
			},
			signal: controller.signal
		});
	});
});
