import { readdir } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export async function findChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const browserRoot = path.join(os.homedir(), ".agent-browser/browsers");
  try {
    const versions = (await readdir(browserRoot))
      .filter((name) => name.startsWith("chrome-"))
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    if (versions[0]) return path.join(browserRoot, versions[0], "chrome");
  } catch {
    // Fall through to the system Chrome path.
  }
  return "/usr/bin/google-chrome";
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

export async function waitForEvaluation(chrome, sessionId, expression, description) {
  await waitFor(() => evaluate(chrome, sessionId, expression), description);
}

export async function stopProcess(process) {
  if (!process || process.exitCode != null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => {
    process.once("exit", resolve);
    setTimeout(resolve, 1000);
  });
}
