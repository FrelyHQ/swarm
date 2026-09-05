export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DebugRequest {
  readonly project: {
    readonly id: string;
    readonly chain: string;
    readonly network: string;
  };
  readonly problem: {
    readonly title: string;
    readonly description: string;
  };
  readonly context?: JsonValue;
  readonly question: string;
}

export interface DebugResult {
  readonly request_id: string;
  readonly result: string;
}

export type ProbeStatus = "ready" | "unavailable" | "not_configured";

export interface ReadyResponse {
  readonly status: "ready" | "not_ready";
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
  readonly error: {
    readonly code: SafeErrorCode;
    readonly request_id?: string;
  };
}
