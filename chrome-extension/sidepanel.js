/**
 * Side panel UI logic (v0.2)
 * - Ensures content script exists (inject if needed)
 * - Toggle annotate mode
 * - Capture screenshots
 * - Allow deleting individual attachments
 */

const $ = (id) => document.getElementById(id);

const state = {
  annotateEnabled: false,
  activeTab: null,
  activeUrl: null,
  routeKey: null,
  selectedElement: null,
  attachments: [], // {id, name, mime, dataUrl}
  openAnnotations: [],
  selectedAnnotation: null,
  settings: {
    serverUrl: "http://localhost:8787",
    token: ""
  }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function routeKeyFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.origin + u.pathname;
  } catch {
    return urlStr || "";
  }
}

function shortUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return u.pathname + (u.search ? u.search : "");
  } catch {
    return urlStr || "";
  }
}

function setConnDot(ok) {
  const el = $("connDot");
  const color = ok ? "#22c55e" : "#ef4444";
  el.style.background = color;
  el.style.color = color; // used by box-shadow in CSS (currentColor)

  const txt = $("connText");
  if (txt) {
    txt.textContent = ok ? "Connected" : "Not reachable";
    txt.style.color = ok ? "#16a34a" : "#dc2626";
  }
}

async function loadSettings() {
  const saved = await chrome.storage.local.get(["serverUrl", "token"]);
  if (saved.serverUrl) state.settings.serverUrl = saved.serverUrl;
  if (saved.token) state.settings.token = saved.token;
  $("serverUrl").value = state.settings.serverUrl;
  $("token").value = state.settings.token;
  const disp = $("serverUrlDisplay");
  if (disp) disp.textContent = state.settings.serverUrl;
}

async function saveSettings() {
  state.settings.serverUrl = $("serverUrl").value.trim() || "http://localhost:8787";
  state.settings.token = $("token").value.trim();
  await chrome.storage.local.set({
    serverUrl: state.settings.serverUrl,
    token: state.settings.token
  });
  const disp = $("serverUrlDisplay");
  if (disp) disp.textContent = state.settings.serverUrl;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function refreshActiveTabInfo() {
  const tab = await getActiveTab();
  state.activeTab = tab;
  state.activeUrl = tab && tab.url ? tab.url : null;
  state.routeKey = state.activeUrl ? routeKeyFromUrl(state.activeUrl) : null;
  $("activeRoute").textContent = state.activeUrl ? shortUrl(state.activeUrl) : "No active tab";
}

function elementSummary(sel) {
  if (!sel) return "None";
  const p = sel.element?.primary;
  if (!p) return "Selected";
  if (p.type === "testid") return `data-testid="${p.value}"`;
  if (p.type === "id") return `#${p.value}`;
  if (p.type === "css") return p.value || "(css)";
  return `${p.type}:${p.value || ""}`;
}

function renderSelectedElement() {
  $("selectedSummary").textContent = elementSummary(state.selectedElement);
  const clearBtn = $("clearSelected");
  if (clearBtn) clearBtn.hidden = !state.selectedElement;
  updateSendEnabled();
}

function estimateBytesFromDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const b64 = m[2] || "";
  // base64 overhead (~4/3) + padding. Good enough for UI.
  return Math.floor((b64.length * 3) / 4);
}

