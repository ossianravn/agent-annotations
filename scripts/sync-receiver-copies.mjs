// Copies the canonical receiver runtime files into the two places that get
// installed into user repos, then checks every copy is byte-identical.
// Usage: node scripts/sync-receiver-copies.mjs [--check]
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "packages/agent-annotations-receiver/bin");
// Canonical name -> name inside .tools/ (repos may be ESM, so .js becomes .cjs).
export const RUNTIME_FILES = {
  "agent-annotations-receiver.js": "agent-annotations-receiver.cjs",
  "agent-annotations-receiver-assets.cjs": "agent-annotations-receiver-assets.cjs",
  "agent-annotations-receiver-cards.cjs": "agent-annotations-receiver-cards.cjs",
  "agent-annotations-cards.cjs": "agent-annotations-cards.cjs"
};
const destinations = [
  "repo-integration/.tools",
  "packages/agent-annotations/templates/repo-integration/.tools"
];

// Windows indexers and virus scanners briefly lock freshly written files.
async function copyWithRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await copyFile(from, to);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

const checkOnly = process.argv.includes("--check");
let mismatches = 0;
for (const [canonical, installed] of Object.entries(RUNTIME_FILES)) {
  const from = path.join(source, canonical);
  const expected = await readFile(from);
  for (const directory of destinations) {
    const to = path.join(root, directory, installed);
    if (!checkOnly) await copyWithRetry(from, to);
    const actual = await readFile(to).catch(() => null);
    if (!actual?.equals(expected)) {
      mismatches += 1;
      console.error(`Out of sync: ${path.relative(root, to)}`);
    }
  }
}
if (mismatches) process.exit(1);
console.log(checkOnly ? "Receiver copies are in sync." : "Receiver copies updated and verified.");
