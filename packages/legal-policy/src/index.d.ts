export type LegalPolicyDocument = Readonly<{
  version: string;
  effective_date: string;
  url: string;
  requires_acceptance: boolean;
}>;

export declare const legalPolicy: Readonly<{
  schema_version: 1;
  terms: LegalPolicyDocument;
  privacy: LegalPolicyDocument;
  refunds: LegalPolicyDocument;
}>;

export type ManagedServiceStore = Readonly<{
  id: string;
  name: string;
  provider: string;
  location: string;
  data: string;
  retention: string;
  protection: string;
}>;

export type ManagedServiceProvider = Readonly<{
  id: string;
  name: string;
  role:
    | "subprocessor"
    | "independent_controller_and_processor"
    | "independent_service_provider"
    | "user_requested_source";
  use:
    | "required"
    | "purchase_triggered"
    | "feature_triggered"
    | "feedback_triggered";
  purpose: string;
  data: string;
  location: string;
  transfer: string;
  source_urls: readonly string[];
}>;

export type DirectedRecipient = Readonly<{
  name: string;
  purpose: string;
  data: string;
  location: string;
  source_url: string;
}>;

export declare const managedService: Readonly<{
  schema_version: 1;
  reviewed_on: string;
  next_review_on: string;
  contact: string;
  change_notice: string;
  stores: readonly ManagedServiceStore[];
  providers: readonly ManagedServiceProvider[];
  directed_recipients: readonly DirectedRecipient[];
  human_access: Readonly<{
    scope: string;
    authentication: string;
    routine_access: string;
    support_access: string;
    approval: string;
    logging: string;
    emergency: string;
    review_and_revocation: string;
  }>;
}>;

export declare function formatPolicyEffectiveDate(
  policy: LegalPolicyDocument,
  locale?: string,
): string;