function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)}MB`;
}

function sanitizeFilename(name) {
  return (name || "asset")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function makeAttachmentId() {
  return "att_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function addAttachment({ name, mime, dataUrl }) {
  state.attachments.push({ id: makeAttachmentId(), name: sanitizeFilename(name), mime, dataUrl });
  renderAttachments();
  updateSendEnabled();
}

function removeAttachment(id) {
  state.attachments = state.attachments.filter(a => a.id !== id);
  renderAttachments();
  updateSendEnabled();
}

function renderAttachments() {
  const root = $("attachments");
  root.innerHTML = "";
  if (!state.attachments.length) return;

  for (const att of state.attachments) {
    const card = document.createElement("div");
    card.className = "attachment";

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    if (att.mime && att.mime.startsWith("image/") && att.dataUrl) {
      const img = document.createElement("img");
      img.src = att.dataUrl;
      img.alt = att.name;
      thumb.appendChild(img);
    } else {
      const ph = document.createElement("div");
      ph.className = "muted tiny";
      ph.textContent = "File";
      thumb.appendChild(ph);
    }

    const meta = document.createElement("div");
    meta.className = "meta";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = att.name;

    const sub = document.createElement("div");
    sub.className = "sub";
    const bytes = estimateBytesFromDataUrl(att.dataUrl);
    const size = formatBytes(bytes);
    sub.textContent = [att.mime || "attachment", size].filter(Boolean).join(" • ");

    meta.appendChild(name);
    meta.appendChild(sub);

    card.appendChild(thumb);
    card.appendChild(meta);

    const btn = document.createElement("button");
    btn.className = "icon-btn ghost remove";
    btn.title = "Remove";
    btn.textContent = "✕";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeAttachment(att.id);
    });
    card.appendChild(btn);

    root.appendChild(card);
  }
}

function getControlTextEl(control) {
  if (!control) return null;
  return control.querySelector?.(".btn-text, .send-text") || null;
}

function getControlText(control) {
  const el = getControlTextEl(control);
  if (el) return el.textContent || "";
  return control ? (control.textContent || "") : "";
}

function setControlText(control, text) {
  const el = getControlTextEl(control);
  if (el) {
    el.textContent = String(text || "");
    return;
  }
  if (control) control.textContent = String(text || "");
}

function flashAnnotateError() {
  const sw = $("annotateToggle")?.closest?.(".switch");
  if (!sw) return;
  sw.classList.remove("is-error");
  // force reflow so the animation retriggers on repeated errors
  void sw.offsetWidth;
  sw.classList.add("is-error");
  setTimeout(() => sw.classList.remove("is-error"), 700);
}

async function withControlFeedback(control, task, opts = {}) {
  if (!control) return task();

  const {
    busyText = "Working…",
    okText = "Done",
    errorText = "Failed",
    okMs = 900,
    errorMs = 1400,
    restoreDisabled = true
  } = opts;

  const originalText = getControlText(control);
  const wasDisabled = !!control.disabled;
  const originalTitle = control.title || "";

  control.title = "";
  control.disabled = true;
  control.classList.remove("is-ok", "is-error");
  control.classList.add("is-busy");
  setControlText(control, busyText);

  try {
    const result = await task();
    control.classList.remove("is-busy");
    control.classList.add("is-ok");
    setControlText(control, okText || originalText);
    await sleep(okMs);
    return result;
  } catch (e) {
    const msg = String(e?.message || e || errorText);
    control.classList.remove("is-busy");
    control.classList.add("is-error");
    control.title = msg;
    setControlText(control, errorText);
    await sleep(errorMs);
    throw e;
  } finally {
    control.classList.remove("is-busy", "is-ok", "is-error");
    if (restoreDisabled) control.disabled = wasDisabled;
    control.title = originalTitle;
    setControlText(control, originalText);
  }
}

async function ensureContentScript() {
  // Returns true if we can talk to the content script for the active tab.
  if (!state.activeTab?.id) return false;

  try {
    await chrome.tabs.sendMessage(state.activeTab.id, { type: "PING_CONTENT" });
    return true;
  } catch {
    // Try injecting (helps when content scripts didn't load due to site access restrictions).
    try {
      await chrome.scripting.executeScript({
        target: { tabId: state.activeTab.id, allFrames: true },
        files: ["content_script.js"]
      });
      await sleep(60);
      await chrome.tabs.sendMessage(state.activeTab.id, { type: "PING_CONTENT" });
      return true;
    } catch (e2) {
      console.warn("Failed to inject content script:", e2);
      return false;
    }
  }
}

async function setAnnotateMode(enabled, opts = {}) {
  const { persist = true } = opts || {};
  state.annotateEnabled = enabled;
  $("annotateToggle").checked = enabled;

  if (persist) {
    try {
      await chrome.storage.local.set({ annotateEnabled: !!enabled });
    } catch {}
  }

  if (!enabled) {
    // best effort
    try {
      if (state.activeTab?.id) await chrome.tabs.sendMessage(state.activeTab.id, { type: "ANNOTATE_DISABLE" });
    } catch {}
    return;
  }

  const ok = await ensureContentScript();
  if (!ok) {
    state.annotateEnabled = false;
    $("annotateToggle").checked = false;
    flashAnnotateError();
    return;
  }

  try {
    await chrome.tabs.sendMessage(state.activeTab.id, { type: "ANNOTATE_ENABLE" });
  } catch (e) {
    state.annotateEnabled = false;
    $("annotateToggle").checked = false;
    flashAnnotateError();
  }
}

async function captureScreenshot() {
  if (!state.activeTab?.windowId) throw new Error("No active window.");
  const resp = await chrome.runtime.sendMessage({
    type: "CAPTURE_VISIBLE_TAB",
    windowId: state.activeTab.windowId
  });
  if (!resp?.ok) throw new Error(resp?.error || "Screenshot failed.");
  return resp.dataUrl;
}

async function cropElementFromScreenshot(fullDataUrl, rect) {
  if (!rect) throw new Error("No element rect available.");
  const dpr = rect.dpr || window.devicePixelRatio || 1;

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Failed to load screenshot."));
    i.src = fullDataUrl;
  });

  const sx = Math.max(0, Math.floor(rect.x * dpr));
  const sy = Math.max(0, Math.floor(rect.y * dpr));
  const sw = Math.max(1, Math.floor(rect.w * dpr));
  const sh = Math.max(1, Math.floor(rect.h * dpr));

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas.toDataURL("image/png");
}

function buildAnnotationPayload() {
  if (!state.activeUrl) throw new Error("No active URL.");
  if (!state.selectedElement) throw new Error("Select an element first (Annotate mode → click element).");

  const comment = $("comment").value.trim();
  if (!comment) throw new Error("Comment is empty.");

  const tags = ($("tags").value || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const severity = $("severity").value;

  return {
    id: "", // receiver fills
    createdAt: new Date().toISOString(),
    url: state.activeUrl,
    routeKey: state.routeKey || routeKeyFromUrl(state.activeUrl),
    status: "open",
    severity,
    tags,
    ...state.selectedElement, // {element, rect}
    comment
  };
}

async function postAnnotation() {
  const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
  const url = serverUrl + "/annotations";

  const annotation = buildAnnotationPayload();
  const body = {
    annotation,
    assets: state.attachments.map(a => ({ name: a.name, mime: a.mime, dataUrl: a.dataUrl }))
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Annotation-Token": state.settings.token || ""
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Server error (${res.status})`);
  }
  return data;
}

