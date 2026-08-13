import { describe, expect, it } from "vitest";
import {
  ensureFirstUseFunnel,
  firstUseJourneyEvents,
  type PostHogFirstUseConfig,
} from "./posthog-first-use";

const config: PostHogFirstUseConfig = {
  personalApiKey: "phx_test",
  projectId: "246054",
  projectToken: "phc_test",
  uiHost: "https://eu.posthog.com",
  ingestionHost: "https://eu.i.posthog.com",
  environment: "production",
};

describe("PostHog first-use funnel", () => {
  it("creates the ordered funnel and proves a personless smoke journey reached it", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/insights/?")) {
        return Response.json({ results: [] });
      }
      if (url.endsWith("/insights/")) {
        return Response.json(
          { id: 77, short_id: "first-use" },
          { status: 201 },
        );
      }
      if (url.endsWith("/batch/")) {
        return Response.json({ status: 1 });
      }
      if (url.includes("/events/?")) {
        return Response.json({
          results: [
            { distinct_id: "openpost-smoke-test", event: "signup started" },
          ],
        });
      }
      if (url.endsWith("/query/")) {
        return Response.json({
          results: firstUseJourneyEvents.map((name) => ({ name, count: 1 })),
        });
      }
      throw new Error(`unexpected request ${url}`);
    };

    const evidence = await ensureFirstUseFunnel(config, {
      fetch: fetch as typeof globalThis.fetch,
      smokeID: "openpost-smoke-test",
      now: () => new Date("2026-08-13T18:00:00Z"),
      sleep: async () => undefined,
    });

    const create = requests.find(({ url }) => url.endsWith("/insights/"));
    const insight = JSON.parse(String(create?.init?.body));
    expect(
      insight.query.source.series.map((step: { event: string }) => step.event),
    ).toEqual(firstUseJourneyEvents);
    const capture = requests.find(({ url }) => url.endsWith("/batch/"));
    const batch = JSON.parse(String(capture?.init?.body));
    expect(batch).toMatchObject({
      api_key: "phc_test",
    });
    expect(batch.batch.map((event: { event: string }) => event.event)).toEqual(
      firstUseJourneyEvents,
    );
    expect(batch.batch[0].properties).toEqual({
      distinct_id: "openpost-smoke-test",
      surface: "operator",
      environment: "production",
      edition: "cloud",
      openpost_smoke: true,
      $process_person_profile: false,
    });
    expect(JSON.stringify(batch)).not.toMatch(
      /email|token=|secret|https?:\/\//i,
    );
    const funnelQuery = requests.find(({ url }) => url.endsWith("/query/"));
    expect(JSON.parse(String(funnelQuery?.init?.body))).toMatchObject({
      query: {
        kind: "FunnelsQuery",
        properties: expect.arrayContaining([
          expect.objectContaining({
            key: "openpost_smoke",
            value: true,
          }),
          expect.objectContaining({
            key: "$distinct_id",
            value: "openpost-smoke-test",
          }),
        ]),
      },
    });
    expect(insight.query.source.properties).toContainEqual({
      key: "openpost_smoke",
      value: null,
      operator: "is_not_set",
      type: "event",
    });
    expect(evidence).toMatchObject({
      insightId: 77,
      smokeID: "openpost-smoke-test",
    });
  });
});
