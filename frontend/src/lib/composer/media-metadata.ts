type MediaMetadataJSONValue =
	| string
	| number
	| boolean
	| null
	| MediaMetadataJSONValue[]
	| { [key: string]: MediaMetadataJSONValue };

export interface ComposerMediaMetadata {
	id: string;
	mimeType?: string;
	size?: number;
	altText?: string;
}

function valueFields(
	value: MediaMetadataJSONValue | undefined
): Map<string, MediaMetadataJSONValue> {
	if (value === null || Array.isArray(value) || !(value instanceof Object)) return new Map();
	return new Map(Object.entries(value));
}

function stringValue(value: MediaMetadataJSONValue | undefined): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

export function parseComposerMediaMetadata(value: MediaMetadataJSONValue): ComposerMediaMetadata[] {
	const media = valueFields(value).get('media');
	if (!Array.isArray(media)) return [];
	const parsed: ComposerMediaMetadata[] = [];
	for (const item of media) {
		const fields = valueFields(item);
		const id = stringValue(fields.get('id'));
		if (!id) continue;
		const metadata: ComposerMediaMetadata = { id };
		const mimeType = stringValue(fields.get('mime_type'));
		const altText = stringValue(fields.get('alt_text'));
		const size = fields.get('size');
		if (mimeType) metadata.mimeType = mimeType;
		if (altText) metadata.altText = altText;
		if (Number.isFinite(size)) metadata.size = Number(size);
		parsed.push(metadata);
	}
	return parsed;
}