async function testConnection() {
  const serverUrl = ($("serverUrl").value.trim() || state.settings.serverUrl).replace(/\/$/, "");
  const u = serverUrl + "/health";
  const disp = $("serverUrlDisplay");
  if (disp) disp.textContent = serverUrl;
  try {
    const res = await fetch(u);
    const data = await res.json().catch(() => ({}));
    const ok = !!(res.ok && data.ok);
    setConnDot(ok);
    return ok;
  } catch {
    setConnDot(false);
    return false;
  }
}

async function getAnnotationsForRoute() {
  if (!state.routeKey) return [];
  const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
  const url = new URL(serverUrl + "/annotations");
  url.searchParams.set("status", "open");
  url.searchParams.set("routeKey", state.routeKey);
  url.searchParams.set("limit", "50");

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.annotations)) return [];
  return data.annotations;
}

function renderList() {
  const root = $("list");
  root.innerHTML = "";
  if (!state.openAnnotations.length) {
    const div = document.createElement("div");
    div.className = "muted tiny";
    div.textContent = "No open annotations for this page.";
    root.appendChild(div);
    return;
  }

  for (const ann of state.openAnnotations) {
    const div = document.createElement("div");
    div.className = "item";
    div.addEventListener("click", () => openDetail(ann));

    const top = document.createElement("div");
    top.className = "topline";

    const badges = document.createElement("div");
    badges.className = "badges";

    const sev = document.createElement("span");
    sev.className = "badge";
    const raw = String(ann.severity || "note").toLowerCase();
    const sevVal =
      raw === "warning" ? "question" :
      raw === "info" ? "note" :
      raw;
    if (sevVal === "bug" || sevVal === "question" || sevVal === "note") {
      sev.classList.add(`sev-${sevVal}`);
    }
    sev.textContent = sevVal;
    badges.appendChild(sev);

    if (ann.tags && ann.tags.length) {
      const tag = document.createElement("span");
      tag.className = "badge";
      tag.textContent = ann.tags.slice(0, 2).join(", ");
      badges.appendChild(tag);
    }

    const id = document.createElement("div");
    id.className = "id mono";
    id.textContent = ann.id || "";

    top.appendChild(badges);
    top.appendChild(id);

    const c = document.createElement("div");
    c.textContent = ann.comment || "";

    div.appendChild(top);
    div.appendChild(c);
    root.appendChild(div);
  }
}

function openDetail(ann) {
  state.selectedAnnotation = ann;

  const dlg = $("detailDialog");
  $("detailId").textContent = ann.id || "—";
  const loc = ann.element?.primary ? `${ann.element.primary.type}:${ann.element.primary.value || ""}` : "—";
  $("detailLocator").textContent = loc;
  $("detailComment").textContent = ann.comment || "—";

  const att = $("detailAttachments");
  att.innerHTML = "";
  if (ann.attachments && ann.attachments.length) {
    for (const a of ann.attachments) {
      const line = document.createElement("div");
      line.textContent = `${a.kind || "asset"}: ${a.path || ""}`;
      att.appendChild(line);
    }
  } else {
    att.textContent = "—";
  }

  $("detailHint").textContent = "";
  dlg.showModal();
}

