import { describe, expect, test } from "bun:test";

import { InputError, validateResponsesRequest } from "../src/validation";

const validRequest = {
  model: "vision-basic",
  input: [{
    role: "user",
    content: [
      { type: "input_text", text: "Describe this image." },
      { type: "input_image", image_url: "https://images.example.test/demo.png" },
    ],
  }],
};

describe("Responses request validation", () => {
  test("accepts direct and Frely-prefixed virtual-model requests", () => {
    expect(validateResponsesRequest(validRequest, "vision-basic")).toMatchObject({
      model: "vision-basic",
      stream: false,
      store: false,
    });
    expect(validateResponsesRequest({ ...validRequest, model: "swarm/vision-basic" }, "vision-basic").model)
      .toBe("swarm/vision-basic");
  });

  test("requires an image and the configured public model", () => {
    expect(() => validateResponsesRequest({
      ...validRequest,
      input: [{ role: "user", content: [{ type: "input_text", text: "Text only" }] }],
    }, "vision-basic")).toThrowError(new InputError("invalid_request"));
    expect(() => validateResponsesRequest({ ...validRequest, model: "gpt-5.6-luna" }, "vision-basic"))
      .toThrowError(new InputError("invalid_request"));
  });

  test("rejects streaming, storage, control fields, and malformed image URLs", () => {
    expect(() => validateResponsesRequest({ ...validRequest, stream: true }, "vision-basic")).toThrow();
    expect(() => validateResponsesRequest({ ...validRequest, store: true }, "vision-basic")).toThrow();
    expect(() => validateResponsesRequest({ ...validRequest, api_key: "not-allowed" }, "vision-basic")).toThrow();
    expect(() => validateResponsesRequest({
      ...validRequest,
      input: [{ content: [{ type: "input_image", image_url: "file:///tmp/image.png" }] }],
    }, "vision-basic")).toThrow();
    expect(() => validateResponsesRequest({
      ...validRequest,
      input: [{ content: [{ type: "input_image", image_url: "data:image/png;base64,AA==" }] }],
    }, "vision-basic")).toThrow();
  });
});
