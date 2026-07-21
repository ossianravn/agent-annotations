(() => {
  const api = globalThis.__AGENT_ANNOTATIONS_CONTENT__;
  if (!api) throw new Error("Agent Annotations selector module was not loaded.");

  function inferRole(element) {
    const explicit = api.getAttr(element, "role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && api.getAttr(element, "href")) return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag !== "input") return null;

    const type = (api.getAttr(element, "type") || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (["button", "submit", "reset"].includes(type)) return "button";
    return "textbox";
  }

  function getTextHint(element) {
    for (const attribute of ["aria-label", "alt", "title"]) {
      const value = api.getAttr(element, attribute);
      if (value) return value.slice(0, 140);
    }
    const text = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 140) : null;
  }

  function xpathLiteral(value) {
    const text = String(value);
    if (!text.includes('"')) return `"${text}"`;
    if (!text.includes("'")) return `'${text}'`;
    const parts = text.split('"').map((part) => `"${part}"`);
    return `concat(${parts.join(", '\"', ")})`;
  }

  function buildXPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.id) return `//*[@id=${xpathLiteral(element.id)}]`;

    const parts = [];
    let current = element;
    for (let depth = 0; depth < 5 && current?.nodeType === Node.ELEMENT_NODE; depth += 1) {
      const siblings = Array.from(current.parentNode?.children || [])
        .filter((sibling) => sibling.tagName === current.tagName);
      parts.unshift(`${current.tagName.toLowerCase()}[${Math.max(1, siblings.indexOf(current) + 1)}]`);
      current = current.parentElement;
    }
    return `/${parts.join("/")}`;
  }

  function buildLocatorBundle(element) {
    const testAttribute = api.getStableTestAttr(element);
    const css = api.buildCssSelector(element);
    const primary = {};
    const alternates = [];

    if (testAttribute?.attribute === "data-testid") {
      primary.type = "testid";
      primary.value = testAttribute.value;
      alternates.push({
        type: "css",
        value: `${element.tagName.toLowerCase()}[data-testid="${api.cssEscapeAttribute(testAttribute.value)}"]`
      });
    } else if (testAttribute) {
      primary.type = "attr";
      primary.value = `${testAttribute.attribute}=${testAttribute.value}`;
      alternates.push({
        type: "css",
        value: `${element.tagName.toLowerCase()}[${testAttribute.attribute}="${api.cssEscapeAttribute(testAttribute.value)}"]`
      });
    } else if (element.id) {
      primary.type = "id";
      primary.value = element.id;
      alternates.push({ type: "css", value: `#${api.cssEscapeIdentifier(element.id)}` });
    } else {
      primary.type = "css";
      primary.value = css || "";
    }

    const role = inferRole(element);
    const textHint = getTextHint(element);
    if (role) alternates.push({ type: "role", value: role, nameHint: textHint || "" });
    const hasCssAlternate = alternates.some((alternate) => alternate.type === "css" && alternate.value === css);
    if (css && !hasCssAlternate && (primary.type !== "css" || primary.value !== css)) {
      alternates.push({ type: "css", value: css });
    }
    const xpath = buildXPath(element);
    if (xpath) alternates.push({ type: "xpath", value: xpath });

    return {
      primary,
      alternates,
      textHint,
      attrs: {
        id: element.id || null,
        class: element.className ? String(element.className).slice(0, 180) : null,
        name: api.getAttr(element, "name"),
        href: api.getAttr(element, "href")
      }
    };
  }

  function rectPayload(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      w: rect.width,
      h: rect.height,
      dpr: window.devicePixelRatio || 1,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight
    };
  }

  Object.assign(api, { buildLocatorBundle, buildXPath, rectPayload });
})();
