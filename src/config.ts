import { isIP } from "node:net";
import { readFile } from "node:fs/promises";

export interface SnapConfig {
  readonly host: string;
  readonly port: number;
  readonly gatewayUrl: URL;
  readonly gatewayHealthUrl: URL;
  readonly gatewayResponsesUrl: URL;
  readonly gatewayApiKey: string;
  readonly swarmUrl?: URL;
  readonly swarmApiKey?: string;
  readonly requireSwarm: boolean;
  readonly model: string;
  readonly timeoutMs: number;
  readonly gatewayHost?: string;
}

const DEFAULT_GATEWAY_URL = "http://host.docker.internal:43000";
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_SECRET_BYTES = 8_192;

function boundedText(
  value: string | undefined,
  fallback: string,
  label: string,
  maximum: number,
): string {
  const resolved = value ?? fallback;
  if (
    resolved.length === 0 ||
    resolved.length > maximum ||
    resolved.trim() !== resolved ||
    /[\u0000\r\n]/u.test(resolved)
  ) {
    throw new Error(`invalid ${label} configuration`);
  }
  return resolved;
}

function booleanValue(
  value: string | undefined,
  fallback: boolean,
  label: string,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`invalid ${label} configuration`);
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/u.test(value)) throw new Error(`invalid ${label} configuration`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`invalid ${label} configuration`);
  }
  return parsed;
}

export function validateServiceUrl(
  raw: string,
  label: string,
  options: { readonly allowInsecureHttp?: boolean } = {},
): URL {
  if (raw.trim() !== raw || raw.length === 0 || /[\u0000\r\n]/u.test(raw)) {
    throw new Error(`invalid ${label} URL`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`invalid ${label} URL`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname === ""
  ) {
    throw new Error(`invalid ${label} URL`);
  }
  if (
    url.protocol === "http:" &&
    options.allowInsecureHttp !== true &&
    !isKnownLocalHttpHost(url.hostname)
  ) {
    throw new Error(`insecure ${label} URL is not allowed`);
  }
  return url;
}

function isKnownLocalHttpHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "host.docker.internal" ||
    normalized === "gateway-srv" ||
    normalized === "frely-swarm"
  ) {
    return true;
  }
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1";
}

function gatewayPaths(raw: URL): {
  readonly health: URL;
  readonly responses: URL;
} {
  const path = raw.pathname.replace(/\/+$/u, "");
  if (path !== "" && path !== "/v1") {
    throw new Error("gateway URL must be a root or /v1 URL");
  }

  // The Gateway health endpoint is rooted at /health even when callers use a
  // /v1 API base URL. Never derive health from the API prefix.
  const origin = new URL(raw.origin);
  const health = new URL(origin);
  health.pathname = "/health";
  const responses = new URL(origin);
  responses.pathname = "/v1/responses";
  return { health, responses };
}

async function readSecret(
  path: string | undefined,
  fallback: string | undefined,
  required: boolean,
  label: string,
): Promise<string | undefined> {
  if (path !== undefined && path !== "") {
    try {
      const value = await readFile(path, "utf8");
      if (new TextEncoder().encode(value).byteLength > MAX_SECRET_BYTES) {
        throw new Error(`invalid ${label} secret`);
      }
      const trimmed = value.trim();
      if (trimmed !== "") return trimmed;
      if (required) throw new Error(`invalid ${label} secret`);
      return undefined;
    } catch (error) {
      if (required) throw new Error(`unavailable ${label} secret`);
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`unavailable ${label} secret`);
      }
    }
  }

  const resolvedFallback = fallback?.trim() ?? "";
  if (resolvedFallback !== "") {
    if (new TextEncoder().encode(resolvedFallback).byteLength > MAX_SECRET_BYTES) {
      throw new Error(`invalid ${label} secret`);
    }
    return resolvedFallback;
  }
  if (required) throw new Error(`missing ${label} secret`);
  return undefined;
}

function modelName(value: string | undefined): string {
  const resolved = boundedText(value, "", "SNAP_MODEL", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(resolved)) {
    throw new Error("invalid SNAP_MODEL configuration");
  }
  return resolved;
}

export async function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SnapConfig> {
  const allowInsecureHttp = booleanValue(
    environment.SNAP_ALLOW_INSECURE_HTTP,
    false,
    "SNAP_ALLOW_INSECURE_HTTP",
  );
  const gatewayRaw = environment.FRELY_GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
  const gatewayUrl = validateServiceUrl(gatewayRaw, "gateway", { allowInsecureHttp });
  const paths = gatewayPaths(gatewayUrl);
  const requireSwarm = booleanValue(
    environment.SNAP_REQUIRE_SWARM,
    true,
    "SNAP_REQUIRE_SWARM",
  );
  const swarmRaw = environment.SNAP_SWARM_URL;
  const swarmUrl = swarmRaw === undefined || swarmRaw === ""
    ? undefined
    : validateServiceUrl(swarmRaw, "Swarm probe", { allowInsecureHttp });
  if (requireSwarm && swarmUrl === undefined) {
    throw new Error("Swarm probe URL is required");
  }

  // Compose supplies the file path. A direct local run may instead supply the
  // explicit environment fallback; do not let a missing default mount mask it.
  const gatewaySecretPath = environment.GATEWAY_API_KEY_FILE ||
    environment.SNAP_GATEWAY_SECRET_FILE || (
      environment.GATEWAY_API_KEY === undefined
        ? "/run/secrets/gateway_api_key"
        : undefined
    );
  const gatewayApiKey = await readSecret(
    gatewaySecretPath,
    environment.GATEWAY_API_KEY,
    true,
    "gateway API key",
  );
  if (gatewayApiKey === undefined) throw new Error("missing gateway API key");

  const swarmApiKey = await readSecret(
    environment.SWARM_PROBE_KEY_FILE || environment.SNAP_SWARM_SECRET_FILE,
    environment.SWARM_PROBE_KEY,
    false,
    "Swarm probe key",
  );
  const model = modelName(environment.SNAP_MODEL);

  return Object.freeze({
    host: boundedText(
      environment.SNAP_HOST,
      "127.0.0.1",
      "SNAP_HOST",
      253,
    ),
    port: boundedInteger(
      environment.PORT,
      8787,
      1,
      65_535,
      "PORT",
    ),
    gatewayUrl,
    gatewayHealthUrl: paths.health,
    gatewayResponsesUrl: paths.responses,
    gatewayApiKey,
    ...(swarmUrl === undefined ? {} : { swarmUrl }),
    ...(swarmApiKey === undefined ? {} : { swarmApiKey }),
    requireSwarm,
    model,
    timeoutMs: boundedInteger(
      environment.SNAP_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      250,
      120_000,
      "SNAP_TIMEOUT_MS",
    ),
    ...(environment.GATEWAY_HOST === undefined || environment.GATEWAY_HOST === ""
      ? {}
      : {
          gatewayHost: boundedText(
            environment.GATEWAY_HOST,
            "",
            "GATEWAY_HOST",
            253,
          ),
        }),
  });
}
