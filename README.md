# Frely Swarm Vision Runtime

This repository is a public development snapshot of the Swarm virtual-model
runtime used by the Frely hackathon demo. It is not the private commercial
runtime and is not a production deployment package.

The snapshot exposes one OpenAI Responses-compatible virtual model,
`vision-basic`. Swarm executes the Agent locally and sends every Agent model
call to a separately authorized base-model entry in the local Frely snapshot.

## Boundary

```text
Caller
  → local Frely Agent-model AccessPoint `vision-basic`
      → authenticated request, routing, demo pricing and billing
  → local Swarm `POST /v1/responses`
      → virtual-model execution
      → local Frely base-model AccessPoint
          → configured development Provider
  ← Agent result and aggregate usage
  → local Frely development billing result
```

Frely owns both local model-access boundaries, final Provider routing and
development billing. Swarm owns only virtual-model and Agent execution. The
Swarm model client receives a restricted local Frely key; it never receives a
final Provider credential.

Model invocations cannot address Swarm directly and cannot leave Swarm toward a
final Provider. Only health and readiness probes may address the Swarm service
outside an admitted Frely request. Component stubs do not define another
supported invocation path.

Any future model MCP entry remains at Frely. Swarm would provide only an
internal Agent execution adapter, which this minimum Vision slice does not
claim to implement. Its runnable local interface is the Responses API described
below.

## Quick start

Requirements: Bun 1.4.0 plus a local Frely development environment with a
configured base-model AccessPoint and a restricted Agent model-access key.

```sh
bun install --frozen-lockfile
export MODEL_BASE_URL='http://127.0.0.1:43000/v1'
export MODEL_API_KEY='a-local-frely-agent-model-key'
export MODEL_NAME='configured-base-model'
export SWARM_ACCESS_TOKEN='a-separate-local-service-token'
bun run dev
```

`MODEL_BASE_URL` must identify the local Frely `/v1` entry and `MODEL_NAME`
must identify the base-model AccessPoint granted to the Agent. The service
listens on `127.0.0.1:4111`.

After configuring the local Frely `vision-basic` Agent-model AccessPoint, call
the virtual model through Frely:

```sh
curl --fail http://127.0.0.1:43000/v1/responses \
  -H "Authorization: Bearer $FRELY_CALLER_API_KEY" \
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
`store: false`, calls the configured Frely base-model AccessPoint, and returns
a standard non-streaming Responses object. The returned `model` remains the
requested virtual-model ID rather than leaking the base model as a routing
contract.

## Frely development routing

The Frely snapshot provides the two AccessPoint layers required by the local
closed loop. Configure them as follows:

1. Start Frely and configure a development Provider plus the base-model
   AccessPoint the Agent may use.
2. Create a restricted Frely development key for that base-model AccessPoint.
3. Start Swarm with `MODEL_BASE_URL` set to the local Frely `/v1` base,
   `MODEL_API_KEY` set to that restricted Frely key, and `MODEL_NAME` set to
   the granted base-model ID.
4. In Frely, create an `openai-compatible` Provider whose base URL is this
   local Swarm service's `/v1` base and whose Provider credential is the
   separate `SWARM_ACCESS_TOKEN` value.
5. Enable the Provider model `vision-basic`.
6. Create and price an AccessPoint exposed as `vision-basic`, routed to that
   Provider model, and include it in the demo Plan.
7. Call Frely's `POST /v1/responses` with the caller's Frely API key. Verify
   the request enters Swarm from Frely and the Agent model call re-enters Frely
   before Frely dispatches to the development Provider.

The Frely public snapshot intentionally omits a complete local database and
deployment reproduction. These steps describe the supported configuration
boundary; they do not claim a production-ready combined stack.

## HTTP API

- `GET /health` and `GET /healthz`: liveness, without upstream calls.
- `GET /readyz`: loaded runtime configuration and public model ID.
- `GET /v1/models`: authenticated catalog containing only `vision-basic`.
- `POST /v1/responses`: authenticated, non-streaming Vision request.

Both `/v1` routes require `Authorization: Bearer <SWARM_ACCESS_TOKEN>` and are
internal to the local Frely-to-Swarm boundary. Model callers use Frely.

## Configuration

| Variable | Purpose | Required integration value |
| --- | --- | --- |
| `MODEL_BASE_URL` | OpenAI-compatible `/v1` base used by the Agent model client. | Local Frely `/v1` URL. |
| `MODEL_API_KEY_FILE` | Preferred file containing the Agent's restricted Frely model-access key. | Local secret file. |
| `MODEL_API_KEY` | Direct-run fallback for the Agent's restricted Frely model-access key. | Local development key. |
| `MODEL_NAME` | Base-model AccessPoint selected inside Frely. | Operator-configured Frely model ID. |
| `SWARM_PUBLIC_MODEL` | Virtual-model ID advertised to Frely. | `vision-basic`. |
| `SWARM_ACCESS_TOKEN_FILE` | Preferred file containing the Frely-to-Swarm token. | Local secret file. |
| `SWARM_ACCESS_TOKEN` | Direct-run fallback for the Frely-to-Swarm token. | Local development token. |
| `MODEL_TIMEOUT_MS` | Frely model-call timeout, from 250 ms to 10 minutes. | Operator-selected bounded value. |
| `SWARM_HOST` | Listen host. | Loopback. |
| `PORT` | Listen port. | Local development port. |
| `SWARM_ALLOW_INSECURE_MODEL_HTTP` | Allow explicit HTTP only for a local Frely development network. | `false`. |

`MODEL_API_KEY` and `SWARM_ACCESS_TOKEN` are different credentials with
different trust boundaries. `MODEL_API_KEY` contains a Frely development key,
not a final Provider key. Compose uses the corresponding `*_FILE` settings.

## Docker

Create two local secret files, then start the hardened development container:

```sh
mkdir -p secrets
printf '%s' 'a-local-frely-agent-model-key' > secrets/model_api_key
printf '%s' 'a-separate-service-token' > secrets/swarm_access_token
cp .env.example .env
# Set MODEL_BASE_URL to local Frely and MODEL_NAME to its base-model ID.
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
bundle build, and component-level checks against a deterministic
stub. No real credential is used. Component verification does not replace the
cross-repository Frely → Swarm → Frely smoke test.

## License

First-party files are provided under the Apache License 2.0. See
[`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
