import { describe, expect, test } from "bun:test";

import type { SwarmConfig } from "../src/config";
import type { VisionModelPort } from "../src/model-client";
import { createHandler } from "../src/server";

const config: SwarmConfig = Object.freeze({
  host: "127.0.0.1",
  port: 4111,
  modelBaseUrl: new URL("https://model.example.test/v1"),
  modelApiKey: "model-secret",
  modelName: "gpt-5.6-luna",
  publicModel: "vision-basic",
  accessToken: "swarm-secret",
  timeoutMs: 1_000,
});

const requestBody = {
  model: "vision-basic",
  input: [{
    role: "user",
    content: [
      { type: "input_text", text: "Describe the image." },
      { type: "input_image", image_url: "https://images.example.test/demo.png" },
    ],
  }],
};

function request(path: string, body?: unknown, token = "swarm-secret"): Request {
  return new Request(`http://swarm.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function model(overrides: Partial<VisionModelPort> = {}): VisionModelPort {
  return {
    createResponse: async (input) => ({
      id: "resp_test",
      object: "response",
      status: "completed",
      model: input.model,
      output_text: "A red bicycle.",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    ...overrides,
  };
}

describe("HTTP boundary", () => {
  test("exposes liveness without probing or credentials", async () => {
    let invoked = false;
    const handler = createHandler(config, model({
      createResponse: async () => {
        invoked = true;
        return {};
      },
    }));
    const response = await handler(new Request("http://swarm.test/healthz"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(invoked).toBe(false);
  });

  test("lists only the public virtual model", async () => {
    const response = await createHandler(config, model())(request("/v1/models"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      object: "list",
      data: [{ id: "vision-basic", object: "model", created: 0, owned_by: "frely-swarm" }],
    });
  });

  test("requires the Swarm token before invoking the model", async () => {
    let invoked = false;
    const handler = createHandler(config, model({
      createResponse: async () => {
        invoked = true;
        return {};
      },
    }));
    const response = await handler(request("/v1/responses", requestBody, "wrong-token"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
    expect(invoked).toBe(false);
  });

  test("returns one Responses-compatible vision result", async () => {
    let seenRequestId = "";
    const handler = createHandler(config, model({
      createResponse: async (input, id) => {
        seenRequestId = id;
        return { id: "resp_test", object: "response", status: "completed", model: input.model, output_text: "A red bicycle." };
      },
    }));
    const response = await handler(request("/v1/responses", requestBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "resp_test",
      object: "response",
      status: "completed",
      model: "vision-basic",
      output_text: "A red bicycle.",
    });
    expect(response.headers.get("x-request-id")).toBe(seenRequestId);
  });
});
