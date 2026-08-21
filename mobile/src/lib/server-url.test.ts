import { describe, expect, test } from "bun:test";

import { normalizeServerUrl } from "./server-url";

describe("normalizeServerUrl", () => {
  test("adds HTTPS to a bare host", () => {
    expect(normalizeServerUrl("openpost.example.com")).toBe("https://openpost.example.com");
  });

  test("preserves an HTTPS origin and port", () => {
    expect(normalizeServerUrl("https://openpost.example.com:8443/")).toBe(
      "https://openpost.example.com:8443",
    );
  });

  test("rejects cleartext HTTP", () => {
    expect(normalizeServerUrl("http://openpost.example.com")).toBeNull();
  });

  test("rejects paths, credentials, query strings, and fragments", () => {
    expect(normalizeServerUrl("https://openpost.example.com/app")).toBeNull();
    expect(normalizeServerUrl("https://user:pass@openpost.example.com")).toBeNull();
    expect(normalizeServerUrl("https://openpost.example.com?next=/app")).toBeNull();
    expect(normalizeServerUrl("https://openpost.example.com#app")).toBeNull();
  });

  test("rejects device-local hosts", () => {
    expect(normalizeServerUrl("https://localhost")).toBeNull();
    expect(normalizeServerUrl("https://127.0.0.1")).toBeNull();
    expect(normalizeServerUrl("https://openpost.local")).toBeNull();
  });
});