function closeDetail() {
  state.selectedAnnotation = null;
  const dlg = $("detailDialog");
  if (dlg.open) dlg.close();
}

function copyAsPrompt(ann) {
  const primary = ann.element?.primary || {};
  const alt = (ann.element?.alternates || []).map(a => `${a.type}:${a.value || ""}`).join(", ");
  const prompt = [
    `Route: ${ann.routeKey || ""}`,
    `URL: ${ann.url || ""}`,
    `Element primary: ${primary.type || ""}=${primary.value || ""}`,
    alt ? `Alternates: ${alt}` : null,
    ann.element?.textHint ? `Text hint: ${ann.element.textHint}` : null,
    ann.comment ? `Comment: ${ann.comment}` : null,
    ann.attachments?.length ? `Attachments: ${ann.attachments.map(a => a.path).join(", ")}` : null,
    `Annotation ID: ${ann.id || ""}`
  ].filter(Boolean).join("\n");
  navigator.clipboard.writeText(prompt).catch(() => {});
}

async function markResolved(ann) {
  const serverUrl = state.settings.serverUrl.replace(/\/$/, "");
  const url = serverUrl + `/annotations/${encodeURIComponent(ann.id)}/status`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Annotation-Token": state.settings.token || ""
    },
    body: JSON.stringify({ status: "resolved" })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data;
}

async function refreshList() {
  $("list").innerHTML = '<div class="muted tiny">Loading…</div>';
  try {
    const anns = await getAnnotationsForRoute();
    state.openAnnotations = anns;
    renderList();
  } catch (e) {
    $("list").innerHTML = `<div class="muted tiny">Failed to load: ${String(e?.message || e)}</div>`;
  }
}

function updateSendEnabled() {
  const hasElement = !!state.selectedElement;
  const hasComment = !!$("comment").value.trim();
  $("send").disabled = !(hasElement && hasComment);
}

