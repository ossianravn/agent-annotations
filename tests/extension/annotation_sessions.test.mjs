import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.chrome = {
  storage: {
    session: {
      async get(key) {
        return values.has(key) ? { [key]: values.get(key) } : {};
      },
      async set(entries) {
        for (const [key, value] of Object.entries(entries)) values.set(key, value);
      },
      async remove(key) {
        values.delete(key);
      }
    }
  }
};

const {
  clearAnnotationSession,
  getAnnotationSession,
  setAnnotationSession
} = await import("../../chrome-extension/shared/annotation_sessions.mjs");

test.beforeEach(() => values.clear());

test("annotation state is isolated by tab and survives module state", async () => {
  await setAnnotationSession(11, true);
  await setAnnotationSession(22, true);
  await setAnnotationSession(11, false);

  assert.equal(await getAnnotationSession(11), false);
  assert.equal(await getAnnotationSession(22), true);
});

test("closed-tab cleanup removes only that tab's state", async () => {
  await setAnnotationSession(11, true);
  await setAnnotationSession(22, true);
  await clearAnnotationSession(11);

  assert.equal(await getAnnotationSession(11), false);
  assert.equal(await getAnnotationSession(22), true);
});

test("invalid tab IDs fail instead of sharing a fallback key", async () => {
  await assert.rejects(() => setAnnotationSession(null, true), /tab ID/i);
});
