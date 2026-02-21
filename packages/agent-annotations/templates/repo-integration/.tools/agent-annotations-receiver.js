#!/usr/bin/env node
// This file may be treated as an ES module in repos with `"type": "module"`.
// Keep the real receiver launcher in `.cjs` and load it in a way that works in both CJS and ESM.
import("./agent-annotations-receiver.cjs").catch((e) => {
  console.error(e);
  process.exit(1);
});
