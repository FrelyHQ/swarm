# Frely Swarm Vision Runtime

This repository is a public local-development snapshot of the Swarm
`vision-basic` virtual-model runtime. It is not the private commercial runtime
or a production deployment package.

## Request boundary

```text
Caller
  -> local Frely Agent-model AccessPoint `vision-basic`
  -> local Swarm `POST /v1/responses`
  -> local Frely base-model AccessPoint `dev-base`
  -> Frely-managed development Provider
  <- Agent result and aggregate usage
```

Frely owns both model-access entries, Provider credentials, pricing and
development billing. Swarm receives a separately restricted Frely API key and
accepts only supported local Frely host forms for model calls. It receives no
final Provider credential. End callers use Frely; only Frely's admitted
Provider dispatch and health/readiness probes address Swarm directly.

## Compose development

Requirements:

- Docker with Compose;
- sibling Relay and Swarm checkouts;
- a prepared Frely local-development state directory.

Prepare and start Frely first:

```sh
cd ../relay
bun run dev:prepare
bun run dev:up
bun run dev:configure-base
```

Then start the source-mounted Swarm runtime:

```sh
cd ../swarm
cp .env.example .env
docker compose -f compose.yaml -f compose.dev.yaml up --build --wait
```

The development overlay runs `bun --watch src/server.ts`. Editing a file under
`src/` reloads the container process without rebuilding the image.

Finish the Agent-model route and run the closed-loop check from Frely:

```sh
cd ../relay
bun run dev:configure-agent
bun run dev:smoke
```

Both Compose projects join the external `frely-dev` network created by
`dev:prepare`. Host ports remain bound to loopback.

## Direct Bun development

Direct execution is useful for focused Swarm work, but its model target must
still be a local Frely entry:

```sh
bun install --frozen-lockfile
export FRELY_BASE_URL='http://127.0.0.1:43000/v1'
export FRELY_API_KEY='a-local-frely-agent-key'
export FRELY_MODEL='dev-base'
export SWARM_ACCESS_TOKEN='a-separate-local-service-token'
bun run dev
```

## HTTP API

- `GET /health` and `GET /healthz`: unauthenticated liveness.
- `GET /readyz`: loaded runtime configuration and public model ID.
- `GET /v1/models`: authenticated catalog containing only `vision-basic`.
- `POST /v1/responses`: authenticated, non-streaming Vision request.
- `POST /v1/chat/completions`: authenticated compatibility adapter used by
  Relay's CPA transport; it is not an additional model or credential boundary.

All `/v1` routes require the Swarm service token. A Vision request must
contain at least one `input_image`; Swarm forces `stream: false` and
`store: false` on its Frely base-model request.

## Configuration

| Variable | Purpose | Development value |
| --- | --- | --- |
| `FRELY_BASE_URL` | Frely `/v1` base used for Agent model calls. | `http://gateway-srv:43000/v1` |
| `FRELY_API_KEY_FILE` | Restricted Frely key mounted into Compose. | `/run/secrets/frely_api_key` |
| `FRELY_API_KEY` | Direct-Bun fallback for the same restricted key. | Local secret only |
| `FRELY_MODEL` | Base-model AccessPoint exposed by Frely. | `dev-base` |
| `SWARM_PUBLIC_MODEL` | Virtual-model ID exposed to Frely. | `vision-basic` |
| `SWARM_ACCESS_TOKEN_FILE` | Frely-to-Swarm service credential. | `/run/secrets/swarm_access_token` |
| `SWARM_ACCESS_TOKEN` | Direct-Bun fallback for the service credential. | Local secret only |
| `FRELY_TIMEOUT_MS` | Frely request timeout, 250 ms to 10 minutes. | `120000` |
| `FRELY_DEV_NETWORK` | Shared Compose network. | `frely-dev` |

`FRELY_API_KEY` and `SWARM_ACCESS_TOKEN` are different credentials. Neither is
a final Provider credential. `FRELY_BASE_URL` accepts only the local Frely
service alias, loopback, or `host.docker.internal`, and requires the `/v1`
path. Generic `MODEL_*` variables are rejected rather than silently ignored.

## Verification

```sh
bun install --frozen-lockfile
bun run verify
FRELY_API_KEY_SECRET_FILE=/dev/null \
SWARM_ACCESS_TOKEN_SECRET_FILE=/dev/null \
  docker compose -f compose.yaml -f compose.dev.yaml config --quiet
```

The repository smoke test uses a local Frely-shaped stub and proves only the
Swarm component contract. `bun run dev:smoke` in the Frely snapshot owns the
cross-repository closed-loop evidence.

## License

First-party files are provided under the Apache License 2.0. See
[`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
