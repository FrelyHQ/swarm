import type { SnapConfig } from "./config";
import type { DebugRequest, ProbeStatus } from "./contracts";
import { makePrompt } from "./validation";

const MAX_UPSTREAM_RESPONSE_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;

export type UpstreamErrorCode =
  | "gateway_timeout"
  | "gateway_unavailable"
  | "gateway_rejected"
  | "gateway_invalid_response";

export class UpstreamError extends Error {
  constructor(public readonly code: UpstreamErrorCode) {
    super(code);
  }
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface FrelyClientPort {
  probeGateway(signal?: AbortSignal): Promise<ProbeStatus>;
  probeSwarm(signal?: AbortSignal): Promise<ProbeStatus>;
  debug(
    request: DebugRequest,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<string>;
}

interface TimeoutScope {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly cleanup: () => void;
}

function timeoutScope(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): TimeoutScope {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Upstream request timed out", "TimeoutError"));
  }, timeoutMs);
  const onParentAbort = () => {
    controller.abort(parent?.reason);
  };
  parent?.addEventListener("abort", onParentAbort, { once: true });
  if (parent?.aborted === true) onParentAbort();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function requestHeaders(
  config: SnapConfig,
  requestId?: string,
  includeApiKey = true,
): Headers {
  const headers = new Headers({ accept: "application/json" });
  if (includeApiKey) headers.set("authorization", `Bearer ${config.gatewayApiKey}`);
  if (config.gatewayHost !== undefined) headers.set("host", config.gatewayHost);
  if (requestId !== undefined) headers.set("x-request-id", requestId);
  return headers;
}

export class FrelyClient implements FrelyClientPort {
  private readonly fetcher: FetchLike;

  public constructor(
    private readonly config: SnapConfig,
    fetcher: FetchLike = (input, init) => globalThis.fetch(input, init),
  ) {
    this.fetcher = fetcher;
  }

  public probeGateway(signal?: AbortSignal): Promise<ProbeStatus> {
    return this.probe(
      this.config.gatewayHealthUrl,
      requestHeaders(this.config, undefined, false),
      signal,
    );
  }

  public probeSwarm(signal?: AbortSignal): Promise<ProbeStatus> {
    if (this.config.swarmUrl === undefined) return Promise.resolve("not_configured");
    const headers = new Headers({ accept: "application/json" });
    if (this.config.swarmApiKey !== undefined) {
      headers.set("authorization", `Bearer ${this.config.swarmApiKey}`);
    }
    return this.probe(this.config.swarmUrl, headers, signal);
  }

  private async probe(
    url: URL,
    headers: Headers,
    parent: AbortSignal | undefined,
  ): Promise<ProbeStatus> {
    const scope = timeoutScope(parent, this.config.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method: "GET",
        headers,
        signal: scope.signal,
      });
      await response.body?.cancel();
      return response.ok ? "ready" : "unavailable";
    } catch {
      return "unavailable";
    } finally {
      scope.cleanup();
    }
  }

  public async debug(
    request: DebugRequest,
    requestId: string,
    parent?: AbortSignal,
  ): Promise<string> {
    const scope = timeoutScope(parent, this.config.timeoutMs);
    try {
      const headers = requestHeaders(this.config, requestId);
      headers.set("content-type", "application/json");
      const response = await this.fetcher(this.config.gatewayResponsesUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.config.model,
          input: makePrompt(request),
          stream: false,
          store: false,
        }),
        signal: scope.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new UpstreamError(
          response.status >= 500
            ? "gateway_unavailable"
            : "gateway_rejected",
        );
      }
      let body: unknown;
      try {
        body = await readJsonBounded(response, MAX_UPSTREAM_RESPONSE_BYTES);
      } catch {
        throw new UpstreamError("gateway_invalid_response");
      }
      try {
        const result = extractResult(body);
        if (result === undefined) {
          throw new Error("upstream result is missing");
        }
        return result;
      } catch (error) {
        if (error instanceof UpstreamError) throw error;
        throw new UpstreamError("gateway_invalid_response");
      }
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (scope.timedOut() || parent?.aborted === true) {
        throw new UpstreamError("gateway_timeout");
      }
      throw new UpstreamError("gateway_unavailable");
    } finally {
      scope.cleanup();
    }
  }
}

async function readJsonBounded(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null) {
    const advertisedBytes = /^\d+$/u.test(advertised)
      ? Number(advertised)
      : Number.NaN;
    if (
      !Number.isSafeInteger(advertisedBytes) ||
      advertisedBytes > maximumBytes
    ) {
      await response.body?.cancel();
      throw new Error("upstream response is too large");
    }
  }
  if (response.body === null) throw new Error("upstream response has no body");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("upstream response is too large");
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
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

function extractResult(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.output_text === "string") {
    return boundedResult(value.output_text);
  }
  if (!Array.isArray(value.output)) return undefined;

  const parts: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (
        isRecord(part) &&
        (part.type === "output_text" || part.type === "text") &&
        typeof part.text === "string"
      ) {
        parts.push(part.text);
      }
    }
  }
  return parts.length === 0 ? undefined : boundedResult(parts.join("\n"));
}

function boundedResult(value: string): string {
  if (new TextEncoder().encode(value).byteLength > MAX_RESULT_BYTES) {
    throw new Error("upstream result is too large");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
