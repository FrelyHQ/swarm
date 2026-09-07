---
name: configure-development-environment
description: Configure or repair a Frely Swarm checkout for local development. Use for onboarding, dependency setup, ignored environment and secret files, Compose inputs, model selection, missing-variable failures, or host/container workflow changes; never treat it as production configuration.
---

# Configure Swarm Development Environment

Prepare the smallest local environment needed and distinguish configuration validity from runtime readiness.

Swarm owns Frely's virtual-model and Agent runtime and exposes MCP and Responses APIs. Relay is the external model entry and billing plane; it forwards admitted traffic to Swarm and accounts for usage. Keep these responsibilities separate.

## Establish the target

1. Start at the repository root and read the applicable repository instructions and current Git status. Preserve every pre-existing change.
2. Detect whether the checkout implements the target runtime or an older Snap/debug adapter. If its package, environment, Compose, and runtime config still describe Snap, state that setup validates only that adapter, not the target Swarm runtime or APIs.
3. Identify the requested mode: code and tests, host runtime with local dependencies, or a Compose stack. If unstated, choose the least expansive useful mode and state the assumption.
4. Configuration authorizes local files and checks, not starting long-running services, changing tracked templates, provisioning hosted resources, or configuring production. Do those only when requested.

## Derive the contract from this checkout

Inspect the active branch instead of relying on a remembered variable list:

- `package.json` and `bun.lock` define the JavaScript toolchain and available commands.
- `.env.example` defines the public local-environment surface.
- The selected `compose*.yaml` files define interpolation, DNS names, ports, overlays, secrets, dependencies, and health checks.
- Runtime config loaders and model registries define parsing, defaults, supported APIs, and required values.
- The README and architecture documents explain intent but do not override executable validation.

Honor explicit user and repository instructions first. Do not fabricate variables to make transitional code resemble the target architecture. When implementing the new runtime, update its tracked configuration contract before treating a generated local environment as authoritative.

The current product direction selects `gpt-5.6-luna`, but model identity belongs in repository configuration. Configure it only when the active registry and API contract support it, and verify Relay admits the same exposed name.

## Configure safely

1. Verify Bun and Node against `package.json`. Use Bun and run `bun install --frozen-lockfile` only when dependencies need installation or verification; do not rewrite the lockfile.
2. If `.env` is absent, create it from the current example. Otherwise preserve values and comments, compare only key names, and add confirmed missing entries. Never replace it wholesale.
3. Confirm every local environment or secret path is ignored with `git check-ignore` before writing sensitive data. Never print secret values, place them in command arguments that will be logged, or add them to tracked examples.
4. Do not invent Frely keys, hosted endpoints, provider credentials, or production-like values. Generate a secret only when the runtime accepts arbitrary local material; write it without echoing, restrict permissions, and report only its key or path. Otherwise identify the required input.
5. Keep network coordinates consistent. Host, host-to-container, and service-to-service calls use different address spaces; derive URLs and secret mounts from the selected mode.
6. For a transitional Snap setup, preserve the one-way request path through Relay and treat any Swarm URL as the readiness role defined by the current code. Do not configure or report a second inference path that bypasses Relay.

## Validate the result

- Run `docker compose ... config --quiet` for each selected file set; avoid rendering interpolated secrets. If services were requested, use declared health checks and bounded logs.
- Run the narrowest applicable repository command from `package.json`. For the target runtime, exercise both MCP and Responses surfaces only when they exist; for the transitional adapter, use only its checked-in smoke or verification path.
- Recheck Git status and verify no secret or generated dependency tree became tracked.
- Report the detected implementation, changed files, tool and dependency status, static validity, service or API health, unresolved inputs, and next commands. Never infer target-runtime or production readiness from a transitional-adapter check.
