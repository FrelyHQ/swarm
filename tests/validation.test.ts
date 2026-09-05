import { describe, expect, test } from "bun:test";
import { InputError, makePrompt, validateDebugRequest } from "../src/validation";

describe("validation", () => {
  test("accepts bounded debug input and creates an untrusted prompt", () => {
    const request = validateDebugRequest({ project: { id: "app", chain: "ethereum", network: "local" }, problem: { title: "Error", description: "Details" }, context: { code: 42 }, question: "What next?" });
    expect(makePrompt(request)).toContain("untrusted data");
  });
  test("rejects sensitive-shaped fields with a stable code", () => {
    expect(() => validateDebugRequest({ project: { id: "app", chain: "ethereum", network: "local" }, problem: { title: "Error", description: "Details" }, context: { private_key: "x" }, question: "What next?" })).toThrowError(new InputError("sensitive_input"));
  });
  test("rejects unknown request fields", () => {
    expect(() => validateDebugRequest({ project: { id: "app", chain: "ethereum", network: "local" }, problem: { title: "Error", description: "Details" }, question: "x", model: "other" })).toThrow();
  });
});
