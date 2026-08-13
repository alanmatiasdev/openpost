export const firstUseJourneyEvents = [
  "signup started",
  "signup completed",
  "plan confirmed",
  "workspace created",
  "checkout completed",
  "destination connected",
  "first composition started",
  "workspace activated",
] as const;

const insightName = "OpenPost first-use Activation";

export interface PostHogFirstUseConfig {
  personalApiKey: string;
  projectId: string;
  projectToken: string;
  uiHost: string;
  ingestionHost: string;
  environment: string;
}

interface Runtime {
  fetch: typeof globalThis.fetch;
  smokeID: string;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
}

interface InsightSummary {
  id: number;
  short_id: string;
  name?: string | null;
}

export interface PostHogFirstUseEvidence {
  verifiedAt: string;
  projectId: string;
  insightId: number;
  insightURL: string;
  smokeEvent: (typeof firstUseJourneyEvents)[number];
  smokeID: string;
}

export async function ensureFirstUseFunnel(
  config: PostHogFirstUseConfig,
  runtime: Partial<Runtime> = {},
): Promise<PostHogFirstUseEvidence> {
  const fetch = runtime.fetch ?? globalThis.fetch;
  const now = runtime.now ?? (() => new Date());
  const sleep = runtime.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
  const smokeID = runtime.smokeID ?? `openpost-smoke-${crypto.randomUUID()}`;
  const apiBase = `${trimHost(config.uiHost)}/api/projects/${encodeURIComponent(config.projectId)}`;
  const insightPayload = firstUseInsight(config.environment);
  const search = new URLSearchParams({
    saved: "true",
    insight: "FUNNELS",
    search: insightName,
    limit: "100",
  });
  const listed = await postHogJSON<{ results: InsightSummary[] }>(
    fetch,
    `${apiBase}/insights/?${search}`,
    config.personalApiKey,
  );
  const existing = listed.results.find(
    (insight) => insight.name === insightName,
  );
  const insight = existing
    ? await postHogJSON<InsightSummary>(
        fetch,
        `${apiBase}/insights/${existing.id}/`,
        config.personalApiKey,
        { method: "PATCH", body: JSON.stringify(insightPayload) },
      )
    : await postHogJSON<InsightSummary>(
        fetch,
        `${apiBase}/insights/`,
        config.personalApiKey,
        {
          method: "POST",
          body: JSON.stringify(insightPayload),
        },
      );

  const capturedAt = now();
  await requestJSON(fetch, `${trimHost(config.ingestionHost)}/batch/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: config.projectToken,
      batch: firstUseJourneyEvents.map((event, index) => ({
        event,
        properties: {
          distinct_id: smokeID,
          surface: "operator",
          environment: config.environment,
          edition: "cloud",
          openpost_smoke: true,
          $process_person_profile: false,
        },
        timestamp: new Date(capturedAt.getTime() + index * 1_000).toISOString(),
      })),
    }),
  });
  await waitForSmokeEvent(
    fetch,
    apiBase,
    config.personalApiKey,
    smokeID,
    capturedAt,
    sleep,
  );
  await waitForSmokeFunnel(
    fetch,
    apiBase,
    config.personalApiKey,
    insightPayload.query.source,
    smokeID,
    sleep,
  );

  return {
    verifiedAt: now().toISOString(),
    projectId: config.projectId,
    insightId: insight.id,
    insightURL: `${trimHost(config.uiHost)}/project/${encodeURIComponent(config.projectId)}/insights/${encodeURIComponent(insight.short_id)}`,
    smokeEvent: firstUseJourneyEvents.at(-1)!,
    smokeID,
  };
}

async function waitForSmokeFunnel(
  fetch: typeof globalThis.fetch,
  apiBase: string,
  personalApiKey: string,
  source: ReturnType<typeof firstUseInsight>["query"]["source"],
  smokeID: string,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  const query = {
    ...source,
    properties: [
      ...source.properties.filter(
        (property) => property.key !== "openpost_smoke",
      ),
      {
        key: "openpost_smoke",
        value: true,
        operator: "exact",
        type: "event",
      },
      {
        key: "$distinct_id",
        value: smokeID,
        operator: "exact",
        type: "event",
      },
    ],
  };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await postHogJSON<Record<string, unknown>>(
      fetch,
      `${apiBase}/query/`,
      personalApiKey,
      { method: "POST", body: JSON.stringify({ query }) },
    );
    if (funnelIncludesCompletedJourney(response)) return;
    await sleep(3_000);
  }
  throw new Error(
    "PostHog did not count the ordered smoke journey in the first-use funnel before the verification timeout",
  );
}

function funnelIncludesCompletedJourney(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(funnelIncludesCompletedJourney);
  }
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const name = record.name ?? record.event ?? record.custom_name;
  const count = record.count ?? record.aggregated_value;
  if (
    name === firstUseJourneyEvents.at(-1) &&
    typeof count === "number" &&
    count > 0
  ) {
    return true;
  }
  return Object.values(record).some(funnelIncludesCompletedJourney);
}

function firstUseInsight(environment: string) {
  return {
    name: insightName,
    description:
      "Ordered first-use journey from signup intent to authoritative Workspace Activation. OpenPost manages this insight from issue #54.",
    tags: ["openpost", "first-use", "production"],
    query: {
      kind: "InsightVizNode",
      source: {
        kind: "FunnelsQuery",
        series: firstUseJourneyEvents.map((event) => ({
          kind: "EventsNode",
          event,
        })),
        dateRange: { date_from: "-30d" },
        properties: [
          {
            key: "environment",
            value: environment,
            operator: "exact",
            type: "event",
          },
          {
            key: "openpost_smoke",
            value: null,
            operator: "is_not_set",
            type: "event",
          },
        ],
        funnelsFilter: {
          funnelOrderType: "ordered",
          funnelWindowInterval: 30,
          funnelWindowIntervalUnit: "day",
        },
      },
    },
  };
}

async function waitForSmokeEvent(
  fetch: typeof globalThis.fetch,
  apiBase: string,
  personalApiKey: string,
  smokeID: string,
  capturedAt: Date,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  const after = new Date(capturedAt.getTime() - 60_000).toISOString();
  const query = new URLSearchParams({
    event: firstUseJourneyEvents.at(-1)!,
    after,
    limit: "100",
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const events = await postHogJSON<{
      results: Array<Record<string, unknown>>;
    }>(fetch, `${apiBase}/events/?${query}`, personalApiKey);
    if (
      events.results.some(
        (event) =>
          event.distinct_id === smokeID || event["$distinct_id"] === smokeID,
      )
    ) {
      return;
    }
    await sleep(3_000);
  }
  throw new Error(
    "PostHog did not expose the first-use smoke event before the verification timeout",
  );
}

async function postHogJSON<T>(
  fetch: typeof globalThis.fetch,
  url: string,
  personalApiKey: string,
  init: RequestInit = {},
): Promise<T> {
  return requestJSON<T>(fetch, url, {
    ...init,
    headers: {
      Authorization: `Bearer ${personalApiKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

async function requestJSON<T>(
  fetch: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `PostHog request failed with ${response.status}: ${detail}`,
    );
  }
  return (await response.json()) as T;
}

function trimHost(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

if (import.meta.main) {
  const evidence = await ensureFirstUseFunnel({
    personalApiKey: requiredEnvironment("POSTHOG_PERSONAL_API_KEY"),
    projectId: requiredEnvironment("POSTHOG_PROJECT_ID"),
    projectToken: requiredEnvironment("POSTHOG_PROJECT_TOKEN"),
    uiHost: requiredEnvironment("POSTHOG_UI_HOST"),
    ingestionHost: requiredEnvironment("POSTHOG_BROWSER_HOST"),
    environment: process.env.POSTHOG_ENVIRONMENT?.trim() || "production",
  });
  const evidencePath = process.env.POSTHOG_EVIDENCE_PATH?.trim();
  if (evidencePath)
    await Bun.write(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(
    `Verified PostHog first-use funnel ${evidence.insightId} and smoke event ${evidence.smokeID}\n`,
  );
}
