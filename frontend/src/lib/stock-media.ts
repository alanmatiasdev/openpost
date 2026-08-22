import { client } from '$lib/api/client';
import type { components } from '$lib/api/types';

export type StockProvider = components['schemas']['StockProviderResponse'];
export type StockSearchPage = components['schemas']['SearchPage'];
export type StockAsset = components['schemas']['Asset'];
export type ResolvedStockAsset = components['schemas']['ResolvedAsset'];

export interface StockMediaProvenance {
	provider: string;
	external_id: string;
	source_url: string;
	creator_name: string;
	creator_url: string;
	license_name: string;
	license_url: string;
	attribution_text: string;
}

type StockProviderID = 'pexels' | 'unsplash' | 'pixabay';

export interface StockMediaSearchInput {
	provider: string;
	query: string;
	kind: 'photo' | 'video';
	orientation?: 'landscape' | 'portrait' | 'square';
	size?: 'small' | 'medium' | 'large';
	color?: string;
	locale?: string;
	order?: 'relevant' | 'latest' | 'popular';
	contentFilter?: 'low' | 'high';
	collections?: string;
	category?: string;
	mediaSubtype?: 'all' | 'photo' | 'illustration' | 'vector';
	editorsChoice?: boolean;
	minWidth?: number;
	minHeight?: number;
	page?: number;
	perPage?: number;
}

export async function listStockProviders(): Promise<StockProvider[]> {
	const { data, error } = await client.GET('/stock-media/providers');
	if (error || !data) throw new Error(error?.detail ?? 'Stock media providers could not load.');
	return data.providers ?? [];
}

export async function searchStockMedia(input: StockMediaSearchInput): Promise<StockSearchPage> {
	const { data, error } = await client.GET('/stock-media/search', {
		params: {
			query: {
				provider: parseStockProviderID(input.provider),
				query: input.query,
				kind: input.kind,
				orientation: input.orientation,
				size: input.size,
				color: input.color,
				locale: input.locale,
				order: input.order,
				content_filter: input.contentFilter,
				collections: input.collections,
				category: input.category,
				media_subtype: input.mediaSubtype,
				editors_choice: input.editorsChoice,
				min_width: input.minWidth,
				min_height: input.minHeight,
				page: input.page ?? 1,
				per_page: input.perPage ?? 24
			}
		}
	});
	if (error || !data) throw new Error(error?.detail ?? 'Stock media search failed.');
	return data;
}

export async function resolveStockAsset(
	provider: string,
	externalID: string
): Promise<ResolvedStockAsset> {
	const { data, error } = await client.POST('/stock-media/selections', {
		body: {
			provider: parseStockProviderID(provider),
			external_id: externalID
		}
	});
	if (error || !data) throw new Error(error?.detail ?? 'That stock item is no longer available.');
	return data;
}

function parseStockProviderID(provider: string): StockProviderID {
	if (provider === 'pexels' || provider === 'unsplash' || provider === 'pixabay') return provider;
	throw new Error('Unsupported stock media provider.');
}
