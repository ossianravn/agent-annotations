import { $, normalizedSeverity, state } from "./shared.js";
import { setListMessage } from "./feedback.js";
import { closeAssetPreview } from "./attachments.js";
import { clearSavedAttachmentPreviews, renderSavedAttachments } from "./saved_attachments.js";
import { getAnnotationsForRoute, markResolved, updateAnnotationComment } from "./receiver.js";

let detailSessionId = 0;
let activeCommentSave = null;

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
  detailSessionId += 1;
  closeAssetPreview();
  clearSavedAttachmentPreviews();
  state.selectedAnnotation = annotation;
  $("detailId").textContent = annotation.id || "—";
  const primary = annotation.element?.primary;
  $("detailLocator").textContent = primary ? `${primary.type}:${primary.value || ""}` : "—";
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
  $("markResolved").disabled = pending;
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
  if (!state.selectedAnnotation) return;
  $("detailHint").textContent = "Resolving…";
  try {
    if (detailCommentIsDirty()) await saveSelectedAnnotationComment();
    await markResolved(state.selectedAnnotation);
    await refreshList();
    closeDetail();
  } catch (error) {
    $("detailHint").textContent = `Could not resolve: ${error?.message || error}`;
  }
}
