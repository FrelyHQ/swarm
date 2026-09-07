import { timingSafeEqual } from "node:crypto";

import { loadConfig, type SwarmConfig } from "./config";
import type { SafeErrorCode, SafeErrorResponse } from "./contracts";
import { FrelyResponsesModel, ModelError, type VisionModelPort } from "./model-client";
import { chatCompletionsToResponsesRequest, InputError, LIMITS, validateResponsesRequest } from "./validation";

function json(value: unknown, status = 200, requestId?: string, headers?: HeadersInit): Response {
  const responseHeaders = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(requestId === undefined ? {} : { "x-request-id": requestId }),
  });
  new Headers(headers).forEach((headerValue, headerName) => {
    responseHeaders.set(headerName, headerValue);
  });
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders,
  });
}

function requestId(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  if (supplied && /^[A-Za-z0-9._:-]{1,128}$/u.test(supplied)) return supplied;
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new InputError("invalid_request");
  const advertised = request.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/u.test(advertised) || Number(advertised) > LIMITS.bodyBytes)) {
    throw new InputError("body_too_large");
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
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new InputError("invalid_request");
  }
}

function authorized(request: Request, token: string): boolean {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(value.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function safeError(error: unknown): {
  code: SafeErrorCode;
  status: number;
  type: SafeErrorResponse["error"]["type"];
  message: string;
} {
  if (error instanceof InputError) {
    return {
      code: error.code,
      status: error.code === "body_too_large" ? 413 : 400,
      type: "invalid_request_error",
      message: error.code === "body_too_large" ? "Request body is too large." : "The request is invalid.",
    };
  }
  if (error instanceof ModelError) {
    return {
      code: error.code,
      status: error.code === "upstream_timeout" ? 504 : 502,
      type: "upstream_error",
      message: error.code === "upstream_timeout" ? "The model request timed out." : "The model service is unavailable.",
    };
  }
  return {
    code: "internal_error",
    status: 500,
    type: "server_error",
    message: "The server could not complete the request.",
  };
}

export function createHandler(
  config: SwarmConfig,
  model: VisionModelPort = new FrelyResponsesModel(config),
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      return json({ status: "ok" });
    }
    if (request.method === "GET" && url.pathname === "/readyz") {
      return json({ status: "ready", model: config.publicModel });
    }

    const id = requestId(request);
    if ((url.pathname === "/v1/models" || url.pathname === "/v1/responses" || url.pathname === "/v1/chat/completions") && !authorized(request, config.accessToken)) {
      const body: SafeErrorResponse = {
        error: {
          message: "Authentication is required.",
          type: "authentication_error",
          code: "unauthorized",
          request_id: id,
        },
      };
      return json(body, 401, id, { "www-authenticate": "Bearer" });
    }

    if (request.method === "GET" && url.pathname === "/v1/models") {
      return json({
        object: "list",
        data: [{ id: config.publicModel, object: "model", created: 0, owned_by: "frely-swarm" }],
      }, 200, id);
    }

    if (request.method === "POST" && url.pathname === "/v1/responses") {
      try {
        const input = validateResponsesRequest(await readBody(request), config.publicModel);
        const output = await model.createResponse(input, id, request.signal);
        return json(output, 200, id);
      } catch (error) {
        const normalized = safeError(error);
        console.error(JSON.stringify({ event: "swarm.request.failed", requestId: id, code: normalized.code }));
        const body: SafeErrorResponse = {
          error: {
            message: normalized.message,
            type: normalized.type,
            code: normalized.code,
            request_id: id,
          },
        };
        return json(body, normalized.status, id);
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      try {
        const input = chatCompletionsToResponsesRequest(await readBody(request), config.publicModel);
        const output = await model.createResponse(input, id, request.signal);
        return json(responsesToChatCompletion(output, config.publicModel), 200, id);
      } catch (error) {
        const normalized = safeError(error);
        console.error(JSON.stringify({ event: "swarm.request.failed", requestId: id, code: normalized.code }));
        const body: SafeErrorResponse = { error: { message: normalized.message, type: normalized.type, code: normalized.code, request_id: id } };
        return json(body, normalized.status, id);
      }
    }

    if (request.method === "GET" || request.method === "POST") {
      console.error(JSON.stringify({ event: "swarm.request.not_found", requestId: id, method: request.method, path: url.pathname }));
      return json({ error: { code: "not_found", request_id: id } }, 404, id);
    }
    return json({ error: { code: "method_not_allowed", request_id: id } }, 405, id);
  };
}

function responsesToChatCompletion(response: Record<string, unknown>, model: string): Record<string, unknown> {
  const usage = response.usage && typeof response.usage === "object" && !Array.isArray(response.usage)
    ? response.usage as Record<string, unknown>
    : {};
  const text = typeof response.output_text === "string" ? response.output_text : extractOutputText(response.output);
  return {
    id: typeof response.id === "string" ? response.id : `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: Number(usage.input_tokens ?? 0),
      completion_tokens: Number(usage.output_tokens ?? 0),
      total_tokens: Number(usage.total_tokens ?? 0),
    },
  };
}

function extractOutputText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  return output.flatMap((item) => item && typeof item === "object" && "content" in item && Array.isArray(item.content) ? item.content : [])
    .filter((part) => part && typeof part === "object" && "text" in part && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

if (import.meta.main) {
  const config = await loadConfig();
  const handler = createHandler(config);
  Bun.serve({ hostname: config.host, port: config.port, fetch: handler });
  console.log(`Frely Swarm vision runtime listening on ${config.host}:${config.port}`);
}
