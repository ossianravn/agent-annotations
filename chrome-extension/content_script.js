(() => {
  // Prevent double-injection.
  if (globalThis.__CODEX_ANN_CS_LOADED) return;
  globalThis.__CODEX_ANN_CS_LOADED = true;

  let enabled = false;
  let hoverBox = null;
  let selectedBox = null;
  let hud = null;

  function ensureBoxes() {
    if (!hoverBox) {
      hoverBox = document.createElement("div");
      hoverBox.id = "__codex_ann_hover";
      Object.assign(hoverBox.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: "2px solid rgba(46, 204, 113, 0.95)",
        borderRadius: "8px",
        boxSizing: "border-box",
        display: "none"
      });
      document.documentElement.appendChild(hoverBox);
    }
    if (!selectedBox) {
      selectedBox = document.createElement("div");
      selectedBox.id = "__codex_ann_selected";
      Object.assign(selectedBox.style, {
        position: "fixed",
        zIndex: "2147483647",
        pointerEvents: "none",
        border: "2px solid rgba(52, 152, 219, 0.95)",
        borderRadius: "8px",
        boxSizing: "border-box",
        display: "none"
      });
      document.documentElement.appendChild(selectedBox);
    }
  }

  function ensureHud() {
    if (hud) return;
    hud = document.createElement("div");
    hud.id = "__codex_ann_hud";
    hud.textContent = "Annotate mode: hover to highlight • click to select • ESC to exit";
    Object.assign(hud.style, {
      position: "fixed",
      left: "12px",
      bottom: "12px",
      zIndex: "2147483647",
      pointerEvents: "none",
      padding: "8px 10px",
      borderRadius: "999px",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      fontSize: "12px",
      lineHeight: "1.2",
      color: "#fff",
      background: "rgba(0,0,0,0.72)",
      backdropFilter: "blur(6px)",
      boxShadow: "0 2px 10px rgba(0,0,0,0.25)",
      maxWidth: "min(520px, 90vw)"
    });
    document.documentElement.appendChild(hud);
  }

  function hideHud() {
    if (hud && hud.parentNode) hud.parentNode.removeChild(hud);
    hud = null;
  }

  function hideBoxes() {
    if (hoverBox) hoverBox.style.display = "none";
    if (selectedBox) selectedBox.style.display = "none";
  }

  function clearSelection() {
    if (selectedBox) selectedBox.style.display = "none";
  }

  function isIgnorable(el) {
    if (!el) return true;
    const id = el.id || "";
    return id === "__codex_ann_hover" || id === "__codex_ann_selected" || id === "__codex_ann_hud";
  }

  function moveBox(box, rect) {
    if (!box || !rect) return;
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    box.style.display = rect.width > 0 && rect.height > 0 ? "block" : "none";
  }

  function getAttr(el, name) {
    const v = el.getAttribute && el.getAttribute(name);
    return v == null ? null : String(v);
  }

  function getStableTestAttr(el) {
    const attrs = ["data-testid", "data-test", "data-cy", "data-qa"];
    for (const a of attrs) {
      const v = getAttr(el, a);
      if (v) return { attr: a, value: v };
    }
    return null;
  }

  function inferRole(el) {
    const explicit = getAttr(el, "role");
    if (explicit) return explicit;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "input") {
      const t = (getAttr(el, "type") || "").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "submit" || t === "button") return "button";
      return "textbox";
    }
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    return null;
  }

  function getTextHint(el) {
    const aria = getAttr(el, "aria-label");
    if (aria) return aria.slice(0, 140);
    const alt = getAttr(el, "alt");
    if (alt) return alt.slice(0, 140);
    const title = getAttr(el, "title");
    if (title) return title.slice(0, 140);

    const txt = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (txt) return txt.slice(0, 140);
    return null;
  }

  function cssEscapeIdent(ident) {
    return String(ident).replace(/["\\]/g, "\\$&");
  }

  function buildCssSelector(el) {
    if (!el || el.nodeType !== 1) return null;

    const id = el.id;
    if (id) return "#" + cssEscapeIdent(id);

    const test = getStableTestAttr(el);
    if (test) return `${el.tagName.toLowerCase()}[${test.attr}="${cssEscapeIdent(test.value)}"]`;

    const parts = [];
    let cur = el;
    for (let depth = 0; depth < 4 && cur && cur.nodeType === 1; depth++) {
      const tag = cur.tagName.toLowerCase();
      const t = getStableTestAttr(cur);
      if (cur.id) {
        parts.unshift("#" + cssEscapeIdent(cur.id));
        break;
      }
      if (t) {
        parts.unshift(`${tag}[${t.attr}="${cssEscapeIdent(t.value)}"]`);
        break;
      }

      let index = 1;
      if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children).filter(s => s.tagName === cur.tagName);
        index = siblings.indexOf(cur) + 1;
      }
      parts.unshift(`${tag}:nth-of-type(${index})`);
      cur = cur.parentElement;
    }
    return parts.length ? parts.join(" > ") : null;
  }

  function buildXPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return `//*[@id="${el.id.replace(/"/g, '\"')}"]`;
    const parts = [];
    let cur = el;
    for (let depth = 0; depth < 5 && cur && cur.nodeType === 1; depth++) {
      const tag = cur.tagName.toLowerCase();
      let index = 1;
      if (cur.parentNode) {
        const siblings = Array.from(cur.parentNode.childNodes).filter(n => n.nodeType === 1 && n.tagName === cur.tagName);
        index = siblings.indexOf(cur) + 1;
      }
      parts.unshift(`${tag}[${index}]`);
      cur = cur.parentElement;
    }
    return "/" + parts.join("/");
  }

  function buildLocatorBundle(el) {
    const primary = {};
    const alternates = [];

    const test = getStableTestAttr(el);
    if (test && test.attr === "data-testid") {
      primary.type = "testid";
      primary.value = test.value;
      alternates.push({ type: "css", value: `${el.tagName.toLowerCase()}[data-testid="${test.value}"]` });
    } else if (test) {
      primary.type = "attr";
      primary.value = `${test.attr}=${test.value}`;
      alternates.push({ type: "css", value: `${el.tagName.toLowerCase()}[${test.attr}="${test.value}"]` });
    } else if (el.id) {
      primary.type = "id";
      primary.value = el.id;
      alternates.push({ type: "css", value: "#" + el.id });
    } else {
      const css = buildCssSelector(el);
      primary.type = "css";
      primary.value = css || "";
    }

    const role = inferRole(el);
    const nameHint = getTextHint(el);

    if (role) alternates.push({ type: "role", value: role, nameHint: nameHint || "" });
    const css = buildCssSelector(el);
    if (css && (primary.type !== "css" || primary.value !== css)) alternates.push({ type: "css", value: css });
    const xp = buildXPath(el);
    if (xp) alternates.push({ type: "xpath", value: xp });

    const attrs = {
      id: el.id || null,
      class: el.className ? String(el.className).slice(0, 180) : null,
      name: getAttr(el, "name"),
      href: getAttr(el, "href")
    };

    return { primary, alternates, textHint: nameHint, attrs };
  }

  function rectPayload(el) {
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      dpr: window.devicePixelRatio || 1
    };
  }

  function onMouseMove(ev) {
    if (!enabled) return;
    ensureBoxes();
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || isIgnorable(el)) return;
    const rect = el.getBoundingClientRect();
    moveBox(hoverBox, rect);
  }

  function onClick(ev) {
    if (!enabled) return;
    ensureBoxes();
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || isIgnorable(el)) return;

    ev.preventDefault();
    ev.stopPropagation();

    const rect = el.getBoundingClientRect();
    moveBox(selectedBox, rect);

    const payload = {
      element: buildLocatorBundle(el),
      rect: rectPayload(el)
    };

    // Use callback form for maximum compatibility.
    chrome.runtime.sendMessage({ type: "ANNOTATE_ELEMENT_SELECTED", payload }, () => {});
  }

  function onKeyDown(ev) {
    if (!enabled) return;
    if (ev.key === "Escape") {
      disable();
      chrome.runtime.sendMessage({ type: "ANNOTATE_DISABLED_BY_PAGE" }, () => {});
    }
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    ensureBoxes();
    ensureHud();
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    hideBoxes();
    hideHud();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;

    if (msg.type === "PING_CONTENT") {
      sendResponse({ ok: true, loaded: true });
      return;
    }
    if (msg.type === "ANNOTATE_ENABLE") {
      enable();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "ANNOTATE_DISABLE") {
      disable();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "ANNOTATE_CLEAR_SELECTION") {
      ensureBoxes();
      clearSelection();
      sendResponse({ ok: true });
      return;
    }
  });
})();
