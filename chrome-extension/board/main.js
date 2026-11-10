import { connectEvents } from "../shared/live_events.mjs";
import { loadProjects } from "../shared/projects.mjs";
import { listCards, readHealth } from "./api.js";
import { bindCardDialog, openCard, refreshOpenCard } from "./card_dialog.js";
import { bindColumns, renderBoard } from "./columns.js";
import { bindNewCard } from "./new_card.js";
import { $, announce, board, setConnection, showMessage } from "./state.js";

let live = null;
let reloadId = 0;
let selectionId = 0;

async function reload() {
  const requestId = ++reloadId;
  try {
    const cards = await listCards();
    if (requestId !== reloadId) return;
    board.cards = cards;
    renderBoard();
    refreshOpenCard();
  } catch (error) {
    if (error.offline) {
      setConnection("offline");
      showMessage(`${board.project.name} isn't running. Start its receiver to see the board; it reconnects by itself.`);
    } else {
      announce(`Could not load cards: ${error?.message || error}`, "error");
    }
  }
}
board.reload = reload;

function renderProjectOptions() {
  const select = $("projectSelect");
  select.replaceChildren(...board.projects.map((project) => (
    Object.assign(document.createElement("option"), { value: project.id, textContent: project.name })
  )));
  select.disabled = board.projects.length < 2;
}

async function selectProject(projectId) {
  live?.close();
  live = null;
  board.cards = [];
  board.target = null;
  board.project = board.projects.find((project) => project.id === projectId) || board.projects[0] || null;
  renderBoard();
  if (!board.project) {
    setConnection("none");
    showMessage("No projects yet. Open a page in the side panel while its repo's receiver is running, then choose Add page.");
    return;
  }
  $("projectSelect").value = board.project.id;
  document.title = `${board.project.name} · Board`;
  history.replaceState(null, "", `?project=${encodeURIComponent(board.project.id)}`);

  const selection = ++selectionId;
  const health = await readHealth(board.project.receiverUrl);
  if (selection !== selectionId) return;
  if (health && health.projectId !== board.project.id) {
    // Reading or writing another repo's cards under this name would mislead.
    setConnection("other-repo");
    showMessage(`${health.name} is running at ${board.project.receiverUrl}, not ${board.project.name}. Start ${board.project.name}'s receiver to see its board.`);
    return;
  }
  board.target = { receiverUrl: board.project.receiverUrl, token: board.project.token };
  if (health) {
    board.wipLimit = health.wipLimitPerAgent || 2;
    setConnection("ok");
    showMessage("");
    await reload();
  } else {
    setConnection("offline");
    showMessage(`${board.project.name} isn't running. Start its receiver to see the board; it reconnects by itself.`);
  }
  // Also covers a receiver that starts later: the first event brings the board up.
  live = connectEvents(board.target, async () => {
    setConnection("ok");
    showMessage("");
    await reload();
  });
}

function bindFilters() {
  $("search").addEventListener("input", () => {
    board.filters.text = $("search").value.trim();
    renderBoard();
  });
  for (const radio of document.querySelectorAll('input[name="typeFilter"]')) {
    radio.addEventListener("change", () => {
      board.filters.type = radio.value;
      renderBoard();
    });
  }
  $("showArchived").addEventListener("change", () => {
    board.filters.archived = $("showArchived").checked;
    renderBoard();
  });
  $("projectSelect").addEventListener("change", () => selectProject($("projectSelect").value));
}

async function main() {
  board.projects = await loadProjects();
  renderProjectOptions();
  bindFilters();
  bindColumns({ onOpen: openCard });
  bindCardDialog();
  bindNewCard();
  await selectProject(new URLSearchParams(location.search).get("project"));
}

main().catch((error) => {
  console.error("The board could not start:", error);
  announce(`The board could not start: ${error?.message || error}`, "error");
});
