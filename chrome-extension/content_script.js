(() => {
  if (globalThis.__AGENT_ANNOTATIONS_CONTENT_LOADED__) return;
  globalThis.__AGENT_ANNOTATIONS_CONTENT_LOADED__ = true;

  const api = globalThis.__AGENT_ANNOTATIONS_CONTENT__;
  if (!api?.createOverlay || !api?.buildLocatorBundle) {
    throw new Error("Agent Annotations content dependencies were not loaded.");
  }

  let enabled = false;
  let overlay = null;
  let hoveredElement = null;
  let selectedElement = null;
  let selectedLocator = null;
  let pointerFrame = 0;
  let layoutFrame = 0;

  function isSelectable(element) {
    return element instanceof Element && element.id !== api.overlayHostId;
  }

  function elementAtPoint(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    return isSelectable(element) ? element : null;
  }

  function selectionPayload() {
    if (!selectedElement?.isConnected || !selectedLocator) return null;
    return {
      element: selectedLocator,
      rect: api.rectPayload(selectedElement),
      frame: { kind: "top", url: location.href }
    };
  }

  function sendSelection() {
    const payload = selectionPayload();
    if (!payload) return;
    chrome.runtime.sendMessage({ type: "ANNOTATE_ELEMENT_SELECTED", payload }, () => {
      void chrome.runtime.lastError;
    });
  }

  function selectElement(element) {
    if (!isSelectable(element)) return;
    selectedElement = element;
    selectedLocator = api.buildLocatorBundle(element);
    overlay.moveSelection(element);
    sendSelection();
  }

  function scheduleLayoutRefresh() {
    if (layoutFrame) return;
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      if (!enabled) return;
      if (hoveredElement) overlay.moveHover(hoveredElement);
      if (selectedElement) overlay.moveSelection(selectedElement);
    });
  }

  function onPointerMove(event) {
    if (pointerFrame || event.pointerType === "touch") return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      hoveredElement = elementAtPoint(event.clientX, event.clientY);
      if (hoveredElement) overlay.moveHover(hoveredElement);
      else overlay.hideHover();
    });
  }

  function onClick(event) {
    const element = elementAtPoint(event.clientX, event.clientY);
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectElement(element);
  }

  // Only the click selects, but menus and drags often start on press, so the
  // page must not see presses either while annotating.
  const PRESS_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "auxclick"];

  function onPress(event) {
    if (!isSelectable(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function onFocusIn(event) {
    if (!isSelectable(event.target)) return;
    hoveredElement = event.target;
    overlay.moveHover(hoveredElement);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      disable();
      chrome.runtime.sendMessage({ type: "ANNOTATE_DISABLED_BY_PAGE" }, () => {
        void chrome.runtime.lastError;
      });
      return;
    }
    if (event.key !== "Enter" || !isSelectable(document.activeElement)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selectElement(document.activeElement);
  }

  function enable() {
    if (enabled) return;
    enabled = true;
    overlay = api.createOverlay();
    if (selectedElement?.isConnected) overlay.moveSelection(selectedElement);
    document.addEventListener("pointermove", onPointerMove, true);
    for (const type of PRESS_EVENTS) document.addEventListener(type, onPress, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", scheduleLayoutRefresh, true);
    window.addEventListener("resize", scheduleLayoutRefresh);
  }

  function disable() {
    if (!enabled) return;
    enabled = false;
    document.removeEventListener("pointermove", onPointerMove, true);
    for (const type of PRESS_EVENTS) document.removeEventListener(type, onPress, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("scroll", scheduleLayoutRefresh, true);
    window.removeEventListener("resize", scheduleLayoutRefresh);
    cancelAnimationFrame(pointerFrame);
    cancelAnimationFrame(layoutFrame);
    pointerFrame = 0;
    layoutFrame = 0;
    overlay?.destroy();
    overlay = null;
    hoveredElement = null;
  }

  function clearSelection() {
    selectedElement = null;
    selectedLocator = null;
    overlay?.hideSelection();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) return;
    if (message.type === "PING_CONTENT") sendResponse({ ok: true, loaded: true });
    if (message.type === "ANNOTATE_ENABLE") {
      enable();
      sendResponse({ ok: true });
    }
    if (message.type === "ANNOTATE_DISABLE") {
      disable();
      sendResponse({ ok: true });
    }
    if (message.type === "ANNOTATE_CLEAR_SELECTION") {
      clearSelection();
      sendResponse({ ok: true });
    }
    if (message.type === "ANNOTATE_HIGHLIGHT") {
      if (enabled) disable();
      sendResponse({ ok: true, found: api.highlightElement(message.element) });
    }
    if (message.type === "ANNOTATE_GET_SELECTION") {
      sendResponse({ ok: true, payload: selectionPayload() });
    }
  });
})();
