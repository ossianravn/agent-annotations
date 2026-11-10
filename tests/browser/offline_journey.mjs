import assert from "node:assert/strict";
import { click, evaluate, readCards, waitForEvaluation } from "./journey_support.mjs";

const OFFLINE_COMMENT = "Captured while the repo was offline";

async function selectCheckoutButton(chrome, panelSession, pageSession) {
  if (!await evaluate(chrome, panelSession, "document.querySelector('#annotateToggle').checked")) {
    await click(chrome, panelSession, "#annotateToggle");
  }
  await waitForEvaluation(chrome, pageSession, "Boolean(document.querySelector('#__agent_annotations_overlay'))", "annotation overlay");
  await evaluate(chrome, pageSession, "document.querySelector('[data-testid=checkout-action]').focus()");
  for (const type of ["keyDown", "keyUp"]) {
    await chrome.command("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, pageSession);
  }
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#selectedSummary').textContent.includes('checkout-action')", "offline selection");
}

// Saving must work with the repo offline, and the annotation must reach the
// repo by itself once the receiver is back.
export async function verifyOfflineCapture(chrome, panelSession, pageSession, { stopReceiver, startReceiver, receiverRepo, repoName }) {
  await stopReceiver();
  await click(chrome, panelSession, "#tabNew");
  await selectCheckoutButton(chrome, panelSession, pageSession);
  await evaluate(chrome, panelSession, `(() => {
    const comment = document.querySelector('#comment');
    comment.value = ${JSON.stringify(OFFLINE_COMMENT)};
    comment.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(chrome, panelSession, "#send");
  await waitForEvaluation(
    chrome,
    panelSession,
    `document.querySelector('#actionStatus').textContent === 'Saved in the browser. It will be sent when ${repoName} is running.'`,
    "saved locally while offline"
  );
  assert.equal(await evaluate(chrome, panelSession, "document.querySelector('#comment').value"), "", "the form resets once the annotation is safe");

  await click(chrome, panelSession, "#tabOpen");
  await waitForEvaluation(
    chrome,
    panelSession,
    `[...document.querySelectorAll('.item.is-local')].some((card) => card.textContent.includes(${JSON.stringify(OFFLINE_COMMENT)}) && card.textContent.includes('Waiting for ${repoName}'))`,
    "waiting card"
  );

  await startReceiver();
  await click(chrome, panelSession, "#refreshList");
  await waitForEvaluation(
    chrome,
    panelSession,
    `!document.querySelector('.item.is-local') && [...document.querySelectorAll('#list .item')].some((card) => card.textContent.includes(${JSON.stringify(OFFLINE_COMMENT)}))`,
    "waiting annotation delivered"
  );
  const waiting = await evaluate(chrome, panelSession, "import(chrome.runtime.getURL('shared/outbox_store.mjs')).then((store) => store.listOutboxItems()).then((items) => items.length)");
  assert.equal(waiting, 0, "delivered annotations leave the outbox");
  const delivered = (await readCards(receiverRepo)).filter((card) => card.comment === OFFLINE_COMMENT);
  assert.equal(delivered.length, 1, "delivered exactly once");
  assert.equal(delivered[0].status, "ready", "Send to agent makes the card ready");
  return delivered[0];
}
