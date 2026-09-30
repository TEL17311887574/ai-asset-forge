/**
 * Key 凭据保险库（浏览器版）：存储在 IndexedDB，接管原服务端 .auth-vault.db / KV 的职责。
 *
 * 设计约定：
 * - 激活的 Key 随每个生成请求通过 Authorization 头发送，服务端纯转发、不落盘。
 * - Key 以明文存于 IndexedDB，与对话历史共用同一个数据库（credentials store）。
 *   这是「用户数据全在浏览器」架构的固有取舍：换设备/清缓存需重新录入。
 * - 多 Key 管理：新增（去重）、激活、重命名、删除，界面仅显示脱敏 Key。
 * - 激活状态（activeKeyId）单独存 localStorage，让刷新后立即知道当前 Key。
 *
 * 数据库连接由 app.js 注入（setVaultDbProvider），避免两个模块各自 open
 * 同名库导致的版本升级冲突。
 */

const ACTIVE_KEY_STORAGE = "ai-asset-forge.activeKeyId";

/** 由 app.js 注入的数据库提供者。 */
let getDb = null;
let storeName = "credentials";

/**
 * 注入共享数据库连接。
 * @param provider 返回 Promise<IDBDatabase> 的函数（app.js 的 openDb）
 * @param name 凭据 store 名称
 */
export function setVaultDbProvider(provider, name = "credentials") {
  getDb = provider;
  storeName = name;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本地数据库操作失败。"));
  });
}

async function withVaultStore(mode, operation) {
  if (!getDb) throw new Error("凭据库未初始化（setVaultDbProvider 未调用）。");
  const db = await getDb();
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error("凭据存储不可用：数据库版本过旧，请刷新页面重试。");
  }
  const transaction = db.transaction(storeName, mode);
  const store = transaction.objectStore(storeName);
  const result = await operation(store);
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error || new Error("本地数据库事务失败。"));
    transaction.onerror = () => reject(transaction.error || new Error("本地数据库事务失败。"));
  });
}

// ---------------------------------------------------------------- 工具

export function maskApiKey(apiKey) {
  const value = String(apiKey || "");
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 3)}${"•".repeat(4)}${value.slice(-4)}`;
}

function normalizeBaseURL(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("Base URL 必须使用 http 或 https。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL 必须使用 http 或 https。");
  }
  return url.toString().replace(/\/+$/, "");
}

function toMetadata(credential) {
  return {
    id: credential.id,
    title: credential.title,
    maskedKey: credential.maskedKey,
    baseURL: credential.baseURL,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
    lastUsedAt: credential.lastUsedAt || null,
    status: credential.status || "unknown",
  };
}

// ---------------------------------------------------------------- 激活状态

export function getActiveKeyId() {
  return localStorage.getItem(ACTIVE_KEY_STORAGE) || null;
}

export function setActiveKeyId(credentialId) {
  if (credentialId) localStorage.setItem(ACTIVE_KEY_STORAGE, credentialId);
  else localStorage.removeItem(ACTIVE_KEY_STORAGE);
}

// ---------------------------------------------------------------- CRUD

/** 新增（或按内容去重复用）一个 Key，返回脱敏元数据并自动激活。 */
export async function addCredential(apiKey, baseURL, title) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) throw new Error("请输入 API Key。");
  if (cleanKey.length > 500) throw new Error("API Key 长度不符合要求。");
  const normalizedURL = normalizeBaseURL(baseURL);
  const cleanTitle = String(title || "").trim().slice(0, 40) || `Key · ${cleanKey.slice(-4)}`;
  const now = Date.now();

  const existing = await findCredentialByKey(cleanKey, normalizedURL);
  let credential;
  if (existing) {
    existing.title = cleanTitle;
    existing.baseURL = normalizedURL;
    existing.updatedAt = now;
    await withVaultStore("readwrite", (store) => store.put(existing));
    credential = existing;
  } else {
    credential = {
      id: `key-${crypto.randomUUID()}`,
      title: cleanTitle,
      apiKey: cleanKey,
      maskedKey: maskApiKey(cleanKey),
      baseURL: normalizedURL,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      status: "unknown",
    };
    await withVaultStore("readwrite", (store) => store.put(credential));
  }

  await activateCredential(credential.id);
  return toMetadata(credential);
}

async function findCredentialByKey(apiKey, baseURL) {
  const all = await listCredentialsRaw();
  return all.find((item) => item.apiKey === apiKey && item.baseURL === baseURL) || null;
}

async function listCredentialsRaw() {
  return withVaultStore("readonly", (store) => requestToPromise(store.getAll()));
}

/** 返回全部脱敏凭据（按最近使用排序），供 Key 管理器列表渲染。 */
export async function listCredentials() {
  const all = await listCredentialsRaw();
  return all
    .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0) || b.updatedAt - a.updatedAt)
    .map(toMetadata);
}

/** 取当前激活的完整凭据（含明文 Key），用于生成请求。 */
export async function getActiveCredential() {
  const activeId = getActiveKeyId();
  if (!activeId) return null;
  const credential = await withVaultStore("readonly", (store) =>
    requestToPromise(store.get(activeId)),
  );
  if (!credential) return null;
  return {
    apiKey: credential.apiKey,
    baseURL: credential.baseURL,
    id: credential.id,
    title: credential.title,
    maskedKey: credential.maskedKey,
  };
}

/** 切换激活 Key，并更新使用时间戳。 */
export async function activateCredential(credentialId) {
  const credential = await withVaultStore("readonly", (store) =>
    requestToPromise(store.get(credentialId)),
  );
  if (!credential) throw new Error("找不到要切换的 Key。");
  credential.lastUsedAt = Date.now();
  credential.status = "active";
  await withVaultStore("readwrite", (store) => store.put(credential));
  setActiveKeyId(credentialId);
  return toMetadata(credential);
}

/** 重命名。 */
export async function renameCredential(credentialId, title) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) throw new Error("Key 名称不能为空。");
  const credential = await withVaultStore("readonly", (store) =>
    requestToPromise(store.get(credentialId)),
  );
  if (!credential) throw new Error("找不到要修改的 Key。");
  credential.title = cleanTitle.slice(0, 40);
  credential.updatedAt = Date.now();
  await withVaultStore("readwrite", (store) => store.put(credential));
  return toMetadata(credential);
}

/** 删除单个 Key；若删除的是激活 Key 则同时清除激活状态。 */
export async function deleteCredential(credentialId) {
  await withVaultStore("readwrite", (store) => store.delete(credentialId));
  if (getActiveKeyId() === credentialId) setActiveKeyId(null);
}

/** 清空全部已保存 Key（对应原「清除全部 Key」）。 */
export async function deleteAllCredentials() {
  await withVaultStore("readwrite", (store) => store.clear());
  setActiveKeyId(null);
}
