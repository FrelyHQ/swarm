import { readFile } from "node:fs/promises";

export interface SnapConfig {
  port: number;
  gatewayUrl: URL;
  gatewayHealthUrl: URL;
  gatewayResponsesUrl: URL;
  gatewayApiKey: string;
  swarmUrl?: URL;
  swarmApiKey?: string;
  requireSwarm: boolean;
  model: string;
  timeoutMs: number;
  gatewayHost?: string;
}

const DEFAULT_TIMEOUT = 10_000;
const MAX_SECRET_BYTES = 8_192;

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error("invalid boolean configuration");
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error("invalid numeric configuration");
  return parsed;
}

export function validateServiceUrl(raw: string, label: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`invalid ${label} URL`); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) {
    throw new Error(`invalid ${label} URL`);
  }
  if (!url.hostname) throw new Error(`invalid ${label} URL`);
  return url;
}

function gatewayPaths(raw: URL): { health: URL; responses: URL } {
  const path = raw.pathname.replace(/\/+$/, "");
  if (path && path !== "/v1") throw new Error("gateway URL must be a root or /v1 URL");
  const base = new URL(raw.toString());
  base.pathname = path;
  base.search = "";
  base.hash = "";
  const health = new URL(base.toString());
  const responses = new URL(base.toString());
  if (path === "/v1") {
    health.pathname = "/v1/health";
    responses.pathname = "/v1/responses";
  } else {
    health.pathname = "/health";
    responses.pathname = "/v1/responses";
  }
  return { health, responses };
}

async function readSecret(path: string | undefined, fallback: string | undefined, required: boolean): Promise<string | undefined> {
  if (path) {
    try {
      const value = await readFile(path, "utf8");
      if (Buffer.byteLength(value) > MAX_SECRET_BYTES) throw new Error("secret is too large");
      const trimmed = value.trim();
      if (trimmed) return trimmed;
      if (required) throw new Error("required secret is empty");
      return undefined;
    } catch (error) {
      if (required) throw new Error("gateway secret file is unavailable");
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (fallback) return fallback.trim();
  if (required) throw new Error("gateway API key is not configured");
  return undefined;
}

export async function loadConfig(env: Record<string, string | undefined> = process.env): Promise<SnapConfig> {
  const gatewayRaw = env.FRELY_GATEWAY_URL ?? "http://127.0.0.1:8080";
  const gatewayUrl = validateServiceUrl(gatewayRaw, "gateway");
  const paths = gatewayPaths(gatewayUrl);
  const requireSwarm = boolEnv(env.SNAP_REQUIRE_SWARM, true);
  const swarmRaw = env.SNAP_SWARM_URL;
  const swarmUrl = swarmRaw ? validateServiceUrl(swarmRaw, "Swarm probe") : undefined;
  if (requireSwarm && !swarmUrl) throw new Error("Swarm probe URL is required");
  const gatewayApiKey = await readSecret(env.GATEWAY_API_KEY_FILE ?? "/run/secrets/gateway_api_key", env.GATEWAY_API_KEY, true);
  if (!gatewayApiKey) throw new Error("gateway API key is not configured");
  const swarmApiKey = await readSecret(env.SWARM_PROBE_KEY_FILE, env.SWARM_PROBE_KEY, false);
  const model = env.SNAP_MODEL ?? "default";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(model)) throw new Error("invalid model configuration");
  return {
    port: boundedInt(env.PORT, 8787, 1, 65535),
    gatewayUrl,
    gatewayHealthUrl: paths.health,
    gatewayResponsesUrl: paths.responses,
    gatewayApiKey,
    swarmUrl,
    swarmApiKey,
    requireSwarm,
    model,
    timeoutMs: boundedInt(env.SNAP_TIMEOUT_MS, DEFAULT_TIMEOUT, 250, 60_000),
    gatewayHost: env.GATEWAY_HOST?.trim() || undefined,
  };
}
