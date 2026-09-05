import { expect, test } from "bun:test";
import { FrelyClient } from "../src/frely-client";
import type { SnapConfig } from "../src/config";

const config: SnapConfig = { port: 1, gatewayUrl: new URL("http://gateway"), gatewayHealthUrl: new URL("http://gateway/health"), gatewayResponsesUrl: new URL("http://gateway/v1/responses"), gatewayApiKey: "secret", requireSwarm: false, model: "default", timeoutMs: 1000 };

test("client sends a generic non-streaming response request and extracts only text", async () => {
  const original = globalThis.fetch;
  let seen: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => { seen = init; return Response.json({ output_text: "answer", secret: "not returned" }); }) as typeof fetch;
  try {
    const result = await new FrelyClient(config).debug({ project: { id: "a", chain: "c", network: "n" }, problem: { title: "t", description: "d" }, question: "q" });
    expect(result).toBe("answer");
    const payload = JSON.parse(String(seen?.body));
    expect(payload.stream).toBe(false);
    expect(payload.store).toBe(false);
    expect(payload.input).toContain("untrusted data");
  } finally { globalThis.fetch = original; }
});
