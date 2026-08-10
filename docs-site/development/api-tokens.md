# API Tokens

OpenPost API tokens are account credentials for the REST API, MCP clients, the CLI, and automation. Create one token per client in **Settings → Developer access**, give it the narrowest scope and workspace boundary that works, and revoke it when that client no longer needs access.

## Create and store a token

1. Enter a name that identifies the client or job.
2. Choose a scope and, when possible, one workspace.
3. Choose 30 days, 90 days, one year, or a custom expiration date. The server rejects dates in the past or more than one year away.
4. Create the token and copy the full secret from the one-time result.

The full secret is never stored in plaintext and cannot be shown again. OpenPost lists only a short prefix, scope, workspace boundary, creation time, last use, expiration, and active, expired, or revoked status. If the secret is lost, revoke it and create a replacement.

An omitted or JSON `null` `expires_at` uses the finite 90-day default. Existing tokens created under older versions may have no expiration; the settings list labels those explicitly. New tokens cannot request an unlimited lifetime.

## REST scopes

Use an `Authorization: Bearer <token>` header. REST scopes are operation allowlists, not route-prefix guesses. Unknown operations and legacy Echo routes fail closed.

`api:read` permits the documented read operations for workspaces, workspace settings, publishing accounts and capabilities, social sets, media metadata and usage, publications and events, validation, and posting schedules.

`api:write` includes `api:read` and permits the publication create, edit, rendition, schedule, publish-now, and retry operations; media upload, metadata update, favorite, trash, restore, batch delete, and analysis-retry operations; social-set changes; and posting-schedule changes. It does not grant account administration, billing, identity, token-management, or arbitrary MCP access.

The generated [API Reference](/development/api-reference) is the source for paths and request bodies. A `403` from a valid token means its scope or workspace boundary does not permit that operation.

## MCP and CLI scopes

- `mcp:read` exposes only query operations through MCP.
- `mcp:full` adds MCP operations that change OpenPost or call a social provider. The MCP client still controls its approval prompt.
- `cli:full` preserves the CLI and existing automation contract. It has broad REST access, so bind it to one workspace unless account-wide access is required.

REST scopes cannot call MCP, and MCP scopes cannot be used as generic REST credentials. This separation keeps each credential tied to its real client contract.

## Workspace boundaries

A workspace-bound token can act only on that exact workspace, subject to the user's current role there. Losing workspace membership also removes effective access. An all-workspace token follows the account into workspaces joined later, so reserve it for deliberate account-wide automation.

The browser CLI approval page lets the user choose a workspace or all workspaces. The backend verifies current membership before saving a bound approval. See [CLI authentication](/cli/authentication) for the device flow.

## Rotation and revocation

Create the replacement first, update the client, confirm it works, and then revoke the old token. Revocation is immediate and irreversible. Expired and revoked tokens are rejected before the requested operation runs, and their full secrets never appear in lists, logs, or activity views.
