import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { click, evaluate, readCards, waitForEvaluation } from "./journey_support.mjs";

const run = promisify(execFile);
const cardsCli = path.resolve(import.meta.dirname, "../../packages/agent-annotations-receiver/bin/agent-annotations-cards.cjs");
const QUESTION = "Should the total lock or show a spinner?";

// The loop the board exists for: an agent claims a card, hands it back with a
// question, and the human sees it, reads the question and sends it back.
export async function verifyAgentHandoff(chrome, panelSession, receiverRepo, card) {
  const cli = async (...args) => JSON.parse((await run(process.execPath, [cardsCli, ...args, "--repo", receiverRepo, "--json"])).stdout);
  const listText = "document.querySelector('#list').textContent";

  const claimed = await cli("next", "--agent", "journey-agent");
  assert.equal(claimed.id, card.id);
  await click(chrome, panelSession, "#refreshList");
  await waitForEvaluation(chrome, panelSession, `${listText}.includes('In progress · journey-agent')`, "claimed card in the panel");

  await cli("handback", card.id, "--agent", "journey-agent", "--question", QUESTION);
  await click(chrome, panelSession, "#refreshList");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#list .item-status.is-attention')?.textContent === 'Waiting on you: question'", "waiting card in the panel");

  await evaluate(chrome, panelSession, `[...document.querySelectorAll('#list button.item')].find((item) => item.textContent.includes('Waiting on you')).click()`);
  await waitForEvaluation(
    chrome,
    panelSession,
    `document.querySelector('#detailDialog').open && document.querySelector('#detailStatus').value === 'waiting:question' && document.querySelector('#detailActivity').textContent.includes(${JSON.stringify(QUESTION)})`,
    "question shown in the card"
  );

  await evaluate(chrome, panelSession, `(() => {
    const select = document.querySelector('#detailStatus');
    select.value = 'ready';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#detailHint').textContent === 'Status: Ready for agent.'", "status changed from the panel");
  assert.equal((await readCards(receiverRepo)).find((candidate) => candidate.id === card.id).status, "ready");
  await click(chrome, panelSession, "#closeDetail");
}
