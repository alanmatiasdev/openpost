import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	fetchLottieAnimations,
	lottieFilesAttribution,
	offsetToCursor,
	type LottieFilesAnimation
} from './lottiefiles-api';

afterEach(() => vi.unstubAllGlobals());

describe('LottieFiles API', () => {
	it('maps the public search connection and sends relay pagination', async () => {
		const fetchMock = vi.fn(
			async (_input: string | URL | Request, _init?: RequestInit) =>
				new Response(
					JSON.stringify({
						data: {
							searchPublicAnimations: {
								totalCount: 2,
								pageInfo: { hasNextPage: false, endCursor: 'end' },
								edges: [
									{
										node: {
											id: 42,
											name: ' Wave ',
											lottieUrl: 'https://assets-v2.lottiefiles.com/wave.lottie',
											gifUrl: null,
											bgColor: '#fff',
											createdBy: { name: ' Ada ', username: '/ada' }
										}
									},
									{
										node: {
											id: 43,
											name: 'Unavailable',
											lottieUrl: null,
											gifUrl: null,
											bgColor: null,
											createdBy: null
										}
									}
								]
							}
						}
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				)
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await fetchLottieAnimations({
			category: 'featured',
			query: 'wave',
			after: offsetToCursor(23),
			first: 24
		});
		expect(result).toMatchObject({
			totalCount: 2,
			hasNextPage: false,
			items: [
				{
					id: '42',
					name: 'Wave',
					author: 'Ada',
					authorPath: '/ada'
				}
			]
		});
		const request = fetchMock.mock.calls[0];
		expect(request).toBeDefined();
		// SAFETY: the production client generated this JSON body from its typed variables object.
		const body = JSON.parse(String(request?.[1]?.body)) as {
			query: string;
			variables: { after: string; query: string };
		};
		expect(body.query).toContain('searchPublicAnimations');
		expect(body.variables).toEqual({ first: 24, after: offsetToCursor(23), query: 'wave' });
	});

	it('builds visible creator and license attribution', () => {
		const animation: LottieFilesAnimation = {
			id: '42',
			name: 'Wave',
			lottieUrl: 'https://assets-v2.lottiefiles.com/wave.lottie',
			gifUrl: null,
			bgColor: null,
			author: 'Ada',
			authorPath: 'ada'
		};
		expect(lottieFilesAttribution(animation)).toMatchObject({
			provider: 'LottieFiles',
			author: 'Ada',
			authorUrl: 'https://lottiefiles.com/ada',
			sourceId: '42',
			licenseUrl: 'https://lottiefiles.com/page/license'
		});
	});
});
