import { describe, expect, test } from "bun:test";
import { createHandler } from "../src/server";
import type { SnapConfig } from "../src/config";

const config: SnapConfig = { port: 8787, gatewayUrl: new URL("http://gateway"), gatewayHealthUrl: new URL("http://gateway/health"), gatewayResponsesUrl: new URL("http://gateway/v1/responses"), gatewayApiKey: "test", requireSwarm: true, swarmUrl: new URL("http://swarm"), model: "default", timeoutMs: 1000 };

describe("HTTP boundary", () => {
  test("health is liveness only", async () => {
    let probes = 0;
    const handler = createHandler(config, { probeGateway: async () => { probes++; return "ready"; }, probeSwarm: async () => { probes++; return "ready"; }, debug: async () => "ok" } as any);
    const response = await handler(new Request("http://snap/healthz"));
    expect(response.status).toBe(200);
    expect(probes).toBe(0);
  });
  test("readiness probes dependencies and debug returns only safe result fields", async () => {
    const handler = createHandler(config, { probeGateway: async () => "ready", probeSwarm: async () => "ready", debug: async () => "safe answer" } as any);
    const ready = await handler(new Request("http://snap/readyz"));
    expect(ready.status).toBe(200);
    const response = await handler(new Request("http://snap/v1/debug", { method: "POST", body: JSON.stringify({ project: { id: "a", chain: "ethereum", network: "local" }, problem: { title: "t", description: "d" }, question: "q" }), headers: { "content-type": "application/json" } }));
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual(["request_id", "result"]);
  });
  test("sensitive input never reaches the client", async () => {
    const handler = createHandler(config, { probeGateway: async () => "ready", probeSwarm: async () => "ready", debug: async () => { throw new Error("must not call"); } } as any);
    const response = await handler(new Request("http://snap/v1/debug", { method: "POST", body: JSON.stringify({ project: { id: "a", chain: "ethereum", network: "local" }, problem: { title: "t", description: "d" }, context: { bearer: "x" }, question: "q" }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "sensitive_input" } });
  });
});
