#!/usr/bin/env bun

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const timeoutMs = 10_000;

function reservePort() {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("reserved"),
  });
  const port = server.port;
  server.stop(true);
  return port;
}

async function waitFor(url, predicate) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (await predicate(response)) return;
    } catch {
      // The child is still starting.
    }
    await Bun.sleep(25);
  }
  throw new Error("smoke service did not become ready");
}

const gatewayPort = reservePort();
const swarmPort = reservePort();
const snapPort = reservePort();
let seenGatewayRequest;

const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: gatewayPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/v1/responses") {
      const body = await request.json();
      seenGatewayRequest = {
        authorization: request.headers.get("authorization"),
        requestId: request.headers.get("x-request-id"),
        body,
      };
      return Response.json({
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Inspect the simulation boundary first." }],
        }],
      });
    }
    return new Response("not found", { status: 404 });
  },
});

const swarm = Bun.serve({
  hostname: "127.0.0.1",
  port: swarmPort,
  fetch: () => Response.json({ ok: true }),
});

const temporaryDirectory = await mkdtemp(join(tmpdir(), "frely-snap-smoke-"));
const secretFile = join(temporaryDirectory, "gateway-key");
await writeFile(secretFile, "smoke-gateway-key", { mode: 0o600 });
const entry = await Bun.file(join(root, "dist/server.js")).exists()
  ? "dist/server.js"
  : "src/server.ts";
const child = Bun.spawn(["bun", entry], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    SNAP_HOST: "127.0.0.1",
    PORT: String(snapPort),
    FRELY_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`,
    GATEWAY_API_KEY_FILE: secretFile,
    SNAP_SWARM_URL: `http://127.0.0.1:${swarmPort}`,
    SNAP_REQUIRE_SWARM: "true",
    SNAP_MODEL: "debug/model",
    SNAP_TIMEOUT_MS: "1000",
  },
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
});

try {
  const baseUrl = `http://127.0.0.1:${snapPort}`;
  await waitFor(`${baseUrl}/healthz`, async (response) => response.ok);

  const health = await (await fetch(`${baseUrl}/healthz`)).json();
  if (health.status !== "ok") throw new Error("liveness contract failed");

  const readinessResponse = await fetch(`${baseUrl}/readyz`);
  const readiness = await readinessResponse.json();
  if (!readinessResponse.ok || readiness.status !== "ready") {
    throw new Error("readiness contract failed");
  }

  const debugResponse = await fetch(`${baseUrl}/v1/debug`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project: { id: "demo", chain: "ethereum", network: "local" },
      problem: { title: "Simulation mismatch", description: "A bounded example failure." },
      context: { step: "simulation", tokenId: 7 },
      question: "What should I inspect first?",
    }),
  });
  const debug = await debugResponse.json();
  if (!debugResponse.ok || typeof debug.request_id !== "string" || !debug.result) {
    throw new Error("debug request contract failed");
  }
  if (
    seenGatewayRequest?.authorization !== "Bearer smoke-gateway-key" ||
    seenGatewayRequest?.body?.model !== "debug/model" ||
    seenGatewayRequest?.body?.stream !== false ||
    seenGatewayRequest?.body?.store !== false ||
    typeof seenGatewayRequest?.requestId !== "string"
  ) {
    throw new Error("gateway forwarding contract failed");
  }

  const sensitiveResponse = await fetch(`${baseUrl}/v1/debug`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project: { id: "demo", chain: "ethereum", network: "local" },
      problem: { title: "Invalid", description: "Invalid" },
      context: { privateKey: "not-a-real-key" },
      question: "help",
    }),
  });
  const sensitive = await sensitiveResponse.json();
  if (sensitiveResponse.status !== 400 || sensitive.error?.code !== "sensitive_input") {
    throw new Error("sensitive input contract failed");
  }

  console.log("smoke: ok");
} finally {
  child.kill("SIGTERM");
  await child.exited.catch(() => undefined);
  gateway.stop(true);
  swarm.stop(true);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
