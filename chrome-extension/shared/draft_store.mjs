import { openDatabase, requestResult, transactionComplete } from "./database.mjs";

const STORE_NAME = "drafts";

export async function loadDraftRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  return requestResult(transaction.objectStore(STORE_NAME).get(key));
}

export async function saveDraftRecord(record) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  await transactionComplete(transaction);
}

export async function deleteDraftRecord(key) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(key);
  await transactionComplete(transaction);
}

export async function deleteDraftRecordsForTab(tabId) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const index = transaction.objectStore(STORE_NAME).index("tabId");
  const request = index.openKeyCursor(IDBKeyRange.only(tabId));
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
    cursor.continue();
  });
  await transactionComplete(transaction);
}
