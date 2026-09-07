# Frely Swarm Vision Runtime

This repository is a public development snapshot of the Swarm virtual-model
runtime used by the Frely hackathon demo. It is not the private commercial
runtime and is not a production deployment package.

The snapshot exposes one OpenAI Responses-compatible virtual model,
`vision-basic`. Swarm executes the request with the model configured by the
operator; the default backing model is `gpt-5.6-luna`.

## Boundary

```text
Caller
  → Frely Gateway / AccessPoint `vision-basic`
      → authenticated request, routing, demo pricing and billing
  → Swarm `POST /v1/responses`
      → virtual-model execution
  → configured model API (`gpt-5.6-luna` by default)
```

Frely owns the public model entry and billing. Swarm owns virtual-model and
Agent execution. The model API key stays inside Swarm and never enters Frely,
the caller request, a response, or this repository.

During local development, a developer may call Swarm directly with the Swarm
access token. That bypasses Frely routing and billing and therefore is only a
runtime test, not a paid-model demonstration.

Swarm also owns the future MCP surface, but this minimum Vision slice does not
pretend that an MCP server is already implemented. Its runnable interface is
the Responses API described below.

## Quick start

Requirements: Bun 1.4.0 and an OpenAI-compatible model endpoint.

```sh
bun install --frozen-lockfile
export MODEL_API_KEY='your-model-key'
export SWARM_ACCESS_TOKEN='a-separate-local-service-token'
bun run dev
```

`MODEL_BASE_URL` defaults to `https://api.openai.com/v1`, `MODEL_NAME` defaults
to `gpt-5.6-luna`, and the service listens on `127.0.0.1:4111`.

Call the virtual model:

```sh
curl --fail http://127.0.0.1:4111/v1/responses \
  -H "Authorization: Bearer $SWARM_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "vision-basic",
    "input": [{
      "role": "user",
      "content": [
        {"type": "input_text", "text": "Describe this image."},
        {"type": "input_image", "image_url": "https://example.com/image.png"}
      ]
    }]
  }'
```

The service requires at least one `input_image`, forces `stream: false` and
`store: false`, calls the configured backing model, and returns a standard
non-streaming Responses object. The returned `model` remains the requested
virtual-model ID rather than leaking the backing model as a routing contract.

## Frely development routing

The Frely snapshot already supports an `openai-compatible` Provider and an
AccessPoint with pricing. Configure it as follows:

1. Start Swarm and keep both secret values outside Git.
2. In Frely, create an `openai-compatible` Provider whose base URL is this
   service's `/v1` base and whose Provider credential is the
   `SWARM_ACCESS_TOKEN` value.
3. Enable the Provider model `vision-basic`.
4. Create and price an AccessPoint exposed as `vision-basic`, routed to that
   Provider model, and include it in the demo Plan.
5. Call Frely's `POST /v1/responses` with the caller's Frely API key. Frely
   performs admission and billing, then forwards the admitted request to
   Swarm. Do not give Frely `MODEL_API_KEY`.

The Frely public snapshot intentionally omits a complete local database and
deployment reproduction. These steps describe the supported configuration
boundary; they do not claim a production-ready combined stack.

## HTTP API

- `GET /health` and `GET /healthz`: liveness, without upstream calls.
- `GET /readyz`: loaded runtime configuration and public model ID.
- `GET /v1/models`: authenticated catalog containing only `vision-basic`.
- `POST /v1/responses`: authenticated, non-streaming Vision request.

Both `/v1` routes require `Authorization: Bearer <SWARM_ACCESS_TOKEN>`.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `MODEL_BASE_URL` | OpenAI-compatible `/v1` base used only by Swarm. | `https://api.openai.com/v1` |
| `MODEL_API_KEY_FILE` | Preferred file containing the backing-model credential. | none |
| `MODEL_API_KEY` | Direct-run fallback for the backing-model credential. | none |
| `MODEL_NAME` | Backing model selected by Swarm. | `gpt-5.6-luna` |
| `SWARM_PUBLIC_MODEL` | Virtual-model ID advertised to callers and Frely. | `vision-basic` |
| `SWARM_ACCESS_TOKEN_FILE` | Preferred file containing the Frely-to-Swarm token. | none |
| `SWARM_ACCESS_TOKEN` | Direct-run fallback for the Frely-to-Swarm token. | none |
| `MODEL_TIMEOUT_MS` | Upstream timeout, from 250 ms to 10 minutes. | `120000` |
| `SWARM_HOST` | Listen host. | `127.0.0.1` |
| `PORT` | Listen port. | `4111` |
| `SWARM_ALLOW_INSECURE_MODEL_HTTP` | Allow a non-loopback HTTP model endpoint for an explicit dev network. | `false` |

`MODEL_API_KEY` and `SWARM_ACCESS_TOKEN` are different credentials with
different trust boundaries. Compose uses the corresponding `*_FILE` settings.

## Docker

Create two local secret files, then start the hardened development container:

```sh
mkdir -p secrets
printf '%s' 'your-model-key' > secrets/model_api_key
printf '%s' 'a-separate-service-token' > secrets/swarm_access_token
cp .env.example .env
docker compose up --build
```

The port is published only on loopback. The container is read-only, drops all
capabilities, and has finite CPU, memory, PID and log limits.

## Verification

```sh
bun install --frozen-lockfile
bun run verify
docker compose config
```

`verify` runs the public-boundary scan, TypeScript checks, unit tests, a
production bundle build, and an end-to-end smoke test against a fake model
endpoint. No real model credential is used by tests.

## License

First-party files are provided under the Apache License 2.0. See
[`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
