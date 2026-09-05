import { describe, expect, test } from "bun:test";

import { InputError } from "../src/validation";
import { LIMITS, makePrompt, validateDebugRequest } from "../src/validation";

const baseRequest = {
  project: { id: "app", chain: "ethereum", network: "local" },
  problem: { title: "Failure", description: "A bounded example." },
  question: "What should I inspect?",
};

describe("debug input validation", () => {
  test("accepts Web3 identifiers such as tokenId and creates an untrusted prompt", () => {
    const request = validateDebugRequest({
      ...baseRequest,
      context: { tokenId: 7, transactionHash: "0x00", logs: [{ event: "Transfer" }] },
    });
    expect(makePrompt(request)).toContain("untrusted data");
    expect(request.context).toEqual({ tokenId: 7, transactionHash: "0x00", logs: [{ event: "Transfer" }] });
  });

  test("rejects sensitive keys even when their values are nested objects", () => {
    expect(() => validateDebugRequest({
      ...baseRequest,
      context: { credentials: { privateKey: { encrypted: true } } },
    })).toThrowError(new InputError("sensitive_input"));
  });

  test("rejects sensitive value shapes", () => {
    expect(() => validateDebugRequest({
      ...baseRequest,
      context: { note: "Bearer abcdefghijkl" },
    })).toThrowError(new InputError("sensitive_input"));
    expect(() => validateDebugRequest({
      ...baseRequest,
      context: { note: "eyJheader-value.payload-value.signature-value" },
    })).toThrowError(new InputError("sensitive_input"));
  });

  test("rejects prototype-changing keys, unknown fields, and excessive nesting", () => {
    expect(() => validateDebugRequest({
      ...baseRequest,
      context: JSON.parse('{"__proto__":{"polluted":true}}'),
    })).toThrowError(new InputError("invalid_request"));
    expect(() => validateDebugRequest({ ...baseRequest, model: "other" })).toThrowError(
      new InputError("invalid_request"),
    );
    let nested: unknown = "value";
    for (let index = 0; index <= LIMITS.contextDepth; index += 1) {
      nested = { child: nested };
    }
    expect(() => validateDebugRequest({ ...baseRequest, context: nested })).toThrowError(
      new InputError("invalid_request"),
    );
  });
});
