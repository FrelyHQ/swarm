export interface ResponsesRequest {
  readonly model: string;
  readonly input: unknown;
  readonly stream: false;
  readonly store: false;
  readonly [key: string]: unknown;
}

export type SafeErrorCode =
  | "invalid_request"
  | "body_too_large"
  | "unauthorized"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "upstream_invalid_response"
  | "internal_error";

export interface SafeErrorResponse {
  readonly error: {
    readonly message: string;
    readonly type: "invalid_request_error" | "authentication_error" | "upstream_error" | "server_error";
    readonly code: SafeErrorCode;
    readonly request_id: string;
  };
}
