// What the board shows before any page has been added to a project: the next
// step for whatever is running at the panel's receiver address right now.
import {
  commandBlock,
  isOutdated,
  repoNameOf,
  SETUP_COMMAND,
  UPDATE_COMMAND
} from "../shared/receiver_setup.mjs";
import { readHealth } from "./api.js";
import { $ } from "./state.js";

const DEFAULT_SERVER_URL = "http://localhost:8787";
const RECHECK_MS = 3000;
const ADD_PAGE = "Then open your app in Chrome, click the Agent Annotations icon to open the side panel, and choose Add page.";

let timer = 0;
let shownKey = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function contentFor(health) {
  if (!health) {
    return {
      title: "No projects yet",
      lead: "In a terminal, go to your project's folder, run this and leave it running:",
      command: SETUP_COMMAND,
      next: ADD_PAGE
    };
  }
  if (isOutdated(health)) {
    const repo = repoNameOf(health) || "Your repo";
    return {
      title: `Update ${repo}'s receiver`,
      lead: `${repo} is running an older receiver, which can't add pages. Stop it, then run this in ${repo}:`,
      command: UPDATE_COMMAND,
      next: ADD_PAGE
    };
  }
  return {
    title: "No projects yet",
    lead: `${health.name || "Your repo"}'s receiver is running.`,
    command: null,
    next: "Open your app in Chrome, click the Agent Annotations icon to open the side panel, and choose Add page."
  };
}

async function render() {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  const content = contentFor(await readHealth(serverUrl || DEFAULT_SERVER_URL));
  const key = JSON.stringify(content);
  if (key === shownKey) return;
  shownKey = key;
  const root = $("boardMessage");
  root.replaceChildren(element("h2", "empty-title", content.title), element("p", "", content.lead));
  if (content.command) root.appendChild(commandBlock(content.command));
  root.appendChild(element("p", "", content.next));
}

// Keeps the step current while the receiver starts or is updated.
export async function showNoProjects() {
  clearTimeout(timer);
  document.body.classList.add("has-no-projects");
  $("boardMessage").hidden = false;
  $("board").hidden = true;
  try {
    await render();
  } finally {
    timer = setTimeout(showNoProjects, RECHECK_MS);
  }
}

export function hideNoProjects() {
  clearTimeout(timer);
  shownKey = null;
  document.body.classList.remove("has-no-projects");
}
