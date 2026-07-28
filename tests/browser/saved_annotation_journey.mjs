import assert from "node:assert/strict";
import { click, evaluate, waitForEvaluation } from "./journey_support.mjs";

export const FINAL_SAVED_COMMENT = "Edited browser journey annotation";

export async function verifySavedAnnotationDetail(chrome, panelSession) {
  await click(chrome, panelSession, ".item");
  await waitForEvaluation(
    chrome,
    panelSession,
    "document.querySelectorAll('#detailAttachments button.detail-attachment').length === 2",
    "saved attachment thumbnails"
  );
  const thumbnailState = await evaluate(chrome, panelSession, `(() => {
    const root = document.querySelector('#detailAttachments');
    const buttons = [...root.querySelectorAll('button.detail-attachment')];
    return {
      count: buttons.length,
      hasRawPath: root.textContent.includes('.agent-annotations/'),
      square: buttons.every((button) => Math.abs(button.clientWidth - button.clientHeight) < 1),
      named: buttons.every((button) => button.getAttribute('aria-label')?.startsWith('Preview '))
    };
  })()`);
  assert.deepEqual(thumbnailState, { count: 2, hasRawPath: false, square: true, named: true });

  await click(chrome, panelSession, "#detailAttachments button.detail-attachment");
  await waitForEvaluation(
    chrome,
    panelSession,
    "document.querySelector('#assetDialog').open && document.querySelector('#assetImg').naturalWidth > 0",
    "saved attachment preview"
  );
  const previewState = await evaluate(chrome, panelSession, `(() => {
    const image = document.querySelector('#assetImg');
    const caption = document.querySelector('#assetMeta');
    return {
      path: caption.textContent,
      captionFollowsImage: image.nextElementSibling === caption,
      ratioDelta: Math.abs(
        image.naturalWidth / image.naturalHeight - image.clientWidth / image.clientHeight
      )
    };
  })()`);
  assert.match(previewState.path, /\.agent-annotations[\\/]assets[\\/]open[\\/].+\.png$/);
  assert.equal(previewState.captionFollowsImage, true);
  assert.ok(previewState.ratioDelta < 0.01, "saved preview should preserve the image aspect ratio");
  await click(chrome, panelSession, "#closeAsset");
  await waitForEvaluation(chrome, panelSession, "!document.querySelector('#assetDialog').open", "preview close");

  await evaluate(chrome, panelSession, `(() => {
    const originalFetch = window.fetch.bind(window);
    window.__annotationOriginalFetch = originalFetch;
    window.fetch = (input, init = {}) => {
      const request = originalFetch(input, init);
      if (init.method !== 'PATCH') return request;
      return request.then((response) => new Promise((resolve) => {
        window.__releaseCommentSave = () => resolve(response);
      }));
    };
    const comment = document.querySelector('#detailComment');
    comment.value = 'First saved edit';
    comment.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click(chrome, panelSession, "#saveDetail");
  await waitForEvaluation(
    chrome,
    panelSession,
    "typeof window.__releaseCommentSave === 'function'",
    "delayed comment save"
  );
  const pendingEditState = await evaluate(chrome, panelSession, `(() => {
    const comment = document.querySelector('#detailComment');
    comment.value = ${JSON.stringify(FINAL_SAVED_COMMENT)};
    comment.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      comment: comment.value,
      closeDisabled: document.querySelector('#closeDetail').disabled,
      resolveDisabled: document.querySelector('#markResolved').disabled,
      saveDisabled: document.querySelector('#saveDetail').disabled
    };
  })()`);
  assert.deepEqual(pendingEditState, {
    comment: FINAL_SAVED_COMMENT,
    closeDisabled: true,
    resolveDisabled: true,
    saveDisabled: true
  });
  await chrome.command("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
  }, panelSession);
  await chrome.command("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27
  }, panelSession);
  const guardedCloseState = await evaluate(chrome, panelSession, `(() => ({
    dialogOpen: document.querySelector('#detailDialog').open,
    hint: document.querySelector('#detailHint').textContent
  }))()`);
  assert.deepEqual(guardedCloseState, {
    dialogOpen: true,
    hint: "Wait for the current changes to finish saving."
  });
  await evaluate(chrome, panelSession, "window.__releaseCommentSave()");
  await waitForEvaluation(
    chrome,
    panelSession,
    `document.querySelector('#detailComment').value === ${JSON.stringify(FINAL_SAVED_COMMENT)} &&
      document.querySelector('#detailHint').textContent === 'Unsaved changes.' &&
      !document.querySelector('#saveDetail').disabled`,
    "stale save response discard"
  );

  await evaluate(chrome, panelSession, `(() => {
    window.fetch = (input, init = {}) => {
      if (init.method !== 'PATCH') return window.__annotationOriginalFetch(input, init);
      return Promise.resolve(new Response(
        JSON.stringify({ ok: false, error: 'Simulated save failure.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ));
    };
  })()`);
  await click(chrome, panelSession, "#saveDetail");
  await waitForEvaluation(
    chrome,
    panelSession,
    "document.querySelector('#detailHint').textContent === 'Could not save changes: Simulated save failure.'",
    "dialog-local save failure"
  );
  const failedSaveState = await evaluate(chrome, panelSession, `(() => ({
    comment: document.querySelector('#detailComment').value,
    saveDisabled: document.querySelector('#saveDetail').disabled
  }))()`);
  assert.deepEqual(failedSaveState, { comment: FINAL_SAVED_COMMENT, saveDisabled: false });

  await evaluate(chrome, panelSession, `(() => {
    window.fetch = window.__annotationOriginalFetch;
    delete window.__annotationOriginalFetch;
    delete window.__releaseCommentSave;
  })()`);
  await click(chrome, panelSession, "#saveDetail");
  await waitForEvaluation(
    chrome,
    panelSession,
    "document.querySelector('#detailHint').textContent === 'Comment saved.' && document.querySelector('#saveDetail').disabled",
    "saved comment edit"
  );
  await click(chrome, panelSession, "#markResolved");
  await waitForEvaluation(
    chrome,
    panelSession,
    "document.querySelector('#list').textContent.includes('No unresolved')",
    "annotation resolve"
  );
}
