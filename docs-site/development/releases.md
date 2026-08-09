# Releases and Versioning

OpenPost follows [Semantic Versioning 2.0.0](https://semver.org/) and derives the normal release bump from [Conventional Commits](https://www.conventionalcommits.org/).

| Commit impact                          | Version change | Example                |
| -------------------------------------- | -------------- | ---------------------- |
| Backward-compatible fix or maintenance | Patch          | `v1.27.9` → `v1.27.10` |
| Backward-compatible feature            | Minor          | `v1.27.9` → `v1.28.0`  |
| Breaking API or product change         | Major          | `v1.27.9` → `v2.0.0`   |

`feat:` selects a minor release. A `!` after the commit type or a `BREAKING CHANGE:` footer selects a major release. When neither appears, a release advances the patch version.

## Production release

Run the release from an audited, up-to-date `main` worktree. Uncommitted work is allowed when the command includes its Conventional Commit message:

```bash
bun run release:plan
bun run release:preflight
bun run release:prod "fix: describe the shipped change"
```

`release:plan` inventories the changed application, marketing, documentation, and delivery surfaces before anything is written. `release:preflight` is the fast check for disk space, Docker responsiveness and memory, GitHub access, required workflows and deployment configuration, and current production readiness. When host space is below the release threshold and Docker still responds, preflight removes only unused BuildKit cache before failing. `release:prod` repeats those checks, then promotes `CHANGELOG.md`, runs the canonical Devenv gate, race and security checks, isolated browser suites, and a production-image restart smoke test locally before committing and pushing `main`. A failed local check restores the original changelog. A successful exact-worktree check can be reused for 24 hours; set `OPENPOST_FORCE_RELEASE_CHECK=1` to force a rerun. The command waits for the parallel hosted CI matrix on the exact pushed revision before creating a tag.

The production-image check enforces a 20 GB budget for unused local BuildKit cache and targets at least 20 GB of host free space. Inspect or enforce those limits directly with `devenv shell -- docker-cache-status` and `devenv shell -- docker-cache-prune`. Set `OPENPOST_DOCKER_CACHE_MAX_STORAGE` or `OPENPOST_DOCKER_MIN_FREE_SPACE` to change them. The prune command does not delete images, containers, or volumes.

On a 16 GiB Mac, configure Docker Desktop with 10 GB memory and 4 GB swap. The production frontend build has been verified with that allocation and can be killed by the VM with Docker's 8 GB memory and 1 GB swap allocation. Preflight rejects a macOS Docker VM below 9.5 GiB; `OPENPOST_DOCKER_MIN_MEMORY_GIB` is available only for a host-specific, proven override.

At the candidate boundary, CI derives a versioned release manifest from the prepared `CHANGELOG.md` release section and the exact Git SHA. The manifest contains the stable SemVer and full revision. CI embeds that same manifest in the image, stamps both OCI labels and server build values from it, and verifies the labels, embedded file, and `/api/v1/version` response while restart-smoking the image against a clean database.

CI publishes the verified image once as immutable `sha-<revision>`. The tag workflow downloads the manifest from the exact successful CI run, requires its version to match the tag and its revision to match the tagged SHA, verifies the image again, and promotes the verified digest to the release tag and `latest` without rebuilding. The signed deployment hook receives that digest, validates the candidate against production configuration and mounted secrets, and automatically restores the previous image if readiness fails. Hosted verification then requires `/api/v1/version` to report both the release tag and exact revision.

Use `bun run release:prepare "<commit>"` when you want to stop after the exact SHA has passed local and hosted checks. Finish later with `bun run release:promote <tag>`. `bun run release:status` compares the local SHA, candidate CI run, and public production revision.

`CHANGELOG.md` is the release-history source of truth. Add notable work to `Unreleased` while implementing it. Do not edit the public marketing changelog or GitHub release notes separately; both are generated from the canonical file. `bun run check:changelog` validates the structure before release.

Use `RELEASE_BUMP=minor|major` only to raise the inferred impact for an intentional release boundary. `RELEASE_VERSION=vX.Y.Z` is reserved for an explicit version-line correction or migration. Overrides cannot lower the version required by the commit history.

## Version-line correction

Historical OpenPost tags advanced the patch component for most releases and later reset to `v1.1.0`, even when the releases contained backward-compatible features. The reconstruction classified the Conventional Commit subjects in each `previous tag..tag` cohort, then applied the highest impact in that cohort. Replaying the published releases from the first stable line gives 27 feature-bearing release cohorts and seven patch-only releases after the last feature cohort, with no published breaking change.

The code shipped as `v1.1.22` therefore maps to `v1.27.7`. The versioning and documentation correction was the next patch-only change, `v1.27.8`, but that tag failed preflight before GitHub release creation or deployment. Following the immutable-tag failure policy, `v1.27.9` fixes the clean-checkout check and becomes the first published release on the corrected line. Future releases continue from there using the rules above.

## Failure policy

Never move or reuse a published tag. If a tag workflow fails, fix the cause and release a new SemVer version. A release is complete only after the workflow succeeds, the GitHub release exists, `/api/v1/ready` succeeds, and `/api/v1/version` reports the stable tag and exact tagged source revision.
