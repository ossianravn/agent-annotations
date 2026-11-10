// Renders the README screenshots in docs/images from the real extension and
// receiver: headless Chrome loads chrome-extension/ unpacked, a receiver
// writes into a throwaway repo, and the agent cards CLI moves the cards along.
// Run with `pnpm screenshots:readme` (Chrome for Testing or installed Chrome).
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ChromePipe } from "../../tests/browser/chrome_pipe.mjs";
import {
  click,
  evaluate,
  findChromePath,
  freePort,
  stopProcess,
  waitFor,
  waitForEvaluation
} from "../../tests/browser/journey_support.mjs";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const here = import.meta.dirname;
const outDir = path.join(root, "docs/images");
const extensionPath = path.join(root, "chrome-extension");
const receiverBin = path.join(root, "packages/agent-annotations-receiver/bin");
const token = "readme-screenshots";
const SCALE = 2;
// The window holds the page and the side panel next to it, like a real Chrome.
const PAGE = { width: 1120, height: 760 };
const PANEL_GUESS = 400;
const BOARD = { width: 1440, height: 860 };

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "agent-annotations-readme-"));
const repo = path.join(temporaryRoot, "juniper-web");
await mkdir(path.join(repo, ".tools"), { recursive: true });
await run("git", ["init", "-q", repo]);
for (const file of ["agent-annotations-cards.cjs", "agent-annotations-receiver-cards.cjs", "agent-annotations-receiver-assets.cjs"]) {
  await copyFile(path.join(receiverBin, file), path.join(repo, ".tools", file));
}

const demoHtml = await readFile(path.join(here, "demo-page.html"));
const demoServer = http.createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(demoHtml);
});
const demoPort = await listenOn(demoServer, 3000);
const demoUrl = `http://localhost:${demoPort}/pricing`;
const receiverPort = await freePort();
const receiverUrl = `http://127.0.0.1:${receiverPort}`;

let receiverErrors = "";
const receiver = spawn(process.execPath, [
  path.join(receiverBin, "agent-annotations-receiver.js"),
  "--repo", repo, "--host", "127.0.0.1", "--port", String(receiverPort), "--base-url", receiverUrl
], { env: { ...process.env, ANNOTATION_TOKEN: token }, stdio: ["ignore", "ignore", "pipe"] });
receiver.stderr.setEncoding("utf8");
receiver.stderr.on("data", (chunk) => { receiverErrors += chunk; });
await waitFor(async () => {
  try {
    return (await fetch(`${receiverUrl}/health`)).ok;
  } catch {
    return false;
  }
}, "receiver startup");

