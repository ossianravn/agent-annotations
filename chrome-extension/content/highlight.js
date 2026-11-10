(() => {
  const api = globalThis.__AGENT_ANNOTATIONS_CONTENT__;
  if (!api?.createOverlay) throw new Error("Agent Annotations overlay module was not loaded.");

  function query(selector) {
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function byXPath(expression) {
    try {
      return document.evaluate(expression, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch {
      return null;
    }
  }

  function locate(locator) {
    const value = String(locator?.value || "");
    if (!value) return null;
    if (locator.type === "testid") return query(`[data-testid="${api.cssEscapeAttribute(value)}"]`);
    if (locator.type === "id") return document.getElementById(value);
    if (locator.type === "css") return query(value);
    if (locator.type === "xpath") return byXPath(value);
    if (locator.type === "attr") {
      const separator = value.indexOf("=");
      if (separator < 1) return null;
      return query(`[${value.slice(0, separator)}="${api.cssEscapeAttribute(value.slice(separator + 1))}"]`);
    }
    return null;
  }

  // The primary locator first, then the alternates recorded with the card.
  function findElement(element) {
    for (const locator of [element?.primary, ...(element?.alternates || [])]) {
      const found = locate(locator);
      if (found instanceof Element) return found;
    }
    return null;
  }

  let current = null;

  function clearHighlight() {
    current?.dispose();
    current = null;
  }

  function highlightElement(element) {
    clearHighlight();
    const target = findElement(element);
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "nearest" });
    const overlay = api.createOverlay({ hudText: "Annotated element · Esc to hide" });
    const refresh = () => overlay.moveSelection(target);
    const onKeyDown = (event) => {
      if (event.key === "Escape") clearHighlight();
    };
    requestAnimationFrame(refresh);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    document.addEventListener("keydown", onKeyDown, true);
    current = {
      dispose() {
        window.removeEventListener("scroll", refresh, true);
        window.removeEventListener("resize", refresh);
        document.removeEventListener("keydown", onKeyDown, true);
        overlay.destroy();
      }
    };
    return true;
  }

  Object.assign(api, { clearHighlight, findElement, highlightElement });
})();
