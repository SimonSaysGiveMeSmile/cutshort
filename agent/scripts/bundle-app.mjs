// Bundle the built phone app into the agent package so `npx cutshort-agent`
// is fully self-contained (no sibling dist/ once published). Runs the root
// Vite build, then copies <root>/dist -> agent/dist. Cross-platform (node fs).

import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentDir = path.resolve(here, "..");
const repoRoot = path.resolve(agentDir, "..");
const srcDist = path.join(repoRoot, "dist");
const outDist = path.join(agentDir, "dist");

console.log("→ building phone app (npm run build in repo root)…");
execSync("npm run build", { cwd: repoRoot, stdio: "inherit" });

if (!existsSync(path.join(srcDist, "index.html"))) {
  console.error("✗ build did not produce dist/index.html — aborting bundle");
  process.exit(1);
}

console.log(`→ copying ${srcDist} → ${outDist}`);
rmSync(outDist, { recursive: true, force: true });
cpSync(srcDist, outDist, { recursive: true });
console.log("✓ app bundled into agent/dist");
