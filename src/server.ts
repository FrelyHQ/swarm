import { loadConfig, type SnapConfig } from "./config";
import { FrelyClient, UpstreamError } from "./frely-client";
import type { SafeErrorCode } from "./contracts";
import { InputError, LIMITS, validateDebugRequest } from "./validation";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function readBody(request: Request): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > LIMITS.bodyBytes) throw new InputError("invalid_request");
  if (!request.body) throw new InputError("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > LIMITS.bodyBytes) {
        await reader.cancel();
        throw new InputError("invalid_request");
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const text = new TextDecoder().decode(concat(chunks, size));
  try { return JSON.parse(text); } catch { throw new InputError("invalid_request"); }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function errorCode(error: unknown): SafeErrorCode {
  if (error instanceof InputError) return error.code;
  if (error instanceof UpstreamError) return error.code;
  return "internal_error";
}

export function createHandler(config: SnapConfig, client = new FrelyClient(config)) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json({ status: "ok" });
    if (request.method === "GET" && url.pathname === "/readyz") {
      const [gateway, swarm] = await Promise.all([client.probeGateway(request.signal), client.probeSwarm(request.signal)]);
      const ready = gateway === "ready" && (!config.requireSwarm || swarm === "ready");
      return json({ status: ready ? "ready" : "not_ready" }, ready ? 200 : 503);
    }
    if (request.method === "POST" && url.pathname === "/v1/debug") {
      const id = requestId();
      try {
        const body = validateDebugRequest(await readBody(request));
        const result = await client.debug(body, request.signal);
        return json({ request_id: id, result });
      } catch (error) {
        const code = errorCode(error);
        const status = code === "internal_error" ? 500 : code.startsWith("gateway_") ? (code === "gateway_rejected" ? 502 : 503) : 400;
        return json({ error: { code } }, status);
      }
    }
    if (["GET", "POST"].includes(request.method)) return json({ error: { code: "not_found" } }, 404);
    return json({ error: { code: "method_not_allowed" } }, 405);
  };
}

if (import.meta.main) {
  const config = await loadConfig();
  const handler = createHandler(config);
  Bun.serve({ port: config.port, fetch: handler });
  console.log(`Frely Snap listening on port ${config.port}`);
}
