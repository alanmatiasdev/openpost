export type SocialImageKind =
  | "home"
  | "workflow"
  | "platforms"
  | "platform"
  | "compare-index"
  | "comparison"
  | "tools-index"
  | "tool"
  | "security"
  | "open-source"
  | "document"
  | "docs";

export interface SocialEntry {
  path: string;
  key: string;
  title: string;
  socialTitle: string;
  description: string;
  label: string;
  kind: SocialImageKind;
  canonical: string;
  imagePath: string;
  imageAlt: string;
  subject?: string;
  platform?: string;
}

export const marketingSiteUrl: "https://openpost.social";
export const docsSiteUrl: "https://docs.openpost.social";
export const marketingSocialEntries: readonly SocialEntry[];

export function normalizeMarketingPath(pathname: string): string;
export function canonicalMarketingUrl(pathname: string): string;
export function resolveMarketingSocial(pathname: string): SocialEntry;
export function docsRouteFromPage(page: string): string;
export function docsImageKey(page: string): string;
export function docsSectionForPage(page: string): string;
export function docsDescriptionForPage(page: string): string;
export function resolveDocsSocial(input: {
  page: string;
  title?: string;
  description?: string;
}): SocialEntry;
