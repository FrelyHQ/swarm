export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface DebugRequest {
  project: {
    id: string;
    chain: string;
    network: string;
  };
  problem: {
    title: string;
    description: string;
  };
  context?: JsonValue;
  question: string;
}

export interface DebugResult {
  request_id: string;
  result: string;
}

export type ProbeStatus = "ready" | "unavailable" | "not_configured";

export interface ReadyResponse {
  status: "ready" | "not_ready";
}

export type SafeErrorCode =
  | "invalid_request"
  | "body_too_large"
  | "sensitive_input"
  | "gateway_timeout"
  | "gateway_unavailable"
  | "gateway_rejected"
  | "gateway_invalid_response"
  | "internal_error";

export interface SafeErrorResponse {
  error: { code: SafeErrorCode };
}
