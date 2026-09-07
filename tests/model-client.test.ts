import { expect, test } from "bun:test";

import type { SwarmConfig } from "../src/config";
import type { ResponsesRequest } from "../src/contracts";
import { OpenAIVisionModel, type ResponsesClientPort } from "../src/model-client";

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

const request: ResponsesRequest = Object.freeze({
  model: "swarm/vision-basic",
  input: [{ content: [{ type: "input_image", image_url: "https://images.example.test/demo.png" }] }],
  stream: false,
  store: false,
});

test("forces the configured backing model and preserves the virtual model at the boundary", async () => {
  let seenBody: Record<string, unknown> | undefined;
  let seenRequestId: string | undefined;
  const responses: ResponsesClientPort = {
    async create(body, options) {
      seenBody = body;
      seenRequestId = options.headers?.["x-client-request-id"];
      return { id: "resp_test", object: "response", status: "completed", model: "gpt-5.6-luna" };
    },
  };
  const result = await new OpenAIVisionModel(config, responses).createResponse(request, "req_test");
  expect(seenBody?.model).toBe("gpt-5.6-luna");
  expect(seenBody?.stream).toBe(false);
  expect(seenBody?.store).toBe(false);
  expect(seenRequestId).toBe("req_test");
  expect(result.model).toBe("swarm/vision-basic");
});
