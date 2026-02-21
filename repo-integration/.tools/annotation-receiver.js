#!/usr/bin/env node
// Backward-compatible shim. Prefer: node .tools/agent-annotations-receiver.cjs
import("./agent-annotations-receiver.cjs").catch((e) => {
  console.error(e);
  process.exit(1);
});
