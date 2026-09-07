#!/usr/bin/env bun

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..");
const timeoutMs = 10_000;

function reservePort() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("reserved") });
  const port = server.port;
  server.stop(true);
  return port;
}

async function waitFor(url) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The child is still starting.
    }
    await Bun.sleep(25);
  }
  throw new Error("smoke service did not become ready");
}

const modelPort = reservePort();
const swarmPort = reservePort();
let seenModelRequest;

const model = Bun.serve({
  hostname: "127.0.0.1",
  port: modelPort,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/responses") {
      return new Response("not found", { status: 404 });
    }
    seenModelRequest = {
      authorization: request.headers.get("authorization"),
      requestId: request.headers.get("x-client-request-id"),
      body: await request.json(),
    };
    return Response.json({
      id: "resp_smoke",
      object: "response",
      created_at: 0,
      status: "completed",
      model: "gpt-5.6-luna",
      output: [{
        id: "msg_smoke",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "A red bicycle beside a brick wall.", annotations: [] }],
      }],
      usage: {
        input_tokens: 12,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 8,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 20,
      },
    });
  },
});

const directory = await mkdtemp(join(tmpdir(), "frely-swarm-smoke-"));
const modelKeyFile = join(directory, "model-key");
const accessTokenFile = join(directory, "access-token");
await writeFile(modelKeyFile, "smoke-model-key", { mode: 0o600 });
await writeFile(accessTokenFile, "smoke-swarm-token", { mode: 0o600 });
const entry = await Bun.file(join(root, "dist/server.js")).exists() ? "dist/server.js" : "src/server.ts";
const child = Bun.spawn(["bun", entry], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "production",
    SWARM_HOST: "127.0.0.1",
    PORT: String(swarmPort),
    MODEL_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
    MODEL_API_KEY_FILE: modelKeyFile,
    MODEL_NAME: "gpt-5.6-luna",
    SWARM_PUBLIC_MODEL: "vision-basic",
    SWARM_ACCESS_TOKEN_FILE: accessTokenFile,
    MODEL_TIMEOUT_MS: "1000",
  },
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
});

try {
  const baseUrl = `http://127.0.0.1:${swarmPort}`;
  await waitFor(`${baseUrl}/healthz`);
  const models = await (await fetch(`${baseUrl}/v1/models`, {
    headers: { authorization: "Bearer smoke-swarm-token" },
  })).json();
  if (models.data?.[0]?.id !== "vision-basic") throw new Error("model catalog contract failed");

  const response = await fetch(`${baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      authorization: "Bearer smoke-swarm-token",
      "content-type": "application/json",
      "x-request-id": "req_smoke",
    },
    body: JSON.stringify({
      model: "vision-basic",
      input: [{
        role: "user",
        content: [
          { type: "input_text", text: "Describe the image." },
          { type: "input_image", image_url: "https://images.example.test/bicycle.png" },
        ],
      }],
    }),
  });
  const body = await response.json();
  if (!response.ok || body.model !== "vision-basic" || body.output_text.length === 0) {
    throw new Error(`vision response contract failed with status ${response.status}`);
  }
  if (
    seenModelRequest?.authorization !== "Bearer smoke-model-key" ||
    seenModelRequest?.requestId !== "req_smoke" ||
    seenModelRequest?.body?.model !== "gpt-5.6-luna" ||
    seenModelRequest?.body?.stream !== false ||
    seenModelRequest?.body?.store !== false
  ) {
    throw new Error("model forwarding contract failed");
  }
  console.log("smoke: ok");
} finally {
  child.kill("SIGTERM");
  await child.exited.catch(() => undefined);
  model.stop(true);
  await rm(directory, { recursive: true, force: true });
}
