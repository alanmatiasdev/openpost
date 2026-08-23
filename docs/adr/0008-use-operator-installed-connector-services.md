# ADR 0008: Use operator-installed connector services

## Status

Accepted

## Context

Self-hosted OpenPost operators need to deliver Publications to internal systems and providers that OpenPost does not compile into its release. Some destinations expose an HTTP API. Others may need browser automation. Loading operator code into the OpenPost process would give that code access to the database, encryption keys, media storage, and every Workspace. It would also bind connector dependencies and crashes to the OpenPost release.

The existing provider adapter combines authorization, credential refresh, profile lookup, media upload, and publishing in one interface. A custom text destination should not implement methods that it cannot support. Provider discovery, connection, capabilities, and presentation also use separate built-in catalogues today.

## Decision

OpenPost will support custom destinations through Connector Protocol v1. A connector is an operator-installed process that OpenPost calls over authenticated HTTP or one configured Unix socket. OpenPost will not load connector code into its process.

OpenPost owns Publications, Renditions, schedules, Jobs, quotas, authorization receipts, media access, write fencing, retries, and the user-visible outcome. The connector owns destination credentials, destination calls, and a durable operation journal that prevents duplicate external writes.

Connector Protocol v1 uses JSON and these routes:

- `GET /v1/manifest`
- `GET /v1/health`
- `POST /v1/connections`
- `POST /v1/capabilities/resolve`
- `POST /v1/publishes`
- `GET /v1/operations/{operation_id}`

The first release supports operator-preconfigured connections and text publishing. A connector manifest declares one stable opaque provider ID, display metadata, a capability revision, connection modes, output profiles, content limits, settings, media limits, and polling support. OpenPost validates and caches sanitized manifest data. It never renders connector HTML, JavaScript, Svelte, or raw SVG.

OpenPost derives one deterministic operation ID for each rendition segment and publish phase. The connector must journal that ID before its first external write. A publish response is `published`, `pending`, or `failed`. A transport failure after a possible write becomes `unknown` inside OpenPost's provider-write fence and can only advance through operation polling or a connector guarantee that makes retry safe.

`OPENPOST_CONNECTORS_FILE` points to a read-only JSON file. Each installation has an installation ID, an endpoint policy, Workspace allowlist, required or optional state, and secret-file references. The file cannot contain inline secrets. Workspace or publication input never controls a connector base URL.

Connector transport supports:

- public HTTPS endpoints whose DNS results remain public at dial time;
- exact operator-owned private hosts, CIDRs, and ports named in the installation;
- one absolute Unix socket path named in the installation.

The client disables environment proxies and credential-bearing redirects, caps response bodies, applies request deadlines, and redacts authorization values and bodies from logs. Optional invalid connectors stay quarantined. A required invalid connector makes readiness fail.

Provider identity, connector installation identity, and connected account identity remain separate. Removing an installation blocks new work but preserves accounts, Publications, Renditions, and delivery history.

The repository will include a Directus reference connector. It maps text delivery to `POST /items/{collection}` and uses a unique OpenPost operation ID field plus its own durable journal for reconciliation. It stores Directus credentials only in the connector process.

## Rejected options

- Go plugins loaded with `plugin.Open` tie custom code to the exact Go toolchain and run it with full process access.
- Mounted executables or scripts have the same trust problem and add an unbounded runtime contract.
- Running Playwright in the OpenPost image gives browser sessions broad access and increases the core image and failure scope.
- Allowing arbitrary Workspace-configured URLs creates an SSRF path and crosses operator and Workspace authority.
- Treating custom connectors as built-in OAuth adapters forces unsupported methods and keeps provider facts split across static catalogues.

## Compatibility and rollout

Built-in providers keep their current IDs and behavior. The provider registry will wrap them while connector-backed providers use optional publishing and connection capabilities. Existing accounts receive built-in installation identities through a forward migration without changing their visible IDs.

Connector Protocol v1 accepts only major version `1`. Unknown required fields, controls, operations, connection modes, and output-profile types fail closed. Additive optional fields remain compatible. Scheduled Renditions retain the capability revision they were validated against and must revalidate before delivery when that revision changes.

Operators can roll back by removing `OPENPOST_CONNECTORS_FILE` and restarting OpenPost. Connector-backed accounts and history remain stored but unavailable for new delivery. The rollback does not delete destination items or connector journals.

## Initial acceptance criteria

- A clean SQLite and PostgreSQL schema stores installations and account bindings without colliding with built-in accounts.
- OpenPost discovers a valid optional connector, quarantines an invalid optional connector, and fails readiness for an invalid required connector.
- A Workspace member with edit access can connect one preconfigured connector account through OpenPost without receiving connector credentials.
- The composer receives the connector's text capability and setting definitions through authenticated Workspace-scoped endpoints.
- A scheduled text Rendition reaches a fixture connector after restart and records its external ID.
- A timeout after the external write does not create a duplicate when OpenPost retries or polls.
- Disabling or removing the connector preserves the account and Rendition history and blocks only new work.
- The Directus reference connector passes the shared conformance suite and an end-to-end item creation test.

## Deferred work

Browser automation, redirect and form connection modes, media upload, threads, analytics, engagement, messaging, deletion, hot reload, executable transports, WASI, and hosted-tenant connector installation require later protocol extensions or separate decisions.
