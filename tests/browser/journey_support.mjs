import { readdir, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

// Chrome for Testing (as installed under ~/.agent-browser) has a different
// layout on each OS; installed Chrome is the fallback.
const TESTING_BUILD_BINARIES = [
  "chrome-win64/chrome.exe",
  "chrome-linux64/chrome",
  "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "chrome"
];
const INSTALLED_CHROME = {
  win32: [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
};

export async function findChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [];
  const browserRoot = path.join(os.homedir(), ".agent-browser/browsers");
  try {
    const versions = (await readdir(browserRoot))
      .filter((name) => name.startsWith("chrome-"))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    for (const version of versions) {
      candidates.push(...TESTING_BUILD_BINARIES.map((binary) => path.join(browserRoot, version, binary)));
    }
  } catch {
    // No testing builds installed; try installed Chrome.
  }
  candidates.push(...(INSTALLED_CHROME[process.platform] || []));
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not here; try the next one.
    }
  }
  throw new Error(`No Chrome found. Set CHROME_PATH, or install Chrome for Testing. Looked in:\n${candidates.join("\n")}`);
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function waitFor(check, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

export async function evaluate(chrome, sessionId, expression) {
  const response = await chrome.command("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

export async function click(chrome, sessionId, selector) {
  const response = await chrome.command("Runtime.evaluate", {
    expression: `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Missing click target: ${selector}");
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  const point = response.result?.value;
  await chrome.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1
  }, sessionId);
  await chrome.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1
  }, sessionId);
}

// A page that is still loading throws on missing elements; that is "not yet",
// not a failure. The last error is reported if the wait times out.
export async function waitForEvaluation(chrome, sessionId, expression, description) {
  let lastError = null;
  try {
    await waitFor(async () => {
      try {
        return await evaluate(chrome, sessionId, expression);
      } catch (error) {
        lastError = error;
        return false;
      }
    }, description);
  } catch (error) {
    if (lastError) error.message += ` Last error: ${lastError.message}`;
    throw error;
  }
}

export async function stopProcess(process) {
  if (!process || process.exitCode != null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => {
    process.once("exit", resolve);
    setTimeout(resolve, 1000);
  });
}

// Cards on disk, parsed the way agents read them: JSON front matter + body.
export async function readCards(repoRoot) {
  const { readdir, readFile } = await import("node:fs/promises");
  const cardsDir = path.join(repoRoot, ".agent-annotations", "cards");
  const cards = [];
  for (const entry of await readdir(cardsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const text = (await readFile(path.join(cardsDir, entry.name, "card.md"), "utf8")).replace(/\r\n/g, "\n");
    const [, fields, body] = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
    cards.push({ ...JSON.parse(fields), comment: body.trim() });
  }
  return cards;
}
