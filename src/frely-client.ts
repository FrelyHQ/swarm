import type { DebugRequest, ProbeStatus } from "./contracts";
import { makePrompt } from "./validation";
import type { SnapConfig } from "./config";

export class UpstreamError extends Error {
  constructor(public readonly code: "gateway_timeout" | "gateway_unavailable" | "gateway_rejected" | "gateway_invalid_response") {
    super(code);
  }
}

function combinedSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  controller.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
  }, { once: true });
  return controller.signal;
}

export class FrelyClient {
  constructor(private readonly config: SnapConfig) {}

  private headers(includeKey = true): HeadersInit {
    const headers: Record<string, string> = { accept: "application/json" };
    if (includeKey) headers.authorization = `Bearer ${this.config.gatewayApiKey}`;
    if (this.config.gatewayHost) headers.host = this.config.gatewayHost;
    return headers;
  }

  async probeGateway(signal?: AbortSignal): Promise<ProbeStatus> {
    return this.probe(this.config.gatewayHealthUrl, this.headers(), signal);
  }

  async probeSwarm(signal?: AbortSignal): Promise<ProbeStatus> {
    if (!this.config.swarmUrl) return "not_configured";
    const headers: HeadersInit = { accept: "application/json" };
    if (this.config.swarmApiKey) headers.authorization = `Bearer ${this.config.swarmApiKey}`;
    return this.probe(this.config.swarmUrl, headers, signal);
  }

  private async probe(url: URL, headers: HeadersInit, parent?: AbortSignal): Promise<ProbeStatus> {
    try {
      const response = await fetch(url, { method: "GET", headers, signal: combinedSignal(parent, this.config.timeoutMs) });
      await response.body?.cancel();
      return response.ok ? "ready" : "unavailable";
    } catch (error) {
      return error instanceof DOMException && error.name === "AbortError" ? "unavailable" : "unavailable";
    }
  }

  async debug(request: DebugRequest, parent?: AbortSignal): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.config.gatewayResponsesUrl, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ model: this.config.model, stream: false, store: false, input: makePrompt(request) }),
        signal: combinedSignal(parent, this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw new UpstreamError("gateway_timeout");
      throw new UpstreamError("gateway_unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError(response.status >= 500 ? "gateway_unavailable" : "gateway_rejected");
    }
    let body: unknown;
    try {
      body = await readJsonBounded(response, 64 * 1024);
    } catch {
      throw new UpstreamError("gateway_invalid_response");
    }
    const result = extractResult(body);
    if (!result) throw new UpstreamError("gateway_invalid_response");
    return result;
  }
}

async function readJsonBounded(response: Response, maxBytes: number): Promise<unknown> {
  const advertised = response.headers.get("content-length");
  if (advertised && Number(advertised) > maxBytes) {
    await response.body?.cancel();
    throw new Error("response too large");
  }
  if (!response.body) throw new Error("response body missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("response too large");
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function extractResult(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text.slice(0, 16_000);
  if (typeof record.result === "string") return record.result.slice(0, 16_000);
  if (!Array.isArray(record.output)) return undefined;
  const parts: string[] = [];
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string") parts.push((part as Record<string, string>).text);
    }
  }
  return parts.join("\n").slice(0, 16_000) || undefined;
}
