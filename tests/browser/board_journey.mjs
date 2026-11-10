import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { click, evaluate, readCards, waitFor, waitForEvaluation } from "./journey_support.mjs";

const run = promisify(execFile);
const cardsCli = path.resolve(import.meta.dirname, "../../packages/agent-annotations-receiver/bin/agent-annotations-cards.cjs");
const IDEA = "Idea from the board: add a dark mode toggle";
const inColumn = (status, text) => `[...document.querySelectorAll('.column[data-status="${status}"] .board-card')].some((card) => card.textContent.includes(${JSON.stringify(text)}))`;

export async function verifyBoard(chrome, { extensionId, panelSession, receiverRepo, card, fixtureUrl }) {
  const projectId = await evaluate(chrome, panelSession, "chrome.storage.local.get('projects').then(({ projects }) => projects.find((project) => project.origins.length).id)");
  const { targetId } = await chrome.command("Target.createTarget", { url: `chrome-extension://${extensionId}/board.html?project=${projectId}` });
  const boardSession = await chrome.attach(targetId);
  const title = card.title;

  await waitForEvaluation(chrome, boardSession, `document.querySelector('#connStatusLabel').textContent === 'Connected' && ${inColumn("ready", title)}`, "board shows the ready card");

  // An agent working elsewhere moves the card on an open board without a reload.
  await run(process.execPath, [cardsCli, "next", "--agent", "board-agent", "--repo", receiverRepo]);
  await waitForEvaluation(chrome, boardSession, inColumn("in_progress", title), "live update after an agent claim");
  assert.match(await evaluate(chrome, boardSession, "document.querySelector('#wipLimit').textContent"), /Up to 2 per agent · 1 working/);

  // Drag it back to Ready (synthetic drag events: same handlers as a mouse drag).
  await evaluate(chrome, boardSession, `(() => {
    const card = [...document.querySelectorAll('.column[data-status="in_progress"] .board-card')].find((item) => item.textContent.includes(${JSON.stringify(title)}));
    const transfer = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    const list = document.querySelector('.column[data-status="ready"] .column-cards');
    const y = list.getBoundingClientRect().top + 4;
    list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: y }));
    list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: y }));
  })()`);
  await waitForEvaluation(chrome, boardSession, inColumn("ready", title), "dragged back to Ready");
  // The board moves the card before the receiver has written it, so wait for the file.
  await waitFor(async () => (await readCards(receiverRepo)).find((candidate) => candidate.id === card.id)?.status === "ready", "drag saved to the card");
  const dragged = (await readCards(receiverRepo)).find((candidate) => candidate.id === card.id);
  assert.equal(dragged.claimedBy, undefined, "moving out of In progress releases the claim");

  // A card can start on the board, without a page.
  await click(chrome, boardSession, "#newCard");
  await evaluate(chrome, boardSession, `document.querySelector('#newComment').value = ${JSON.stringify(IDEA)}`);
  await click(chrome, boardSession, "#newCardDraft");
  await waitForEvaluation(chrome, boardSession, inColumn("draft", IDEA), "new draft card");
  const idea = (await readCards(receiverRepo)).find((candidate) => candidate.comment === IDEA);
  assert.equal(idea.status, "draft");
  assert.equal(idea.url, undefined);

  // Type, tags and a "Done when" criterion are editable on the card.
  await evaluate(chrome, boardSession, `[...document.querySelectorAll('.board-card')].find((item) => item.textContent.includes(${JSON.stringify(IDEA)})).click()`);
  await waitForEvaluation(chrome, boardSession, "document.querySelector('#cardDialog').open", "idea dialog");
  await click(chrome, boardSession, "#cardDialog .segment[data-sev='bug']");
  await waitFor(async () => (await readCards(receiverRepo)).find((candidate) => candidate.comment === IDEA)?.severity === "bug", "type change saved");
  await evaluate(chrome, boardSession, `(() => {
    const tags = document.querySelector('#cardTags');
    tags.value = 'Ideas, UX';
    tags.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#newCriterion').value = 'The toggle remembers the choice';
  })()`);
  await click(chrome, boardSession, "#saveCard");
  await waitForEvaluation(chrome, boardSession, "document.querySelector('#cardHint').textContent === 'Saved.'", "tags saved");
  await click(chrome, boardSession, "#addCriterion");
  await waitForEvaluation(chrome, boardSession, "document.querySelectorAll('#cardAcceptance input[type=checkbox]').length === 1", "criterion added");
  await click(chrome, boardSession, "#cardAcceptance input[type=checkbox]");
  await waitFor(async () => {
    const edited = (await readCards(receiverRepo)).find((candidate) => candidate.comment === IDEA);
    return edited?.acceptance?.[0]?.done === true && edited.tags.join() === "ideas,ux";
  }, "criterion ticked and tags stored");
  await click(chrome, boardSession, "#closeCard");
  await waitForEvaluation(chrome, boardSession, `!document.querySelector('#cardDialog').open && document.body.textContent.includes('1/1 done')`, "progress on the card");

  // Keyboard equivalent of dragging: Alt+Right moves the draft to Ready.
  await evaluate(chrome, boardSession, `[...document.querySelectorAll('.board-card')].find((item) => item.textContent.includes(${JSON.stringify(IDEA)})).focus()`);
  for (const type of ["keyDown", "keyUp"]) {
    await chrome.command("Input.dispatchKeyEvent", { type, key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers: 1 }, boardSession);
  }
  await waitForEvaluation(chrome, boardSession, inColumn("ready", IDEA), "moved with the keyboard");
  await waitForEvaluation(chrome, boardSession, `document.activeElement?.textContent.includes(${JSON.stringify(IDEA)})`, "focus follows the moved card");

  // Done, then archived: it leaves the board until Show archived is on.
  await evaluate(chrome, boardSession, `[...document.querySelectorAll('.board-card')].find((item) => item.textContent.includes(${JSON.stringify(IDEA)})).click()`);
  await waitForEvaluation(chrome, boardSession, "document.querySelector('#cardDialog').open && document.querySelector('#cardPageField').hidden", "page-less card dialog");
  await click(chrome, boardSession, "#doneCard");
  await waitForEvaluation(chrome, boardSession, inColumn("done", IDEA), "marked done");
  await evaluate(chrome, boardSession, `[...document.querySelectorAll('.board-card')].find((item) => item.textContent.includes(${JSON.stringify(IDEA)})).click()`);
  await waitForEvaluation(chrome, boardSession, "!document.querySelector('#archiveCard').hidden", "archive offered for done cards");
  await click(chrome, boardSession, "#archiveCard");
  await waitForEvaluation(chrome, boardSession, `!${inColumn("done", IDEA)}`, "archived card hidden");
  await click(chrome, boardSession, "#showArchived");
  await waitForEvaluation(chrome, boardSession, inColumn("done", IDEA), "archived card shown on request");

  // Show on page opens the card's page and outlines its element.
  await evaluate(chrome, boardSession, `[...document.querySelectorAll('.board-card')].find((item) => item.textContent.includes(${JSON.stringify(title)})).click()`);
  await waitForEvaluation(chrome, boardSession, "document.querySelector('#cardDialog').open && document.querySelector('#cardPage').textContent.length > 0", "card with a page");
  const before = new Set((await chrome.command("Target.getTargets")).targetInfos.map((target) => target.targetId));
  await click(chrome, boardSession, "#showOnPage");
  const opened = await chrome.waitForTarget((target) => target.type === "page" && target.url === fixtureUrl && !before.has(target.targetId), 15000);
  const pageSession = await chrome.attach(opened.targetId);
  await waitForEvaluation(chrome, pageSession, "Boolean(document.querySelector('#__agent_annotations_overlay'))", "element outlined on the page");
  await chrome.command("Target.closeTarget", { targetId: opened.targetId });
  await chrome.command("Target.closeTarget", { targetId });
}
