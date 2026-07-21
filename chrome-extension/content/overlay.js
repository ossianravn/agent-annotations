(() => {
  const api = globalThis.__AGENT_ANNOTATIONS_CONTENT__;
  if (!api) throw new Error("Agent Annotations content modules were not loaded.");

  const HOST_ID = "__agent_annotations_overlay";

  function createOverlay() {
    document.getElementById(HOST_ID)?.remove();
    const host = document.createElement("agent-annotations-overlay");
    host.id = HOST_ID;
    const hostStyles = {
      all: "initial",
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      contain: "strict",
      display: "block"
    };
    for (const [property, value] of Object.entries(hostStyles)) {
      host.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), value, "important");
    }

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light dark; }
      .box {
        position: fixed;
        box-sizing: border-box;
        display: none;
        pointer-events: none;
        border: 3px solid #0069d9;
        outline: 2px solid Canvas;
        outline-offset: 0;
      }
      .box[data-visible="true"] { display: block; }
      .selected {
        border-color: #b53800;
        border-style: dashed;
      }
      .hud {
        position: fixed;
        inset-inline-start: 0.75rem;
        inset-block-end: 0.75rem;
        max-inline-size: min(34rem, calc(100vw - 1.5rem));
        box-sizing: border-box;
        padding: 0.55rem 0.75rem;
        border: 2px solid CanvasText;
        border-radius: 999px;
        color: Canvas;
        background: CanvasText;
        font: 600 0.75rem/1.35 system-ui, sans-serif;
        letter-spacing: 0.01em;
      }
      @media (forced-colors: active) {
        .box { border-color: Highlight; outline-color: CanvasText; }
        .selected { border-color: Mark; }
      }
    `;
    const hover = document.createElement("div");
    hover.className = "box";
    hover.setAttribute("aria-hidden", "true");
    const selected = document.createElement("div");
    selected.className = "box selected";
    selected.setAttribute("aria-hidden", "true");
    const hud = document.createElement("div");
    hud.className = "hud";
    hud.textContent = "Annotate: point or Tab to highlight · click or Enter to select · Esc to exit";
    shadow.append(style, hover, selected, hud);
    document.documentElement.appendChild(host);

    function move(box, element) {
      if (!element?.isConnected) {
        box.dataset.visible = "false";
        return;
      }
      const rect = element.getBoundingClientRect();
      box.style.insetInlineStart = `${rect.left}px`;
      box.style.insetBlockStart = `${rect.top}px`;
      box.style.inlineSize = `${rect.width}px`;
      box.style.blockSize = `${rect.height}px`;
      box.dataset.visible = String(rect.width > 0 && rect.height > 0);
    }

    return {
      destroy() {
        host.remove();
      },
      hideHover() {
        hover.dataset.visible = "false";
      },
      hideSelection() {
        selected.dataset.visible = "false";
      },
      moveHover(element) {
        move(hover, element);
      },
      moveSelection(element) {
        move(selected, element);
      }
    };
  }

  api.createOverlay = createOverlay;
  api.overlayHostId = HOST_ID;
})();
