// Annotations saved in the browser that have not reached their repo yet.
// Record: { id, annotation, assets: [{ name, mime, blob }], bytes, destination,
//           state: "pending" | "failed", reason, createdAt, updatedAt }
// destination is { projectId, projectName, receiverUrl, token } or null when
// the page belonged to no project at save time.

import { openDatabase, requestResult, transactionComplete } from "./database.mjs";

const STORE_NAME = "outbox";

async function store(mode) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, mode);
  return { transaction, objects: transaction.objectStore(STORE_NAME) };
}

export async function putOutboxItem(item) {
  const { transaction, objects } = await store("readwrite");
  objects.put(item);
  await transactionComplete(transaction);
}

export async function listOutboxItems() {
  const { objects } = await store("readonly");
  const items = await requestResult(objects.getAll());
  return items.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

export async function getOutboxItem(id) {
  const { objects } = await store("readonly");
  return requestResult(objects.get(id));
}

export async function deleteOutboxItem(id) {
  const { transaction, objects } = await store("readwrite");
  objects.delete(id);
  await transactionComplete(transaction);
}
