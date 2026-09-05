#!/usr/bin/env bun

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const forbiddenPaths = [
  ".mastra",
  "SNAPSHOT.md",
  "src/mastra",
  "src/adapters",
  "tests/mcp.test.ts",
  "tests/openai-responses.test.ts",
];
const forbiddenMarkers = [
  "@mastra",
  "@modelcontextprotocol",
  "FRIDAY_RELAY",
  "CLIPROXY",
  "posthog",
  "stripe",
  "billing",
  "quota",
  "settlement",
  "subscription",
  "hackathon",
  "flutter-agent",
  "artifact-foundry",
  "host-governance",
  "wyattcoder.top",
  "ctb-",
  "docker.sock",
  "postgres",
  "BEGIN RSA PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
];

const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(root);

const violations = [];
for (const forbiddenPath of forbiddenPaths) {
  if (files.some((file) => relative(root, file) === forbiddenPath || relative(root, file).startsWith(`${forbiddenPath}/`))) {
    violations.push(`forbidden path: ${forbiddenPath}`);
  }
}

for (const file of files) {
  const name = relative(root, file);
  if (name === "scripts/verify-public-boundary.mjs" || name === "LICENSE") continue;
  const text = await readFile(file, "utf8");
  const lower = text.toLowerCase();
  for (const marker of forbiddenMarkers) {
    if (lower.includes(marker.toLowerCase())) {
      violations.push(`${name} contains forbidden marker`);
    }
  }
  if (/[\u0000]/u.test(text)) violations.push(`${name} contains a NUL byte`);
  if (/BEGIN [A-Z0-9 ]+PRIVATE KEY/iu.test(text)) {
    violations.push(`${name} contains a private-key marker`);
  }
}

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (packageJson.private !== false) violations.push("package.json must declare private=false");
if (packageJson.license !== "Apache-2.0") violations.push("package.json must declare Apache-2.0");
for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
  for (const name of Object.keys(packageJson[section] ?? {})) {
    if (/^(?:@mastra|@modelcontextprotocol|openai|ethers|viem|web3|prisma|drizzle)/iu.test(name)) {
      violations.push(`disallowed dependency: ${name}`);
    }
  }
}

const dockerignore = await readFile(join(root, ".dockerignore"), "utf8");
for (const required of [".git", "node_modules", ".env", "secrets"]) {
  if (!dockerignore.split(/\r?\n/u).includes(required)) {
    violations.push(`.dockerignore is missing: ${required}`);
  }
}

const composeFiles = ["compose.yaml", "compose.local.yaml", "compose.swarm-auth.yaml"];
for (const composeFile of composeFiles) {
  const composePath = join(root, composeFile);
  const compose = await readFile(composePath, "utf8");
  for (const marker of ["privileged:", "network_mode: host", "docker.sock"]) {
    if (compose.toLowerCase().includes(marker.toLowerCase())) {
      violations.push(`${composeFile} contains unsafe property: ${marker}`);
    }
  }
}
const compose = await readFile(join(root, "compose.yaml"), "utf8");
for (const required of [
  "read_only: true",
  "cap_drop:",
  "no-new-privileges:true",
  "mem_limit: 256m",
  "cpus: \"0.50\"",
  "pids_limit: 128",
  "restart:",
  "healthcheck:",
  "secrets:",
  "127.0.0.1:",
]) {
  if (!compose.includes(required)) violations.push(`compose is missing: ${required}`);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`boundary: ok (${files.length} files checked)`);
