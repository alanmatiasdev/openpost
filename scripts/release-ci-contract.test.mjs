import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const dockerfile = readFileSync("docker/Dockerfile", "utf8");
const imageEvidence = readFileSync("scripts/image-evidence.mjs", "utf8");
const localRelease = readFileSync("scripts/release.mjs", "utf8");
const smoke = readFileSync("scripts/smoke-production-image.sh", "utf8");

test("only the candidate image job can write packages", () => {
  const jobsStart = ci.indexOf("\njobs:\n");
  const imageStart = ci.indexOf("\n  image:\n", jobsStart);
  const nextJob = ci.indexOf("\n  release-candidate:\n", imageStart);

  assert.ok(jobsStart > 0 && imageStart > jobsStart && nextJob > imageStart);
  assert.doesNotMatch(ci.slice(0, jobsStart), /packages:\s*write/);
  assert.match(
    ci.slice(imageStart, nextJob),
    /permissions:\n\s+contents: read\n\s+packages: write/,
  );
  assert.equal(ci.match(/packages:\s*write/g)?.length, 1);
  assert.match(release, /\npermissions: \{\}\n\njobs:\n/);
});

test("candidate CI embeds one stable version and exact-revision manifest", () => {
  assert.match(
    ci,
    /release-manifest\.mjs create[\s\S]*--changelog CHANGELOG\.md[\s\S]*--latest-tag[\s\S]*--revision "\$GITHUB_SHA"/,
  );
  assert.match(ci, /image:[\s\S]*fetch-depth: 0[\s\S]*--latest-tag/);
  assert.match(
    ci,
    /name: release-manifest-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
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
  assert.match(
    ci,
    /name: frontend-public-\$\{\{ github\.sha \}\}-\$\{\{ github\.run_attempt \}\}/,
  );
  assert.match(
    release,
    /ci_run_attempt:[\s\S]*release-manifest-\$\{GITHUB_SHA\}-\$\{CI_RUN_ATTEMPT\}/,
  );
  assert.match(
    release,
    /frontend-public-\$\{GITHUB_SHA\}-\$\{CI_RUN_ATTEMPT\}/,
  );
  assert.match(
    localRelease,
    /release-manifest-\$\{revision\}-\$\{ciRun\.attempt\}/,
  );
  assert.doesNotMatch(ci, /overwrite: true/);
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
    /image="\$\{repository\}@\$\{digest\}"[\s\S]*docker pull "\$image"/,
  );
  assert.match(ci, /openpost-image-evidence\.json/);
  assert.match(
    imageEvidence,
    /release_manifest_sha256[\s\S]*sbom_sha256[\s\S]*vulnerability_report_sha256/,
  );
  assert.match(ci, /image-evidence\.mjs create/);
  assert.match(release, /image-evidence\.mjs verify/);
  assert.match(
    release,
    /verified_digest[\s\S]*"\$verified_digest" == "\$CANDIDATE_DIGEST"/,
  );
  assert.match(
    release,
    /source_image="\$\{REGISTRY\}\/\$\{IMAGE_NAME\}@\$\{SOURCE_DIGEST\}"/,
  );
  assert.match(release, /--prefer-index=false/);
  assert.match(release, /\[\[ "\$promoted_digest" == "\$SOURCE_DIGEST" \]\]/);

  const localManifestCheck = localRelease.indexOf(
    "await verifyCandidateManifest(ciRun, tag, revision)",
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

test("deployment proof requires readiness, the public stable version, and exact revision", () => {
  assert.match(
    release,
    /"\$revision" == "\$GITHUB_SHA" && "\$version" == "\$GITHUB_REF_NAME" && "\$readiness" == ready && "\$database" == ok/,
  );
  assert.match(release, /\/api\/v1\/ready/);
  assert.match(release, /deploy-production:[\s\S]*timeout-minutes: 10/);
  assert.match(
    release,
    /curl --fail --silent --connect-timeout 2 --max-time 5 https:\/\/app\.openpost\.social\/api\/v1\/ready/,
  );
  assert.match(smoke, /--connect-timeout 1 --max-time 2/);
  assert.doesNotMatch(
    release,
    /\[\[ "\$revision" == "\$GITHUB_SHA" \]\] && exit 0/,
  );
  assert.match(
    localRelease,
    /info\.version === version && info\.revision === revision/,
  );
});
