import posthog from "posthog-js";

export type TelemetrySurface = "app" | "marketing" | "docs";

export interface BrowserTelemetryConfig {
  enabled: boolean;
  projectToken?: string;
  apiHost?: string;
  uiHost?: string;
  environment: string;
  edition: string;
  version?: string;
  revision?: string;
  surface: TelemetrySurface;
}

export interface TelemetryEventMap {
  "signup started": Record<string, never>;
  "publication publish requested": {
    account_count: number;
    is_thread: boolean;
  };
  "publication schedule requested": {
    account_count: number;
    is_thread: boolean;
  };
  "media uploaded": {
    count: number;
    source: "upload" | "camera" | "stock_import";
  };
  "image design created": {
    source: "custom" | "preset" | "template" | "media";
  };
  "image design exported": { mode: string; pages: number };
  "billing checkout opened": { billing_period: string; plan_id: string };
  "first composition started": { signal: "text" | "media" | "content_mode" };
  "video project created": {
    source: "openpost_media" | "files" | "blank" | "recording" | "stock";
    editing_mode?: string;
    file_count?: number;
  };
  "video export completed": { format: string; variant_count: number };
  "public editor opened": {
    editor: "image" | "video";
    source: "marketing_tool";
  };
  "public image editor viewed": Record<string, string | number | boolean>;
  "public image design started": Record<string, string | number | boolean>;
  "public image editor meaningful edit": Record<
    string,
    string | number | boolean
  >;
  "public image export completed": Record<string, string | number | boolean>;
  "public image editor signup clicked": Record<
    string,
    string | number | boolean
  >;
  "public image editor signup completed": Record<
    string,
    string | number | boolean
  >;
  "public image workspace import completed": Record<
    string,
    string | number | boolean
  >;
  "docs search used": { result_count?: number };
  "docs code copied": { language?: string };
}

export type TelemetryEventName = keyof TelemetryEventMap;

interface BrowserSDK {
  init(token: string, options: Record<string, unknown>): unknown;
  capture(event: string, properties?: Record<string, unknown>): unknown;
  captureException(error: Error, properties?: Record<string, unknown>): unknown;
  identify(distinctID: string): unknown;
  register(properties: Record<string, unknown>): unknown;
  reset(): unknown;
  opt_out_capturing(): unknown;
  get_distinct_id?(): string;
  get_session_id?(): string;
}

type PendingEvent = {
  name: TelemetryEventName;
  properties: Record<string, unknown>;
};

type PendingPageView = { pathname: string; title: string };
type PendingException = { error: Error; properties: Record<string, unknown> };

const maxPendingEvents = 100;
const eventPropertyAllowlists: Record<TelemetryEventName, readonly string[]> = {
  "signup started": [],
  "publication publish requested": ["account_count", "is_thread"],
  "publication schedule requested": ["account_count", "is_thread"],
  "media uploaded": ["count", "source"],
  "image design created": ["source"],
  "image design exported": ["mode", "pages"],
  "billing checkout opened": ["billing_period", "plan_id"],
  "first composition started": ["signal"],
  "video project created": ["source", "editing_mode", "file_count"],
  "video export completed": ["format", "variant_count"],
  "public editor opened": ["editor", "source"],
  "public image editor viewed": ["returning_guest"],
  "public image design started": ["entry", "preset", "template"],
  "public image editor meaningful edit": ["source"],
  "public image export completed": ["format", "pages"],
  "public image editor signup clicked": ["source"],
  "public image editor signup completed": ["source"],
  "public image workspace import completed": ["source"],
  "docs search used": ["result_count"],
  "docs code copied": ["language"],
};
const firstCompositionSignals = new Set(["text", "media", "content_mode"]);
const planIDs = new Set(["starter", "founder", "pro", "team", "agency"]);
const billingPeriods = new Set(["monthly", "annual"]);

export class BrowserTelemetry {
  private configured = false;
  private disabled = false;
  private activeUserID: string | null = null;
  private pendingUserID: string | null = null;
  private pendingEvents: PendingEvent[] = [];
  private pendingPageViews: PendingPageView[] = [];
  private pendingExceptions: PendingException[] = [];
  private capturedErrors = new WeakSet<object>();

  constructor(
    private readonly sdk: BrowserSDK,
    private readonly runtimeAvailable: () => boolean = () =>
      typeof window !== "undefined",
  ) {}

