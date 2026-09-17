const MAX_SOURCE_FILES = 16;
const DB_NAME = "gpt-image-2-studio";
const DB_VERSION = 2;
const CONVERSATION_STORE = "conversations";
const LEGACY_STORE = "generations";
// Keep every model/resolution/ratio combination in one place. If GPT Image
// 2.5 uses different dimensions later, add another model entry here.
const MODEL_SIZE_PRESETS = Object.freeze({
  "gpt-image-2": Object.freeze({
    "1K": Object.freeze({
      "1:1": "1024x1024", "3:4": "768x1024", "16:9": "1024x576",
      "4:3": "1024x768", "9:16": "576x1024", "2:3": "688x1024",
      "3:2": "1024x688", "5:4": "1024x816", "4:5": "816x1024",
      "21:9": "1024x432",
    }),
    "2K": Object.freeze({
      "1:1": "2048x2048", "3:4": "1536x2048", "16:9": "2048x1152",
      "4:3": "2048x1536", "9:16": "1152x2048", "2:3": "1360x2048",
      "3:2": "2048x1360", "5:4": "2048x1632", "4:5": "1632x2048",
      "21:9": "2048x880",
    }),
    "3K": Object.freeze({
      // 3072x3072 would exceed GPT Image 2's 8,294,400-pixel limit.
      "1:1": "2880x2880", "3:4": "2304x3072", "16:9": "3072x1728",
      "4:3": "3072x2304", "9:16": "1728x3072", "2:3": "2048x3072",
      "3:2": "3072x2048", "5:4": "3072x2464", "4:5": "2464x3072",
      "21:9": "3072x1312",
    }),
    "4K": Object.freeze({
      "1:1": "2880x2880", "3:4": "2496x3312", "16:9": "3840x2160",
      "4:3": "3312x2496", "9:16": "2160x3840", "2:3": "2352x3520",
      "3:2": "3520x2352", "5:4": "3216x2576", "4:5": "2576x3216",
      "21:9": "3840x1648",
    }),
  }),
});
const ACTIVE_IMAGE_MODEL = "gpt-image-2";
const RESOLUTION_PRESETS = Object.freeze({
  "1K": Object.freeze({ longEdge: 1024, fitToMaxPixels: false }),
  "2K": Object.freeze({ longEdge: 2048, fitToMaxPixels: false }),
  "3K": Object.freeze({ longEdge: 3072, fitToMaxPixels: false }),
  "4K": Object.freeze({ longEdge: 3840, fitToMaxPixels: true }),
});
const modeContent = {
  default: "程序会根据是否上传参考图，自动选择文生图或图生图。",
  mask: "上传原图并擦出蒙版区域，只修改你指定的部分。",
  characterTurnaround: "需 1 张参考图，生成工作室肖像与全身三视图。",
};
const modeLabels = {
  default: "默认",
  generate: "文生图",
  edit: "图生图",
  mask: "蒙版编辑",
  characterTurnaround: "角色三视图",
};
const state = {
  mode: "default",
  sourceFiles: [],
  maskFile: null,
  busy: false,
  ratio: "1:1",
  resolution: "1K",
  quality: "medium",
  count: 1,
  width: 1024,
  height: 1024,
  linkSize: true,
  conversations: [],
  activeConversationId: null,
  pendingMentions: [],
  mentionCursor: -1,
  mentionRange: null,
  mentionPickerOpen: false,
  activeMaskIndex: 0,
  maskEditorOpen: false,
  authenticated: false,
  model: "gpt-image-2",
  availableModels: [],
};
const $ = (selector) => document.querySelector(selector);
const refreshIcons = () =>
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
const els = {
  form: $("#imageForm"),
  prompt: $("#prompt"),
  promptCount: $("#promptCount"),
  sourceInput: $("#sourceInput"),
  sourceMeta: $("#sourceMeta"),
  composerAttachments: $("#composerAttachments"),
  mentionPicker: $("#mentionPicker"),
  attachButton: $("#attachButton"),
  maskEditor: $("#maskEditor"),
  maskEditorHint: $("#maskEditorHint"),
  openMaskEditor: $("#openMaskEditor"),
  maskModal: $("#maskModal"),
  closeMaskEditor: $("#closeMaskEditor"),
  applyMaskEditor: $("#applyMaskEditor"),
  maskModalSubtitle: $("#maskModalSubtitle"),
  maskModalStatus: $("#maskModalStatus"),
  maskSourceRail: $("#maskSourceRail"),
  maskCanvasStage: $("#maskCanvasStage"),
  brushCursor: $("#brushCursor"),
  maskInput: $("#maskInput"),
  canvasSource: $("#canvasSource"),
  maskCanvas: $("#maskCanvas"),
  brushSize: $("#brushSize"),
  brushOutput: $("#brushOutput"),
  resetMask: $("#resetMask"),
  fidelityField: $("#fidelityField"),
  fidelity: $("#fidelity"),
  submitButton: $("#submitButton"),
  submitIcon: $("#submitIcon"),
  settingsButton: $("#settingsButton"),
  modelButton: $("#modelButton"),
  modelLabel: $("#modelLabel"),
  modelPopover: $("#modelPopover"),
  modelOptions: $("#modelOptions"),
  closeModel: $("#closeModel"),
  settingsPopover: $("#settingsPopover"),
  closeSettings: $("#closeSettings"),
  modePopover: $("#modePopover"),
  closeMode: $("#closeMode"),
  modeButton: $("#modeButton"),
  modeLabel: $("#modeLabel"),
  status: $("#toast"),
  connection: $("#connectionState"),
  ratioGrid: $("#ratioGrid"),
  resolution: $("#resolution"),
  quality: $("#quality"),
  count: $("#count"),
  widthInput: $("#widthInput"),
  heightInput: $("#heightInput"),
  linkSize: $("#linkSize"),
  dimensionNote: $("#dimensionNote"),
  messages: $("#messages"),
  welcomeScreen: $("#welcomeScreen"),
  conversationStage: $("#conversationStage"),
  composerWrap: $("#composerWrap"),
  conversationList: $("#conversationList"),
  conversationTotal: $("#conversationTotal"),
  conversationTitle: $("#conversationTitle"),
  newConversation: $("#newConversation"),
  mobileNewConversation: $("#mobileNewConversation"),
  mobileHistory: $("#mobileHistory"),
  sidebarScrim: $("#sidebarScrim"),
  authButton: $("#authButton"),
  authModal: $("#authModal"),
  authForm: $("#authForm"),
  authApiKey: $("#authApiKey"),
  authBaseURL: $("#authBaseURL"),
  authKeyToggle: $("#authKeyToggle"),
  authSubmit: $("#authSubmit"),
  closeAuth: $("#closeAuth"),
  imageLightbox: $("#imageLightbox"),
  lightboxImage: $("#lightboxImage"),
  lightboxTitle: $("#lightboxTitle"),
  lightboxCaption: $("#lightboxCaption"),
  closeLightbox: $("#closeLightbox"),
  lightboxPrev: $("#lightboxPrev"),
  lightboxNext: $("#lightboxNext"),
  confirmBackdrop: $("#confirmBackdrop"),
  confirmTitle: $("#confirmTitle"),
  confirmText: $("#confirmText"),
  cancelConfirm: $("#cancelConfirm"),
  confirmAction: $("#confirmAction"),
  composerHint: $("#composerHint"),
};
let dbPromise;
let confirmCallback;
let confirmNeedsSecondStep = false;
let toastTimer;
let painting = false;
let maskLoadToken = 0;
let maskDirty = false;
let brushCursorPoint = null;
let authReturnFocus = null;
const lightboxState = { items: [], index: 0, returnFocus: null };

