import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const forbidden = [
  "@mastra", "@modelcontextprotocol", "posthog", "SNAPSHOT.md", "hackathon", "billing", "quota", "settlement",
  "admin/owner", "docker.sock", "BEGIN OPENSSH", "Authorization: Bearer", "DATABASE_URL",
  "internal.frely", "staging.frely", "old-runtime",
];
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path); else files.push(path);
  }
}
await walk(root);
const violations = [];
for (const file of files) {
  const name = relative(root, file);
  // The license and security/test fixtures contain standard explanatory words and
  // deliberate rejection examples; boundary checks target shipped implementation.
  if (["LICENSE", "README.md", "SECURITY.md", "scripts/verify-public-boundary.mjs"].includes(name) || name.startsWith("tests/")) continue;
  const text = await readFile(file, "utf8");
  for (const pattern of forbidden) if (text.toLowerCase().includes(pattern.toLowerCase())) violations.push(`${name} contains forbidden boundary marker`);
}
const compose = await readFile(join(root, "compose.yaml"), "utf8");
for (const unsafe of ["privileged:", "network_mode: host", "docker.sock", "volumes:"]) if (compose.includes(unsafe)) violations.push(`compose contains unsafe property: ${unsafe}`);
if (!compose.includes("read_only: true") || !compose.includes("cap_drop:") || !compose.includes("pids_limit:") || !compose.includes("127.0.0.1:")) violations.push("compose is missing required isolation limits");
if (violations.length) { console.error(violations.join("\n")); process.exit(1); }
console.log(`boundary: ok (${files.length} files checked)`);
