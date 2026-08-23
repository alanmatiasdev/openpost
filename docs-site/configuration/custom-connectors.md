---
description: Add operator-run publishing destinations to a self-hosted OpenPost instance.
---

# Custom Connectors

Custom connectors let a self-hosted operator add an HTTP/JSON publishing destination without loading third-party code into OpenPost. A connector runs as a separate service. OpenPost keeps the publication, rendition, validation, queue, write fence, and result history. The connector owns destination credentials and the final API call.

Protocol 1.0 supports preconfigured, text-only destinations. It does not support browser automation, arbitrary connector UI, connector-supplied code, or media uploads.

## Install a connector

1. Run a service that implements OpenPost Connector Protocol 1.0.
2. Give OpenPost and the connector the same connector bearer token through a secret file.
3. Create a connector registry JSON file on the OpenPost host.
4. Set `OPENPOST_CONNECTORS_FILE` to the absolute registry path.
5. Restart OpenPost and check the startup log for the installation status.
6. In **Social accounts**, connect the custom connector to a Workspace.

OpenPost reads connector endpoints only from the operator file. Workspace members cannot supply or change a connector URL.

```json
{
  "version": 1,
  "installations": [
    {
      "id": "directus-main",
      "required": false,
      "workspace_allowlist": ["workspace-id"],
      "endpoint": {
        "mode": "private_allowlist",
        "base_url": "http://directus-connector:8787",
        "allowed_hosts": ["directus-connector"],
        "allowed_cidrs": ["172.16.0.0/12"],
        "allowed_ports": [8787]
      },
      "auth": {
        "bearer_token_file": "/run/secrets/openpost-connector-token"
      }
    }
  ]
}
```

An empty `workspace_allowlist` exposes the installation to every Workspace on the instance. List exact Workspace IDs when only some teams should see it.

## Transport modes

- `public_https` accepts only a public HTTPS endpoint and blocks private, loopback, link-local, and reserved addresses.
- `private_allowlist` requires exact hosts, network ranges, and ports. OpenPost checks DNS results again when it connects.
- `unix_socket` connects through an absolute local socket path.

OpenPost blocks redirects and proxy environment variables for connector calls, caps responses at 1 MiB, and never stores the connector bearer token in its database.

Set `required` to `true` only when OpenPost must refuse startup if the connector is invalid or unavailable. An optional failed connector is quarantined. Existing accounts and publication history stay stored if an installation is later removed, but new connections and publishes stop.

## Directus example

The repository includes a runnable [Directus connector example](https://github.com/getopenpost/openpost/tree/main/examples/connectors/directus). It maps a rendition to `POST /items/{collection}` and uses a unique `openpost_operation_id` field to prevent duplicate items after timeouts or retries.

The connector README lists the Directus fields, secret files, environment variables, container build, and sample registry file.

## Protocol routes

Every connector exposes these authenticated routes:

- `GET /v1/manifest`
- `GET /v1/health`
- `POST /v1/connections`
- `POST /v1/capabilities/resolve`
- `POST /v1/publishes`
- `GET /v1/operations/{operation_id}`

The manifest uses a stable provider ID and capability revision. A connector cannot claim a built-in provider ID. If the capability revision changes, OpenPost blocks an old account binding until the operator reconnects it.
