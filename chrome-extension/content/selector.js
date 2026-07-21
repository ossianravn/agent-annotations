(() => {
  const api = globalThis.__AGENT_ANNOTATIONS_CONTENT__ ||= {};

  function getAttr(element, name) {
    const value = element?.getAttribute?.(name);
    return value == null ? null : String(value);
  }

  function getStableTestAttr(element) {
    for (const attribute of ["data-testid", "data-test", "data-cy", "data-qa"]) {
      const value = getAttr(element, attribute);
      if (value) return { attribute, value };
    }
    return null;
  }

  function cssEscapeIdentifier(identifier) {
    const value = String(identifier ?? "");
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);

    let escaped = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      const code = value.charCodeAt(index);
      const isControl = (code >= 1 && code <= 31) || code === 127;
      const isDigit = code >= 48 && code <= 57;
      const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

      if (code === 0) {
        escaped += "\uFFFD";
      } else if (
        isControl ||
        (index === 0 && isDigit) ||
        (index === 1 && isDigit && value.charCodeAt(0) === 45)
      ) {
        escaped += `\\${code.toString(16)} `;
      } else if (index === 0 && character === "-" && value.length === 1) {
        escaped += "\\-";
      } else if (code >= 128 || character === "-" || character === "_" || isLetter || isDigit) {
        escaped += character;
      } else {
        escaped += `\\${character}`;
      }
    }
    return escaped;
  }

  function cssEscapeAttribute(value) {
    return String(value ?? "").replace(/["\\\n\r\f]/g, "\\$&");
  }

  function candidateClasses(element) {
    return Array.from(element?.classList || [])
      .map((name) => String(name).trim())
      .filter(Boolean)
      .filter((name) => name.length <= 48)
      .filter((name) => !/^ng-/.test(name))
      .filter((name) => !/^(active|selected|open|closed|disabled|enabled|focus|focused|hover|pressed)$/.test(name));
  }

  function directChildMatchCount(parent, selector) {
    if (!parent) return null;
    try {
      return parent.querySelectorAll(`:scope > ${selector}`).length;
    } catch {
      return null;
    }
  }

  function stableAttributeSelector(element, tag) {
    if (tag === "a") {
      const href = getAttr(element, "href");
      if (href && href.length <= 220 && !href.startsWith("javascript:")) {
        return `${tag}[href="${cssEscapeAttribute(href)}"]`;
      }
    }
    if (tag === "button") {
      const type = (getAttr(element, "type") || "").toLowerCase();
      if (type && type !== "submit") return `${tag}[type="${cssEscapeAttribute(type)}"]`;
    }
    if (tag === "input") {
      const name = getAttr(element, "name");
      if (name && name.length <= 120) return `${tag}[name="${cssEscapeAttribute(name)}"]`;
      const type = (getAttr(element, "type") || "").toLowerCase();
      if (type && type !== "text") return `${tag}[type="${cssEscapeAttribute(type)}"]`;
    }
    return null;
  }

  function buildSegment(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = element.tagName.toLowerCase();
    if (element.id) return `#${cssEscapeIdentifier(element.id)}`;

    const testAttribute = getStableTestAttr(element);
    if (testAttribute) {
      return `${tag}[${testAttribute.attribute}="${cssEscapeAttribute(testAttribute.value)}"]`;
    }

    const parent = element.parentElement;
    let segment = tag || "*";
    const stableAttribute = stableAttributeSelector(element, segment);
    if (stableAttribute && directChildMatchCount(parent, stableAttribute) <= 3) {
      segment = stableAttribute;
    }

    const scoredClasses = candidateClasses(element)
      .map((name) => ({ name, matches: directChildMatchCount(parent, `${tag}.${cssEscapeIdentifier(name)}`) }))
      .filter(({ matches }) => matches != null)
      .sort((left, right) => left.matches - right.matches);

    const chosen = [];
    for (const { name } of scoredClasses) {
      chosen.push(name);
      segment = `${tag}${chosen.map((item) => `.${cssEscapeIdentifier(item)}`).join("")}`;
      if (directChildMatchCount(parent, segment) === 1 || chosen.length >= 5) break;
    }

    if (parent && directChildMatchCount(parent, segment) > 1) {
      const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === element.tagName);
      segment += `:nth-of-type(${Math.max(1, siblings.indexOf(element) + 1)})`;
    }
    return segment;
  }

  function buildCssSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    const parts = [];
    let current = element;
    let firstUnique = null;
    let contextualUnique = null;

    for (let depth = 0; depth < 12 && current?.nodeType === Node.ELEMENT_NODE; depth += 1) {
      const segment = buildSegment(current);
      if (!segment) break;
      parts.unshift(segment);
      const selector = parts.join(" > ");
      try {
        if (document.querySelectorAll(selector).length === 1) {
          firstUnique ||= selector;
          contextualUnique = selector;
          if (selector.length > 320) break;
        }
      } catch {
        // Invalid intermediate selectors are skipped while climbing ancestors.
      }
      if (current.id || getStableTestAttr(current)) break;
      current = current.parentElement;
    }

    if (!firstUnique || !contextualUnique) return firstUnique || contextualUnique || parts.join(" > ") || null;
    const firstSegments = firstUnique.split(">").length;
    const contextualSegments = contextualUnique.split(">").length;
    const firstNthCount = (firstUnique.match(/:nth-of-type\(/g) || []).length;
    const contextualNthCount = (contextualUnique.match(/:nth-of-type\(/g) || []).length;
    const preferContext =
      (firstSegments === 1 && contextualSegments >= 3 && contextualUnique.length <= 240) ||
      (firstNthCount > contextualNthCount && contextualUnique.length <= 280) ||
      (!/[#\[]/.test(firstUnique) && /[#\[]/.test(contextualUnique) && contextualUnique.length <= 280);
    return preferContext ? contextualUnique : firstUnique;
  }

  Object.assign(api, {
    buildCssSelector,
    cssEscapeAttribute,
    cssEscapeIdentifier,
    getAttr,
    getStableTestAttr
  });
})();
