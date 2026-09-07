import OpenAI from "openai";

import type { SwarmConfig } from "./config";
import type { ResponsesRequest } from "./contracts";

export type ModelErrorCode = "upstream_timeout" | "upstream_unavailable" | "upstream_invalid_response";

export class ModelError extends Error {
  constructor(public readonly code: ModelErrorCode) {
    super(code);
  }
}

export interface ResponsesClientPort {
  create(
    body: Record<string, unknown>,
    options: { readonly signal?: AbortSignal; readonly headers?: Record<string, string> },
  ): Promise<unknown>;
}

export interface VisionModelPort {
  createResponse(
    request: ResponsesRequest,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
}

export class OpenAIVisionModel implements VisionModelPort {
  private readonly responses: ResponsesClientPort;

  constructor(
    private readonly config: SwarmConfig,
    responses?: ResponsesClientPort,
  ) {
    const client = responses === undefined
      ? new OpenAI({
          apiKey: config.modelApiKey,
          baseURL: config.modelBaseUrl.toString(),
          timeout: config.timeoutMs,
          maxRetries: 0,
        })
      : undefined;
    this.responses = responses ?? (client!.responses as unknown as ResponsesClientPort);
  }

  async createResponse(
    request: ResponsesRequest,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.responses.create({
        ...request,
        model: this.config.modelName,
        stream: false,
        store: false,
      }, {
        ...(signal === undefined ? {} : { signal }),
        headers: { "x-client-request-id": requestId },
      });
      if (!isRecord(response)) throw new ModelError("upstream_invalid_response");
      return Object.freeze({ ...response, model: request.model });
    } catch (error) {
      if (error instanceof ModelError) throw error;
      if (isTimeout(error)) throw new ModelError("upstream_timeout");
      throw new ModelError("upstream_unavailable");
    }
  }
}

function isTimeout(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  if (!(error instanceof Error)) return false;
  return /timeout/i.test(error.name) || /timed out/i.test(error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
