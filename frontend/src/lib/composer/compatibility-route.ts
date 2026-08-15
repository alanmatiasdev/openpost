export function canonicalPublicationPathFromLegacyPost(
	post: { publication_id?: string | null } | null | undefined
): string | null {
	const publicationID = post?.publication_id?.trim();
	return publicationID ? `/publications/${encodeURIComponent(publicationID)}` : null;
}
