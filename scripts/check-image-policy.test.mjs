import assert from "node:assert/strict";
import test from "node:test";

import {
  imagePolicyInputs,
  validateImagePolicy,
} from "./check-image-policy.mjs";

test("the maintained image policy is internally consistent", () => {
  assert.deepEqual(
    validateImagePolicy(imagePolicyInputs(), new Date("2026-08-09T00:00:00Z")),
    [],
  );
});

test("probe and architecture drift fail the policy check", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile
        .replace("/api/v1/health", "/api/v1/ready")
        .replace("received ${TARGETARCH:-unknown}", "unsupported target"),
      compose: inputs.compose.replace("platform: linux/amd64\n", ""),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("health check")));
  assert.ok(
    problems.some((problem) => problem.includes("target architecture")),
  );
  assert.ok(problems.some((problem) => problem.includes("Compose")));
});

test("production build stages cannot drift back to mutable tags", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile.replace(
        /oven\/bun:1\.3\.11-alpine@sha256:[a-f0-9]{64}/u,
        "oven/bun:1.3.11-alpine",
      ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("bun-toolchain")));
});

test("the production frontend cannot drift back to Bun's node fallback shim", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      dockerfile: inputs.dockerfile
        .replace(
          "COPY --from=bun-toolchain /usr/local/bin/bun /usr/local/bin/bun",
          "COPY --from=bun-toolchain /usr/local/bun-node-fallback-bin /usr/local/bun-node-fallback-bin",
        )
        .replace(
          'test "$(command -v node)" = "/usr/local/bin/node"',
          "bun --version",
        ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(
    problems.some((problem) => problem.includes("copy only the pinned Bun")),
  );
  assert.ok(
    problems.some((problem) => problem.includes("verify real Node")),
  );
});

test("smoke and release proof fail when OCI health or public readiness is omitted", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      smoke: inputs.smoke.replace(".State.Health.Status", ".State.Status"),
      release: inputs.release.replace("/api/v1/ready", "/api/v1/health"),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("OCI health")));
  assert.ok(
    problems.some((problem) => problem.includes("public database readiness")),
  );
});

test("expired runtime support fails closed", () => {
  const inputs = imagePolicyInputs();
  assert.ok(
    validateImagePolicy(inputs, new Date("2028-06-01T00:00:00Z")).some(
      (problem) => problem.includes("support_ends"),
    ),
  );
});

test("candidate publication cannot move ahead of the blocking scan", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      ci: inputs.ci.replace(
        "Publish the validated candidate and record its digest",
        "Publish candidate without assurance ordering",
      ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(
    problems.some((problem) => problem.includes("before registry publication")),
  );
});

test("each scan step and the only image push are checked in their own scope", () => {
  const inputs = imagePolicyInputs();
  const problems = validateImagePolicy(
    {
      ...inputs,
      ci: inputs.ci
        .replace(
          "severity: UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL",
          "severity: CRITICAL,HIGH",
        )
        .replace(
          "          docker buildx build \\",
          '          docker push "$image"\n          docker buildx build ' +
            "\\",
        ),
    },
    new Date("2026-08-09T00:00:00Z"),
  );
  assert.ok(problems.some((problem) => problem.includes("report severities")));
  assert.ok(problems.some((problem) => problem.includes("publish only")));
});
