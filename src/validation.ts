import type { ResponsesRequest } from "./contracts";

export const LIMITS = Object.freeze({
  bodyBytes: 1024 * 1024,
  instructionsBytes: 64 * 1024,
  nodes: 1_024,
  depth: 12,
});

export class InputError extends Error {
  constructor(public readonly code: "invalid_request" | "body_too_large") {
    super(code);
  }
}

const ALLOWED_FIELDS = new Set([
  "model",
  "input",
  "instructions",
  "max_output_tokens",
  "temperature",
  "top_p",
  "text",
  "reasoning",
  "include",
  "service_tier",
  "stream",
  "store",
]);

export function validateResponsesRequest(value: unknown, publicModel: string): ResponsesRequest {
  if (!isRecord(value) || Object.keys(value).some((key) => !ALLOWED_FIELDS.has(key))) {
    throw new InputError("invalid_request");
  }
  const model = requestedModel(value.model, publicModel);
  if (value.stream !== undefined && value.stream !== false) throw new InputError("invalid_request");
  if (value.store !== undefined && value.store !== false) throw new InputError("invalid_request");
  if (typeof value.instructions === "string" && utf8Bytes(value.instructions) > LIMITS.instructionsBytes) {
    throw new InputError("invalid_request");
  }
  if (value.instructions !== undefined && typeof value.instructions !== "string") {
    throw new InputError("invalid_request");
  }
  if (value.max_output_tokens !== undefined && !boundedInteger(value.max_output_tokens, 1, 65_536)) {
    throw new InputError("invalid_request");
  }
  for (const field of ["temperature", "top_p"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "number" || !Number.isFinite(value[field]))) {
      throw new InputError("invalid_request");
    }
  }
  if (typeof value.input !== "string" && !Array.isArray(value.input)) {
    throw new InputError("invalid_request");
  }
  const state = { nodes: 0, hasImage: false };
  inspectInput(value.input, 0, state);
  if (!state.hasImage) throw new InputError("invalid_request");
  return Object.freeze({
    ...value,
    model,
    stream: false,
    store: false,
  } as ResponsesRequest);
}

export function chatCompletionsToResponsesRequest(value: unknown, publicModel: string): ResponsesRequest {
  if (!isRecord(value) || !Array.isArray(value.messages)) throw new InputError("invalid_request");
  const model = requestedModel(value.model, publicModel);
  if (value.stream !== undefined && value.stream !== false) throw new InputError("invalid_request");
  const input = value.messages.map((message) => {
    if (!isRecord(message) || typeof message.role !== "string") throw new InputError("invalid_request");
    if (typeof message.content === "string") return { role: message.role, content: message.content };
    if (!Array.isArray(message.content)) throw new InputError("invalid_request");
    return {
      role: message.role,
      content: message.content.map((part) => {
        if (!isRecord(part)) throw new InputError("invalid_request");
        if (part.type === "text" && typeof part.text === "string") return { type: "input_text", text: part.text };
        if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
          return { type: "input_image", image_url: part.image_url.url, ...(typeof part.image_url.detail === "string" ? { detail: part.image_url.detail } : {}) };
        }
        throw new InputError("invalid_request");
      }),
    };
  });
  const maxOutputTokens = value.max_completion_tokens ?? value.max_tokens;
  return validateResponsesRequest({
    model,
    input,
    ...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
    ...(value.temperature === undefined ? {} : { temperature: value.temperature }),
    ...(value.top_p === undefined ? {} : { top_p: value.top_p }),
    stream: false,
    store: false,
  }, publicModel);
}

function requestedModel(value: unknown, publicModel: string): string {
  if (typeof value !== "string") throw new InputError("invalid_request");
  if (value === publicModel) return value;
  const parts = value.split("/");
  if (
    parts.length === 2 &&
    parts[1] === publicModel &&
    /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/u.test(parts[0] ?? "")
  ) {
    return value;
  }
  throw new InputError("invalid_request");
}

function inspectInput(
  value: unknown,
  depth: number,
  state: { nodes: number; hasImage: boolean },
): void {
  state.nodes += 1;
  if (state.nodes > LIMITS.nodes || depth > LIMITS.depth) throw new InputError("invalid_request");
  if (value === null || typeof value === "boolean" || typeof value === "number") return;
  if (typeof value === "string") {
    if (/\u0000/u.test(value)) throw new InputError("invalid_request");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectInput(item, depth + 1, state);
    return;
  }
  if (!isRecord(value)) throw new InputError("invalid_request");
  if (value.type === "input_image") {
    if (typeof value.image_url !== "string" || !validImageUrl(value.image_url)) {
      throw new InputError("invalid_request");
    }
    state.hasImage = true;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new InputError("invalid_request");
    }
    inspectInput(child, depth + 1, state);
  }
}

function validImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.hostname !== "";
  } catch {
    return false;
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
