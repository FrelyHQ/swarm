import { expect, test } from "bun:test";

import type { SnapConfig } from "../src/config";
import { FrelyClient, type FetchLike } from "../src/frely-client";
import type { DebugRequest } from "../src/contracts";

const config: SnapConfig = Object.freeze({
  host: "127.0.0.1",
  port: 8787,
  gatewayUrl: new URL("http://gateway.test"),
  gatewayHealthUrl: new URL("http://gateway.test/health"),
  gatewayResponsesUrl: new URL("http://gateway.test/v1/responses"),
  gatewayApiKey: "gateway-secret",
  requireSwarm: false,
  model: "web3/debug",
  timeoutMs: 1_000,
});

const debugRequest: DebugRequest = {
  project: { id: "app", chain: "ethereum", network: "local" },
  problem: { title: "Failure", description: "A bounded example." },
  context: { tokenId: 7 },
  question: "What should I inspect?",
};

test("forwards one bounded non-streaming request and extracts only public text", async () => {
  let seenInput: RequestInfo | URL | undefined;
  let seenInit: RequestInit | undefined;
  const fetcher: FetchLike = async (input, init) => {
    seenInput = input;
    seenInit = init;
    return Response.json({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "safe answer" }],
      }],
      internal: "must not cross the boundary",
    });
  };

  const result = await new FrelyClient(config, fetcher).debug(debugRequest, "req_test");
  expect(result).toBe("safe answer");
  expect(String(seenInput)).toBe("http://gateway.test/v1/responses");
  const headers = new Headers(seenInit?.headers);
  expect(headers.get("authorization")).toBe("Bearer gateway-secret");
  expect(headers.get("x-request-id")).toBe("req_test");
  expect(headers.get("content-type")).toContain("application/json");
  const payload = JSON.parse(String(seenInit?.body));
  expect(payload.model).toBe("web3/debug");
  expect(payload.stream).toBe(false);
  expect(payload.store).toBe(false);
  expect(payload.input).toContain("untrusted data");
});

test("does not send the Gateway key to the liveness probe", async () => {
  let seenHeaders: Headers | undefined;
  const fetcher: FetchLike = async (_input, init) => {
    seenHeaders = new Headers(init?.headers);
    return Response.json({ ok: true });
  };
  await expect(new FrelyClient(config, fetcher).probeGateway()).resolves.toBe("ready");
  expect(seenHeaders?.get("authorization")).toBeNull();
});

test("maps malformed and rejected upstream responses without copying their body", async () => {
  const malformedFetcher: FetchLike = async () => Response.json({ output: [] });
  await expect(new FrelyClient(config, malformedFetcher).debug(debugRequest, "req_invalid"))
    .rejects.toMatchObject({ code: "gateway_invalid_response" });

  const rejectedFetcher: FetchLike = async () => new Response("private upstream detail", { status: 403 });
  await expect(new FrelyClient(config, rejectedFetcher).debug(debugRequest, "req_rejected"))
    .rejects.toMatchObject({ code: "gateway_rejected" });
});
