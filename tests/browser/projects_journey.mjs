import assert from "node:assert/strict";
import { click, evaluate, waitForEvaluation } from "./journey_support.mjs";

const promptText = "document.querySelector('#projectPrompt').textContent";

export async function verifyProjectRouting(chrome, panelSession, repoName) {
  // A page outside every project is offered to the repo that is running.
  await waitForEvaluation(chrome, panelSession, `!document.querySelector('#projectPrompt').hidden && ${promptText}.includes(${JSON.stringify(repoName)})`, "add-page prompt");
  assert.equal(await evaluate(chrome, panelSession, "document.querySelector('#projectName').textContent"), "No project");
  // Page loads and Save settings refresh the route; an unchanged prompt stays as it is.
  const kept = await evaluate(chrome, panelSession, `(async () => {
    const before = document.querySelector('#projectPrompt .btn-primary');
    before.closest('#projectPrompt').querySelector('.prompt-error').textContent = 'Shown error';
    await (await import(chrome.runtime.getURL('sidepanel/projects.js'))).refreshRoute();
    const prompt = document.querySelector('#projectPrompt');
    const result = prompt.querySelector('.btn-primary') === before && prompt.querySelector('.prompt-error').textContent === 'Shown error';
    prompt.querySelector('.prompt-error').textContent = '';
    return result;
  })()`);
  assert.equal(kept, true, "a route refresh must not rebuild an unchanged prompt");
  await click(chrome, panelSession, "#projectPrompt .btn-primary");
  await waitForEvaluation(chrome, panelSession, `document.querySelector('#projectName').textContent === ${JSON.stringify(repoName)} && document.querySelector('#projectPrompt').hidden`, "page added to project");

  // Another repo answering on the project's port must pause saving until the page is moved.
  await evaluate(chrome, panelSession, `(async () => {
    const { projects } = await chrome.storage.local.get('projects');
    projects[0].id = 'prj_some_other_repo';
    await chrome.storage.local.set({ projects });
    const panel = await import(chrome.runtime.getURL('sidepanel/projects.js'));
    await panel.loadProjectsIntoState();
    await panel.refreshRoute();
  })()`);
  await waitForEvaluation(chrome, panelSession, `document.querySelector('#connStatusLabel').textContent === 'Other repo running' && ${promptText}.includes('wait in the browser')`, "wrong-repo guard");
  const blocked = await evaluate(chrome, panelSession, `(async () => {
    const receiver = await import(chrome.runtime.getURL('sidepanel/receiver.js'));
    try { await receiver.getAnnotationsForRoute(); return 'not blocked'; } catch (error) { return error.message; }
  })()`);
  assert.match(blocked, /belongs to .* but .* is running/);

  await click(chrome, panelSession, "#projectPrompt .btn");
  await waitForEvaluation(chrome, panelSession, "document.querySelector('#connStatusLabel').textContent === 'Connected' && document.querySelector('#projectPrompt').hidden", "page moved to running repo");
  const stored = Object.fromEntries(await evaluate(chrome, panelSession, "chrome.storage.local.get('projects').then(({ projects }) => projects.map((project) => [project.id, project.origins.length]))"));
  const [runningId] = Object.keys(stored).filter((id) => id !== "prj_some_other_repo");
  assert.deepEqual(stored, { prj_some_other_repo: 0, [runningId]: 1 }, "the page moved to the running repo's project");
}
