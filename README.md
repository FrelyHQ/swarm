# Frely Snap

Frely Snap is a small local HTTP adapter for debugging Web3 applications with
Frely and Frely Swarm. It gives a developer project one stable, bounded debug
endpoint without embedding either upstream runtime in this repository.

## Request path

```text
Web3 project
    │
    ▼
Snap (local debug adapter)
    │  authenticated POST /v1/responses
    ▼
Frely Gateway
    │  configured upstream routing
    ▼
Frely Swarm
```

Snap sends debug requests only to the configured Frely Gateway. The configured
Swarm URL is a readiness probe for a local complete environment; it is not used
to send a second debug request or to bypass the Gateway.

## Quick start

1. Start a Frely Gateway and a Frely Swarm instance in a development
   environment. They are external dependencies and are intentionally not
   defined by this repository.
2. Create local secret files. Keep them outside Git:

   ```sh
   mkdir -p secrets
   printf '%s' 'replace-with-your-development-gateway-key' > secrets/gateway_api_key
   ```

   If the Swarm probe requires authentication, create a separate probe-key
   file and use the optional `compose.swarm-auth.yaml` override described
   below.
3. Configure the adapter:

   ```sh
   cp .env.example .env
   # Edit FRELY_GATEWAY_URL, SNAP_SWARM_URL, and SNAP_MODEL.
   ```
4. Start Snap:

   ```sh
   docker compose up --build
   ```

   The local endpoint is published at `http://127.0.0.1:8787`.
5. Check the complete development path:

   ```sh
   curl --fail http://127.0.0.1:8787/healthz
   curl --fail http://127.0.0.1:8787/readyz
   ```

### Sibling containers on one Docker network

When Frely and Frely Swarm run as separate local containers, create a shared
external network and attach all three containers to it. The optional Compose
override supplies convenient service-name defaults:

```sh
docker network create frely-local
# Attach the existing Frely and Frely Swarm containers to frely-local.
docker network connect frely-local <frely-gateway-container>
docker network connect frely-local <frely-swarm-container>

# Use service aliases visible on that network.
FRELY_GATEWAY_URL=http://gateway-srv:43000 \
SNAP_SWARM_URL=http://frely-swarm:4111 \
docker compose -f compose.yaml -f compose.local.yaml up --build
```

The sibling services remain owned by their own projects. Snap does not build,
configure, or publish their images, databases, or internal ports. If the local
Swarm probe needs a key, add its file explicitly:

```sh
printf '%s' 'replace-with-your-local-probe-key' > secrets/swarm_probe_key
docker compose -f compose.yaml -f compose.local.yaml -f compose.swarm-auth.yaml up --build
```

The base Compose file has no Swarm secret mount, so hosted mode does not
require a local probe-key file.

### Hosted Frely

If Frely routes to a privately managed Swarm instance, Snap can use only the
hosted Gateway URL and skip the direct probe:

```dotenv
FRELY_GATEWAY_URL=https://gateway.example.test
SNAP_REQUIRE_SWARM=false
```

Use HTTPS for hosted URLs. The local default requires a configured Swarm probe
so a developer can detect an incomplete debug environment before sending a
request.

## API

### `GET /healthz`

A liveness check. It does not contact either upstream service.

```json
{"status":"ok"}
```

### `GET /readyz`

Checks the configured Frely Gateway and, when `SNAP_REQUIRE_SWARM=true`, the
configured Swarm probe URL. It returns no URL, response body, header, or secret.

```json
{"status":"ready"}
```

The status is `503` with `{"status":"not_ready"}` when a required dependency
is unavailable.

### `POST /v1/debug`

Submit a bounded, developer-supplied debugging report:

```json
{
  "project": {
    "id": "checkout-demo",
    "chain": "ethereum",
    "network": "sepolia"
  },
  "problem": {
    "title": "Transaction simulation failed",
    "description": "The UI shows a generic failure after the user submits."
  },
  "context": {
    "step": "simulation",
    "component": "checkout",
    "transactionHash": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "function": "swap"
  },
  "question": "What should I inspect first?"
}
```

Snap validates the structure, bounds nested JSON, rejects common sensitive
fields and value shapes, and sends a non-streaming request to the configured
Frely model. The response contains only a local correlation ID and the returned
text:

```json
{
  "request_id": "req_example",
  "result": "Inspect the simulation error and contract state first."
}
```

The request cannot select a model, upstream URL, RPC endpoint, file, command,
or container. Change `SNAP_MODEL` in local configuration when a different
model is needed.

## Configuration

| Variable | Purpose |
| --- | --- |
| `FRELY_GATEWAY_URL` | Frely root URL or `/v1` API base. |
| `GATEWAY_API_KEY_FILE` | Secret path used by a direct local run. Compose mounts the configured host file at this path. |
| `GATEWAY_API_KEY` | Non-Compose local fallback; do not use in committed files. |
| `SNAP_SWARM_URL` | URL used only by the Swarm readiness probe. |
| `SWARM_PROBE_KEY_FILE` | Optional Swarm probe secret path; the auth Compose override mounts it. |
| `SWARM_PROBE_KEY` | Non-Compose local probe-key fallback. |
| `SNAP_REQUIRE_SWARM` | Require the Swarm probe; defaults to `true`. |
| `SNAP_ALLOW_INSECURE_HTTP` | Permit an explicitly chosen non-local HTTP upstream; defaults to `false`. Known local hosts are allowed for development. |
| `SNAP_MODEL` | Model selected by the local adapter configuration. |
| `GATEWAY_HOST` | Optional local Host header for a Gateway with host admission. |
| `SNAP_PORT` | Host-published Compose port; defaults to `8787`. |
| `SNAP_TIMEOUT_MS` | Bounded upstream timeout; defaults to `30000`. |

For direct local development without Compose, set `SNAP_HOST`, `PORT`, the
Gateway key file or fallback, both upstream URLs, and `SNAP_MODEL` before
running `bun run dev`. The application also understands the Compose host-path
aliases `SNAP_GATEWAY_SECRET_FILE` and `SNAP_SWARM_SECRET_FILE` for this mode.
Remote HTTP URLs are rejected unless `SNAP_ALLOW_INSECURE_HTTP=true` is set
explicitly.

## Safety boundary

- Snap is stateless and does not persist reports or upstream responses.
- Request and response bodies are not logged.
- Keys are read from secret files whenever possible and are never returned.
- The container is read-only, has finite CPU, memory, and PID limits, drops
  capabilities, and publishes only on loopback.
- Upstream URLs come from startup configuration; a request cannot choose one.
- The component has no wallet, signer, chain-write, RPC-proxy, file, shell,
  browser, or Docker-socket capability.
- Do not send private keys, seed phrases, bearer credentials, cookies,
  passwords, signatures, signed transactions, or database credentials in a
  debugging report. Use a transaction hash and other non-secret references.

## Development and verification

```sh
bun install --frozen-lockfile
bun run verify
```

`verify` runs the public-boundary scan, TypeScript checks, focused tests, a
production bundle build, and a local fake-upstream smoke test. After creating
the local Gateway secret file, validate the base Compose model with:

```sh
docker compose config
```

The checked-in Compose file also declares finite CPU, memory, PID, restart, log,
filesystem, capability, and loopback-publishing limits for the long-running
adapter. The optional Swarm-auth and local-network overrides are explicit
operator choices.

## License

First-party files are provided under the Apache License 2.0. See
[`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
