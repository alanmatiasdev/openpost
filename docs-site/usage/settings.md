# Settings

OpenPost groups settings by who or what they affect.

## Workspace

Workspace settings belong to the selected workspace.

- Connected social accounts
- Workspace timezone and week start
- Media cleanup policy
- Posting schedule and default slot behavior
- Natural posting delay
- Native auto repost rules, engagement gates, and account access grants
- Brand colors, marks, text styles, and custom WOFF2, TTF, or OTF fonts

Use this tab when the setting should differ between brands, clients, or projects.

## Account

Account settings follow your user login across every workspace.

- Display name and profile picture
- Password, two-factor authentication, and passkeys
- Linked Google and organization sign-in identities
- Active browser sessions
- CLI devices and API tokens
- MCP and ChatGPT App tokens/activity

Use an `mcp:read` token limited to one workspace when an AI tool only needs to read OpenPost. Use `mcp:full` only when it must create or change drafts and account versions, upload media, schedule, publish, cancel, reply, or moderate. You can remove either token. Check recent activity and remove access when the tool no longer needs it.

Use this tab when the setting is about you, not a workspace.

OpenPost keeps account linking explicit. If a Google or organization account
uses the same email as an existing OpenPost user, sign in with the existing
method first. Open **Settings → Account → Security**, confirm your current
method, and link the external account there. You can then use either method to
sign in. OpenPost blocks unlinking the last usable sign-in method.

## Organization

Organization settings group collaboration and hosted billing.

- Workspace team members and pending invitations
- Seat usage
- Managed app plan, usage, checkout, and billing links
- OIDC identity providers, verified domains, SSO enforcement, provider assurance, and machine-token policy

Invite people from **Settings -> Organization**. Pending invitations reserve seats until they are accepted, revoked, or expired.

The **Single sign-on** tab is available for organization administration. Add an
exact OIDC issuer, copy the callback and back-channel logout URLs into the
provider, then test optional login before requiring SSO. Required mode checks
workspace access, password recovery, and API, CLI, and MCP credentials. Keep an
MFA-protected local instance administrator in
`OPENPOST_SSO_BREAK_GLASS_EMAILS` before enforcing SSO.

## Instance

Instance settings are available only to instance administrators.

- **Overview** shows account growth, publishing activity, and the running release.
- **Configuration** manages optional account policy, authentication, email delivery, OpenPost Image Editor, feedback, provider behavior, and OAuth provider applications.
- **Users** shows instance-wide account, plan, access, and activity details.

The Configuration screen identifies whether each value comes from the environment, an encrypted admin override, or the application default. Instance administrators can replace an allowlisted environment-backed value. Before and after saving, the screen names the environment source and clearly labels that the admin value will override or is overriding it. Removing the admin override restores the environment value or default after a server restart. Database, encryption, network, and storage settings remain deployment-only because OpenPost needs them before this screen can load.

Self-hosted users need provider apps when they bring their own OAuth keys. Provider apps keep environment-first precedence and remain read-only when defined by the deployment. Mastodon is a common case because each server can need its own app. See [Environment Variables](/configuration/environment-variables), [Platform Overview](/providers/overview), and [Mastodon](/providers/mastodon).
