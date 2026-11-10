import { $, elementSummary, normalizedSeverity, state } from "./shared.js";
import { setListMessage } from "./feedback.js";
import { renderOpenCount } from "./tabs.js";
import { closeAssetPreview } from "./attachments.js";
import { clearSavedAttachmentPreviews, renderSavedAttachments } from "./saved_attachments.js";
import { getAnnotationsForRoute, markResolved, updateAnnotationComment } from "./receiver.js";

let detailSessionId = 0;
let activeCommentSave = null;
let listRequestId = 0;
let resolving = false;

function severityLabel(value) {
  if (value === "bug") return "Bug";
  if (value === "feature") return "Feature";
  return "Request";
}

function textSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function listItem(annotation) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "item";
  item.addEventListener("click", () => openDetail(annotation));

  const severity = normalizedSeverity(annotation.severity);
  const type = textSpan("type-label", severityLabel(severity));
  type.dataset.sev = severity;
  const dot = textSpan("sev-dot", "");
  dot.setAttribute("aria-hidden", "true");
  type.prepend(dot);
  const top = textSpan("item-top", "");
  top.appendChild(type);
  if (annotation.tags?.length) top.appendChild(textSpan("item-tags", annotation.tags.join(", ")));

  const attachmentCount = annotation.attachments?.length || 0;
  // The count goes first so a long locator is what gets truncated.
  const meta = [
    attachmentCount ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}` : null,
    annotation.element ? elementSummary(annotation) : null
  ].filter(Boolean).join(" · ");
  item.append(top, textSpan("item-comment", annotation.comment || "No comment"));
  if (meta) item.appendChild(textSpan("item-meta", meta));
  return item;
}

export function renderList() {
  const root = $("list");
  root.replaceChildren();
  renderOpenCount(state.openAnnotations.length);
  if (!state.openAnnotations.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    const title = document.createElement("strong");
    title.textContent = "No open annotations on this page.";
    empty.append(title, "Saved annotations stay here until they are resolved.");
    root.appendChild(empty);
    return;
  }
  root.append(...state.openAnnotations.map(listItem));
}

export async function refreshList() {
  // Navigation can start a newer refresh while an older route is still loading.
  const requestId = ++listRequestId;
  const list = $("list");
  list.setAttribute("aria-busy", "true");
  // Keep the current cards in place while refreshing so the list does not jump.
  if (!state.openAnnotations.length) setListMessage("Loading…");
  try {
    const annotations = await getAnnotationsForRoute();
    if (requestId !== listRequestId) return;
    state.openAnnotations = annotations;
    renderList();
  } catch (error) {
    if (requestId !== listRequestId) return;
    state.openAnnotations = [];
    renderOpenCount(null);
    setListMessage(`Could not load annotations: ${error?.message || error}`, "inline-error");
  } finally {
    if (requestId === listRequestId) list.removeAttribute("aria-busy");
  }
}

export function openDetail(annotation) {
  detailSessionId += 1;
  closeAssetPreview();
  clearSavedAttachmentPreviews();
  state.selectedAnnotation = annotation;
  $("detailId").textContent = annotation.id || "—";
  $("detailLocator").textContent = annotation.element ? elementSummary(annotation) : "—";
  $("detailComment").value = annotation.comment || "";
  $("detailHint").textContent = "";
  syncDetailControls();
  if (!$("detailDialog").open) $("detailDialog").showModal();
  renderSavedAttachments(annotation).catch((error) => {
    console.error("Could not render saved attachments:", error);
    $("detailHint").textContent = "Attachments could not be loaded.";
  });
}

export function closeDetail() {
  if (detailSaveIsPending()) {
    $("detailHint").textContent = "Wait for the current changes to finish saving.";
    return;
  }
  if (detailCommentIsDirty() && !confirm("Discard unsaved comment changes?")) return;
  if ($("detailDialog").open) $("detailDialog").close();
}

export function resetDetail() {
  detailSessionId += 1;
  closeAssetPreview();
  clearSavedAttachmentPreviews();
  state.selectedAnnotation = null;
}

export function detailCommentIsDirty() {
  if (!state.selectedAnnotation) return false;
  return $("detailComment").value !== (state.selectedAnnotation.comment || "");
}

export function detailSaveIsPending() {
  return Boolean(
    activeCommentSave &&
    activeCommentSave.sessionId === detailSessionId &&
    activeCommentSave.annotationId === state.selectedAnnotation?.id
  );
}

function syncDetailControls() {
  const pending = detailSaveIsPending();
  const comment = $("detailComment").value.trim();
  $("saveDetail").disabled = pending || !detailCommentIsDirty() || !comment;
  $("closeDetail").disabled = pending;
  $("markResolved").disabled = pending || resolving;
}

export function syncDetailCommentState() {
  const comment = $("detailComment").value.trim();
  const dirty = detailCommentIsDirty();
  syncDetailControls();
  if (dirty) $("detailHint").textContent = comment ? "Unsaved changes." : "Comment cannot be empty.";
  else if (["Unsaved changes.", "Comment cannot be empty."].includes($("detailHint").textContent)) {
    $("detailHint").textContent = "";
  }
}

export async function saveSelectedAnnotationComment() {
  const selected = state.selectedAnnotation;
  if (!selected) return null;
  if (detailSaveIsPending()) return activeCommentSave.promise;
  const editorValue = $("detailComment").value;
  const comment = editorValue.trim();
  if (!comment) throw new Error("Comment cannot be empty.");
  if (!detailCommentIsDirty()) return selected;

  const request = {
    annotationId: selected.id,
    editorValue,
    sessionId: detailSessionId,
    promise: null
  };
  request.promise = updateAnnotationComment(selected, comment);
  activeCommentSave = request;
  syncDetailControls();
  $("detailHint").textContent = "Saving changes…";

  try {
    const updated = await request.promise;
    state.openAnnotations = state.openAnnotations.map((annotation) => (
      annotation.id === updated.id ? updated : annotation
    ));
    renderList();
    const isCurrent = request.sessionId === detailSessionId && state.selectedAnnotation?.id === updated.id;
    if (!isCurrent) return updated;

    state.selectedAnnotation = updated;
    if ($("detailComment").value === request.editorValue) {
      $("detailComment").value = updated.comment;
      $("detailHint").textContent = "Comment saved.";
    } else {
      syncDetailCommentState();
    }
    return updated;
  } catch (error) {
    const isCurrent = request.sessionId === detailSessionId && state.selectedAnnotation?.id === request.annotationId;
    if (isCurrent) $("detailHint").textContent = `Could not save changes: ${error?.message || error}`;
    throw error;
  } finally {
    if (activeCommentSave === request) activeCommentSave = null;
    if (request.sessionId === detailSessionId) syncDetailControls();
  }
}

function layoutLine(layout) {
  if (!layout?.viewportWidth) return null;
  const zoom = layout.zoom && layout.zoom !== 1 ? ` at ${Math.round(layout.zoom * 100)}% zoom` : "";
  return `Layout: ${Math.round(layout.viewportWidth)}px wide viewport${zoom}`;
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
    layoutLine(annotation.layout),
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
    await navigator.clipboard.writeText(annotationPrompt({
      ...state.selectedAnnotation,
      comment: $("detailComment").value.trim()
    }));
    $("detailHint").textContent = "Copied to clipboard.";
  } catch (error) {
    $("detailHint").textContent = `Could not copy: ${error?.message || error}`;
  }
}

export async function resolveSelectedAnnotation() {
  if (!state.selectedAnnotation || resolving) return;
  resolving = true;
  syncDetailControls();
  $("detailHint").textContent = "Resolving…";
  try {
    if (detailCommentIsDirty()) await saveSelectedAnnotationComment();
    await markResolved(state.selectedAnnotation);
    await refreshList();
    closeDetail();
  } catch (error) {
    $("detailHint").textContent = `Could not resolve: ${error?.message || error}`;
  } finally {
    resolving = false;
    syncDetailControls();
  }
}