const terminalLog = await seedCards();
const chrome = await launchChrome(path.join(temporaryRoot, "profile"));
try {
  const { id: extensionId } = await chrome.command("Extensions.loadUnpacked", { path: extensionPath });
  const { targetId: pageTargetId } = await chrome.command("Target.createTarget", { url: demoUrl });
  const pageSession = await chrome.attach(pageTargetId);
  await waitForEvaluation(chrome, pageSession, "document.readyState === 'complete'", "demo page load");
  const tab = (await chrome.command("Target.getTargets", { filter: [{}] })).targetInfos
    .find((target) => target.type === "tab" && target.url === demoUrl);
  await chrome.waitForTarget((target) => target.type === "service_worker" && target.url.includes(extensionId));
  await sleep(500);
  await chrome.command("Extensions.triggerAction", { id: extensionId, targetId: tab.targetId });
  const panelTarget = await chrome.waitForTarget((target) => target.url === `chrome-extension://${extensionId}/sidepanel.html`, 30000);
  const panelSession = await chrome.attach(panelTarget.targetId);
  await waitForEvaluation(chrome, panelSession, "Boolean(document.querySelector('#send'))", "side panel load");
  await sleep(800);
  // Resize the window so the page itself gets PAGE's size beside the panel.
  const inner = await evaluate(chrome, pageSession, "({ width: innerWidth, height: innerHeight })");
  const { windowId, bounds } = await chrome.command("Browser.getWindowForTarget", { targetId: pageTargetId });
  await chrome.command("Browser.setWindowBounds", { windowId, bounds: { width: bounds.width + PAGE.width - inner.width, height: bounds.height + PAGE.height - inner.height } });
  await waitForEvaluation(chrome, pageSession, `innerWidth === ${PAGE.width} && innerHeight === ${PAGE.height}`, "page size");

  await click(chrome, panelSession, "#openSettings");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#settingsDialog').open", "settings dialog");
  await evaluate(chrome, panelSession, `(() => {
    document.querySelector('#serverUrl').value = ${JSON.stringify(receiverUrl)};
    document.querySelector('#token').value = ${JSON.stringify(token)};
  })()`);
  await click(chrome, panelSession, "#saveSettings");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#connStatusLabel').textContent === 'Connected' && !document.querySelector('#projectPrompt').hidden", "add-page prompt");
  await evaluate(chrome, panelSession, "document.querySelector('#settingsDialog').close()");
  // An Add page click right after saving settings can be lost to a re-render
  // of the prompt, so try again until the page is in the project.
  for (let attempt = 1; ; attempt += 1) {
    await sleep(1000);
    await evaluate(chrome, panelSession, "document.querySelector('#projectPrompt .btn-primary')?.click()");
    try {
      await waitForEvaluation(chrome, panelSession, "document.querySelector('#projectPrompt').hidden && document.querySelector('#projectName').textContent === 'juniper-web'", "page added to the project");
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }

  // Select the Team plan card, the one whose badge overlaps its name.
  await click(chrome, panelSession, "#annotateToggle");
  await waitForEvaluation(chrome, pageSession, "Boolean(document.querySelector('#__agent_annotations_overlay'))", "annotation overlay");
  const point = await evaluate(chrome, pageSession, `(() => {
    const rect = document.querySelector('[data-testid=plan-team]').getBoundingClientRect();
    return { x: rect.left + 8, y: rect.top + rect.height / 2 };
  })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await chrome.command("Input.dispatchMouseEvent", { type, ...point, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 }, pageSession);
  }
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#selectedSummary').textContent.includes('plan-team')", "selected element");
  await click(chrome, panelSession, "#attachElementShot");
  await waitForEvaluation(chrome, panelSession, "document.querySelectorAll('.attachment').length === 1", "element capture");
  await evaluate(chrome, panelSession, `(() => {
    const comment = document.querySelector('#comment');
    comment.value = 'The "Most popular" badge covers the plan name. Put it above the name, and keep the three cards the same height.';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(chrome, panelSession, "label[data-sev='bug']");
  // Move the pointer off the card so only the selection outline shows.
  await chrome.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 40, y: PAGE.height - 40 }, pageSession);
  await evaluate(chrome, panelSession, "document.activeElement?.blur()");
  await sleep(600);

  const projectId = await evaluate(chrome, panelSession, "chrome.storage.local.get('projects').then(({ projects }) => projects.find((project) => project.origins.length).id)");
  const { targetId: boardTargetId } = await chrome.command("Target.createTarget", { url: `chrome-extension://${extensionId}/board.html?project=${projectId}` });
  const boardSession = await chrome.attach(boardTargetId);
  await viewport(boardSession, BOARD);
  await waitForEvaluation(chrome, boardSession, "document.querySelector('#connStatusLabel').textContent === 'Connected' && document.querySelectorAll('.board-card').length >= 7", "board cards");

  const PANEL = await evaluate(chrome, panelSession, "({ width: innerWidth, height: innerHeight })");
  const shots = {};
  for (const theme of ["light", "dark"]) {
    for (const session of [panelSession, boardSession]) {
      await chrome.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, session);
    }
    await sleep(400);
    shots[theme] = {
      page: await capture(pageSession, `page-${theme}`),
      panel: await capture(panelSession, `panel-${theme}`),
      board: await capture(boardSession, `board-${theme}`)
    };
    await openCard(boardSession, "Feature checkmarks");
    shots[theme].card = await capture(boardSession, `card-${theme}`);
    await evaluate(chrome, boardSession, "document.querySelector('#cardDialog').close()");
  }

  // The framed shots are wider than the page's window, so they get their own.
  const { targetId: frameTargetId } = await chrome.command("Target.createTarget", { url: "about:blank", newWindow: true });
  const frameSession = await chrome.attach(frameTargetId);
  const { windowId: frameWindowId } = await chrome.command("Browser.getWindowForTarget", { targetId: frameTargetId });
  await chrome.command("Browser.setWindowBounds", { windowId: frameWindowId, bounds: { width: 1900, height: 1300 } });
  for (const theme of ["light", "dark"]) {
    await chrome.command("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, frameSession);
    await frame(frameSession, `panel-${theme}.png`, browserFrame(shots[theme], demoUrl, PANEL));
    await frame(frameSession, `board-${theme}.png`, boardFrame(shots[theme].board, "Agent Annotations board"));
    await frame(frameSession, `card-${theme}.png`, boardFrame(shots[theme].card, "Agent Annotations board"));
    await frame(frameSession, `agent-${theme}.png`, terminalFrame(terminalLog));
  }
  process.stdout.write(`Screenshots written to ${path.relative(root, outDir)}.\n`);

  async function openCard(session, titleStart) {
    await evaluate(chrome, session, `[...document.querySelectorAll('.board-card')].find((card) => card.textContent.includes(${JSON.stringify(titleStart)})).click()`);
    await waitForEvaluation(chrome, session, "document.querySelector('#cardDialog').open", "card dialog");
    await evaluate(chrome, session, `(() => {
      document.activeElement?.blur();
      // Scroll to the checklist and the agent's hand-back, the point of the shot.
      const dialog = document.querySelector('#cardDialog');
      for (const element of [dialog, ...dialog.querySelectorAll('*')]) {
        if (element.scrollHeight > element.clientHeight + 4 && getComputedStyle(element).overflowY !== 'visible') element.scrollTop = element.scrollHeight;
      }
    })()`);
    await sleep(400);
  }

  async function capture(session, name) {
    // Background tabs do not paint, so their screenshots never arrive.
    if (session !== panelSession) {
      await chrome.command("Page.bringToFront", {}, session);
      await sleep(300);
    }
    const { data } = await chrome.command("Page.captureScreenshot", { format: "png" }, session);
    const file = path.join(temporaryRoot, `${name}.png`);
    await writeFile(file, Buffer.from(data, "base64"));
    return pathToFileURL(file).href;
  }

  async function frame(session, name, html) {
    const file = path.join(temporaryRoot, `${name}.html`);
    await writeFile(file, html);
    await chrome.command("Page.navigate", { url: pathToFileURL(file).href }, session);
    await chrome.command("Page.bringToFront", {}, session);
    await waitForEvaluation(chrome, session, "document.readyState === 'complete' && [...document.images].every((image) => image.complete)", `frame ${name}`);
    const box = await evaluate(chrome, session, "(() => { const r = document.querySelector('.shot').getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()");
    const { data } = await chrome.command("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 1 } }, session);
    await writeFile(path.join(outDir, name), Buffer.from(data, "base64"));
  }
} finally {
  await chrome.close();
  await stopProcess(receiver);
  await new Promise((resolve) => demoServer.close(resolve));
  if (process.env.KEEP_SCREENSHOT_TEMP) process.stdout.write(`Kept ${temporaryRoot}\n`);
  else await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  if (receiverErrors) process.stderr.write(receiverErrors);
}

// Like ChromePipe.launch, but at 2x and with room for the page and the panel.
async function launchChrome(profilePath) {
  const browser = spawn(await findChromePath(), [
    "--headless=new",
    "--remote-debugging-pipe",
    "--enable-unsafe-extension-debugging",
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--hide-scrollbars",
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${PAGE.width + PANEL_GUESS},${PAGE.height + 100}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  return new ChromePipe(browser);
}

async function viewport(session, { width, height }) {
  await chrome.command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: SCALE, mobile: false }, session);
}

// Cards in every column, moved there the way agents do it, through the CLI.
async function seedCards() {
  const cards = [
    { key: "yearly", title: "Add a monthly / yearly switch above the plans", severity: "feature", status: "draft", tags: ["pricing"] },
    { key: "hover", title: "Sign in link has no hover or focus style", severity: "bug", status: "ready", tags: ["header"],
      acceptance: ["Underline on hover", "Visible focus ring"],
      comment: "Keyboard users can't see when Sign in has focus. Give it the same hover and focus styles as the nav links." },
    { key: "faq", title: "Add a short FAQ under the plans", severity: "feature", status: "ready", tags: ["pricing", "content"],
      acceptance: ["Five questions, collapsed by default", "Links to the docs for billing"] },
    { key: "currency", title: "Show prices in the visitor's currency", severity: "feature", status: "ready", tags: ["pricing"],
      acceptance: ["Uses the browser locale", "Falls back to USD", "Rounds to whole amounts"] },
    { key: "sales", title: "Rename \"Talk to sales\" to \"Contact sales\"", severity: "info", status: "ready" },
    { key: "footnote", title: "Footnote under the plans is hard to read", severity: "bug", status: "ready", tags: ["a11y"] },
    { key: "checks", title: "Feature checkmarks misalign when a line wraps", severity: "bug", status: "ready", tags: ["pricing"],
      acceptance: ["Checkmark stays on the first line", "Works at 1024 px and 1440 px"],
      comment: "Feature checkmarks misalign when a line wraps.\n\nAt 1024 px the second line of \"Everything in Personal\" starts under the checkmark. Hang the text so wrapped lines align with the first." },
    { key: "logo", title: "Logo dot uses the old brand green", severity: "bug", status: "ready", tags: ["brand"] }
  ];
  const ids = {};
  const minute = 60000;
  let createdAt = Date.now() - cards.length * 7 * minute;
  for (const card of cards) {
    createdAt += 7 * minute;
    const annotation = {
      title: card.title,
      comment: card.comment || card.title,
      severity: card.severity,
      status: card.status,
      tags: card.tags || [],
      acceptance: (card.acceptance || []).map((text) => ({ text, done: false })),
      url: demoUrl,
      createdAt: new Date(createdAt).toISOString()
    };
    const response = await fetch(`${receiverUrl}/annotations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Annotation-Token": token },
      body: JSON.stringify({ annotation })
    });
    ids[card.key] = (await response.json()).id;
  }

  const cli = (...args) => run(process.execPath, [path.join(".tools", "agent-annotations-cards.cjs"), ...args], { cwd: repo });
  await cli("claim", ids.logo, "--agent", "codex");
  await cli("handback", ids.logo, "--agent", "codex", "--review", "Swapped #3a7d5c for the brand token --brand.");
  await cli("move", ids.logo, "done");
  await cli("claim", ids.checks, "--agent", "claude");
  await cli("check", ids.checks, "1");
  await cli("check", ids.checks, "2");
  await cli("handback", ids.checks, "--agent", "claude", "--review", "Gave the list items a hanging indent, so wrapped lines start under the text, not the checkmark. Checked at 1024 and 1440 px.", "--link", "src/components/PlanCard.css");
  await cli("claim", ids.footnote, "--agent", "codex");
  await cli("handback", ids.footnote, "--agent", "codex", "--question", "Darken --muted for the whole site, or only for this footnote?");
  await cli("claim", ids.currency, "--agent", "codex");
  await cli("check", ids.currency, "1");
  await cli("claim", ids.sales, "--agent", "claude");

  // What an agent sees when it asks for work, for the terminal screenshot.
  const prompt = "$ node .tools/agent-annotations-cards.cjs";
  const list = (await cli("list", "--status", "ready")).stdout.trimEnd();
  const next = (await cli("next", "--agent", "codex")).stdout.trimEnd();
  return [`${prompt} list --status ready`, list, "", `${prompt} next --agent codex`, next].join("\n");
}

function listenOn(server, preferredPort) {
  return new Promise((resolve, reject) => {
    server.once("error", async (error) => {
      if (error.code !== "EADDRINUSE") return reject(error);
      const port = await freePort();
      server.listen(port, "127.0.0.1", () => resolve(port));
    });
    server.listen(preferredPort, "127.0.0.1", () => resolve(preferredPort));
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function frameCss() {
  return `
  :root { color-scheme: light dark; --desk: #eceae5; --chrome: #f6f5f2; --line: #d4d4cf; --text: #5e5e5a; --bar: #ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --desk: #0d1117; --chrome: #232322; --line: #3b3b39; --text: #a5a5a0; --bar: #1c1c1b; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--desk); font: 13px/1 "Segoe UI", system-ui, sans-serif; }
  .shot { display: inline-block; padding: 36px; background: var(--desk); }
  .window { overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--chrome);
    box-shadow: 0 1px 2px rgb(0 0 0 / 8%), 0 18px 48px rgb(0 0 0 / 16%); }
  .titlebar { display: flex; align-items: center; gap: 14px; height: 44px; padding: 0 14px; border-bottom: 1px solid var(--line); color: var(--text); }
  .dots { display: flex; gap: 7px; }
  .dots i { width: 11px; height: 11px; border-radius: 50%; background: var(--line); }
  .address { flex: 1; max-width: 560px; height: 28px; padding: 0 12px; border-radius: 14px; background: var(--bar); display: flex; align-items: center; }
  .content { display: flex; }
  .content img { display: block; }
  .divider { width: 1px; background: var(--line); }
`;
}

function browserFrame(shot, url, panel) {
  return `<!DOCTYPE html><meta charset="utf-8"><style>${frameCss()}</style>
  <div class="shot"><div class="window">
    <div class="titlebar"><span class="dots"><i></i><i></i><i></i></span><span class="address">${escapeHtml(url.replace(/^http:\/\//, ""))}</span></div>
    <div class="content">
      <img src="${shot.page}" width="${PAGE.width}" height="${PAGE.height}" alt="">
      <span class="divider"></span>
      <img src="${shot.panel}" width="${panel.width}" height="${panel.height}" alt="">
    </div>
  </div></div>`;
}

function boardFrame(image, title) {
  return `<!DOCTYPE html><meta charset="utf-8"><style>${frameCss()}</style>
  <div class="shot"><div class="window">
    <div class="titlebar"><span class="dots"><i></i><i></i><i></i></span><span class="address">${escapeHtml(title)}</span></div>
    <div class="content"><img src="${image}" width="${BOARD.width}" height="${BOARD.height}" alt=""></div>
  </div></div>`;
}

function terminalFrame(log) {
  const lines = escapeHtml(log).split("\n").map((line) => (line.startsWith("$ ") ? `<b>${line}</b>` : line)).join("\n");
  return `<!DOCTYPE html><meta charset="utf-8"><style>${frameCss()}
    .terminal { width: 980px; background: #151515; border-color: #2d2d2b; }
    .terminal .titlebar { border-color: #2d2d2b; color: #a5a5a0; }
    .terminal .dots i { background: #3b3b39; }
    pre { margin: 0; padding: 20px 22px 24px; color: #d4d4cf; font: 14px/1.6 "Cascadia Mono", Consolas, ui-monospace, monospace; white-space: pre-wrap; }
    pre b { color: #8ab4ff; font-weight: 600; }
  </style>
  <div class="shot"><div class="window terminal">
    <div class="titlebar"><span class="dots"><i></i><i></i><i></i></span><span>juniper-web — agent</span></div>
    <pre>${lines}</pre>
  </div></div>`;
}
