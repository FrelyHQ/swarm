# Frely Snap

Frely Snap (Frely Swarm Debug Integration for Web3 application development) is a small local HTTP adapter. It gives a Web3 project one bounded debug endpoint while keeping upstream access, input checks, and readiness behavior in one place.

## Architecture

```text
Web3 project -> local Snap HTTP adapter -> Frely Gateway -> Frely Swarm
```

Snap sends normal debug requests only to the configured Frely Gateway. A configured Swarm URL is used only for a readiness probe; Snap does not call Swarm for a debug request.

## Quick start with Compose

Create local secret files and keep them outside version control:

```sh
mkdir -p secrets
printf '%s' 'your-local-gateway-key' > secrets/gateway_api_key
: > secrets/swarm_probe_key
cp .env.example .env
bun install --frozen-lockfile
bun run verify
# The gateway and Swarm services are external to this repository.
docker compose up --build
```

The adapter listens on `127.0.0.1:8787`. `compose.local.yaml` can attach it to an explicitly created external network:

```sh
docker network create frely-local
docker compose -f compose.yaml -f compose.local.yaml up --build
```

The sibling gateway and Swarm services are not defined or started by this repository. For hosted deployments, set `SNAP_REQUIRE_SWARM=false` when Frely manages the upstream privately. HTTPS is recommended for hosted URLs.

## API

`GET /healthz` is a liveness check and makes no upstream request. `GET /readyz` checks the gateway and, when required, the configured Swarm probe. It returns only `{"status":"ready"}` or `{"status":"not_ready"}`.

`POST /v1/debug` accepts one JSON object:

```json
{
  "project": { "id": "my-app", "chain": "ethereum", "network": "sepolia" },
  "problem": { "title": "Transaction simulation failed", "description": "The UI shows a generic failure after submit." },
  "context": { "step": "simulation", "component": "checkout" },
  "question": "What should I inspect first?"
}
```

The response is limited to `{ "request_id": "...", "result": "..." }`. The request cannot select a model, upstream URL, RPC endpoint, file, command, or container. Input and context are bounded and sensitive-shaped fields are rejected.

## Configuration

- `FRELY_GATEWAY_URL`: gateway root or `/v1` URL; HTTP and HTTPS are supported, with HTTPS recommended outside local development.
- `GATEWAY_API_KEY_FILE`: secret file path. The non-compose `GATEWAY_API_KEY` fallback is intended for local tests only.
- `SNAP_SWARM_URL`: readiness probe URL. Required by default.
- `SNAP_REQUIRE_SWARM`: set to `false` for hosted mode when Swarm is managed privately.
- `SWARM_PROBE_KEY_FILE`: optional probe key file.
- `SNAP_MODEL`: configured gateway model name.
- `GATEWAY_HOST`: optional Host header for local gateway admission.
- `PORT` and `SNAP_TIMEOUT_MS`: bounded listener and upstream timeout settings.

## Security

Do not send private keys, seed phrases, bearer credentials, cookies, passwords, signatures, signed transactions, or database credentials. Keep API keys in secret files with restrictive permissions. Do not expose the local port publicly, and use HTTPS for hosted upstreams. Snap does not log request or response bodies, credentials, or upstream error details.

Report security issues privately using the process in [SECURITY.md](SECURITY.md).

## Non-goals

Snap is not a general agent runtime, model SDK, wallet or chain SDK, database, administration surface, provider manager, or hosted deployment platform. It is not a replacement for the Frely Gateway or Swarm services.

## Verification

```sh
bun run typecheck
bun test
bun run build
bun run smoke
bun run verify:boundary
```

Docker Compose configuration can be checked with local secret files and non-production dummy values:

```sh
docker compose config
```