function uid(prefix = "id") {
  const random =
    window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${random}`;
}
function imageUrl(item) {
  if (!item) return "";
  if (item.previewDataUrl) return item.previewDataUrl;
  if (item.preview) return item.preview;
  if (item.dataUrl) return item.dataUrl;
  const blob = item instanceof Blob ? item : item.blob;
  return blob instanceof Blob ? URL.createObjectURL(blob) : "";
}
function originalImageUrl(item) {
  const blob = sourceBlob(item);
  return blob instanceof Blob ? URL.createObjectURL(blob) : imageUrl(item);
}
function openImageLightbox(items, index = 0) {
  const usableItems = items.filter((item) => item?.src);
  if (!usableItems.length) return;
  lightboxState.items = usableItems;
  lightboxState.index = Math.max(0, Math.min(index, usableItems.length - 1));
  lightboxState.returnFocus = document.activeElement;
  renderImageLightbox();
  els.imageLightbox.classList.remove("hidden");
  document.body.classList.add("lightbox-open");
  els.closeLightbox.focus();
}
function renderImageLightbox() {
  const item = lightboxState.items[lightboxState.index];
  if (!item) return;
  els.lightboxImage.src = item.src;
  els.lightboxImage.alt = item.alt || "图片预览";
  els.lightboxCaption.textContent = item.caption || `${lightboxState.index + 1} / ${lightboxState.items.length}`;
  const hasMultiple = lightboxState.items.length > 1;
  els.lightboxPrev.classList.toggle("hidden", !hasMultiple);
  els.lightboxNext.classList.toggle("hidden", !hasMultiple);
  refreshIcons();
}
function closeImageLightbox() {
  els.imageLightbox.classList.add("hidden");
  document.body.classList.remove("lightbox-open");
  const returnFocus = lightboxState.returnFocus;
  lightboxState.items = [];
  lightboxState.returnFocus = null;
  returnFocus?.focus?.();
}
function setAuthenticated(authenticated) {
  state.authenticated = authenticated;
  els.authButton.classList.toggle("authenticated", authenticated);
  els.authButton.setAttribute("aria-label", authenticated ? "退出登录" : "登录");
  els.authButton.innerHTML = authenticated
    ? '<i data-lucide="log-out" aria-hidden="true"></i><span>退出</span>'
    : '<i data-lucide="log-in" aria-hidden="true"></i><span>登录</span>';
  els.connection.innerHTML = authenticated
    ? '<span class="dot ok"></span>API 已登录'
    : '<span class="dot bad"></span>等待登录';
  refreshIcons();
}
function openAuthModal() {
  if (els.authModal.classList.contains("hidden"))
    authReturnFocus = document.activeElement;
  els.authModal.classList.remove("hidden");
  document.body.classList.add("auth-modal-open");
  requestAnimationFrame(() => els.authApiKey.focus());
}
function closeAuthModal() {
  els.authModal.classList.add("hidden");
  document.body.classList.remove("auth-modal-open");
  els.authApiKey.value = "";
  els.authApiKey.type = "password";
  els.authKeyToggle.setAttribute("aria-pressed", "false");
  els.authKeyToggle.setAttribute("aria-label", "显示 API Key");
  els.authKeyToggle.title = "显示 API Key";
  els.authKeyToggle.innerHTML = '<i data-lucide="eye" aria-hidden="true"></i>';
  refreshIcons();
  authReturnFocus?.focus?.();
  authReturnFocus = null;
}
async function refreshAuthSession() {
  try {
    const response = await fetch("/api/auth/session");
    const data = await response.json();
    setAuthenticated(Boolean(data.authenticated));
    return Boolean(data.authenticated);
  } catch {
    setAuthenticated(false);
    els.connection.innerHTML = '<span class="dot bad"></span>服务未连接';
    return false;
  }
}
function stepImageLightbox(direction) {
  if (!lightboxState.items.length) return;
  lightboxState.index =
    (lightboxState.index + direction + lightboxState.items.length) %
    lightboxState.items.length;
  renderImageLightbox();
}
function bindImagePreview(element, getItems, getIndex = () => 0) {
  element.classList.add("image-preview-trigger");
  element.setAttribute("role", "button");
  element.tabIndex = 0;
  element.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    event.preventDefault();
    openImageLightbox(getItems(), getIndex());
  });
  element.addEventListener("keydown", (event) => {
    if (event.target !== element) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openImageLightbox(getItems(), getIndex());
    }
  });
}

function createPreviewDataUrl(file) {
  return new Promise((resolve) => {
    const blob = sourceBlob(file);
    if (!blob) return resolve("");
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const maxEdge = 160;
      const scale = Math.min(
        1,
        maxEdge / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("");
    };
    image.src = url;
  });
}
function sourceBlob(item) {
  return item instanceof Blob ? item : item?.blob;
}
function getPromptText(labels = false) {
  if (!els.prompt) return "";
  const read = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR")
      return "\n";
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.classList.contains("inline-mention")) {
      const index = Number(node.dataset.index);
      return labels ? `图片${index + 1}` : "@";
    }
    const content = [...node.childNodes].map(read).join("");
    return /^(DIV|P|LI)$/.test(node.tagName) ? `${content}\n` : content;
  };
  return [...els.prompt.childNodes]
    .map(read)
    .join("")
    .replace(/\u00a0/g, " ")
    .replace(/\n+$/, "");
}
function setPromptText(text, mentionIndexes = []) {
  if (!els.prompt) return;
  const value = String(text || "");
  els.prompt.replaceChildren();
  const positions = [...value]
    .map((char, index) => (char === "@" ? index : -1))
    .filter((index) => index >= 0)
    .slice(-mentionIndexes.length);
  let cursor = 0;
  const fragment = document.createDocumentFragment();
  positions.forEach((position, mentionIndex) => {
    if (position > cursor)
      fragment.append(document.createTextNode(value.slice(cursor, position)));
    fragment.append(createInlineMention(mentionIndexes[mentionIndex], true));
    cursor = position + 1;
  });
  if (cursor < value.length)
    fragment.append(document.createTextNode(value.slice(cursor)));
  els.prompt.append(fragment);
  syncPendingMentions();
}
function updateInlineMention(mention, index) {
  mention.dataset.index = String(index);
  mention.setAttribute("aria-label", `图${index + 1}`);
  const label = mention.querySelector(".inline-mention-label");
  if (label) label.textContent = `图${index + 1}`;
  const thumbnail = mention.querySelector(".inline-mention-thumb");
  if (thumbnail) {
    thumbnail.src = imageUrl(state.sourceFiles[index]) || "";
    thumbnail.alt = `参考图 ${index + 1}`;
  }
}

function createInlineMention(index, restoring = false) {
  const mention = document.createElement("span");
  mention.className = "inline-mention";
  mention.dataset.index = String(index);
  mention.contentEditable = "false";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "inline-mention-remove";
  remove.textContent = "×";
  remove.title = "移除引用";
  remove.setAttribute("aria-label", "移除引用");
  remove.addEventListener("mousedown", (event) => event.preventDefault());
  remove.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    mention.remove();
    syncPendingMentions();
    els.prompt.focus();
    els.prompt.dispatchEvent(new Event("input"));
  });
  const thumbnail = document.createElement("img");
  thumbnail.className = "inline-mention-thumb";
  thumbnail.src = imageUrl(state.sourceFiles[index]) || "";
  thumbnail.alt = `参考图 ${index + 1}`;
  bindImagePreview(
    thumbnail,
    () =>
      state.sourceFiles.map((source) => ({
        src: imageUrl(source),
        alt: source.name || "参考图",
        caption: source.name || "参考图",
      })),
    () => Number(mention.dataset.index),
  );
  const label = document.createElement("span");
  label.className = "inline-mention-label";
  label.textContent = `图${Number(index) + 1}`;
  mention.append(remove, thumbnail, label);
  mention.setAttribute("aria-label", `图${Number(index) + 1}`);
  return mention;
}
function syncPendingMentions() {
  if (!els.prompt) return;
  state.pendingMentions = [
    ...els.prompt.querySelectorAll(".inline-mention"),
  ].map((node) => ({
    index: Number(node.dataset.index),
    node,
  }));
}
function currentPromptRange() {
  const selection = window.getSelection?.();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return els.prompt.contains(range.commonAncestorContainer) ? range : null;
}
function previousCharacter(range) {
  if (!range || !range.collapsed) return "";
  const node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0)
    return node.nodeValue[range.startOffset - 1] || "";
  if (node.nodeType !== Node.ELEMENT_NODE || range.startOffset === 0) return "";
  let previous = node.childNodes[range.startOffset - 1];
  while (previous?.lastChild) previous = previous.lastChild;
  if (previous?.nodeType === Node.TEXT_NODE)
    return previous.nodeValue.slice(-1);
  return "";
}
function insertInlineMention(index) {
  const range = state.mentionRange?.cloneRange() || currentPromptRange();
  if (!range || !els.prompt.contains(range.commonAncestorContainer)) return;
  if (range.collapsed && previousCharacter(range) === "@") {
    if (
      range.startContainer.nodeType === Node.TEXT_NODE &&
      range.startOffset > 0
    )
      range.setStart(range.startContainer, range.startOffset - 1);
    else if (
      range.startContainer.nodeType === Node.ELEMENT_NODE &&
      range.startOffset > 0
    ) {
      const previous = range.startContainer.childNodes[range.startOffset - 1];
      if (previous?.nodeType === Node.TEXT_NODE)
        range.setStart(previous, previous.nodeValue.length - 1);
    }
  }
  range.deleteContents();
  const mention = createInlineMention(index);
  range.insertNode(mention);
  const caret = document.createRange();
  caret.setStartAfter(mention);
  caret.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(caret);
  state.mentionRange = null;
  syncPendingMentions();
  els.prompt.focus();
  els.prompt.dispatchEvent(new Event("input"));
}
function dataUrlBlob(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const [header, payload = ""] = dataUrl.split(",", 2);
  const mime = header.match(/^data:([^;]+)/i)?.[1] || "image/png";
  try {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}
async function toUploadFile(item, index) {
  const blob = sourceBlob(item) || dataUrlBlob(item?.dataUrl);
  if (!(blob instanceof Blob))
    throw new Error("参考图数据已不可用，请重新上传图片。");
  return blob instanceof File
    ? blob
    : new File([blob], item?.name || `image-${index + 1}.png`, {
        type: blob.type || "image/png",
      });
}
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window))
      return reject(
        new Error("当前浏览器不支持 IndexedDB，本地对话无法保存。"),
      );
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONVERSATION_STORE)) {
        const conversations = db.createObjectStore(CONVERSATION_STORE, {
          keyPath: "id",
        });
        conversations.createIndex("updatedAt", "updatedAt");
        conversations.createIndex("pinned", "pinned");
      }
      if (!db.objectStoreNames.contains(LEGACY_STORE)) {
        const generations = db.createObjectStore(LEGACY_STORE, {
          keyPath: "id",
        });
        generations.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("无法打开本地数据库。"));
  });
  return dbPromise;
}
function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("本地数据库操作失败。"));
  });
}
async function getConversations() {
  const db = await openDb();
  return idbRequest(
    db
      .transaction(CONVERSATION_STORE, "readonly")
      .objectStore(CONVERSATION_STORE)
      .getAll(),
  );
}
async function putConversation(conversation) {
  const db = await openDb();
  return idbRequest(
    db
      .transaction(CONVERSATION_STORE, "readwrite")
      .objectStore(CONVERSATION_STORE)
      .put(conversation),
  );
}
async function deleteConversationFromDb(id) {
  const db = await openDb();
  return idbRequest(
    db
      .transaction(CONVERSATION_STORE, "readwrite")
      .objectStore(CONVERSATION_STORE)
      .delete(id),
  );
}
async function readLegacyGenerations() {
  const db = await openDb();
  return idbRequest(
    db.transaction(LEGACY_STORE, "readonly").objectStore(LEGACY_STORE).getAll(),
  );
}
function sortConversations(items) {
  return items.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
  );
}
function titleFromPrompt(prompt) {
  const title = String(prompt || "")
    .replace(/\s+/g, " ")
    .trim();
  return title
    ? `${title.slice(0, 18)}${title.length > 18 ? "…" : ""}`
    : "未命名对话";
}
function dateLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
function dateGroupKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
function dateHeading(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString("zh-CN", {
    month: "long",
    day: "numeric",
  });
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char],
  );
}
function showToast(message, type = "") {
  els.status.textContent = message;
  els.status.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.status.classList.add("hidden"), 2800);
}
function askConfirm(title, text, callback, requiresDouble = false) {
  els.confirmTitle.textContent = title;
  els.confirmText.textContent = text;
  confirmCallback = callback;
  confirmNeedsSecondStep = requiresDouble;
  els.confirmAction.textContent = requiresDouble ? "继续" : "确认删除";
  els.confirmBackdrop.classList.remove("hidden");
}
function closeConfirm() {
  els.confirmBackdrop.classList.add("hidden");
  confirmCallback = null;
  confirmNeedsSecondStep = false;
  els.confirmAction.textContent = "确认删除";
}

function snapDimension(value) {
  return Math.max(64, Math.round(value / 16) * 16);
}

function fitDimensionsToModelLimits(width, height) {
  const maxEdge = 3840;
  const maxPixels = 8294400;
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  let fittedWidth = snapDimension(width * scale);
  let fittedHeight = snapDimension(height * scale);
  while ((Math.max(fittedWidth, fittedHeight) > maxEdge || fittedWidth * fittedHeight > maxPixels) && Math.max(fittedWidth, fittedHeight) > 64) {
    if (fittedWidth >= fittedHeight) fittedWidth -= 16;
    else fittedHeight -= 16;
  }
  return { width: fittedWidth, height: fittedHeight };
}
function calculateDimensions(
  ratio = state.ratio,
  resolution = state.resolution,
) {
  if (ratio === "original") return getOriginalImageDimensions();
  const [rw, rh] = ratio.split(":").map(Number);
  const preset = RESOLUTION_PRESETS[resolution] || RESOLUTION_PRESETS["1K"];
  const presetSize = MODEL_SIZE_PRESETS[ACTIVE_IMAGE_MODEL]?.[resolution]?.[ratio];
  if (presetSize) {
    const [width, height] = presetSize.split("x").map(Number);
    return { width, height };
  }
  const edge = preset.longEdge;
  if (!rw || !rh) return { width: edge, height: edge };
  const dimensions = rw >= rh
    ? { width: edge, height: snapDimension((edge * rh) / rw) }
    : { width: snapDimension((edge * rw) / rh), height: edge };
  return preset.fitToMaxPixels
    ? fitDimensionsToModelLimits(dimensions.width, dimensions.height)
    : dimensions;
}
function getOriginalImageDimensions() {
  const source = state.sourceFiles[0];
  const blob = sourceBlob(source);
  if (source?.naturalWidth && source?.naturalHeight)
    return { width: source.naturalWidth, height: source.naturalHeight };
  if (source?.width && source?.height)
    return { width: Number(source.width), height: Number(source.height) };
  if (blob) {
    const image = els.canvasSource;
    if (image?.naturalWidth && image?.naturalHeight)
      return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return { width: state.width || 1024, height: state.height || 1024 };
}
function updateDimensionPreview() {
  els.widthInput.value = state.width;
  els.heightInput.value = state.height;
  if (state.ratio === "original") {
    els.dimensionNote.textContent = `原图 · ${state.width}×${state.height} px · 原始比例`;
    els.widthInput.disabled = true;
    els.heightInput.disabled = true;
    els.linkSize.disabled = true;
  } else {
    const preset = RESOLUTION_PRESETS[state.resolution] || RESOLUTION_PRESETS["1K"];
    els.dimensionNote.textContent = `${state.resolution} · 长边 ${preset.longEdge} px · ${state.ratio}`;
    els.widthInput.disabled = false;
    els.heightInput.disabled = false;
    els.linkSize.disabled = false;
  }
}
function syncDimensionsFromRatio() {
  const dimensions = calculateDimensions();
  state.width = dimensions.width;
  state.height = dimensions.height;
  updateDimensionPreview();
}
function setRatio(ratio) {
  if (ratio === "original" && !state.sourceFiles.length) {
    showToast("请先上传原图，再使用原图比例", "error");
    return;
  }
  state.ratio = ratio;
  document.querySelectorAll(".ratio-option").forEach((button) => {
    const active = button.dataset.ratio === ratio;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  });
  if (state.linkSize || ratio === "original") syncDimensionsFromRatio();
  else updateDimensionPreview();
}
function getEffectiveGenerationMode() {
  if (state.mode === "mask") return "mask";
  if (state.mode === "characterTurnaround") return "characterTurnaround";
  return state.sourceFiles.length ? "edit" : "generate";
}
function setMode(mode) {
  const nextMode = ["mask", "characterTurnaround"].includes(mode)
    ? mode
    : "default";
  if (nextMode !== "mask" && state.maskEditorOpen) closeMaskEditor();
  state.mode = nextMode;
  const originalRatio = document.querySelector('[data-ratio="original"]');
  originalRatio?.classList.toggle("hidden", nextMode !== "mask");
  if (nextMode !== "mask" && state.ratio === "original") {
    setRatio("1:1");
  }
  els.modeLabel.textContent = modeLabels[nextMode];
  els.fidelityField.classList.toggle(
    "hidden",
    getEffectiveGenerationMode() === "generate",
  );
  els.maskEditor.classList.toggle(
    "hidden",
    nextMode !== "mask" || !state.sourceFiles.length,
  );
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === nextMode);
  });
  if (nextMode === "mask") updateMaskFromSource();
  if (nextMode === "mask" && state.ratio === "original" && state.sourceFiles.length)
    syncDimensionsFromRatio();
  renderAttachments();
}
function renderFileMeta() {
  if (state.mode === "characterTurnaround") {
    els.sourceMeta.textContent = `${state.sourceFiles.length} / 1 张参考图`;
    return;
  }
  els.sourceMeta.textContent = state.sourceFiles.length
    ? `${state.sourceFiles.length} / ${MAX_SOURCE_FILES} 张参考图`
    : `最多 ${MAX_SOURCE_FILES} 张参考图`;
}


let draggingAttachmentIndex = null;

function clearAttachmentDropStates() {
  document
    .querySelectorAll(".attachment-item")
    .forEach((item) => item.classList.remove("drop-left", "drop-right"));
}

function reorderSourceFiles(fromIndex, toIndex) {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= state.sourceFiles.length ||
    toIndex >= state.sourceFiles.length
  )
    return;

  if (state.maskEditorOpen) saveActiveMask();
  const activeFile = state.sourceFiles[state.activeMaskIndex];
  const previousOrder = [...state.sourceFiles];
  const [movedFile] = state.sourceFiles.splice(fromIndex, 1);
  state.sourceFiles.splice(toIndex, 0, movedFile);
  state.activeMaskIndex = Math.max(0, state.sourceFiles.indexOf(activeFile));
  const indexMap = new Map(
    previousOrder.map((file, oldIndex) => [
      file,
      state.sourceFiles.indexOf(file),
    ]),
  );

  els.prompt.querySelectorAll(".inline-mention").forEach((mention) => {
    const oldIndex = Number(mention.dataset.index);
    const nextIndex = indexMap.get(previousOrder[oldIndex]);
    if (nextIndex === undefined) mention.remove();
    else updateInlineMention(mention, nextIndex);
  });

  draggingAttachmentIndex = null;
  syncPendingMentions();
  renderAttachments();
  renderMentionTags();
  if (state.mode === "mask") updateMaskFromSource();
}

function renderAttachments() {
  els.composerAttachments.replaceChildren();
  renderFileMeta();
  els.fidelityField.classList.toggle(
    "hidden",
    getEffectiveGenerationMode() === "generate",
  );
  state.sourceFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";
    item.draggable = true;
    item.dataset.index = String(index);
    item.title = `拖拽调整参考图顺序`;
    item.setAttribute("aria-label", `参考图 ${index + 1}，可拖拽排序`);
    const img = document.createElement("img");
    img.className = "attachment-thumb";
    img.src = imageUrl(file);
    img.alt = `图${index + 1}`;
    bindImagePreview(
      img,
      () => state.sourceFiles.map((source) => ({
        src: imageUrl(source),
        alt: source.name || "参考图",
        caption: source.name || "参考图",
      })),
      () => state.sourceFiles.indexOf(file),
    );
    const badge = document.createElement("span");
    badge.className = "attachment-index";
    badge.textContent = `图${index + 1}`;
    const remove = document.createElement("button");
    remove.className = "attachment-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "删除图片";
    remove.addEventListener("click", () => {
      if (state.maskEditorOpen) saveActiveMask();
      state.sourceFiles.splice(index, 1);
      state.activeMaskIndex = Math.min(
        state.activeMaskIndex,
        Math.max(0, state.sourceFiles.length - 1),
      );
      els.prompt.querySelectorAll(".inline-mention").forEach((mention) => {
        const mentionIndex = Number(mention.dataset.index);
        if (mentionIndex === index) mention.remove();
        else if (mentionIndex > index)
          updateInlineMention(mention, mentionIndex - 1);
      });
      syncPendingMentions();
      renderAttachments();
      renderMentionTags();
      if (state.mode === "mask") updateMaskFromSource();
    });
    const editMask = document.createElement("button");
    editMask.className = "attachment-mask";
    editMask.type = "button";
    editMask.title = file.maskDataUrl ? "继续编辑蒙版" : "编辑这张图的蒙版";
    editMask.setAttribute("aria-label", `编辑参考图 ${index + 1} 的蒙版`);
    editMask.innerHTML = `<i data-lucide="${file.maskDataUrl ? "scan" : "brush"}" aria-hidden="true"></i>`;
    editMask.classList.toggle("hidden", state.mode !== "mask");
    editMask.classList.toggle("has-mask", Boolean(file.maskDataUrl));
    editMask.addEventListener("click", (event) => {
      event.stopPropagation();
      openMaskEditor(index);
    });
    item.addEventListener("dragstart", (event) => {
      draggingAttachmentIndex = index;
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    });
    item.addEventListener("dragover", (event) => {
      if (draggingAttachmentIndex === null || draggingAttachmentIndex === index)
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      clearAttachmentDropStates();
      item.classList.add(index < draggingAttachmentIndex ? "drop-left" : "drop-right");
    });
    item.addEventListener("dragleave", () => item.classList.remove("drop-left", "drop-right"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const fromIndex =
        draggingAttachmentIndex ?? Number(event.dataTransfer.getData("text/plain"));
      reorderSourceFiles(fromIndex, index);
    });
    item.addEventListener("dragend", () => {
      draggingAttachmentIndex = null;
      item.classList.remove("dragging");
      clearAttachmentDropStates();
    });
    item.append(img, badge, editMask, remove);
    els.composerAttachments.append(item);
  });
  els.composerAttachments.classList.toggle(
    "hidden",
    state.sourceFiles.length === 0,
  );
  refreshIcons();
}
function setSourceFiles(files) {
  const incoming = [...files].filter((file) => file.type.startsWith("image/"));
  const incomingCount = state.sourceFiles.length + incoming.length;
  if (state.mode === "characterTurnaround" && incomingCount > 1) {
    showToast("角色三视图只能保留 1 张参考图，请删除多余图片", "error");
    return;
  }
  const slots = Math.max(0, MAX_SOURCE_FILES - state.sourceFiles.length);
  const added = incoming
    .slice(0, slots)
    .map((file) =>
      Object.assign(file, { preview: URL.createObjectURL(file) }),
    );
  state.sourceFiles.push(...added);
  renderAttachments();
  added.forEach(async (file) => {
    file.previewDataUrl = await createPreviewDataUrl(file);
    if (state.sourceFiles.includes(file)) renderAttachments();
  });
  if (incoming.length > slots)
    showToast(`最多只能添加 ${MAX_SOURCE_FILES} 张参考图`, "error");
  if (state.mode === "mask") updateMaskFromSource();
}
function renderMentionTags() {
  syncPendingMentions();
}
function renderMentionPicker() {
  els.mentionPicker.replaceChildren();
  const title = document.createElement("div");
  title.className = "mention-picker-title";
  title.textContent = state.sourceFiles.length
    ? "选择一张参考图"
    : "请先上传参考图";
  els.mentionPicker.append(title);
  state.sourceFiles.forEach((file, index) => {
    const option = document.createElement("button");
    option.className = "mention-option";
    option.type = "button";
    const img = document.createElement("img");
    img.src = imageUrl(file);
    const label = document.createElement("span");
    label.textContent = `图${index + 1}${file.name ? ` · ${file.name}` : ""}`;
    option.append(img, label);
    option.addEventListener("click", () => {
      insertInlineMention(index);
      closeMentionPicker();
      els.prompt.focus();
    });
    els.mentionPicker.append(option);
  });
}
function openMentionPicker() {
  state.mentionRange = currentPromptRange()?.cloneRange() || null;
  renderMentionPicker();
  els.mentionPicker.classList.remove("hidden");
  state.mentionPickerOpen = true;
}
function closeMentionPicker() {
  els.mentionPicker.classList.add("hidden");
  state.mentionPickerOpen = false;
}
function replaceMentions(prompt) {
  return getPromptText(true).trim() || String(prompt || "").trim();
}

function resizeMaskCanvas(width, height) {
  const canvas = els.maskCanvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
}
function saveActiveMask() {
  const file = state.sourceFiles[state.activeMaskIndex];
  if (!file || !els.maskCanvas.width || !maskDirty) return;
  file.maskDataUrl = els.maskCanvas.toDataURL("image/png");
  maskDirty = false;
  updateMaskEditorMeta();
}
function updateMaskEditorMeta() {
  const file = state.sourceFiles[state.activeMaskIndex];
  if (!file) return;
  const label = `图${state.activeMaskIndex + 1}`;
  els.maskModalSubtitle.textContent = `${label} · ${file.name || "参考图"}`;
  els.maskModalStatus.textContent = `${label} · ${file.maskDataUrl ? "蒙版已保存" : "未保存蒙版"}`;
  els.maskEditorHint.textContent = `${state.sourceFiles.length} 张参考图可分别编辑`;
  renderMaskSourceRail();
}
function renderMaskSourceRail() {
  els.maskSourceRail.replaceChildren();
  state.sourceFiles.forEach((file, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mask-source-item";
    button.classList.toggle("active", index === state.activeMaskIndex);
    button.setAttribute("aria-pressed", String(index === state.activeMaskIndex));
    button.setAttribute("aria-label", `编辑参考图 ${index + 1} 的蒙版`);
    const image = document.createElement("img");
    image.src = imageUrl(file);
    image.alt = "";
    const label = document.createElement("span");
    label.textContent = `图${index + 1}`;
    const status = document.createElement("i");
    status.className = "mask-source-status";
    status.title = file.maskDataUrl ? "已有蒙版" : "未编辑";
    button.append(image, label, status);
    button.addEventListener("click", () => selectMaskSource(index));
    els.maskSourceRail.append(button);
  });
}
function loadMaskSource(index = 0) {
  const file = state.sourceFiles[index];
  if (!file) {
    els.maskEditor.classList.add("hidden");
    return;
  }
  state.activeMaskIndex = index;
  maskDirty = false;
  const loadToken = ++maskLoadToken;
  const image = new Image();
  image.onload = () => {
    if (loadToken !== maskLoadToken) return;
    file.naturalWidth = image.naturalWidth;
    file.naturalHeight = image.naturalHeight;
    resizeMaskCanvas(image.naturalWidth, image.naturalHeight);
    els.canvasSource.src = originalImageUrl(file);
    els.maskEditor.classList.remove("hidden");
    updateMaskEditorMeta();
    if (file.maskDataUrl) {
      const mask = new Image();
      mask.onload = () => {
        if (loadToken !== maskLoadToken) return;
        const ctx = els.maskCanvas.getContext("2d");
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, els.maskCanvas.width, els.maskCanvas.height);
        ctx.drawImage(mask, 0, 0, els.maskCanvas.width, els.maskCanvas.height);
        maskDirty = false;
      };
      mask.src = file.maskDataUrl;
    }
    if (state.ratio === "original" && index === 0) {
      state.width = image.naturalWidth;
      state.height = image.naturalHeight;
      updateDimensionPreview();
    }
  };
  image.src = originalImageUrl(file);
}
function updateMaskFromSource() {
  if (!state.sourceFiles.length) {
    els.maskEditor.classList.add("hidden");
    if (state.maskEditorOpen) closeMaskEditor(false);
    return;
  }
  state.activeMaskIndex = Math.min(
    state.activeMaskIndex,
    state.sourceFiles.length - 1,
  );
  els.maskEditor.classList.toggle("hidden", state.mode !== "mask");
  els.maskEditorHint.textContent = `${state.sourceFiles.length} 张参考图可分别编辑`;
  loadMaskSource(state.activeMaskIndex);
}
function selectMaskSource(index) {
  if (index === state.activeMaskIndex) return;
  saveActiveMask();
  loadMaskSource(index);
}
function openMaskEditor(index = state.activeMaskIndex) {
  if (!state.sourceFiles.length)
    return showToast("请先上传参考图", "error");
  state.maskEditorOpen = true;
  els.maskModal.classList.remove("hidden");
  document.body.classList.add("mask-modal-open");
  loadMaskSource(Math.max(0, Math.min(index, state.sourceFiles.length - 1)));
  els.closeMaskEditor.focus();
}
function closeMaskEditor(save = true) {
  if (!state.maskEditorOpen) return;
  if (save) saveActiveMask();
  state.maskEditorOpen = false;
  els.maskModal.classList.add("hidden");
  document.body.classList.remove("mask-modal-open");
  renderAttachments();
}
function drawAt(event) {
  if (!els.maskCanvas.width) return;
  const rect = els.maskCanvas.getBoundingClientRect();
  const scaleX = els.maskCanvas.width / rect.width;
  const scaleY = els.maskCanvas.height / rect.height;
  const ctx = els.maskCanvas.getContext("2d");
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(
    (event.clientX - rect.left) * scaleX,
    (event.clientY - rect.top) * scaleY,
    (Number(els.brushSize.value) * scaleX) / 2,
    0,
    Math.PI * 2,
  );
  ctx.fill();
}
function updateBrushCursor(event) {
  if (event.pointerType === "touch" || !els.maskCanvas.width) {
    els.brushCursor.classList.remove("visible");
    return;
  }
  const canvasRect = els.maskCanvas.getBoundingClientRect();
  const stageRect = els.maskCanvasStage.getBoundingClientRect();
  const insideCanvas =
    event.clientX >= canvasRect.left &&
    event.clientX <= canvasRect.right &&
    event.clientY >= canvasRect.top &&
    event.clientY <= canvasRect.bottom;
  if (!insideCanvas) {
    els.brushCursor.classList.remove("visible");
    return;
  }
  const scale = canvasRect.width / els.maskCanvas.width;
  const diameter = Number(els.brushSize.value) * scale;
  brushCursorPoint = { x: event.clientX, y: event.clientY };
  els.brushCursor.style.width = `${diameter}px`;
  els.brushCursor.style.height = `${diameter}px`;
  els.brushCursor.style.left = `${event.clientX - stageRect.left}px`;
  els.brushCursor.style.top = `${event.clientY - stageRect.top}px`;
  els.brushCursor.classList.add("visible");
}
function refreshBrushCursorSize() {
  if (!brushCursorPoint) return;
  updateBrushCursor({
    clientX: brushCursorPoint.x,
    clientY: brushCursorPoint.y,
    pointerType: "mouse",
  });
}
function hideBrushCursor() {
  brushCursorPoint = null;
  els.brushCursor.classList.remove("visible");
}
function resetMaskCanvas() {
  if (els.maskCanvas.width)
    resizeMaskCanvas(els.maskCanvas.width, els.maskCanvas.height);
}

function createConversation() {
  return {
    id: uid("conversation"),
    title: "新建对话",
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}
async function saveConversation(conversation) {
  conversation.updatedAt = Date.now();
  await putConversation(conversation);
  state.conversations = sortConversations(
    state.conversations
      .filter((item) => item.id !== conversation.id)
      .concat(conversation),
  );
  renderConversationList();
}
function renderConversationList() {
  els.conversationList.replaceChildren();
  els.conversationTotal.textContent = state.conversations.length;
  state.conversations.forEach((conversation) => {
    const item = document.createElement("div");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.setAttribute("aria-label", `打开对话：${conversation.title || "未命名对话"}`);
    item.className = `conversation-item${conversation.id === state.activeConversationId ? " active" : ""}${conversation.pinned ? " pinned" : ""}`;
    item.dataset.id = conversation.id;
    const icon = document.createElement("span");
    icon.className = "conversation-item-icon";
    icon.setAttribute(
      "data-lucide",
      conversation.pinned ? "pin" : "message-square",
    );
    const referenceMessage = [...conversation.messages]
      .reverse()
      .find((message) => message.references?.length);
    const references = referenceMessage?.references || [];
    let leading = icon;
    if (references.length) {
      const stack = document.createElement("div");
      stack.className = "conversation-references";
      stack.setAttribute("aria-label", `参考图 ${references.length} 张`);
      references.slice(0, 3).forEach((reference, index) => {
        const thumb = document.createElement("img");
        thumb.className = "conversation-reference-thumb";
        thumb.src = imageUrl(reference);
        thumb.alt = `参考图 ${index + 1}`;
        stack.append(thumb);
      });
      if (references.length > 3) {
        const more = document.createElement("span");
        more.className = "conversation-reference-more";
        more.textContent = `+${references.length - 3}`;
        stack.append(more);
      }
      leading = stack;
    }
    const title = document.createElement("span");
    title.className = "conversation-item-title";
    title.textContent = conversation.title || "未命名对话";
    const time = document.createElement("span");
    time.className = "conversation-item-time";
    time.textContent = dateLabel(conversation.updatedAt);
    const trigger = document.createElement("button");
    trigger.className = "conversation-menu-trigger";
    trigger.type = "button";
    trigger.innerHTML = '<i data-lucide="ellipsis" aria-hidden="true"></i>';
    trigger.setAttribute("aria-label", "对话操作");
    const menu = document.createElement("div");
    menu.className = "conversation-menu hidden";
    const pin = document.createElement("button");
    pin.type = "button";
    pin.textContent = conversation.pinned ? "取消置顶" : "置顶";
    pin.addEventListener("click", async (event) => {
      event.stopPropagation();
      conversation.pinned = !conversation.pinned;
      menu.classList.add("hidden");
      await saveConversation(conversation);
    });
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "重命名";
    rename.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.classList.add("hidden");
      const nextTitle = window.prompt("输入新的对话标题", conversation.title);
      if (nextTitle?.trim()) {
        conversation.title = nextTitle.trim().slice(0, 40);
        saveConversation(conversation);
      }
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-option";
    del.textContent = "删除";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.classList.add("hidden");
      askConfirm(
        "删除这条对话？",
        "删除后其中的提示词和生成图片也会一并移除，且无法恢复。",
        async () => {
          await deleteConversationFromDb(conversation.id);
          state.conversations = state.conversations.filter(
            (entry) => entry.id !== conversation.id,
          );
          if (state.activeConversationId === conversation.id)
            openNewConversation();
          else renderConversationList();
        },
        true,
      );
    });
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelectorAll(".conversation-menu").forEach((other) => {
        if (other !== menu) other.classList.add("hidden");
      });
      document
        .querySelectorAll(".conversation-item.menu-open")
        .forEach((other) => {
          if (other !== item) other.classList.remove("menu-open");
        });
      const willOpen = menu.classList.contains("hidden");
      menu.classList.toggle("hidden");
      item.classList.toggle("menu-open", willOpen);
    });
    menu.append(pin, rename, del);
    item.append(leading, title, time, trigger, menu);
    item.addEventListener("click", () => {
      closeAllMenus();
      openConversation(conversation.id);
      closeMobileHistory();
    });
    item.addEventListener("keydown", (event) => {
      if (event.target !== item) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        item.click();
      }
    });
    els.conversationList.append(item);
  });
  refreshIcons();
}

function openMobileHistory() {
  document.querySelector(".sidebar")?.classList.add("mobile-open");
  els.sidebarScrim.classList.remove("hidden");
  els.mobileHistory?.setAttribute("aria-expanded", "true");
}

function closeMobileHistory() {
  document.querySelector(".sidebar")?.classList.remove("mobile-open");
  els.sidebarScrim.classList.add("hidden");
  els.mobileHistory?.setAttribute("aria-expanded", "false");
}
function closeAllMenus() {
  document
    .querySelectorAll(".conversation-menu")
    .forEach((menu) => menu.classList.add("hidden"));
  document
    .querySelectorAll(".conversation-item.menu-open")
    .forEach((item) => item.classList.remove("menu-open"));
}

function initAmbientMotion() {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  if (reducedMotion || !finePointer) return;

  const visual = document.querySelector(".welcome-visual");
  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight / 2;
  let scrollTop = 0;
  let frameId;

  document.addEventListener(
    "pointermove",
    (event) => {
      targetX = event.clientX;
      targetY = event.clientY;
    },
    { passive: true },
  );
  els.conversationStage.addEventListener(
    "scroll",
    () => {
      scrollTop = els.conversationStage.scrollTop;
    },
    { passive: true },
  );

  const renderFrame = () => {
    if (visual && !visual.classList.contains("hidden")) {
      const relativeX = targetX / window.innerWidth - 0.5;
      const relativeY = targetY / window.innerHeight - 0.5;
      visual.style.setProperty("--visual-x", `${relativeX * 10}px`);
      visual.style.setProperty("--visual-y", `${relativeY * 8}px`);
      visual.style.setProperty("--visual-r", `${relativeX * 1.5}deg`);
      visual.style.setProperty(
        "--parallax-y",
        `${Math.max(-20, scrollTop * -0.07)}px`,
      );
    }
    frameId = requestAnimationFrame(renderFrame);
  };

  frameId = requestAnimationFrame(renderFrame);
  window.addEventListener(
    "pagehide",
    () => cancelAnimationFrame(frameId),
    { once: true },
  );
}
async function openNewConversation() {
  state.activeConversationId = null;
  closeMobileHistory();
  state.sourceFiles = [];
  state.pendingMentions = [];
  state.mentionCursor = -1;
  state.maskFile = null;
  state.mode = "default";
  setPromptText("");
  els.prompt.dispatchEvent(new Event("input"));
  els.messages.replaceChildren();
  els.welcomeScreen.classList.remove("hidden");
  els.conversationTitle.textContent = "新建对话";
  els.composerWrap.classList.remove("conversation-mode");
  setMode("default");
  renderAttachments();
  renderMentionTags();
  renderConversationList();
  closeMentionPicker();
}
async function openConversation(id) {
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) return;
  state.activeConversationId = id;
  state.sourceFiles = [];
  state.pendingMentions = [];
  state.mentionCursor = -1;
  state.maskFile = null;
  state.mode = "default";
  setPromptText("");
  els.prompt.dispatchEvent(new Event("input"));
  setMode("default");
  renderAttachments();
  renderMentionTags();
  closeMentionPicker();
  els.conversationTitle.textContent = conversation.title;
  els.messages.replaceChildren();
  els.welcomeScreen.classList.add("hidden");
  els.composerWrap.classList.add("conversation-mode");
  conversation.messages.forEach((message) => renderMessage(message));
  renderConversationList();
  scrollToBottom();
}
function ensureConversation(prompt) {
  if (state.activeConversationId)
    return state.conversations.find(
      (item) => item.id === state.activeConversationId,
    );
  const conversation = createConversation();
  conversation.title = titleFromPrompt(prompt);
  state.activeConversationId = conversation.id;
  state.conversations.push(conversation);
  els.conversationTitle.textContent = conversation.title;
  els.welcomeScreen.classList.add("hidden");
  els.composerWrap.classList.add("conversation-mode");
  return conversation;
}
function renderMessage(message) {
  if (message.role === "user") return;
  const groupKey = dateGroupKey(message.createdAt);
  if (!els.messages.querySelector(`[data-date-group="${groupKey}"]`)) {
    const heading = document.createElement("h2");
    heading.className = "history-date";
    heading.dataset.dateGroup = groupKey;
    heading.textContent = dateHeading(message.createdAt);
    els.messages.append(heading);
  }
  const reply = document.createElement("article");
  reply.className = "message message-reply";
  reply.dataset.messageId = message.id;
  const card = document.createElement("div");
  card.className = "generation-card";
  const head = document.createElement("div");
  head.className = "generation-head";
  const refs = document.createElement("div");
  refs.className = "reference-stack";
  (message.references || []).forEach((reference, index) => {
    const img = document.createElement("img");
    img.className = "reference-thumb";
    img.src = imageUrl(reference);
    img.alt = `参考图 ${index + 1}`;
    bindImagePreview(
      img,
      () =>
        (message.references || []).map((item) => ({
          src: imageUrl(item),
          alt: item.name || "参考图",
          caption: item.name || "参考图",
        })),
      () => index,
    );
    refs.append(img);
  });
  const summary = document.createElement("div");
  summary.className = "generation-summary";
  const prompt = document.createElement("div");
  prompt.className = "generation-prompt";
  prompt.textContent = message.prompt || "";
  const details = document.createElement("div");
  details.className = "generation-details";
  details.innerHTML = `<span>GPT Image 2</span><i></i><span>${modeLabels[message.mode] || "图片生成"}</span><i></i><strong>${escapeHtml(message.ratio || "1:1")}</strong><i></i><strong>${escapeHtml(message.size || "1024x1024")}</strong><i></i><span>${escapeHtml(message.resolution || "1K")}</span>`;
  summary.append(prompt, details);
  head.append(refs, summary);
  card.append(head);
  if (message.status === "loading") {
    const loading = document.createElement("div");
    loading.className = "generation-loading";
    loading.innerHTML =
      '<span class="loading-orb"></span><span>正在生成图片…</span>';
    card.append(loading);
  } else if (message.error) {
    const loading = document.createElement("div");
    loading.className = "generation-loading";
    loading.innerHTML = `<span>生成失败：${escapeHtml(message.error)}</span>`;
    card.append(loading);
  } else {
    const images = document.createElement("div");
    images.className = "generation-images";
    (message.images || []).forEach((image, index) => {
      const wrap = document.createElement("div");
      wrap.className = "generated-image-wrap";
      const img = document.createElement("img");
      img.src = image.dataUrl;
      img.alt = `生成结果 ${index + 1}`;
      bindImagePreview(
        wrap,
        () =>
          (message.images || []).map((item, itemIndex) => ({
            src: item.dataUrl,
            alt: `生成结果 ${itemIndex + 1}`,
            caption: `生成结果 ${itemIndex + 1} / ${(message.images || []).length}`,
          })),
        () => index,
      );
      const download = document.createElement("a");
      download.className = "generated-download";
      download.href = image.dataUrl;
      download.download = `gpt-image-2-${message.createdAt}-${index + 1}.png`;
      download.setAttribute("aria-label", `下载生成结果 ${index + 1}`);
      download.innerHTML = '<i data-lucide="download" aria-hidden="true"></i>';
      wrap.append(img, download);
      images.append(wrap);
    });
    card.append(images);
    const actions = document.createElement("div");
    actions.className = "generation-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "generation-action";
    edit.innerHTML = '<i data-lucide="wand-sparkles" aria-hidden="true"></i><span>重新编辑</span>';
    edit.addEventListener("click", () => editMessage(message));
    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.className = "generation-action";
    regenerate.innerHTML = '<i data-lucide="refresh-cw" aria-hidden="true"></i><span>再次生成</span>';
    regenerate.addEventListener("click", () => regenerateMessage(message));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "generation-action danger";
    remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i><span>删除</span>';
    remove.addEventListener("click", () =>
      askConfirm(
        "删除这次生成？",
        "这条提示词和图片会从当前对话中移除。",
        async () => {
          const conversation = state.conversations.find(
            (entry) => entry.id === state.activeConversationId,
          );
          if (!conversation) return;
          const generationIndex = conversation.messages.findIndex(
            (entry) => entry.id === message.id,
          );
          const previousMessage = conversation.messages[generationIndex - 1];
          const idsToRemove = new Set([message.id]);
          if (previousMessage?.role === "user") idsToRemove.add(previousMessage.id);
          conversation.messages = conversation.messages.filter(
            (entry) => !idsToRemove.has(entry.id),
          );
          await saveConversation(conversation);
          renderConversationMessages(conversation);
        },
      ),
    );
    actions.append(edit, regenerate, remove);
    card.append(actions);
  }
  reply.append(card);
  els.messages.append(reply);
  refreshIcons();
}
function renderConversationMessages(conversation) {
  els.messages.replaceChildren();
  conversation.messages.forEach((message) => renderMessage(message));
  scrollToBottom();
}
function scrollToBottom() {
  requestAnimationFrame(() => {
    els.conversationStage.scrollTop = els.conversationStage.scrollHeight;
  });
}

function appendLoadingMessage(conversation, message) {
  conversation.messages.push(message);
  renderMessage(message);
  scrollToBottom();
}
function getReferences() {
  return state.sourceFiles.map((file, index) => ({
    blob: sourceBlob(file),
    // Keep both the original Blob (for re-submission) and a stable preview
    // value when one is available. IndexedDB can structured-clone Blob/File
    // objects, so restored conversations remain uploadable after reload.
    dataUrl: file.dataUrl || "",
    previewDataUrl: file.previewDataUrl || "",
    maskDataUrl: file.maskDataUrl || "",
    name: file.name || `图${index + 1}`,
    index,
  }));
}
function editMessage(message) {
  state.mode = ["mask", "characterTurnaround"].includes(message.mode)
    ? message.mode
    : "default";
  state.ratio = message.ratio || "1:1";
  state.resolution = message.resolution || "1K";
  state.quality = message.quality || "medium";
  state.count = Number(message.count || 1);
  state.width = Number(message.width || calculateDimensions().width);
  state.height = Number(message.height || calculateDimensions().height);
  state.sourceFiles = (message.references || []).map((reference, index) => ({
    name: reference.name || `图${index + 1}`,
    blob: reference.blob,
    dataUrl: reference.dataUrl || "",
    previewDataUrl: reference.previewDataUrl || "",
    maskDataUrl: reference.maskDataUrl || "",
    preview: imageUrl(reference),
  }));
  state.pendingMentions = (message.mentionIndexes || []).map((index) => ({
    index,
    position: -1,
  }));
  let editPrompt = message.originalPrompt || message.prompt || "";
  if (!message.originalPrompt && message.mentionIndexes?.length) {
    message.mentionIndexes.forEach((index) => {
      editPrompt = editPrompt.replace(`图片${index + 1}`, "@");
    });
  }
  setPromptText(editPrompt, message.mentionIndexes || []);
  state.mentionCursor = -1;
  els.prompt.dispatchEvent(new Event("input"));
  els.resolution.value = state.resolution;
  els.quality.value = state.quality;
  els.count.value = String(state.count);
  setMode(state.mode);
  setRatio(state.ratio);
  updateDimensionPreview();
  renderAttachments();
  renderMentionTags();
  setSettingsOpen(false);
  els.prompt.focus();
  showToast("已将这次生成放入对话框");
}
function regenerateMessage(message) {
  editMessage(message);
  submitGeneration();
}
async function submitGeneration() {
  if (state.busy) return;
  if (!state.authenticated) {
    openAuthModal();
    return showToast("请先登录，再开始生成", "error");
  }
  if (state.maskEditorOpen) saveActiveMask();
  syncPendingMentions();
  const rawPrompt = getPromptText(false).trim();
  if (!rawPrompt) return showToast("请先输入提示词", "error");
  const effectiveMode = getEffectiveGenerationMode();
  if (effectiveMode === "characterTurnaround" && state.sourceFiles.length !== 1)
    return showToast("角色三视图必须传入 1 张参考图", "error");
  if ((effectiveMode === "edit" || effectiveMode === "mask") && !state.sourceFiles.length)
    return showToast("请先上传原图", "error");
  // 角色三视图的模板由后端拼接（prompts/character_turnaround.txt 是唯一来源），
  // 前端只提交用户自己的描述，因此这里始终用带 @ 引用的完整提示词文本。
  const prompt = getPromptText(true).trim();
  const displayPrompt = rawPrompt;
  const conversation = ensureConversation(prompt);
  const dimensions = {
    width: Number(state.width) || 1024,
    height: Number(state.height) || 1024,
  };
  const settings = {
    prompt,
    originalPrompt: rawPrompt,
    mode: effectiveMode,
    model: state.model,
    ratio: state.ratio,
    resolution: state.resolution,
    quality: els.quality.value,
    count: Number(els.count.value),
    width: dimensions.width,
    height: dimensions.height,
    size: `${dimensions.width}x${dimensions.height}`,
    mentionIndexes: state.pendingMentions.map((mention) => mention.index),
    references: getReferences(),
    createdAt: Date.now(),
  };
  const userMessage = {
    id: uid("user"),
    role: "user",
    prompt: displayPrompt,
    createdAt: Date.now(),
  };
  const generation = {
    id: uid("generation"),
    role: "generation",
    ...settings,
    status: "loading",
    images: [],
  };
  conversation.messages.push(userMessage, generation);
  await saveConversation(conversation);
  renderMessage(userMessage);
  renderMessage(generation);
  scrollToBottom();
  state.busy = true;
  els.submitButton.disabled = true;
  els.submitIcon.textContent = "…";
  try {
    let response;
    if (effectiveMode === "generate")
      response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          size: settings.size,
          quality: settings.quality,
          n: settings.count,
          model: state.model,
        }),
      });
    else {
      const data = new FormData();
      const sourceFiles = await Promise.all(
        state.sourceFiles.map(toUploadFile),
      );
      sourceFiles.forEach((file) =>
        data.append("image", file, file.name || `image-${Date.now()}.png`),
      );
      Object.entries({
        prompt,
        size: settings.size,
        quality: settings.quality,
        n: settings.count,
        // 后端据此决定是否套用角色三视图模板。
        mode: effectiveMode,
        model: state.model,
      }).forEach(([key, value]) => data.append(key, value));
      if (els.fidelity.checked) data.append("input_fidelity", "high");
      if (effectiveMode === "mask") {
        // Keep the first mask on the legacy field and expose additional masks
        // as indexed multipart fields for the multi-reference API contract.
        const blob = dataUrlBlob(state.sourceFiles[0]?.maskDataUrl);
        if (blob) data.append("mask", blob, "mask.png");
        state.sourceFiles.slice(1).forEach((source, index) => {
          const extraMask = dataUrlBlob(source.maskDataUrl);
          if (extraMask)
            data.append("mask[]", extraMask, `mask-${index + 2}.png`);
        });
        data.append(
          "mask_count",
          String(state.sourceFiles.filter((source) => source.maskDataUrl).length),
        );
      }
      response = await fetch("/api/edit", { method: "POST", body: data });
    }
    const result = await response.json();
    if (!response.ok) {
      const requestError = new Error(result.error || "请求失败");
      requestError.status = response.status;
      throw requestError;
    }
    generation.status = "done";
    generation.images = result.images || [];
    conversation.updatedAt = Date.now();
    await saveConversation(conversation);
    renderConversationMessages(conversation);
  } catch (error) {
    if (error.status === 401) {
      setAuthenticated(false);
      openAuthModal();
    }
    generation.status = "error";
    generation.error = error.message;
    await saveConversation(conversation);
    renderConversationMessages(conversation);
    showToast(error.message, "error");
  } finally {
    state.busy = false;
    els.submitButton.disabled = false;
    els.submitIcon.innerHTML =
      '<i data-lucide="arrow-up" aria-hidden="true"></i>';
    refreshIcons();
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitGeneration();
});
els.sourceInput.addEventListener("change", (event) => {
  setSourceFiles(event.target.files);
  els.sourceInput.value = "";
});
els.prompt.addEventListener("input", () => {
  syncPendingMentions();
  const value = getPromptText(false);
  els.promptCount.textContent = `${value.length} / 4000`;
  const range = currentPromptRange();
  if (range && previousCharacter(range) === "@") {
    state.mentionRange = range.cloneRange();
    openMentionPicker();
  } else if (state.mentionPickerOpen) closeMentionPicker();
});
els.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMentionPicker();
  if (event.key !== "Enter") return;
  // 输入法组合态（拼音/日文等）下按 Enter 是选词，不应发送。
  if (event.isComposing || event.keyCode === 229) return;
  // Shift+Enter 插入换行，交给浏览器默认行为。
  if (event.shiftKey) return;
  event.preventDefault();
  submitGeneration();
});
document.addEventListener("click", (event) => {
  if (
    state.mentionPickerOpen &&
    !els.mentionPicker.contains(event.target) &&
    event.target !== els.prompt
  )
    closeMentionPicker();
  if (!event.target.closest(".conversation-item")) closeAllMenus();
  if (
    !els.settingsPopover.classList.contains("hidden") &&
    !els.settingsPopover.contains(event.target) &&
    !event.target.closest("#settingsButton, #modeButton, #modelButton")
  )
    setSettingsOpen(false);
  if (
    !els.modePopover.classList.contains("hidden") &&
    !els.modePopover.contains(event.target) &&
    !event.target.closest("#modeButton, #modelButton")
  )
    setModePopoverOpen(false);
  if (
    !els.modelPopover.classList.contains("hidden") &&
    !els.modelPopover.contains(event.target) &&
    !event.target.closest("#modelButton")
  )
    setModelPopoverOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (!els.authModal.classList.contains("hidden")) {
    if (event.key === "Escape") {
      closeAuthModal();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...els.authModal.querySelectorAll("button, input")].filter(
        (element) => !element.disabled && element.offsetParent !== null,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
  if (state.maskEditorOpen && event.key === "Escape") {
    closeMaskEditor();
    return;
  }
  if (!els.imageLightbox.classList.contains("hidden")) {
    if (event.key === "Escape") closeImageLightbox();
    else if (event.key === "ArrowLeft") stepImageLightbox(-1);
    else if (event.key === "ArrowRight") stepImageLightbox(1);
    return;
  }
  if (event.key !== "Escape") return;
  closeMentionPicker();
  closeAllMenus();
  setSettingsOpen(false);
  setModePopoverOpen(false);
  closeMobileHistory();
  if (!els.confirmBackdrop.classList.contains("hidden")) closeConfirm();
});
document.querySelectorAll("[data-prompt]").forEach((button) =>
  button.addEventListener("click", () => {
    setPromptText(button.dataset.prompt);
    els.prompt.dispatchEvent(new Event("input"));
    els.prompt.focus();
  }),
);
document
  .querySelectorAll(".ratio-option")
  .forEach((button) =>
    button.addEventListener("click", () => setRatio(button.dataset.ratio)),
  );
document.querySelectorAll("[data-mode]").forEach((button) =>
  button.addEventListener("click", () => {
    if (
      button.dataset.mode === "characterTurnaround" &&
      state.sourceFiles.length > 1
    ) {
      const firstImage = state.sourceFiles[0];
      state.sourceFiles = [firstImage];
      els.prompt.querySelectorAll(".inline-mention").forEach((mention) => {
        const mentionIndex = Number(mention.dataset.index);
        if (mentionIndex === 0) updateInlineMention(mention, 0);
        else mention.remove();
      });
      syncPendingMentions();
      renderMentionTags();
      showToast("已为角色三视图保留第一张参考图");
    }
    setMode(button.dataset.mode);
    if (button.closest(".mode-options"))
      setModePopoverOpen(false);
  }),
);
els.settingsButton.addEventListener("click", () => {
  setModePopoverOpen(false);
  setModelPopoverOpen(false);
  toggleSettingsPopover();
});
els.closeSettings.addEventListener("click", () =>
  setSettingsOpen(false),
);
els.closeMode?.addEventListener("click", () =>
  setModePopoverOpen(false),
);
els.modelButton.addEventListener("click", () => {
  setSettingsOpen(false);
  setModePopoverOpen(false);
  toggleModelPopover();
});
els.closeModel?.addEventListener("click", () => setModelPopoverOpen(false));
els.modeButton.addEventListener("click", () => {
  setSettingsOpen(false);
  setModelPopoverOpen(false);
  toggleModePopover();
});
function setSettingsOpen(open) {
  els.settingsPopover.classList.toggle("hidden", !open);
  els.settingsButton.setAttribute("aria-expanded", String(open));
  if (open) positionSettingsPopover();
}
function toggleSettingsPopover() {
  setSettingsOpen(els.settingsPopover.classList.contains("hidden"));
}
function positionSettingsPopover() {
  const rect = els.settingsButton.getBoundingClientRect();
  const popup = els.settingsPopover;
  popup.style.left = "0px";
  popup.style.top = "0px";
  popup.style.right = "auto";
  popup.style.bottom = "auto";
  popup.style.visibility = "hidden";
  popup.style.maxHeight = "";
  popup.style.height = "";
  popup.classList.remove("hidden");
  const popupRect = popup.getBoundingClientRect();
  let left = rect.left;
  const maxLeft = window.innerWidth - popupRect.width - 10;
  left = Math.max(10, Math.min(left, maxLeft));
  let top = rect.top - popupRect.height - 10;
  if (top < 10) top = rect.bottom + 10;
  popup.style.left = left + "px";
  popup.style.top = top + "px";
  popup.style.visibility = "";
}
function setModePopoverOpen(open) {
  els.modePopover.classList.toggle("hidden", !open);
  els.modeButton.setAttribute("aria-expanded", String(open));
  if (open) positionModePopover();
}
function positionModePopover() {
  const rect = els.modeButton.getBoundingClientRect();
  const popup = els.modePopover;
  popup.style.visibility = "hidden";
  popup.classList.remove("hidden");
  const popupRect = popup.getBoundingClientRect();
  let left = rect.left;
  const maxLeft = window.innerWidth - popupRect.width - 10;
  left = Math.max(10, Math.min(left, maxLeft));
  let top = rect.top - popupRect.height - 10;
  if (top < 10) top = rect.bottom + 10;
  popup.style.left = left + "px";
  popup.style.top = top + "px";
  popup.style.visibility = "";
}
function toggleModePopover() {
  setModePopoverOpen(els.modePopover.classList.contains("hidden"));
}
// ---------- 模型选择器（需求6） ----------
const MODEL_DESCRIPTIONS = {
  "gpt-image-2": "快速、经济的通用出图模型",
  "gpt-image-2.5": "更高质量、更高保真度",
};
function renderModelOptions() {
  const models = state.availableModels.length
    ? state.availableModels
    : [state.model];
  els.modelOptions.innerHTML = "";
  models.forEach((name) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "model-option" + (name === state.model ? " active" : "");
    button.dataset.model = name;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(name === state.model));
    const desc = MODEL_DESCRIPTIONS[name] || "可用模型";
    button.innerHTML =
      '<span class="model-option-icon"><i data-lucide="cpu"></i></span>' +
      '<span class="model-option-copy">' +
      `<span class="model-option-title">${escapeHtml(name)}</span>` +
      `<span class="model-option-desc">${escapeHtml(desc)}</span>` +
      "</span>" +
      '<span class="model-option-state"><i data-lucide="check"></i></span>';
    button.addEventListener("click", () => selectModel(name));
    els.modelOptions.appendChild(button);
  });
  refreshIcons();
  els.modelLabel.textContent = state.model;
}
function selectModel(name) {
  if (!name) return;
  state.model = name;
  renderModelOptions();
  setModelPopoverOpen(false);
  showToast(`已切换到 ${name}`);
}
function setModelPopoverOpen(open) {
  els.modelPopover.classList.toggle("hidden", !open);
  els.modelButton.setAttribute("aria-expanded", String(open));
  if (open) positionModelPopover();
}
function positionModelPopover() {
  const rect = els.modelButton.getBoundingClientRect();
  const popup = els.modelPopover;
  popup.style.visibility = "hidden";
  popup.classList.remove("hidden");
  const popupRect = popup.getBoundingClientRect();
  let left = rect.left;
  const maxLeft = window.innerWidth - popupRect.width - 10;
  left = Math.max(10, Math.min(left, maxLeft));
  let top = rect.top - popupRect.height - 10;
  if (top < 10) top = rect.bottom + 10;
  popup.style.left = left + "px";
  popup.style.top = top + "px";
  popup.style.visibility = "";
}
function toggleModelPopover() {
  setModelPopoverOpen(els.modelPopover.classList.contains("hidden"));
}
window.addEventListener("resize", () => {
  if (!els.modePopover.classList.contains("hidden")) positionModePopover();
  if (!els.settingsPopover.classList.contains("hidden")) positionSettingsPopover();
  if (!els.modelPopover.classList.contains("hidden")) positionModelPopover();
});
els.resolution.addEventListener("change", () => {
  state.resolution = els.resolution.value;
  if (state.linkSize) syncDimensionsFromRatio();
  else updateDimensionPreview();
});
els.quality.addEventListener("change", () => {
  state.quality = els.quality.value;
});
els.count.addEventListener("change", () => {
  state.count = Number(els.count.value);
});
els.widthInput.addEventListener("input", () => {
  state.width = snapDimension(Number(els.widthInput.value) || 1024);
  if (state.linkSize) {
    const [rw, rh] = state.ratio.split(":").map(Number);
    state.height = snapDimension((state.width * rh) / rw);
  }
  updateDimensionPreview();
});
els.heightInput.addEventListener("input", () => {
  state.height = snapDimension(Number(els.heightInput.value) || 1024);
  if (state.linkSize) {
    const [rw, rh] = state.ratio.split(":").map(Number);
    state.width = snapDimension((state.height * rw) / rh);
  }
  updateDimensionPreview();
});
els.linkSize.addEventListener("click", () => {
  state.linkSize = !state.linkSize;
  els.linkSize.setAttribute("aria-pressed", String(state.linkSize));
  els.linkSize.textContent = state.linkSize ? "锁定比例" : "自由尺寸";
  if (state.linkSize) syncDimensionsFromRatio();
});
els.maskCanvas.addEventListener("pointerdown", (event) => {
  painting = true;
  maskDirty = true;
  els.maskModalStatus.textContent = `图${state.activeMaskIndex + 1} · 正在编辑`;
  els.maskCanvas.setPointerCapture(event.pointerId);
  updateBrushCursor(event);
  drawAt(event);
});
els.maskCanvas.addEventListener("pointerenter", updateBrushCursor);
els.maskCanvas.addEventListener("pointermove", (event) => {
  updateBrushCursor(event);
  if (painting) drawAt(event);
});
els.maskCanvas.addEventListener("pointerup", (event) => {
  painting = false;
  updateBrushCursor(event);
});
els.maskCanvas.addEventListener("pointercancel", () => {
  painting = false;
  hideBrushCursor();
});
els.maskCanvas.addEventListener("pointerleave", hideBrushCursor);
els.brushSize.addEventListener("input", () => {
  els.brushOutput.textContent = `${els.brushSize.value} px`;
  refreshBrushCursorSize();
});
els.resetMask.addEventListener("click", () => {
  const file = state.sourceFiles[state.activeMaskIndex];
  maskDirty = true;
  resetMaskCanvas();
  if (file) file.maskDataUrl = "";
  updateMaskEditorMeta();
});
els.maskInput.addEventListener("change", () => {
  const file = els.maskInput.files?.[0];
  if (!file || !els.maskCanvas.width) return;
  const image = new Image();
  image.onload = () => {
    const ctx = els.maskCanvas.getContext("2d");
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(image, 0, 0, els.maskCanvas.width, els.maskCanvas.height);
    saveActiveMask();
  };
  image.src = URL.createObjectURL(file);
  els.maskInput.value = "";
});
els.openMaskEditor.addEventListener("click", () => openMaskEditor());
els.closeMaskEditor.addEventListener("click", () => closeMaskEditor());
els.applyMaskEditor.addEventListener("click", () => closeMaskEditor());
els.maskModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-mask-close]")) closeMaskEditor();
});
els.authButton.addEventListener("click", async () => {
  if (!state.authenticated) return openAuthModal();
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    setAuthenticated(false);
    showToast("已退出登录，历史对话仍保留在本机");
  }
});
els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authSubmit.disabled = true;
  els.authSubmit.querySelector("span").textContent = "正在登录…";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: els.authApiKey.value,
        baseURL: els.authBaseURL.value,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "登录失败");
    setAuthenticated(true);
    closeAuthModal();
    await checkHealth();
    showToast("登录成功，30 天内无需重复登录");
  } catch (error) {
    showToast(error.message, "error");
    els.authApiKey.focus();
  } finally {
    els.authSubmit.disabled = false;
    els.authSubmit.querySelector("span").textContent = "进入工作台";
  }
});
els.authKeyToggle.addEventListener("click", () => {
  const visible = els.authApiKey.type === "text";
  els.authApiKey.type = visible ? "password" : "text";
  els.authKeyToggle.setAttribute("aria-pressed", String(!visible));
  els.authKeyToggle.setAttribute("aria-label", visible ? "显示 API Key" : "隐藏 API Key");
  els.authKeyToggle.title = visible ? "显示 API Key" : "隐藏 API Key";
  els.authKeyToggle.innerHTML = `<i data-lucide="${visible ? "eye" : "eye-off"}" aria-hidden="true"></i>`;
  refreshIcons();
  els.authApiKey.focus();
});
els.closeAuth.addEventListener("click", closeAuthModal);
els.authModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-auth-close]")) closeAuthModal();
});
els.newConversation.addEventListener("click", openNewConversation);
els.mobileNewConversation.addEventListener("click", openNewConversation);
els.mobileHistory?.addEventListener("click", () => {
  const open = document.querySelector(".sidebar")?.classList.contains("mobile-open");
  if (open) closeMobileHistory();
  else openMobileHistory();
});
els.sidebarScrim?.addEventListener("click", closeMobileHistory);
els.closeLightbox?.addEventListener("click", closeImageLightbox);
els.lightboxPrev?.addEventListener("click", () => stepImageLightbox(-1));
els.lightboxNext?.addEventListener("click", () => stepImageLightbox(1));
els.imageLightbox?.addEventListener("click", (event) => {
  if (event.target.matches("[data-lightbox-close]")) closeImageLightbox();
});
els.cancelConfirm.addEventListener("click", closeConfirm);
els.confirmBackdrop.addEventListener("click", (event) => {
  if (event.target === els.confirmBackdrop) closeConfirm();
});
els.confirmAction.addEventListener("click", async () => {
  if (confirmNeedsSecondStep) {
    confirmNeedsSecondStep = false;
    els.confirmTitle.textContent = "再次确认删除？";
    els.confirmText.textContent =
      "这是最后一步，确认后将永久删除该对话及其中的全部图片。";
    els.confirmAction.textContent = "永久删除";
    return;
  }
  const callback = confirmCallback;
  closeConfirm();
  if (callback) await callback();
});
async function checkHealth() {
  if (!state.authenticated) {
    setAuthenticated(false);
    return;
  }
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    if (response.status === 401) {
      setAuthenticated(false);
      return;
    }
    els.connection.innerHTML = `<span class="dot ${data.configured ? "ok" : "bad"}"></span>${data.configured ? "API 已登录" : "等待登录"}`;
  } catch {
    els.connection.innerHTML = '<span class="dot bad"></span>服务未连接';
  }
}
async function loadModels() {
  try {
    const response = await fetch("/api/models");
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.available) && data.available.length) {
      state.availableModels = data.available;
      // 若当前模型不在服务端白名单中，回退到服务端默认值。
      if (!data.available.includes(state.model)) {
        state.model = data.default || data.available[0];
      }
      renderModelOptions();
    }
  } catch (error) {
    // 模型列表不可用时保留默认值，不打断页面初始化。
    console.warn("加载模型列表失败：", error);
  }
}

async function init() {
  try {
    state.conversations = sortConversations(await getConversations());
    if (!state.conversations.length) {
      const legacy = await readLegacyGenerations();
      if (legacy.length) {
        const conversation = createConversation();
        const sorted = legacy.sort((a, b) => b.createdAt - a.createdAt);
        conversation.title = titleFromPrompt(sorted[0].prompt);
        sorted.forEach((record) =>
          conversation.messages.push({
            id: record.id || uid("generation"),
            role: "generation",
            ...record,
            status: "done",
            mode: record.mode || "generate",
            images: [{ dataUrl: record.dataUrl }],
            references: [],
          }),
        );
        await saveConversation(conversation);
      }
    }
    renderConversationList();
    await openNewConversation();
  } catch (error) {
    showToast(error.message, "error");
  }
  setRatio(state.ratio);
  updateDimensionPreview();
  await refreshAuthSession();
  await loadModels();
  checkHealth();
  refreshIcons();
  initAmbientMotion();
}
init();
