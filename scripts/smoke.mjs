const port = 19_878;
const gatewayPort = 19_879;
const swarmPort = 19_880;
const gateway = Bun.serve({
  port: gatewayPort,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ ok: true });
    if (url.pathname === "/v1/responses" && request.method === "POST") return Response.json({ output_text: "Use the network's documented endpoint and inspect the returned error." });
    return new Response("no", { status: 404 });
  },
});
const swarm = Bun.serve({ port: swarmPort, fetch: () => Response.json({ ok: true }) });
const secret = `${Bun.env.TMPDIR ?? "/tmp"}/frely-snap-smoke-${process.pid}`;
await Bun.write(secret, "smoke-key");
const child = Bun.spawn(["bun", "src/server.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: { ...process.env, PORT: String(port), FRELY_GATEWAY_URL: `http://127.0.0.1:${gatewayPort}`, SNAP_SWARM_URL: `http://127.0.0.1:${swarmPort}`, GATEWAY_API_KEY_FILE: secret, SNAP_REQUIRE_SWARM: "true", SNAP_MODEL: "default" },
  stdout: "ignore",
  stderr: "pipe",
});
try {
  const deadline = Date.now() + 5_000;
  let ready = false;
  while (Date.now() < deadline) {
    try { const response = await fetch(`http://127.0.0.1:${port}/healthz`); if (response.ok) { ready = true; break; } } catch {}
    await Bun.sleep(25);
  }
  if (!ready) throw new Error("service did not start");
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  if ((await health.json()).status !== "ok") throw new Error("health check failed");
  const readiness = await fetch(`http://127.0.0.1:${port}/readyz`);
  if (!readiness.ok || (await readiness.json()).status !== "ready") throw new Error("readiness check failed");
  const good = await fetch(`http://127.0.0.1:${port}/v1/debug`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: { id: "demo", chain: "ethereum", network: "local" }, problem: { title: "RPC response mismatch", description: "A harmless example error." }, context: { step: "read" }, question: "What should I inspect first?" }) });
  const goodBody = await good.json();
  if (!good.ok || !goodBody.request_id || !goodBody.result) throw new Error("debug request failed");
  const bad = await fetch(`http://127.0.0.1:${port}/v1/debug`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project: { id: "demo", chain: "ethereum", network: "local" }, problem: { title: "bad", description: "bad" }, context: { private_key: "not-for-use" }, question: "help" }) });
  const badBody = await bad.json();
  if (bad.status !== 400 || badBody.error?.code !== "sensitive_input") throw new Error("sensitive input was not rejected");
  console.log("smoke: ok");
} finally {
  child.kill();
  gateway.stop();
  swarm.stop();
  await Bun.write(secret, "");
  try { await Bun.file(secret).delete(); } catch {}
}
