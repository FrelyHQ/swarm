import { describe, expect, test } from "bun:test";
import { validateServiceUrl } from "../src/config";

describe("configuration", () => {
  test("accepts root and versioned gateway URLs", () => {
    expect(validateServiceUrl("https://gateway.example", "gateway").protocol).toBe("https:");
    expect(validateServiceUrl("http://127.0.0.1:8080/v1", "gateway").pathname).toBe("/v1");
  });
  test("rejects credentials and URL modifiers", () => {
    expect(() => validateServiceUrl("https://user:pass@gateway.example", "gateway")).toThrow();
    expect(() => validateServiceUrl("https://gateway.example?key=x", "gateway")).toThrow();
  });
});
