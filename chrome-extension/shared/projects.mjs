// A project is one repo (identified by the receiver's projectId) plus the page
// origins that belong to it. Origins only route; the projectId is the identity.

const STORAGE_KEY = "projects";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function pageOrigin(urlString) {
  try {
    const url = new URL(urlString);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

// Dev servers switch between localhost, 127.0.0.1 and ::1, so those compare as one host.
export function originKey(origin) {
  const url = new URL(origin);
  const host = LOOPBACK_HOSTS.has(url.hostname) ? "loopback" : url.hostname;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.protocol}//${host}:${port}`;
}

function sameOrigin(left, right) {
  try {
    return originKey(left) === originKey(right);
  } catch {
    return false;
  }
}

export function projectForUrl(projects, urlString) {
  const origin = pageOrigin(urlString);
  if (!origin) return null;
  return projects.find((project) => project.origins.some((candidate) => sameOrigin(candidate, origin))) || null;
}

// An origin belongs to one project only, so adding it elsewhere moves it.
export function withOrigin(projects, project, origin) {
  const others = projects
    .filter((candidate) => candidate.id !== project.id)
    .map((candidate) => ({
      ...candidate,
      origins: candidate.origins.filter((existing) => !sameOrigin(existing, origin))
    }));
  const current = projects.find((candidate) => candidate.id === project.id) || { ...project, origins: [] };
  const origins = current.origins.some((existing) => sameOrigin(existing, origin))
    ? current.origins
    : [...current.origins, origin];
  return [...others, { ...current, ...project, origins }];
}

export function withoutOrigin(projects, projectId, origin) {
  return projects.map((project) => (
    project.id === projectId
      ? { ...project, origins: project.origins.filter((existing) => !sameOrigin(existing, origin)) }
      : project
  ));
}

export function withProjectToken(projects, projectId, token) {
  return projects.map((project) => (project.id === projectId ? { ...project, token } : project));
}

export function withoutProject(projects, projectId) {
  return projects.filter((project) => project.id !== projectId);
}

export async function loadProjects() {
  const saved = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(saved[STORAGE_KEY]) ? saved[STORAGE_KEY] : [];
}

export async function saveProjects(projects) {
  await chrome.storage.local.set({ [STORAGE_KEY]: projects });
}
