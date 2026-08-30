import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("a scoped check resolves through the canonical task interface", () => {
  const result = taskPlan("check", "frontend");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.command, "check");
  assert.equal(plan.scope, "frontend");
  assert.ok(plan.stages.some((stage) => stage.label === "generated contracts"));
  assert.ok(plan.stages.some((stage) => stage.label === "frontend types"));
});

test("specialized policy checks share the check interface", () => {
  const result = taskPlan("check", "provider-certification");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(
    plan.stages.map((stage) => stage.label),
    ["provider certification"],
  );
});

test("repository tests use exact Bun paths", () => {
  const result = taskPlan("test", "marketing");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.match(plan.stages[0].commands[0], /bun test \.\/scripts\//u);
});

test("unknown scopes fail with the supported interface", () => {
  const result = taskPlan("test", "unknown");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /supported test scopes/u);
});

function taskPlan(command, scope) {
  const args = ["scripts/tasks.mjs", command];
  if (scope) args.push(scope);
  args.push("--plan");
  return spawnSync("bun", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}
