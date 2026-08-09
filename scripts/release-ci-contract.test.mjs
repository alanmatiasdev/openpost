import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const dockerfile = readFileSync("docker/Dockerfile", "utf8");
const localRelease = readFileSync("scripts/release.mjs", "utf8");
const smoke = readFileSync("scripts/smoke-production-image.sh", "utf8");

test("candidate CI embeds one stable version and exact-revision manifest", () => {
  assert.match(
    ci,
    /release-manifest\.mjs create[\s\S]*--changelog CHANGELOG\.md[\s\S]*--latest-tag[\s\S]*--revision "\$GITHUB_SHA"/,
  );
  assert.match(ci, /image:[\s\S]*fetch-depth: 0[\s\S]*--latest-tag/);
  assert.match(ci, /name: release-manifest-\$\{\{ github\.sha \}\}/);
  assert.match(
    ci,
    /--build-arg VERSION="\$\{\{ steps\.manifest\.outputs\.version \}\}"/,
  );
  assert.match(ci, /--build-arg COMMIT="\$GITHUB_SHA"/);
  assert.match(ci, /--build-arg RELEASE_MANIFEST_B64=/);
  assert.doesNotMatch(ci, /VERSION="candidate-/);

  assert.match(
    dockerfile,
    /COPY --from=backend-builder \/app\/release-manifest\.json/,
  );
  assert.match(
    dockerfile,
    /org\.opencontainers\.image\.version="\$\{VERSION\}"/,
  );
  assert.match(
    dockerfile,
    /org\.opencontainers\.image\.revision="\$\{COMMIT\}"/,
  );
  assert.match(dockerfile, /sha256sum -c -/);
  assert.match(
    dockerfile,
    /\.version' release-manifest\.json\)" = "\$\{VERSION\}"/,
  );
  assert.match(smoke, /running_version/);
  assert.match(smoke, /verify-image-release-manifest\.sh/);
});

test("promotion verifies metadata before pinning the verified digest", () => {
  const verifyPosition = release.indexOf(
    "bun scripts/release-manifest.mjs verify",
  );
  const promotePosition = release.indexOf("promote-image:");
  assert.ok(verifyPosition >= 0 && verifyPosition < promotePosition);
  assert.match(
    release,
    /--version "\$GITHUB_REF_NAME"[\s\S]*--revision "\$GITHUB_SHA"/,
  );
  assert.match(
    release,
    /source_image="\$\{REGISTRY\}\/\$\{IMAGE_NAME\}@\$\{SOURCE_DIGEST\}"/,
  );
  assert.match(release, /--prefer-index=false/);
  assert.match(release, /\[\[ "\$promoted_digest" == "\$SOURCE_DIGEST" \]\]/);

  const localManifestCheck = localRelease.indexOf(
    "await verifyCandidateManifest(ciRunID, tag, revision)",
  );
  const localTagPush = localRelease.indexOf(
    'run(["git", "push", "origin", tag]',
  );
  assert.ok(localManifestCheck >= 0 && localManifestCheck < localTagPush);
  assert.match(
    localRelease,
    /expectedVersion: version,[\s\S]*expectedRevision: revision/,
  );
});

test("deployment proof requires the public stable version and exact revision", () => {
  assert.match(
    release,
    /"\$revision" == "\$GITHUB_SHA" && "\$version" == "\$GITHUB_REF_NAME"/,
  );
  assert.doesNotMatch(
    release,
    /\[\[ "\$revision" == "\$GITHUB_SHA" \]\] && exit 0/,
  );
  assert.match(
    localRelease,
    /info\.version === version && info\.revision === revision/,
  );
});
