const DATABASE_NAME = "agent-annotations";
const DATABASE_VERSION = 1;
const STORE_NAME = "drafts";

let databasePromise = null;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed.")));
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Draft transaction aborted.")));
    transaction.addEventListener("error", () => reject(transaction.error || new Error("Draft transaction failed.")));
  });
}

function openDatabase() {
  databasePromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
      store.createIndex("tabId", "tabId", { unique: false });
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("Draft database could not open.")));
    request.addEventListener("blocked", () => reject(new Error("Draft database upgrade was blocked.")));
  });
  return databasePromise;
}

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
