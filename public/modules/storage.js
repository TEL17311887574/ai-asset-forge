/**
 * 浏览器本地历史记录存储。
 * IndexedDB 细节封装在这里，UI 只关心几个语义化方法。
 */
const DB_NAME = "gpt-image-2-studio";
const DB_VERSION = 2;
const CONVERSATION_STORE = "conversations";
const LEGACY_STORE = "generations";

let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("当前浏览器不支持 IndexedDB，本地对话无法保存。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONVERSATION_STORE)) {
        const conversations = db.createObjectStore(CONVERSATION_STORE, { keyPath: "id" });
        conversations.createIndex("updatedAt", "updatedAt");
        conversations.createIndex("pinned", "pinned");
      }
      if (!db.objectStoreNames.contains(LEGACY_STORE)) {
        const generations = db.createObjectStore(LEGACY_STORE, { keyPath: "id" });
        generations.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地数据库。"));
  });
  return dbPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本地数据库操作失败。"));
  });
}

export async function getConversations() {
  const db = await openDb();
  return requestResult(db.transaction(CONVERSATION_STORE, "readonly").objectStore(CONVERSATION_STORE).getAll());
}

export async function putConversation(conversation) {
  const db = await openDb();
  return requestResult(db.transaction(CONVERSATION_STORE, "readwrite").objectStore(CONVERSATION_STORE).put(conversation));
}

export async function deleteConversation(id) {
  const db = await openDb();
  return requestResult(db.transaction(CONVERSATION_STORE, "readwrite").objectStore(CONVERSATION_STORE).delete(id));
}

export async function getLegacyGenerations() {
  const db = await openDb();
  return requestResult(db.transaction(LEGACY_STORE, "readonly").objectStore(LEGACY_STORE).getAll());
}

export function sortConversations(items) {
  return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}
