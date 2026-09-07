import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

export interface SwarmConfig {
  readonly host: string;
  readonly port: number;
  readonly frelyBaseUrl: URL;
  readonly frelyApiKey: string;
  readonly frelyModel: string;
  readonly publicModel: string;
  readonly accessToken: string;
  readonly timeoutMs: number;
}

const DEFAULT_FRELY_BASE_URL = "http://gateway-srv:43000/v1";
const DEFAULT_FRELY_MODEL = "dev-base";
const DEFAULT_PUBLIC_MODEL = "vision-basic";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_SECRET_BYTES = 8_192;

function rejectGenericModelEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): void {
  if (Object.keys(environment).some((name) => name.startsWith("MODEL_"))) {
    throw new Error("generic MODEL_* configuration is unsupported; use FRELY_* configuration");
  }
}

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

export function validateFrelyBaseUrl(raw: string): URL {
  if (raw.trim() !== raw || raw.length === 0 || /[\u0000\r\n]/u.test(raw)) {
    throw new Error("invalid FRELY_BASE_URL configuration");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid FRELY_BASE_URL configuration");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname === ""
  ) {
    throw new Error("invalid FRELY_BASE_URL configuration");
  }
  const pathname = url.pathname.replace(/\/+$/u, "");
  if (!isKnownLocalFrelyHost(url.hostname) || pathname !== "/v1") {
    throw new Error("FRELY_BASE_URL must be the local Frely /v1 entry");
  }
  return new URL(url.toString().replace(/\/+$/u, ""));
}

function isKnownLocalFrelyHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized === "host.docker.internal" || normalized === "gateway-srv") return true;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1" || normalized === "[::1]";
}

async function readSecret(
  filePath: string | undefined,
  fallback: string | undefined,
  label: string,
): Promise<string> {
  let raw: string | undefined;
  if (filePath !== undefined && filePath !== "") {
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      throw new Error(`unavailable ${label} secret`);
    }
  } else {
    raw = fallback;
  }
  if (raw === undefined || new TextEncoder().encode(raw).byteLength > MAX_SECRET_BYTES) {
    throw new Error(`missing ${label} secret`);
  }
  const value = raw.trim();
  if (value.length === 0 || /[\u0000\r\n]/u.test(value)) {
    throw new Error(`invalid ${label} secret`);
  }
  return value;
}

function modelName(value: string | undefined, fallback: string, label: string): string {
  const resolved = boundedText(value, fallback, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(resolved)) {
    throw new Error(`invalid ${label} configuration`);
  }
  return resolved;
}

function publicModel(value: string | undefined): string {
  const resolved = modelName(value, DEFAULT_PUBLIC_MODEL, "SWARM_PUBLIC_MODEL");
  if (resolved.includes("/")) throw new Error("invalid SWARM_PUBLIC_MODEL configuration");
  return resolved;
}

export async function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<SwarmConfig> {
  rejectGenericModelEnvironment(environment);
  return Object.freeze({
    host: boundedText(environment.SWARM_HOST, "127.0.0.1", "SWARM_HOST", 253),
    port: boundedInteger(environment.PORT, 4111, 1, 65_535, "PORT"),
    frelyBaseUrl: validateFrelyBaseUrl(environment.FRELY_BASE_URL ?? DEFAULT_FRELY_BASE_URL),
    frelyApiKey: await readSecret(
      environment.FRELY_API_KEY_FILE,
      environment.FRELY_API_KEY,
      "Frely API key",
    ),
    frelyModel: modelName(environment.FRELY_MODEL, DEFAULT_FRELY_MODEL, "FRELY_MODEL"),
    publicModel: publicModel(environment.SWARM_PUBLIC_MODEL),
    accessToken: await readSecret(
      environment.SWARM_ACCESS_TOKEN_FILE,
      environment.SWARM_ACCESS_TOKEN,
      "Swarm access token",
    ),
    timeoutMs: boundedInteger(
      environment.FRELY_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      250,
      10 * 60_000,
      "FRELY_TIMEOUT_MS",
    ),
  });
}