  configure(config: BrowserTelemetryConfig): void {
    if (!this.runtimeAvailable()) return;
    if (
      !config.enabled ||
      !config.projectToken?.trim() ||
      !config.apiHost?.trim()
    ) {
      this.disabled = true;
      this.pendingEvents = [];
      this.pendingPageViews = [];
      this.pendingExceptions = [];
      if (this.configured) this.sdk.opt_out_capturing();
      return;
    }

    this.sdk.init(config.projectToken.trim(), {
      api_host: config.apiHost.trim().replace(/\/+$/, ""),
      ...(config.uiHost?.trim()
        ? { ui_host: config.uiHost.trim().replace(/\/+$/, "") }
        : {}),
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      cross_subdomain_cookie: false,
      persistence: "memory",
      cookieless_mode: "always",
      person_profiles: config.surface === "app" ? "identified_only" : "never",
      respect_dnt: true,
    });
    this.sdk.register(
      compactProperties({
        surface: config.surface,
        environment: config.environment,
        edition: config.edition,
        version: config.version,
        revision: config.revision,
      }),
    );
    this.configured = true;
    this.disabled = false;

    if (this.pendingUserID) {
      this.identify(this.pendingUserID);
    }
    for (const event of this.pendingEvents.splice(0)) {
      this.sdk.capture(event.name, event.properties);
    }
    for (const pageView of this.pendingPageViews.splice(0)) {
      this.capturePageView(pageView.pathname, pageView.title);
    }
    for (const exception of this.pendingExceptions.splice(0)) {
      this.sdk.captureException(exception.error, exception.properties);
    }
  }

  capture<Name extends TelemetryEventName>(
    name: Name,
    ...args: TelemetryEventMap[Name] extends Record<string, never>
      ? [properties?: TelemetryEventMap[Name]]
      : [properties: TelemetryEventMap[Name]]
  ): void {
    if (this.disabled) return;
    const properties = allowlistedEventProperties(
      name,
      (args[0] ?? {}) as Record<string, unknown>,
    );
    if (properties === null) return;
    if (!this.configured) {
      if (this.pendingEvents.length < maxPendingEvents)
        this.pendingEvents.push({ name, properties });
      return;
    }
    this.sdk.capture(name, properties);
  }

  capturePageView(pathname: string, title = document.title): void {
    if (this.disabled || typeof window === "undefined") return;
    if (!this.configured) {
      if (this.pendingPageViews.length < maxPendingEvents) {
        this.pendingPageViews.push({ pathname, title });
      }
      return;
    }
    const path = cleanPath(pathname);
    this.sdk.capture("$pageview", {
      $current_url: `${window.location.origin}${path}`,
      path,
      title,
    });
  }

  identify(userID: string): void {
    const normalized = userID.trim();
    if (!normalized || containsSensitiveValue(normalized)) {
      this.resetIdentity();
      return;
    }
    this.pendingUserID = normalized;
    if (!this.configured || this.disabled || this.activeUserID === normalized)
      return;
    if (this.activeUserID !== null) this.sdk.reset();
    this.sdk.identify(normalized);
    this.activeUserID = normalized;
  }

  resetIdentity(): void {
    this.pendingUserID = null;
    this.activeUserID = null;
    if (this.configured) this.sdk.reset();
  }

  captureException(
    error: unknown,
    properties: Record<string, unknown> = {},
  ): void {
    if (this.disabled) return;
    if (typeof error === "object" && error !== null) {
      if (this.capturedErrors.has(error)) return;
      this.capturedErrors.add(error);
    }
    const sanitized = sanitizeError(error);
    const compacted = compactProperties(properties);
    if (!this.configured) {
      if (this.pendingExceptions.length < maxPendingEvents) {
        this.pendingExceptions.push({
          error: sanitized,
          properties: compacted,
        });
      }
      return;
    }
    this.sdk.captureException(sanitized, compacted);
  }

  requestHeaders(): Record<string, string> {
    if (!this.configured || this.disabled) return {};
    const distinctID = this.sdk.get_distinct_id?.();
    const sessionID = this.sdk.get_session_id?.();
    return compactProperties({
      "X-PostHog-Distinct-ID": distinctID,
      "X-PostHog-Session-ID": sessionID,
    }) as Record<string, string>;
  }
}

const telemetry = new BrowserTelemetry(posthog as unknown as BrowserSDK);

export function configureTelemetry(config: BrowserTelemetryConfig): void {
  telemetry.configure(config);
}

