import { describe, expect, test } from "bun:test";

import { loadConfig, validateServiceUrl } from "../src/config";

describe("configuration", () => {
  test("normalizes root and /v1 Gateway URLs to the public paths", async () => {
    const root = await loadConfig({
      FRELY_GATEWAY_URL: "https://gateway.example.test",
      SNAP_SWARM_URL: "https://swarm.example.test/",
      SNAP_MODEL: "web3/debug",
      GATEWAY_API_KEY: "local-key",
    });
    expect(root.gatewayHealthUrl.toString()).toBe("https://gateway.example.test/health");
    expect(root.gatewayResponsesUrl.toString()).toBe("https://gateway.example.test/v1/responses");

    const versioned = await loadConfig({
      FRELY_GATEWAY_URL: "https://gateway.example.test/v1",
      SNAP_REQUIRE_SWARM: "false",
      SNAP_MODEL: "web3/debug",
      GATEWAY_API_KEY: "local-key",
    });
    expect(versioned.gatewayHealthUrl.toString()).toBe("https://gateway.example.test/health");
    expect(versioned.gatewayResponsesUrl.toString()).toBe("https://gateway.example.test/v1/responses");
    expect(versioned.swarmUrl).toBeUndefined();
  });

  test("rejects URL credentials, queries, fragments, and unsupported protocols", () => {
    expect(() => validateServiceUrl("https://user:pass@gateway.example.test", "gateway")).toThrow();
    expect(() => validateServiceUrl("https://gateway.example.test?key=value", "gateway")).toThrow();
    expect(() => validateServiceUrl("https://gateway.example.test/#fragment", "gateway")).toThrow();
    expect(() => validateServiceUrl("file:///tmp/gateway", "gateway")).toThrow();
  });

  test("requires the Swarm probe unless hosted mode explicitly disables it", async () => {
    await expect(loadConfig({
      SNAP_MODEL: "web3/debug",
      GATEWAY_API_KEY: "local-key",
      SNAP_REQUIRE_SWARM: "true",
    })).rejects.toThrow("Swarm probe URL is required");

    await expect(loadConfig({
      SNAP_MODEL: "web3/debug",
      GATEWAY_API_KEY: "local-key",
      SNAP_REQUIRE_SWARM: "false",
    })).resolves.toMatchObject({ requireSwarm: false });
  });
});
