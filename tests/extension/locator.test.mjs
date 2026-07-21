import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function locatorApi() {
  const context = vm.createContext({
    console,
    Node: { ELEMENT_NODE: 1 }
  });
  context.globalThis = context;
  const selector = await readFile("chrome-extension/content/selector.js", "utf8");
  const locator = await readFile("chrome-extension/content/locator.js", "utf8");
  vm.runInContext(selector, context);
  vm.runInContext(locator, context);
  return context.__AGENT_ANNOTATIONS_CONTENT__;
}

test("XPath ID locators support IDs containing both quote types", async () => {
  const api = await locatorApi();
  const xpath = api.buildXPath({ nodeType: 1, id: `save'"draft` });
  assert.equal(xpath, `//*[@id=concat("save'", '"', "draft")]`);
});

test("CSS identifier fallback escapes leading digits and punctuation", async () => {
  const api = await locatorApi();
  assert.equal(api.cssEscapeIdentifier("1:panel"), "\\31 \\:panel");
});
