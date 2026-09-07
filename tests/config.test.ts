import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig, validateFrelyBaseUrl } from "../src/config";

describe("configuration", () => {
  test("uses the local Frely base-model entry by default", async () => {
    const config = await loadConfig({
      FRELY_API_KEY: "frely-key",
      SWARM_ACCESS_TOKEN: "swarm-token",
    });
    expect(config.frelyBaseUrl.toString()).toBe("http://gateway-srv:43000/v1");
    expect(config.frelyModel).toBe("dev-base");
    expect(config.publicModel).toBe("vision-basic");
    expect(config.port).toBe(4111);
  });

  test("accepts only a local Frely /v1 entry", () => {
    expect(() => validateFrelyBaseUrl("https://user:pass@gateway-srv/v1")).toThrow();
    expect(() => validateFrelyBaseUrl("http://gateway-srv:43000/v1#fragment")).toThrow();
    expect(() => validateFrelyBaseUrl("file:///tmp/model")).toThrow();
    expect(() => validateFrelyBaseUrl("https://api.openai.com/v1")).toThrow(/local Frely/);
    expect(() => validateFrelyBaseUrl("http://gateway-srv:43000/models")).toThrow(/local Frely/);
    expect(() => validateFrelyBaseUrl("http://127.0.0.1:43000/v1")).not.toThrow();
    expect(() => validateFrelyBaseUrl("http://[::1]:43000/v1")).not.toThrow();
  });

  test("reads both independent credentials from files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frely-swarm-config-"));
    const modelKey = join(directory, "model-key");
    const accessToken = join(directory, "access-token");
    await writeFile(modelKey, "model-secret", { mode: 0o600 });
    await writeFile(accessToken, "swarm-secret", { mode: 0o600 });
    try {
      await expect(loadConfig({
        FRELY_API_KEY_FILE: modelKey,
        SWARM_ACCESS_TOKEN_FILE: accessToken,
      })).resolves.toMatchObject({
        frelyApiKey: "model-secret",
        accessToken: "swarm-secret",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("requires model and service credentials without conflating them", async () => {
    await expect(loadConfig({ SWARM_ACCESS_TOKEN: "swarm-token" })).rejects.toThrow("Frely API key");
    await expect(loadConfig({ FRELY_API_KEY: "frely-key" })).rejects.toThrow("Swarm access token");
  });

  test("rejects generic model configuration instead of silently ignoring it", async () => {
    await expect(loadConfig({
      MODEL_BASE_URL: "https://api.openai.com/v1",
      FRELY_API_KEY: "frely-key",
      SWARM_ACCESS_TOKEN: "swarm-token",
    })).rejects.toThrow("generic MODEL_*");
    await expect(loadConfig({
      MODEL_TIMEOUT_MS: "1000",
      FRELY_API_KEY: "frely-key",
      SWARM_ACCESS_TOKEN: "swarm-token",
    })).rejects.toThrow("generic MODEL_*");
  });
});