export function captureTelemetryEvent<Name extends TelemetryEventName>(
  name: Name,
  ...args: TelemetryEventMap[Name] extends Record<string, never>
    ? [properties?: TelemetryEventMap[Name]]
    : [properties: TelemetryEventMap[Name]]
): void {
  telemetry.capture(name, ...(args as never));
}

export function captureTelemetryPageView(
  pathname: string,
  title?: string,
): void {
  telemetry.capturePageView(pathname, title);
}

export function identifyTelemetryUser(userID: string): void {
  telemetry.identify(userID);
}

export function resetTelemetryIdentity(): void {
  telemetry.resetIdentity();
}

export function captureClientException(
  error: unknown,
  properties: Record<string, unknown> = {},
): void {
  telemetry.captureException(error, properties);
}

export function telemetryRequestHeaders(): Record<string, string> {
  return telemetry.requestHeaders();
}

export function telemetryDistinctID(): string {
  return telemetry.requestHeaders()["X-PostHog-Distinct-ID"] ?? "";
}

export function applyTelemetryRequestHeaders(
  headers: Headers,
  requestHeaders: Record<string, string> = telemetryRequestHeaders(),
): Headers {
  for (const [name, value] of Object.entries(requestHeaders)) {
    headers.set(name, value);
  }
  return headers;
}

export function installGlobalErrorCapture(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onError = (event: ErrorEvent) => {
    captureClientException(event.error ?? new Error(event.message), {
      error_boundary: "window_error",
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    captureClientException(event.reason, {
      error_boundary: "unhandled_rejection",
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

function compactProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, sanitizePropertyValue(value)]),
  );
}

function allowlistedEventProperties(
  name: TelemetryEventName,
  properties: Record<string, unknown>,
): Record<string, unknown> | null {
  const allowlist = eventPropertyAllowlists[name];
  if (!allowlist) return null;
  if (Object.keys(properties).some((key) => !allowlist.includes(key))) {
    return null;
  }
  if (Object.values(properties).some(containsSensitiveValue)) return null;
  if (
    name === "first composition started" &&
    !firstCompositionSignals.has(String(properties.signal))
  ) {
    return null;
  }
  if (
    name === "billing checkout opened" &&
    (!planIDs.has(String(properties.plan_id)) ||
      !billingPeriods.has(String(properties.billing_period)))
  ) {
    return null;
  }
  const result = compactProperties(
    Object.fromEntries(allowlist.map((key) => [key, properties[key]])),
  );
  return result;
}

function containsSensitiveValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:https?:\/\/|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?:token|secret|password|authorization)=|^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$)/iu.test(
      value,
    );
  }
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (value && typeof value === "object") {
    return Object.values(value).some(containsSensitiveValue);
  }
  return false;
}

function cleanPath(pathname: string): string {
  try {
    return new URL(pathname, "https://openpost.invalid").pathname;
  } catch {
    return "/";
  }
}

function sanitizeError(value: unknown): Error {
  const source =
    value instanceof Error
      ? value
      : new Error(typeof value === "string" ? value : "Unknown client error");
  const result = new Error(
    scrubPropertyString(source.message || "Unknown client error"),
  );
  result.name = source.name || "Error";
  if (source.stack) result.stack = scrubStack(source.stack);
  return result;
}

function sanitizePropertyValue(value: unknown): unknown {
  if (typeof value === "string") return scrubPropertyString(value);
  if (Array.isArray(value)) return value.map(sanitizePropertyValue);
  if (value && typeof value === "object") {
    return compactProperties(value as Record<string, unknown>);
  }
  return value;
}

function scrubPropertyString(value: string): string {
  return truncate(
    scrubSensitiveText(value).replace(
      /https?:\/\/[^\s)\]}]+/gi,
      "[redacted-url]",
    ),
    200,
  );
}

function scrubStack(value: string): string {
  return scrubSensitiveText(
    value.replace(/https?:\/\/[^\s)\]}]+/gi, scrubStackURL),
  );
}

function scrubStackURL(value: string): string {
  const withoutQueryOrFragment = value.replace(/[?#].*$/, "");
  try {
    const pathname = new URL(withoutQueryOrFragment).pathname;
    if (
      /^\/(?:_app\/immutable|assets)\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+\.m?js(?::\d+){0,2}$/.test(
        pathname,
      )
    ) {
      return pathname;
    }
  } catch {
    // Invalid absolute URLs are redacted below.
  }
  return "[redacted-url]";
}

function scrubSensitiveText(value: string): string {
  return value
    .replace(
      /([?&](?:token|code|secret|key|signature|state)=)[^&\s)]+/gi,
      "$1[redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}
