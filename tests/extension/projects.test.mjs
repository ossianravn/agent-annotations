import assert from "node:assert/strict";
import test from "node:test";
import { projectForUrl, withOrigin, withoutOrigin } from "../../chrome-extension/shared/projects.mjs";

const shop = { id: "prj_shop", name: "shop", receiverUrl: "http://localhost:8787", token: "t", origins: ["http://localhost:3000"] };
const blog = { id: "prj_blog", name: "blog", receiverUrl: "http://localhost:8788", token: "u", origins: ["https://blog.example.com"] };

test("loopback hosts route to the same project, other ports and hosts do not", () => {
  const projects = [shop, blog];
  assert.equal(projectForUrl(projects, "http://127.0.0.1:3000/cart?x=1")?.id, "prj_shop");
  assert.equal(projectForUrl(projects, "http://[::1]:3000/")?.id, "prj_shop");
  assert.equal(projectForUrl(projects, "http://localhost:3001/"), null);
  assert.equal(projectForUrl(projects, "https://blog.example.com/post/1")?.id, "prj_blog");
  assert.equal(projectForUrl(projects, "http://blog.example.com/"), null);
  assert.equal(projectForUrl(projects, "chrome://extensions"), null);
});

test("an origin belongs to one project and moves when added elsewhere", () => {
  let projects = withOrigin([shop, blog], blog, "http://127.0.0.1:3000");
  assert.deepEqual(projects.find((project) => project.id === "prj_shop").origins, []);
  assert.deepEqual(projects.find((project) => project.id === "prj_blog").origins, ["https://blog.example.com", "http://127.0.0.1:3000"]);

  const created = { id: "prj_new", name: "new", receiverUrl: "http://localhost:8787", token: "v" };
  projects = withOrigin(projects, created, "http://localhost:5173");
  assert.deepEqual(projects.find((project) => project.id === "prj_new").origins, ["http://localhost:5173"]);

  projects = withoutOrigin(projects, "prj_blog", "http://localhost:3000");
  assert.deepEqual(projects.find((project) => project.id === "prj_blog").origins, ["https://blog.example.com"]);
});
