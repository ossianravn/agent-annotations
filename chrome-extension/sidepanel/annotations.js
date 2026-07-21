import { $, normalizedSeverity, state } from "./shared.js";
import { setListMessage } from "./feedback.js";
import { getAnnotationsForRoute, markResolved } from "./receiver.js";

function severityLabel(value) {
  if (value === "bug") return "BUG";
  if (value === "feature") return "FEATURE";
  return "REQUEST";
}

export function renderList() {
  const root = $("list");
  root.replaceChildren();
  if (!state.openAnnotations.length) {
    setListMessage("No unresolved annotations.");
    return;
  }

  for (const annotation of state.openAnnotations) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "item";
    item.addEventListener("click", () => openDetail(annotation));

    const top = document.createElement("span");
    top.className = "topline";
    const badges = document.createElement("span");
    badges.className = "badges";
    const severity = document.createElement("span");
    severity.className = "tag";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    severity.append(dot, document.createTextNode(severityLabel(normalizedSeverity(annotation.severity))));
    badges.appendChild(severity);

    if (annotation.tags?.length) {
      const tags = document.createElement("span");
      tags.className = "tag";
      tags.textContent = annotation.tags.slice(0, 2).join(", ");
      badges.appendChild(tags);
    }

    const id = document.createElement("span");
    id.className = "id mono";
    id.textContent = annotation.id ? `[#${annotation.id}]` : "";
    top.append(badges, id);
    const comment = document.createElement("span");
    comment.textContent = annotation.comment || "No comment";
    item.append(top, comment);
    root.appendChild(item);
  }
}

export async function refreshList() {
  const list = $("list");
  list.setAttribute("aria-busy", "true");
  setListMessage("Loading…");
  try {
    state.openAnnotations = await getAnnotationsForRoute();
    renderList();
  } catch (error) {
    state.openAnnotations = [];
    setListMessage(`Could not load annotations: ${error?.message || error}`, "inline-error");
  } finally {
    list.removeAttribute("aria-busy");
  }
}

export function openDetail(annotation) {
  state.selectedAnnotation = annotation;
  $("detailId").textContent = annotation.id || "—";
  const primary = annotation.element?.primary;
  $("detailLocator").textContent = primary ? `${primary.type}:${primary.value || ""}` : "—";
  $("detailComment").textContent = annotation.comment || "—";
  const attachments = $("detailAttachments");
  attachments.replaceChildren();
  if (annotation.attachments?.length) {
    for (const attachment of annotation.attachments) {
      const line = document.createElement("div");
      line.textContent = `${attachment.kind || "asset"}: ${attachment.path || ""}`;
      attachments.appendChild(line);
    }
  } else {
    attachments.textContent = "—";
  }
  $("detailHint").textContent = "";
  if (!$("detailDialog").open) $("detailDialog").showModal();
}

export function closeDetail() {
  state.selectedAnnotation = null;
  if ($("detailDialog").open) $("detailDialog").close();
}

function annotationPrompt(annotation) {
  const primary = annotation.element?.primary || {};
  const alternates = (annotation.element?.alternates || [])
    .map((alternate) => `${alternate.type}:${alternate.value || ""}`)
    .join(", ");
  return [
    `Route: ${annotation.routeKey || ""}`,
    `URL: ${annotation.url || ""}`,
    `Element primary: ${primary.type || ""}=${primary.value || ""}`,
    alternates ? `Alternates: ${alternates}` : null,
    annotation.element?.textHint ? `Text hint: ${annotation.element.textHint}` : null,
    annotation.comment ? `Comment: ${annotation.comment}` : null,
    annotation.attachments?.length
      ? `Attachments: ${annotation.attachments.map((attachment) => attachment.path).join(", ")}`
      : null,
    `Annotation ID: ${annotation.id || ""}`
  ].filter(Boolean).join("\n");
}

export async function copySelectedAnnotation() {
  if (!state.selectedAnnotation) return;
  try {
    await navigator.clipboard.writeText(annotationPrompt(state.selectedAnnotation));
    $("detailHint").textContent = "Copied to clipboard.";
  } catch (error) {
    $("detailHint").textContent = `Could not copy: ${error?.message || error}`;
  }
}

export async function resolveSelectedAnnotation() {
  if (!state.selectedAnnotation) return;
  $("detailHint").textContent = "Resolving…";
  try {
    await markResolved(state.selectedAnnotation);
    await refreshList();
    closeDetail();
  } catch (error) {
    $("detailHint").textContent = `Could not resolve: ${error?.message || error}`;
  }
}
