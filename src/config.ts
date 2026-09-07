import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

export interface SwarmConfig {
  readonly host: string;
  readonly port: number;
  readonly modelBaseUrl: URL;
  readonly modelApiKey: string;
  readonly modelName: string;
  readonly publicModel: string;
  readonly accessToken: string;
  readonly timeoutMs: number;
}

const DEFAULT_MODEL_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL_NAME = "gpt-5.6-luna";
const DEFAULT_PUBLIC_MODEL = "vision-basic";
const DEFAULT_TIMEOUT_MS = 120_000;
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

function booleanValue(value: string | undefined, fallback: boolean, label: string): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`invalid ${label} configuration`);
}

export function validateModelBaseUrl(
  raw: string,
  options: { readonly allowInsecureHttp?: boolean } = {},
): URL {
  if (raw.trim() !== raw || raw.length === 0 || /[\u0000\r\n]/u.test(raw)) {
    throw new Error("invalid MODEL_BASE_URL configuration");
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid MODEL_BASE_URL configuration");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname === ""
  ) {
    throw new Error("invalid MODEL_BASE_URL configuration");
  }
  if (
    url.protocol === "http:" &&
    options.allowInsecureHttp !== true &&
    !isKnownLocalHost(url.hostname)
  ) {
    throw new Error("insecure MODEL_BASE_URL is not allowed");
  }
  return new URL(url.toString().replace(/\/+$/u, ""));
}

function isKnownLocalHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "host.docker.internal") return true;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1";
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
  const allowInsecureHttp = booleanValue(
    environment.SWARM_ALLOW_INSECURE_MODEL_HTTP,
    false,
    "SWARM_ALLOW_INSECURE_MODEL_HTTP",
  );
  return Object.freeze({
    host: boundedText(environment.SWARM_HOST, "127.0.0.1", "SWARM_HOST", 253),
    port: boundedInteger(environment.PORT, 4111, 1, 65_535, "PORT"),
    modelBaseUrl: validateModelBaseUrl(
      environment.MODEL_BASE_URL ?? DEFAULT_MODEL_BASE_URL,
      { allowInsecureHttp },
    ),
    modelApiKey: await readSecret(
      environment.MODEL_API_KEY_FILE,
      environment.MODEL_API_KEY,
      "model API key",
    ),
    modelName: modelName(environment.MODEL_NAME, DEFAULT_MODEL_NAME, "MODEL_NAME"),
    publicModel: publicModel(environment.SWARM_PUBLIC_MODEL),
    accessToken: await readSecret(
      environment.SWARM_ACCESS_TOKEN_FILE,
      environment.SWARM_ACCESS_TOKEN,
      "Swarm access token",
    ),
    timeoutMs: boundedInteger(
      environment.MODEL_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      250,
      10 * 60_000,
      "MODEL_TIMEOUT_MS",
    ),
  });
}