function bindUI() {
  function setSeverity(value) {
    const select = $("severity");
    select.value = value;
    for (const b of document.querySelectorAll(".pill-btn[data-sev]")) {
      b.classList.toggle("is-active", b.getAttribute("data-sev") === value);
    }
  }

  $("saveSettings").addEventListener("click", async () => {
    await withControlFeedback($("saveSettings"), async () => {
      await saveSettings();
      await testConnection();
    }, { busyText: "Saving…", okText: "Saved", errorText: "Failed" }).catch(() => {});
  });

  $("testConn").addEventListener("click", async () => {
    await withControlFeedback($("testConn"), async () => {
      await saveSettings();
      const ok = await testConnection();
      if (!ok) throw new Error("Not reachable");
    }, { busyText: "Testing…", okText: "Connected", errorText: "Not reachable" }).catch(() => {});
  });

  $("annotateToggle").addEventListener("change", async () => {
    await refreshActiveTabInfo();
    await setAnnotateMode($("annotateToggle").checked);
  });

  $("changeSelected").addEventListener("click", async () => {
    await refreshActiveTabInfo();
    if (!$("annotateToggle").checked) {
      await setAnnotateMode(true);
    }
  });

  $("clearSelected").addEventListener("click", async () => {
    state.selectedElement = null;
    renderSelectedElement();
    try {
      await refreshActiveTabInfo();
      if (state.activeTab?.id) {
        chrome.tabs.sendMessage(state.activeTab.id, { type: "ANNOTATE_CLEAR_SELECTION" }).catch(() => {});
      }
    } catch {}
  });

  $("refreshTab").addEventListener("click", async () => {
    await refreshActiveTabInfo();
    await refreshList();
  });

  $("attachScreenshot").addEventListener("click", async () => {
    await withControlFeedback($("attachScreenshot"), async () => {
      await refreshActiveTabInfo();
      const dataUrl = await captureScreenshot();
      addAttachment({ name: "screenshot.png", mime: "image/png", dataUrl });
    }, { busyText: "Capturing…", okText: "Added", errorText: "Failed" }).catch(() => {});
  });

  $("attachElementShot").addEventListener("click", async () => {
    await withControlFeedback($("attachElementShot"), async () => {
      await refreshActiveTabInfo();
      if (!state.selectedElement?.rect) throw new Error("Select an element first.");
      const full = await captureScreenshot();
      const cropped = await cropElementFromScreenshot(full, state.selectedElement.rect);
      addAttachment({ name: "element.png", mime: "image/png", dataUrl: cropped });
    }, { busyText: "Cropping…", okText: "Added", errorText: "Failed" }).catch(() => {});
  });

  $("clearAttachments").addEventListener("click", () => {
    withControlFeedback($("clearAttachments"), async () => {
      state.attachments = [];
      renderAttachments();
      updateSendEnabled();
    }, { busyText: "Clearing…", okText: "Cleared", errorText: "Failed", okMs: 700 }).catch(() => {});
  });

  $("send").addEventListener("click", async () => {
    await withControlFeedback($("send"), async () => {
      await saveSettings();
      await refreshActiveTabInfo();
      const resp = await postAnnotation();
      await setAnnotateMode(false);
      // Clear selection after a successful send so users don't accidentally
      // "reuse" the previous element in the next report.
      state.selectedElement = null;
      renderSelectedElement();
      try {
        if (state.activeTab?.id) {
          chrome.tabs.sendMessage(state.activeTab.id, { type: "ANNOTATE_CLEAR_SELECTION" }).catch(() => {});
        }
      } catch {}
      $("comment").value = "";
      $("tags").value = "";
      state.attachments = [];
      renderAttachments();
      updateSendEnabled();
      await refreshList();
      return resp;
    }, { busyText: "Sending…", okText: "Sent", errorText: "Failed", okMs: 900 }).catch(() => {});
  });

  $("refreshList").addEventListener("click", async () => {
    await refreshList();
  });

  $("comment").addEventListener("input", () => updateSendEnabled());

  // Severity pills -> hidden select
  for (const btn of document.querySelectorAll(".pill-btn[data-sev]")) {
    btn.addEventListener("click", () => {
      const v = btn.getAttribute("data-sev") || "info";
      setSeverity(v);
    });
  }
  setSeverity($("severity").value || "note");

  // Paste images into comment box -> attachment
  $("comment").addEventListener("paste", async (ev) => {
    try {
      const items = ev.clipboardData && ev.clipboardData.items ? Array.from(ev.clipboardData.items) : [];
      const imgItem = items.find((it) => it.type && it.type.startsWith("image/"));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (!file) return;

      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Failed reading pasted image."));
        r.readAsDataURL(file);
      });

      addAttachment({ name: "pasted.png", mime: file.type || "image/png", dataUrl });
    } catch (e) {
      console.warn("Paste handling failed:", e);
    }
  });

  // Detail dialog controls
  $("closeDetail").addEventListener("click", () => closeDetail());
  $("detailDialog").addEventListener("click", (e) => {
    // click outside closes
    const dlg = $("detailDialog");
    const rect = dlg.getBoundingClientRect();
    const inDialog = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inDialog) closeDetail();
  });

  $("copyPrompt").addEventListener("click", () => {
    if (!state.selectedAnnotation) return;
    copyAsPrompt(state.selectedAnnotation);
    $("detailHint").textContent = "Copied.";
    setTimeout(() => ($("detailHint").textContent = ""), 1200);
  });

  $("markResolved").addEventListener("click", async () => {
    if (!state.selectedAnnotation) return;
    $("detailHint").textContent = "";
    try {
      await saveSettings();
      await markResolved(state.selectedAnnotation);
      $("detailHint").textContent = "Marked resolved.";
      await refreshList();
      closeDetail();
    } catch (e) {
      $("detailHint").textContent = String(e?.message || e);
    }
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || !msg.type) return;

  if (msg.type === "ANNOTATE_MODE_SYNC") {
    state.annotateEnabled = !!msg.enabled;
    $("annotateToggle").checked = !!msg.enabled;
    return;
  }

  if (msg.type === "ANNOTATE_ELEMENT_SELECTED") {
    state.selectedElement = msg.payload || null;
    renderSelectedElement();
    return;
  }

  if (msg.type === "ANNOTATE_DISABLED_BY_PAGE") {
    state.annotateEnabled = false;
    $("annotateToggle").checked = false;
    chrome.storage.local.set({ annotateEnabled: false }).catch(() => {});
    return;
  }
});

async function main() {
  await loadSettings();
  bindUI();
  await refreshActiveTabInfo();
  await testConnection();
  await refreshList();
  const saved = await chrome.storage.local.get(["annotateEnabled"]);
  await setAnnotateMode(!!saved.annotateEnabled, { silent: true });
  updateSendEnabled();
}

main();
