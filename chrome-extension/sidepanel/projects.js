import {
  loadProjects,
  pageOrigin,
  projectForUrl,
  saveProjects,
  withOrigin,
  withProjectToken
} from "../shared/projects.mjs";
import { setConnectionStatus } from "./feedback.js";
import { renderProjectPrompt } from "./project_prompt.js";
import { checkToken, probeReceiver } from "./receiver.js";
import { requestSync } from "./outbox.js";
import { connectEvents } from "../shared/live_events.mjs";
import { repoNameOf } from "../shared/receiver_setup.mjs";
import { $, state } from "./shared.js";

// "Not now" lasts for this panel session only.
const dismissedOrigins = new Set();
let routeRequestId = 0;
let live = null;
let liveKey = null;
let onCardsChanged = () => {};

export function onLiveCardsChanged(callback) {
  onCardsChanged = callback;
}

// Follow the page's repo, so agent claims and hand-backs show up by themselves.
function followCards(target, reachable) {
  const key = reachable && target ? `${target.receiverUrl}|${target.token}` : null;
  if (key === liveKey) return;
  live?.close();
  live = null;
  liveKey = key;
  if (key) live = connectEvents(target, () => onCardsChanged());
}

export async function loadProjectsIntoState() {
  state.projects = await loadProjects();
}

function knownProject(projectId) {
  return state.projects.find((project) => project.id === projectId) || null;
}

async function credentialsFor(running) {
  const token = knownProject(running.id)?.token || state.settings.token;
  const status = await checkToken(running.receiverUrl, token);
  return { token: status === "ok" ? token : "", status };
}

async function resolveRoute() {
  const origin = pageOrigin(state.activeUrl);
  const project = projectForUrl(state.projects, state.activeUrl);
  const receiverUrl = project?.receiverUrl || state.settings.serverUrl;
  const health = await probeReceiver(receiverUrl);
  const running = health?.projectId
    ? { id: health.projectId, name: health.name || "Unnamed repo", receiverUrl }
    : null;

  if (project) {
    if (!health) return { project, status: "offline", target: project };
    if (!running) {
      return {
        project,
        status: "outdated",
        prompt: { kind: "legacy", project, repoName: repoNameOf(health) || project.name, receiverUrl }
      };
    }
    if (running.id !== project.id) {
      // Saving now would write into whichever repo happens to own the port.
      const credentials = await credentialsFor(running);
      return {
        project,
        status: "other-repo",
        prompt: { kind: "mismatch", project, running, origin, needsToken: credentials.status !== "ok", token: credentials.token }
      };
    }
    const status = await checkToken(receiverUrl, project.token);
    const tokenProblem = status === "unauthorized" || status === "missing-token";
    return { project, status, target: project, prompt: tokenProblem ? { kind: "token", project } : null };
  }

  if (!health) {
    // Only the first run needs telling how to start one; later, unrelated
    // pages stay quiet.
    const prompt = state.projects.length ? null : { kind: "start", receiverUrl };
    return { project: null, status: "offline", target: null, prompt };
  }
  if (!running) {
    // Receivers older than 0.4.4 have no project identity, so the page can't
    // be added. Saves still reach the old inbox until the repo is updated.
    const tokenStatus = await checkToken(receiverUrl, state.settings.token);
    return {
      project: null,
      // Updating is the step that matters; a token comes after it.
      status: "outdated",
      target: tokenStatus === "ok" ? { receiverUrl, token: state.settings.token } : null,
      prompt: { kind: "legacy", project: null, repoName: repoNameOf(health), receiverUrl }
    };
  }
  const credentials = await credentialsFor(running);
  const ready = credentials.status === "ok";
  const offer = origin && !dismissedOrigins.has(origin);
  return {
    project: null,
    status: credentials.status,
    // Until the page is added, saves still reach the repo that is running.
    target: ready ? { ...running, token: credentials.token } : null,
    // "Not now" hides the offer even without a token; saves then wait in the
    // browser until the page is added.
    prompt: offer
      ? { kind: "add", running, origin, needsToken: !ready, token: credentials.token, known: Boolean(knownProject(running.id)) }
      : null
  };
}

function blockedReason(route) {
  if (route.prompt?.kind === "mismatch") {
    return `This page belongs to ${route.prompt.project.name}, but ${route.prompt.running.name} is running.`;
  }
  if (route.prompt?.kind === "legacy" && route.prompt.project) {
    return "The running receiver is too old to confirm this page's repo.";
  }
  if (route.prompt?.kind === "add" && route.prompt.needsToken) return `Add the token for ${route.prompt.running.name} first.`;
  return null;
}

// While the panel waits for a receiver to start or be updated, it checks again
// by itself, so the next step appears without reloading the page.
let recheckTimer = null;
const RECHECK_MS = 3000;

function scheduleRecheck(route) {
  clearTimeout(recheckTimer);
  recheckTimer = ["start", "legacy"].includes(route.prompt?.kind)
    ? setTimeout(() => refreshRoute().catch(() => {}), RECHECK_MS)
    : null;
}

export async function refreshRoute() {
  const requestId = ++routeRequestId;
  const route = await resolveRoute();
  if (requestId !== routeRequestId) return;
  state.project = route.project;
  state.target = route.target
    ? {
      receiverUrl: route.target.receiverUrl,
      token: route.target.token,
      projectId: route.target.id ?? null,
      name: route.target.name ?? null
    }
    : null;
  state.targetBlockedReason = blockedReason(route);
  $("projectName").textContent = route.project?.name || "No project";
  setConnectionStatus(route.status);
  renderProjectPrompt(route.prompt, { addPage, dismiss, saveToken });
  const reachable = route.status === "ok" || (route.status === "outdated" && Boolean(state.target));
  followCards(state.target, reachable);
  // A repo that just became reachable may have annotations waiting for it.
  if (reachable) requestSync();
  scheduleRecheck(route);
}

async function storeProjects(projects) {
  await saveProjects(projects);
  state.projects = projects;
  await afterProjectsChanged();
}

let afterProjectsChanged = async () => {};

export function onProjectsChanged(callback) {
  afterProjectsChanged = callback;
}

async function requireValidToken(receiverUrl, token) {
  const status = await checkToken(receiverUrl, token);
  if (status === "missing-token") throw new Error("Paste the token printed by the receiver.");
  if (status === "unauthorized") throw new Error("The receiver rejected that token.");
  if (status !== "ok") throw new Error("The receiver stopped answering.");
}

async function addPage({ running, origin, token }) {
  await requireValidToken(running.receiverUrl, token);
  const project = { id: running.id, name: running.name, receiverUrl: running.receiverUrl, token };
  await storeProjects(withOrigin(state.projects, project, origin));
}

async function saveToken({ project, token }) {
  await requireValidToken(project.receiverUrl, token);
  await storeProjects(withProjectToken(state.projects, project.id, token));
}

async function dismiss({ origin }) {
  dismissedOrigins.add(origin);
  await refreshRoute();
}

export async function replaceProjects(projects) {
  await storeProjects(projects);
}
