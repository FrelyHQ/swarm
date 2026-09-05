import { loadConfig, type SnapConfig } from "./config";
import {
  type SafeErrorCode,
  type SafeErrorResponse,
} from "./contracts";
import { FrelyClient, type FrelyClientPort, UpstreamError } from "./frely-client";
import { InputError, LIMITS, validateDebugRequest } from "./validation";

function json(
  value: unknown,
  status = 200,
  requestId?: string,
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(requestId === undefined ? {} : { "x-request-id": requestId }),
    },
  });
}

function newRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/json") {
    throw new InputError("invalid_request");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength) || Number(contentLength) > LIMITS.bodyBytes) {
      throw new InputError("body_too_large");
    }
  }
  if (request.body === null) throw new InputError("invalid_request");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > LIMITS.bodyBytes) {
        await reader.cancel();
        throw new InputError("body_too_large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new InputError("invalid_request");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InputError("invalid_request");
  }
}

function errorCode(error: unknown): SafeErrorCode {
  if (error instanceof InputError) return error.code;
  if (error instanceof UpstreamError) return error.code;
  return "internal_error";
}

function errorStatus(code: SafeErrorCode): number {
  switch (code) {
    case "body_too_large":
      return 413;
    case "gateway_timeout":
      return 504;
    case "gateway_unavailable":
      return 503;
    case "gateway_rejected":
    case "gateway_invalid_response":
      return 502;
    case "internal_error":
      return 500;
    default:
      return 400;
  }
}

export function createHandler(
  config: SnapConfig,
  client: FrelyClientPort = new FrelyClient(config),
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (request.method === "GET" && url.pathname === "/readyz") {
      const [gateway, swarm] = await Promise.all([
        client.probeGateway(request.signal).catch(() => "unavailable" as const),
        config.requireSwarm
          ? client.probeSwarm(request.signal).catch(() => "unavailable" as const)
          : Promise.resolve("not_configured" as const),
      ]);
      const ready = gateway === "ready" &&
        (!config.requireSwarm || swarm === "ready");
      return json({ status: ready ? "ready" : "not_ready" }, ready ? 200 : 503);
    }

    if (request.method === "POST" && url.pathname === "/v1/debug") {
      const id = newRequestId();
      try {
        const body = validateDebugRequest(await readBody(request));
        const result = await client.debug(body, id, request.signal);
        return json({ request_id: id, result }, 200, id);
      } catch (error) {
        const code = errorCode(error);
        const response: SafeErrorResponse = {
          error: { code, request_id: id },
        };
        return json(response, errorStatus(code), id);
      }
    }

    if (request.method === "GET" || request.method === "POST") {
      return json({ error: { code: "not_found" } }, 404);
    }
    return json({ error: { code: "method_not_allowed" } }, 405);
  };
}

if (import.meta.main) {
  const config = await loadConfig();
  const handler = createHandler(config);
  Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch: handler,
  });
  console.log(`Frely Snap listening on ${config.host}:${config.port}`);
}
