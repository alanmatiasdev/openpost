import { expect, test } from "bun:test";

import { parseCapacitorSyncArguments } from "./capacitor-sync.mjs";

test("Capacitor sync accepts only the owned Android build", () => {
  expect(parseCapacitorSyncArguments(["android"])).toBe("android");
  expect(() => parseCapacitorSyncArguments([])).toThrow("Usage:");
  expect(() => parseCapacitorSyncArguments(["ios"])).toThrow("Usage:");
});
