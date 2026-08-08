export type StockMediaKind = 'photo' | 'video';
export type StockMediaAccept = StockMediaKind | 'both';

export function stockMediaKindsForProvider(
	provider: { photos: boolean; videos: boolean } | undefined,
	accept: StockMediaAccept
): StockMediaKind[] {
	if (!provider) return [];
	return [
		...(accept !== 'video' && provider.photos ? (['photo'] as const) : []),
		...(accept !== 'photo' && provider.videos ? (['video'] as const) : [])
	];
}
