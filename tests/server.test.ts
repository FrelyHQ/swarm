import { describe, expect, test } from "bun:test";

import type { SnapConfig } from "../src/config";
import type { FrelyClientPort } from "../src/frely-client";
import { createHandler } from "../src/server";

const config: SnapConfig = Object.freeze({
  host: "127.0.0.1",
  port: 8787,
  gatewayUrl: new URL("http://gateway.test"),
  gatewayHealthUrl: new URL("http://gateway.test/health"),
  gatewayResponsesUrl: new URL("http://gateway.test/v1/responses"),
  gatewayApiKey: "test-key",
  requireSwarm: true,
  swarmUrl: new URL("http://swarm.test"),
  model: "web3/debug",
  timeoutMs: 1_000,
});

function client(overrides: Partial<FrelyClientPort> = {}): FrelyClientPort {
  return {
    probeGateway: async () => "ready",
    probeSwarm: async () => "ready",
    debug: async () => "safe answer",
    ...overrides,
  };
}

function debugRequest(context?: unknown): Request {
  return new Request("http://snap.test/v1/debug", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project: { id: "app", chain: "ethereum", network: "local" },
      problem: { title: "Failure", description: "A bounded example." },
      ...(context === undefined ? {} : { context }),
      question: "What should I inspect?",
    }),
  });
}

describe("HTTP boundary", () => {
  test("health is liveness-only", async () => {
    let probes = 0;
    const handler = createHandler(config, client({
      probeGateway: async () => {
        probes += 1;
        return "ready";
      },
      probeSwarm: async () => {
        probes += 1;
        return "ready";
      },
    }));
    const response = await handler(new Request("http://snap.test/healthz"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(probes).toBe(0);
  });

  test("readiness fails closed when a required dependency is unavailable", async () => {
    const handler = createHandler(config, client({ probeSwarm: async () => "unavailable" }));
    const response = await handler(new Request("http://snap.test/readyz"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });

  test("hosted mode does not probe an optional Swarm URL", async () => {
    let swarmProbes = 0;
    const hostedConfig: SnapConfig = {
      ...config,
      requireSwarm: false,
      swarmUrl: undefined,
    };
    const handler = createHandler(hostedConfig, client({
      probeSwarm: async () => {
        swarmProbes += 1;
        return "unavailable";
      },
    }));
    const response = await handler(new Request("http://snap.test/readyz"));
    expect(response.status).toBe(200);
    expect(swarmProbes).toBe(0);
  });

  test("debug returns only a correlation ID and result", async () => {
    let receivedId = "";
    const handler = createHandler(config, client({
      debug: async (_request, requestId) => {
        receivedId = requestId;
        return "safe answer";
      },
    }));
    const response = await handler(debugRequest({ step: "simulation", tokenId: 7 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["request_id", "result"]);
    expect(body.request_id).toBe(receivedId);
    expect(response.headers.get("x-request-id")).toBe(receivedId);
  });

  test("sensitive input is rejected before the client is called", async () => {
    let invoked = false;
    const handler = createHandler(config, client({
      debug: async () => {
        invoked = true;
        return "must not run";
      },
    }));
    const response = await handler(debugRequest({ privateKey: "not-for-use" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "sensitive_input" } });
    expect(invoked).toBe(false);
  });

  test("rejects an oversized body before JSON parsing", async () => {
    const handler = createHandler(config, client());
    const response = await handler(new Request("http://snap.test/v1/debug", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(256 * 1024 + 1),
    }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "body_too_large" } });
  });
});
