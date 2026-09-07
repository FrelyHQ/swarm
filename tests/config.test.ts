import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, validateModelBaseUrl } from "../src/config";

describe("configuration", () => {
  test("uses the Luna-backed vision virtual-model defaults", async () => {
    const config = await loadConfig({
      MODEL_API_KEY: "model-key",
      SWARM_ACCESS_TOKEN: "swarm-token",
    });
    expect(config.modelBaseUrl.toString()).toBe("https://api.openai.com/v1");
    expect(config.modelName).toBe("gpt-5.6-luna");
    expect(config.publicModel).toBe("vision-basic");
    expect(config.port).toBe(4111);
  });

  test("rejects URL credentials, fragments, unsupported protocols, and remote HTTP", () => {
    expect(() => validateModelBaseUrl("https://user:pass@model.example.test/v1")).toThrow();
    expect(() => validateModelBaseUrl("https://model.example.test/v1#fragment")).toThrow();
    expect(() => validateModelBaseUrl("file:///tmp/model")).toThrow();
    expect(() => validateModelBaseUrl("http://model.example.test/v1")).toThrow(/insecure/);
    expect(() => validateModelBaseUrl("http://model.example.test/v1", { allowInsecureHttp: true })).not.toThrow();
    expect(() => validateModelBaseUrl("http://127.0.0.1:8080/v1")).not.toThrow();
  });

  test("reads both independent credentials from files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frely-swarm-config-"));
    const modelKey = join(directory, "model-key");
    const accessToken = join(directory, "access-token");
    await writeFile(modelKey, "model-secret", { mode: 0o600 });
    await writeFile(accessToken, "swarm-secret", { mode: 0o600 });
    try {
      await expect(loadConfig({
        MODEL_API_KEY_FILE: modelKey,
        SWARM_ACCESS_TOKEN_FILE: accessToken,
      })).resolves.toMatchObject({
        modelApiKey: "model-secret",
        accessToken: "swarm-secret",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("requires model and service credentials without conflating them", async () => {
    await expect(loadConfig({ SWARM_ACCESS_TOKEN: "swarm-token" })).rejects.toThrow("model API key");
    await expect(loadConfig({ MODEL_API_KEY: "model-key" })).rejects.toThrow("Swarm access token");
  });
});
