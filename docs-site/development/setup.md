# Development Setup

OpenPost's root Devenv configuration pins Go, Bun, Node, and the supporting
tools used by the repository. On Hermes, provision Nix, Devenv, direnv, and the
direnv shell hook through the durable host configuration so they return after a
reboot; do not install project tools globally.

## Enter the project environment

```bash
git clone https://github.com/rodrgds/openpost.git
cd openpost
direnv allow
devenv shell -- setup
```

`setup` runs the frozen `install`, then creates local environment state.
`install` runs `bun install --frozen-lockfile` and downloads the backend and
CLI Go modules. Dependency and build caches live under the ignored
`.devenv/state/` directory in the checkout, so a NAS-hosted clone does not
depend on `/tmp` state. It copies `backend/.env.example` only when
`backend/.env` is missing; rerunning it never overwrites local credentials.

The backend reads `backend/.env` with its non-executing dotenv loader. Do not
`source` or `eval` dotenv files, and do not put credentials in Nix expressions.

After direnv loads at the next shell prompt, use the named commands directly.
For a one-off command outside the direnv-managed shell, use the same command
through Devenv, for example:

```bash
devenv shell -- install
devenv shell -- setup
devenv shell -- dev
```

## Commands

```bash
dev       # frontend on :5173 and backend on :8080
docs      # documentation site on :4174
check     # types and generated contracts
lint      # backend and frontend lint
test      # backend and frontend tests
build     # frontend assets and backend binary
verify    # check, lint, test, and build
```

Targeted commands include `backend-run`, `backend-build`, `backend-check`,
`backend-test`, `backend-lint`, `backend-verify`, and matching `frontend-*`
commands. CLI work has `cli-build`, `cli-format-check`, `cli-lint`, and
`cli-test`.

Use `cache-status` and `cache-prune` to inspect and enforce the daily 4 GiB
default cap on the shared Go build cache. Use `docker-cache-status` and
`docker-cache-prune` to inspect Docker storage and bound unused BuildKit cache
without deleting images, containers, or volumes. Production backend builds use
a disposable Go cache; development runs, tests, vulnerability scans, and lint
use the `dev` build tag so embedded frontend assets do not accumulate there.
On a 16 GiB Mac, set Docker Desktop to 10 GB memory and 4 GB swap before local
release-image builds; release preflight rejects a macOS Docker VM below the
verified memory floor.

Entering Devenv installs the tracked fast pre-push lint gate. It does not run
tests or production builds; run `verify` explicitly before a release or a
high-risk push.

In shells where `test` resolves to the shell builtin, run `test-all` inside
direnv or `devenv shell -- test` from outside it.
