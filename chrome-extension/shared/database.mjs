// One IndexedDB database for the panel and the service worker.
// Version 1 had drafts only; version 2 adds the outbox of unsent annotations.

const DATABASE_NAME = "agent-annotations";
const DATABASE_VERSION = 2;

let databasePromise = null;

export function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("IndexedDB request failed.")));
  });
}

export function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve);
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("Transaction aborted.")));
    transaction.addEventListener("error", () => reject(transaction.error || new Error("Transaction failed.")));
  });
}

export function openDatabase() {
  databasePromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("drafts")) {
        database.createObjectStore("drafts", { keyPath: "key" }).createIndex("tabId", "tabId", { unique: false });
      }
      if (!database.objectStoreNames.contains("outbox")) {
        database.createObjectStore("outbox", { keyPath: "id" });
      }
    });
    request.addEventListener("success", () => {
      const database = request.result;
      // Let a newer version of the extension upgrade the schema instead of blocking it.
      database.addEventListener("versionchange", () => {
        database.close();
        databasePromise = null;
      });
      resolve(database);
    });
    request.addEventListener("error", () => reject(request.error || new Error("The extension database could not open.")));
    request.addEventListener("blocked", () => reject(new Error("The extension database upgrade was blocked.")));
  });
  return databasePromise;
}
