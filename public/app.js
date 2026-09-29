const MAX_SOURCE_FILES = 16;
const DB_NAME = "gpt-image-2-studio";
const DB_VERSION = 5;
const PROJECT_STORE = "projects";
const CONVERSATION_STORE = "conversations";
const LEGACY_STORE = "generations";
const ASSET_STORE = "assets";
const ASSET_CATEGORIES = Object.freeze([
  { id: "character", label: "角色", english: "CHARACTERS", icon: "user-round" },
  { id: "scene", label: "场景", english: "SCENES", icon: "landmark" },
  { id: "prop", label: "道具", english: "PROPS", icon: "package" },
]);
// 对话拖拽移动时写入 dataTransfer 的自定义类型，用来区分其它拖拽（如文件拖入）。
const CONVERSATION_DRAG_TYPE = "application/x-conversation-id";
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
  characterTurnaround: "需 1 张参考图（包含资产），生成工作室肖像与全身三视图。",
  sceneMultiView: "需 1 张参考图（包含资产），生成 2×2 场景多视角网格。",
};
const modeLabels = {
  default: "默认",
  generate: "文生图",
  edit: "图生图",
  mask: "蒙版编辑",
  characterTurnaround: "角色三视图",
  sceneMultiView: "场景多视角",
};
// 单参考图模式：角色三视图与场景多视角都只能使用 1 张参考图。
const SINGLE_REFERENCE_MODES = ["characterTurnaround", "sceneMultiView"];
// 特殊模式的允许比例；切换模式时若当前比例不可用，自动回退到列表第一项。
const MODE_ALLOWED_RATIOS = {
  characterTurnaround: ["16:9", "21:9"],
  sceneMultiView: ["9:16", "16:9", "21:9"],
};
const TURNAROUND_ALLOWED_RATIOS = MODE_ALLOWED_RATIOS.characterTurnaround;
const PROMPT_PLACEHOLDERS = {
  default: "描述你想生成的画面… 输入 @ 选择参考图",
  singleReference: "可不输入提示词，直接发送",
};
const MASK_EDITABLE_ERROR = "蒙版中没有透明区域，请先擦出要编辑的区域";
const state = {
  mode: "default",
  sourceFiles: [],
  maskFile: null,
  // 每一条生成消息都是独立任务；切换项目/对话不会中断其它任务。
  generationTasks: new Map(),
  conversationSaveQueues: new Map(),
  ratio: "1:1",
  resolution: "1K",
  quality: "medium",
  count: 1,
  width: 1024,
  height: 1024,
  linkSize: true,
  conversations: [],
  assets: [],
  assetCategoryTab: "character",
  workspaceView: "conversation",
  activeConversationId: null,
  projects: [],
  activeProjectId: null,
  // 空白草稿待绑定的项目：新建对话后由项目胶囊选择，发出首条消息时落库。
  draftProjectId: null,
  // 草稿态「尚未创建」的项目名：在浮层里输入名称回车只是记下名字，
  // 项目本身要等首条消息发出时才真正建库，避免留下空项目。
  draftProjectTitle: null,
  pendingMentions: [],
  pendingAssetMentions: [],
  mentionCursor: -1,
  mentionRange: null,
  assetMentionRange: null,
  mentionPickerOpen: false,
  activeMaskIndex: 0,
  maskEditorOpen: false,
  authenticated: false,
  model: "gpt-image-2",
  availableModels: [],
  assetModalMode: "upload",
  assetModalCategory: "character",
  assetModalImage: null,
  assetModalSource: null,
  assetPickerFilter: "all",
};
const $ = (selector) => document.querySelector(selector);
function totalReferenceCount() {
  return state.sourceFiles.length + uniqueAssetMentions().length;
}
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
  projectList: $("#projectList"),
  projectTotal: $("#projectTotal"),
  projectButton: $("#projectButton"),
  projectLabel: $("#projectLabel"),
  projectPopover: $("#projectPopover"),
  projectOptions: $("#projectOptions"),
  projectSearchInput: $("#projectSearchInput"),
  closeProject: $("#closeProject"),
  projectCreateToggle: $("#projectCreateToggle"),
  projectCreateRow: $("#projectCreateRow"),
  projectCreateInput: $("#projectCreateInput"),
  projectCreateConfirm: $("#projectCreateConfirm"),
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
  lightboxDownload: $("#lightboxDownload"),
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
  conversationNav: $("#conversationNav"),
  assetNav: $("#assetNav"),
  assetTotal: $("#assetTotal"),
  assetStage: $("#assetStage"),
  assetTabs: $("#assetTabs"),
  assetSections: $("#assetSections"),
  assetButton: $("#assetButton"),
  assetModal: $("#assetModal"),
  closeAssetModal: $("#closeAssetModal"),
  cancelAssetModal: $("#cancelAssetModal"),
  assetForm: $("#assetForm"),
  assetModalCategory: $("#assetModalCategory"),
  assetCategoryInput: $("#assetCategoryInput"),
  assetFileInput: $("#assetFileInput"),
  assetFilePicker: $("#assetFilePicker"),
  assetFileSelected: $("#assetFileSelected"),
  assetFilePreview: $("#assetFilePreview"),
  assetFileName: $("#assetFileName"),
  assetFileChange: $("#assetFileChange"),
  assetNameInput: $("#assetNameInput"),
  assetModalHint: $("#assetModalHint"),
  saveAsset: $("#saveAsset"),
  assetPickerModal: $("#assetPickerModal"),
  closeAssetPicker: $("#closeAssetPicker"),
  assetPickerGrid: $("#assetPickerGrid"),
  assetFilterTabs: $("#assetFilterTabs"),
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
  // 预览中的下载按钮始终跟随当前这张图。
  if (els.lightboxDownload) {
    els.lightboxDownload.href = item.src;
    els.lightboxDownload.download = item.downloadName || `image-${lightboxState.index + 1}.png`;
    els.lightboxDownload.setAttribute(
      "aria-label",
      `下载${item.alt ? ` ${item.alt}` : "当前图片"}`,
    );
  }
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
  const assetReferenceIndexes = new Map(
    uniqueAssetMentions().map((mention, index) => [
      assetMentionKey(mention),
      state.sourceFiles.length + index + 1,
    ]),
  );
  const read = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR")
      return "\n";
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.classList.contains("inline-mention")) {
      const index = Number(node.dataset.index);
      return labels ? `图片${index + 1}` : "@";
    }
    if (node.classList.contains("asset-mention")) {
      const title = node.dataset.title || "未命名资产";
      if (!labels) return `资产：${title}`;
      // References are uploaded in the same order as getReferences():
      // normal source images first, then asset snapshots. Keep the prompt's
      // image number aligned with that order so the model can bind text to
      // the correct image.
      const referenceIndex = assetReferenceIndexes.get(assetMentionKey({
        assetId: node.dataset.assetId,
        dataUrl: node.dataset.dataUrl || node.querySelector("img")?.src || "",
        title,
      })) || state.sourceFiles.length + 1;
      return `图片${referenceIndex}（资产：${title}）`;
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

function createAssetMention(asset, snapshot = true) {
  const mention = document.createElement("span");
  mention.className = "asset-mention";
  mention.contentEditable = "false";
  mention.dataset.assetId = asset.id || "";
  mention.dataset.title = asset.title || asset.name || "未命名资产";
  if (snapshot) mention.dataset.dataUrl = asset.dataUrl || "";
  const img = document.createElement("img");
  img.src = asset.dataUrl || "";
  img.alt = mention.dataset.title;
  const label = document.createElement("span");
  label.textContent = mention.dataset.title;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "inline-mention-remove asset-mention-remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `移除资产 ${mention.dataset.title}`);
  remove.addEventListener("mousedown", (event) => event.preventDefault());
  remove.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); mention.remove(); syncPendingMentions(); els.prompt.dispatchEvent(new Event("input")); });
  // Match reference-image mentions: remove button, thumbnail, then label.
  mention.append(remove, img, label);
  return mention;
}
function syncAssetMentions() {
  state.pendingAssetMentions = [...els.prompt.querySelectorAll(".asset-mention")].map((node) => ({
    assetId: node.dataset.assetId,
    title: node.dataset.title,
    dataUrl: node.dataset.dataUrl || node.querySelector("img")?.src || "",
  }));
}
function assetMentionKey(mention) {
  return mention?.assetId || mention?.dataUrl || `title:${mention?.title || "未命名资产"}`;
}
function uniqueAssetMentions(mentions = state.pendingAssetMentions) {
  const seen = new Set();
  return mentions.filter((mention) => {
    const key = assetMentionKey(mention);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function insertAssetMention(asset) {
  const currentCount = totalReferenceCount();
  if (SINGLE_REFERENCE_MODES.includes(state.mode) && currentCount >= 1) {
    showToast(`${modeLabels[state.mode]}只能使用 1 张参考图（包含资产）`, "error");
    return;
  }
  if (currentCount >= MAX_SOURCE_FILES) {
    showToast(`最多只能添加 ${MAX_SOURCE_FILES} 张参考图（包含资产）`, "error");
    return;
  }
  let range = state.assetMentionRange?.cloneRange() || currentPromptRange();
  if (!range || !els.prompt.contains(range.commonAncestorContainer)) {
    els.prompt.focus();
    range = currentPromptRange();
  }
  // The picker steals focus, so always fall back to the end of the editor
  // rather than downgrading an asset reference to plain text.
  if (!range || !els.prompt.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(els.prompt);
    range.collapse(false);
  }
  range.deleteContents();
  const mention = createAssetMention(asset);
  range.insertNode(mention);
  const caret = document.createRange();
  caret.setStartAfter(mention); caret.collapse(true);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(caret);
  state.assetMentionRange = null;
  syncAssetMentions(); els.prompt.dispatchEvent(new Event("input"));
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

function insertPlainTextAtCursor(text) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const textNode = document.createTextNode(text);

  if (!range || !els.prompt.contains(range.commonAncestorContainer)) {
    els.prompt.append(textNode);
    return;
  }

  range.deleteContents();
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
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
  syncAssetMentions();
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
async function hasTransparentPixel(dataUrl) {
  return new Promise((resolve) => {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png"))
      return resolve(false);
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) return resolve(false);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return resolve(false);
      context.drawImage(image, 0, 0);
      try {
        const alpha = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        for (let index = 3; index < alpha.length; index += 4) {
          if (alpha[index] < 255) return resolve(true);
        }
      } catch {
        return resolve(false);
      }
      resolve(false);
    };
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
}

async function validateMaskSources() {
  for (const source of state.sourceFiles) {
    if (!source.maskDataUrl) continue;
    const hasEditableArea = await hasTransparentPixel(source.maskDataUrl);
    if (!hasEditableArea) return false;
  }
  return true;
}

function useGeneratedImageAsReference(message, index, image) {
  const blob = dataUrlBlob(image?.dataUrl);
  if (!(blob instanceof Blob)) {
    showToast("生成图片数据不可用，无法添加为参考图", "error");
    return;
  }
  const previousCount = state.sourceFiles.length;
  const file = new File(
    [blob],
    generatedFileName(message, index),
    { type: blob.type || "image/png" },
  );
  setSourceFiles([file]);
  if (state.sourceFiles.length > previousCount) {
    showToast("已添加到参考图", "success");
    els.prompt.focus({ preventScroll: true });
  }
}

function splitImageFileType(dataUrl) {
  const mime = dataUrl?.match(/^data:([^;]+)/i)?.[1];
  return mime || "image/jpeg";
}

function useSplitImageAsReference(splitItem, splitIndex) {
  const blob = dataUrlBlob(splitItem?.dataUrl);
  if (!(blob instanceof Blob)) {
    showToast("拆分图片数据不可用，无法添加为参考图", "error");
    return;
  }
  const previousCount = state.sourceFiles.length;
  const file = new File(
    [blob],
    splitItem?.name || `grid-split-${splitIndex + 1}.jpg`,
    { type: blob.type || splitImageFileType(splitItem?.dataUrl) },
  );
  setSourceFiles([file]);
  if (state.sourceFiles.length > previousCount) {
    showToast("已添加到参考图", "success");
    els.prompt.focus({ preventScroll: true });
  }
}

async function splitGeneratedGrid(message, index, image, button) {
  const blob = dataUrlBlob(image?.dataUrl);
  if (!(blob instanceof Blob)) {
    showToast("生成图片数据不可用，无法拆分", "error");
    return;
  }
  const originalIcon = button.innerHTML;
  button.disabled = true;
  button.innerHTML = "<span>…</span>";
  try {
    const data = new FormData();
    data.append("image", blob, generatedFileName(message, index));
    const response = await fetch("/api/split-grid", {
      method: "POST",
      body: data,
    });
    const result = await response.json();
    if (!response.ok) {
      const requestError = new Error(result.error || "宫格图拆分失败");
      requestError.status = response.status;
      throw requestError;
    }
    const splitImages = (result.images || []).map((item) => ({
      dataUrl: item.dataUrl,
      name: item.name || `grid-split-${Date.now()}.jpg`,
    }));
    if (!splitImages.length) throw new Error(result.error || "宫格图拆分失败");
    // 保留每次拆分结果，便于用户在同一生成图下回看历史拆分。
    if (!Array.isArray(message.splitHistory)) message.splitHistory = [];
    message.splitHistory.push({
      id: `split-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: Date.now(),
      images: splitImages,
    });
    message.activeSplitId = message.splitHistory.at(-1).id;
    message.splitImages = splitImages;
    message.splitCreatedAt = Date.now();
    const conversation = state.conversations.find(
      (item) => item.id === state.activeConversationId,
    );
    await saveConversation(conversation);
    renderConversationMessages(conversation);
    showToast(`已拆分出 ${splitImages.length} 张图片`, "success");
  } catch (error) {
    if (error.status === 401) {
      setAuthenticated(false);
      openAuthModal();
    }
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = originalIcon;
    refreshIcons();
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
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const transaction = request.transaction;
      // 新增项目表（v3）。老用户升级时把已有对话归入默认项目，见下方迁移。
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        const projects = db.createObjectStore(PROJECT_STORE, {
          keyPath: "id",
        });
        projects.createIndex("updatedAt", "updatedAt");
      }
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
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        const assets = db.createObjectStore(ASSET_STORE, { keyPath: "id" });
        assets.createIndex("category", "category");
        assets.createIndex("updatedAt", "updatedAt");
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
async function getAssets() {
  const db = await openDb();
  return idbRequest(db.transaction(ASSET_STORE, "readonly").objectStore(ASSET_STORE).getAll());
}
async function putAsset(asset) {
  const db = await openDb();
  return idbRequest(db.transaction(ASSET_STORE, "readwrite").objectStore(ASSET_STORE).put(asset));
}
async function deleteAssetFromDb(id) {
  const db = await openDb();
  return idbRequest(db.transaction(ASSET_STORE, "readwrite").objectStore(ASSET_STORE).delete(id));
}
function sortAssets(assets) {
  return [...(assets || [])].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
}
function assetCategory(category) {
  return ASSET_CATEGORIES.find((entry) => entry.id === category) || ASSET_CATEGORIES[0];
}
function uniqueAssetTitle(title, ignoredId = null) {
  const base = String(title || "").trim() || "未命名资产";
  const names = new Set(state.assets.filter((asset) => asset.id !== ignoredId).map((asset) => asset.title || asset.name));
  if (!names.has(base)) return base;
  let index = 1;
  let candidate = `${base}(${index})`;
  while (names.has(candidate)) candidate = `${base}(${++index})`;
  return candidate;
}
// ---------------------------------------------------------------- 项目层
// 结构：项目（projects）1 ── n 会话（conversations），会话带 projectId 外键。
// 老数据（无 projectId）由 migrateConversationsToProjects 归入默认项目，
// 因此升级数据库不会丢失已有对话。
const DEFAULT_PROJECT_TITLE = "默认项目";

async function getProjects() {
  const db = await openDb();
  return idbRequest(
    db.transaction(PROJECT_STORE, "readonly").objectStore(PROJECT_STORE).getAll(),
  );
}
async function putProject(project) {
  const db = await openDb();
  return idbRequest(
    db.transaction(PROJECT_STORE, "readwrite").objectStore(PROJECT_STORE).put(project),
  );
}
async function deleteProjectFromDb(id) {
  const db = await openDb();
  const projectStore = db.transaction(PROJECT_STORE, "readwrite").objectStore(PROJECT_STORE);
  return idbRequest(projectStore.delete(id));
}
function createProject(title = "新建项目") {
  return {
    id: uid("project"),
    title,
    collapsed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
async function saveProject(project) {
  project.updatedAt = Date.now();
  await putProject(project);
  state.projects = sortProjects(
    state.projects.filter((item) => item.id !== project.id).concat(project),
  );
  renderConversationList();
}
function sortProjects(items) {
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

/** 把历史上没有 projectId 的对话归入默认项目，保证升级不丢数据。 */
async function migrateConversationsToProjects() {
  const orphans = state.conversations.filter((item) => !item.projectId);
  if (!orphans.length) return;

  let fallback = state.projects.find((item) => item.title === DEFAULT_PROJECT_TITLE);
  if (!fallback) {
    fallback = createProject(DEFAULT_PROJECT_TITLE);
    await putProject(fallback);
    state.projects.push(fallback);
  }

  await Promise.all(
    orphans.map((conversation) => {
      conversation.projectId = fallback.id;
      return putConversation(conversation);
    }),
  );
  state.projects = sortProjects(state.projects);
}

async function recoverInterruptedGenerations() {
  const interrupted = [];
  state.conversations.forEach((conversation) => {
    conversation.messages?.forEach((message) => {
      if (message.role === "generation" && message.status === "loading") {
        message.status = "error";
        message.error = "页面刷新导致这次生成中断，请重新生成。";
        message.completedAt = Date.now();
        message.unread = false;
        interrupted.push(conversation);
      }
    });
  });
  await Promise.all(
    [...new Set(interrupted)].map((conversation) =>
      saveConversation(conversation, { touchUpdatedAt: false }),
    ),
  );
}

function activeProject() {
  return state.projects.find((item) => item.id === state.activeProjectId) || null;
}
/** 当前项目下的会话；没有选中项目时返回全部（便于搜索场景）。 */
function conversationsInProject(projectId) {
  return state.conversations.filter((item) => item.projectId === projectId);
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
function generatedFileName(message, index) {
  // 统一下载命名：模型-时间戳-序号，避免不同入口（角标/预览）命名不一致。
  const stamp = new Date(message?.createdAt || Date.now())
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `gpt-image-2-${stamp}-${index + 1}.png`;
}

function appendSplitGridAccordion(card, message) {
  // 兼容旧数据中的单次拆分结果，同时保留新版多次拆分历史。
  const splitHistory = Array.isArray(message.splitHistory)
    ? message.splitHistory.filter((item) => item?.images?.length)
    : [];
  if (
    !splitHistory.length &&
    Array.isArray(message.splitImages) &&
    message.splitImages.length
  ) {
    splitHistory.push({
      id: `split-legacy-${message.id || "result"}`,
      createdAt: message.splitCreatedAt || message.createdAt || Date.now(),
      images: message.splitImages,
    });
  }
  if (!splitHistory.length) return;

  const section = document.createElement("section");
  section.className = "split-grid-accordion";
  const latestId = splitHistory.at(-1)?.id;

  splitHistory.forEach((splitResult, resultIndex) => {
    const isOpen = splitResult.id === message.activeSplitId || (
      message.activeSplitId == null && splitResult.id === latestId
    );
    const itemId = `split-grid-item-${message.id || "result"}-${resultIndex + 1}`;
    const item = document.createElement("div");
    item.className = "split-grid-item";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "split-grid-toggle";
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-controls", itemId);
    toggle.innerHTML =
      '<span>宫格拆分结果</span><i data-lucide="chevron-down" aria-hidden="true"></i>';

    const panel = document.createElement("div");
    panel.className = "split-grid-panel";
    panel.id = itemId;
    const content = document.createElement("div");
    content.className = "split-grid-content";
    panel.append(content);

    const setPanelHeight = (height = null) => {
      if (height === null) {
        panel.style.removeProperty("height");
        panel.classList.add("expanded");
        panel.classList.remove("collapsed");
        return;
      }
      panel.style.height = `${height}px`;
      panel.classList.add("collapsed");
      panel.classList.remove("expanded");
    };

    const setExpanded = (expanded) => {
      toggle.setAttribute("aria-expanded", String(expanded));
      item.dataset.splitOpen = String(expanded);
      if (expanded) {
        setPanelHeight(panel.scrollHeight);
        // 先强制浏览器记录当前高度，再切回自适应高度，确保展开动画生效。
        void panel.offsetHeight;
        requestAnimationFrame(() => setPanelHeight());
      } else {
        setPanelHeight(panel.scrollHeight);
        requestAnimationFrame(() => setPanelHeight(0));
      }
    };

    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      setExpanded(!expanded);
    });
    panel.addEventListener("transitionend", (event) => {
      if (event.target !== panel || event.propertyName !== "height") return;
      if (toggle.getAttribute("aria-expanded") === "true") setPanelHeight();
    });
    content.querySelectorAll("img").forEach((img) => {
      // Data URL 加载很快，但仍可能在动画期间完成；同步高度避免临时裁切。
      img.addEventListener("load", () => {
        if (toggle.getAttribute("aria-expanded") === "true") setPanelHeight();
      });
    });

    const createdAt = new Date(splitResult.createdAt || Date.now());
    const timeText = createdAt.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const toggleLabel = toggle.querySelector("span");
    toggleLabel.textContent = `第 ${resultIndex + 1} 次拆分 · ${timeText} · ${splitResult.images.length} 张`;
    const splitImages = document.createElement("div");
    splitImages.className = "generation-images split-grid-images";
    splitResult.images.forEach((image, splitIndex) => {
      const wrap = document.createElement("div");
      wrap.className = "generated-image-wrap split-image-wrap";
      const img = document.createElement("img");
      img.src = image.dataUrl;
      img.alt = `第 ${resultIndex + 1} 次拆分结果 ${splitIndex + 1}`;
      bindImagePreview(
        wrap,
        () =>
          splitResult.images.map((item, itemIndex) => ({
            src: item.dataUrl,
            alt: `拆分结果 ${itemIndex + 1}`,
            caption: `第 ${resultIndex + 1} 次拆分结果 ${itemIndex + 1} / ${splitResult.images.length}`,
            downloadName: item.name || `grid-split-${itemIndex + 1}.jpg`,
          })),
        () => splitIndex,
      );
      const useAsReference = document.createElement("button");
      useAsReference.type = "button";
      useAsReference.className = "generated-use-reference split-use-reference";
      useAsReference.setAttribute(
        "aria-label",
        `第 ${resultIndex + 1} 次拆分图片 ${splitIndex + 1} 用作参考图`,
      );
      useAsReference.title = "用作参考图";
      useAsReference.innerHTML =
        '<i data-lucide="image-plus" aria-hidden="true"></i>';
      useAsReference.addEventListener("click", (event) => {
        // 防止点击事件冒泡到拆分图容器，避免误触发图片灯箱预览。
        event.stopPropagation();
        useSplitImageAsReference(image, splitIndex);
      });
      const addAsset = document.createElement("button");
      addAsset.type = "button";
      addAsset.className = "generated-add-asset";
      addAsset.setAttribute(
        "aria-label",
        `第 ${resultIndex + 1} 次拆分图片 ${splitIndex + 1} 添加到资产库`,
      );
      addAsset.title = "添加到资产库";
      addAsset.innerHTML = `<svg class="generated-add-asset-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7.5h16v12H4zM6 4.5h12l2 3H4l2-3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M12 11v5M9.5 13.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
      addAsset.addEventListener("click", (event) => {
        event.stopPropagation();
        openAssetModal({
          mode: "generation",
          image: {
            dataUrl: image.dataUrl,
            name: image.name || `grid-split-${splitIndex + 1}.jpg`,
          },
          source: {
            type: "generation-split",
            conversationId: state.activeConversationId,
            messageId: message.id,
          },
        });
      });
      const download = document.createElement("a");
      download.className = "generated-download split-download";
      download.href = image.dataUrl;
      download.download = image.name || `grid-split-${splitIndex + 1}.jpg`;
      download.setAttribute("aria-label", `下载拆分图片 ${splitIndex + 1}`);
      download.title = `下载拆分图片 ${splitIndex + 1}`;
      download.innerHTML = '<i data-lucide="download" aria-hidden="true"></i>';
      wrap.append(img, useAsReference, addAsset, download);
      splitImages.append(wrap);
    });
    content.append(splitImages);
    item.append(toggle, panel);
    if (isOpen) {
      item.dataset.splitOpen = "true";
      panel.classList.add("expanded");
    } else {
      item.dataset.splitOpen = "false";
      panel.classList.add("collapsed");
      panel.style.height = "0px";
    }
    section.append(item);
  });

  card.append(section);
  refreshIcons();
}

function appendGenerationActions(card, message) {
  const actions = document.createElement("div");
  actions.className = "generation-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "generation-action";
  edit.innerHTML =
    '<i data-lucide="wand-sparkles" aria-hidden="true"></i><span>重新编辑</span>';
  edit.addEventListener("click", () => editMessage(message));
  const regenerate = document.createElement("button");
  regenerate.type = "button";
  regenerate.className = "generation-action";
  regenerate.innerHTML =
    '<i data-lucide="refresh-cw" aria-hidden="true"></i><span>再次生成</span>';
  regenerate.addEventListener("click", () => regenerateMessage(message));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "generation-action danger";
  remove.innerHTML =
    '<i data-lucide="trash-2" aria-hidden="true"></i><span>删除图片</span>';
  remove.addEventListener("click", () =>
    askConfirm(
      "删除这次生成的图片？",
      "这条提示词记录也会一并移除，且无法恢复。",
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

function setWorkspaceView(view) {
  state.workspaceView = view === "assets" ? "assets" : "conversation";
  const assets = state.workspaceView === "assets";
  const headingKicker = document.querySelector(".heading-kicker");
  if (headingKicker) headingKicker.textContent = assets ? "LOCAL ARCHIVE / ASSETS" : "IMAGE LAB / CHAT";
  if (assets) els.conversationTitle.textContent = "资产库";
  else if (state.activeConversationId) els.conversationTitle.textContent = state.conversations.find((item) => item.id === state.activeConversationId)?.title || "新建对话";
  els.conversationStage.classList.toggle("hidden", assets);
  els.composerWrap.classList.toggle("hidden", assets);
  els.assetStage.classList.toggle("hidden", !assets);
  els.conversationNav?.classList.toggle("active", !assets);
  els.assetNav?.classList.toggle("active", assets);
  els.conversationNav?.setAttribute("aria-current", assets ? "false" : "page");
  els.assetNav?.setAttribute("aria-current", assets ? "page" : "false");
  if (assets) renderAssetStage();
}
function renderAssetStage() {
  if (!els.assetSections) return;
  const activeCategory = ASSET_CATEGORIES.some((category) => category.id === state.assetCategoryTab)
    ? state.assetCategoryTab
    : ASSET_CATEGORIES[0].id;
  state.assetCategoryTab = activeCategory;
  if (els.assetTabs) {
    const track = els.assetTabs.querySelector(".asset-tabs-track");
    els.assetTabs.replaceChildren();
    ASSET_CATEGORIES.forEach((category) => {
      const count = state.assets.filter((asset) => asset.category === category.id).length;
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `asset-tab${category.id === activeCategory ? " active" : ""}`;
      tab.dataset.category = category.id;
      tab.id = `asset-tab-${category.id}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(category.id === activeCategory));
      tab.setAttribute("aria-controls", `asset-panel-${category.id}`);
      tab.innerHTML = `<span class="asset-tab-index">0${ASSET_CATEGORIES.indexOf(category) + 1}</span><span class="asset-tab-icon" aria-hidden="true"><i data-lucide="${category.icon}"></i></span><span class="asset-tab-label">${category.label}</span><span class="asset-tab-count">${count}</span>`;
      tab.addEventListener("click", () => {
        if (state.assetCategoryTab === category.id) return;
        state.assetCategoryTab = category.id;
        renderAssetStage();
      });
      els.assetTabs.append(tab);
    });
    if (track) els.assetTabs.append(track);
  }
  els.assetSections.replaceChildren();
  const category = ASSET_CATEGORIES.find((item) => item.id === activeCategory);
  if (category) {
    const section = document.createElement("section");
    section.className = "asset-section asset-section-active";
    section.dataset.category = category.id;
    section.id = `asset-panel-${category.id}`;
    section.setAttribute("role", "tabpanel");
    section.setAttribute("aria-labelledby", `asset-tab-${category.id}`);
    const head = document.createElement("header");
    head.className = "asset-section-head";
    head.innerHTML = `<div><span class="asset-kicker">${category.english}</span><h3>${category.label}</h3></div><span>${state.assets.filter((asset) => asset.category === category.id).length} ITEMS</span>`;
    const grid = document.createElement("div"); grid.className = "asset-grid";
    const upload = document.createElement("button"); upload.type = "button"; upload.className = "asset-upload-card";
    upload.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i><strong>上传资产</strong><small>从本地图片开始</small>';
    upload.addEventListener("click", () => openAssetModal({ category: category.id }));
    grid.append(upload);
    state.assets.filter((asset) => asset.category === category.id).forEach((asset) => grid.append(renderAssetCard(asset)));
    section.append(head, grid); els.assetSections.append(section);
  }
  refreshIcons();
}
function renderAssetCard(asset) {
  const card = document.createElement("article"); card.className = "asset-card";
  const image = document.createElement("img"); image.className = "asset-card-image"; image.src = asset.dataUrl || ""; image.alt = asset.title || "资产";
  const meta = document.createElement("div"); meta.className = "asset-card-meta";
  const title = document.createElement("h4"); title.textContent = asset.title || "未命名资产";
  const source = document.createElement("small"); source.textContent = asset.source?.type === "generation" ? "对话生成 · 独立副本" : "本地上传";
  meta.append(title, source);
  const actions = document.createElement("div"); actions.className = "asset-card-actions";
  const rename = document.createElement("button"); rename.type = "button"; rename.innerHTML = '<i data-lucide="pencil" aria-hidden="true"></i><span class="asset-action-label">重命名</span>'; rename.title = "重命名"; rename.setAttribute("aria-label", `重命名 ${asset.title}`);
  rename.addEventListener("click", async () => { const next = window.prompt("新的资产名称", asset.title); if (!next?.trim()) return; asset.title = uniqueAssetTitle(next, asset.id); asset.name = asset.title; asset.updatedAt = Date.now(); await putAsset(asset); state.assets = sortAssets(state.assets); renderAssetStage(); updateAssetTotal(); });
  const del = document.createElement("button"); del.type = "button"; del.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i><span class="asset-action-label">删除</span>'; del.title = "删除资产"; del.setAttribute("aria-label", `删除 ${asset.title}`);
  del.addEventListener("click", () => askConfirm("删除这项资产？", "对话中的已插入 Tag 会保留图片快照。", async () => { await deleteAssetFromDb(asset.id); state.assets = state.assets.filter((item) => item.id !== asset.id); renderAssetStage(); updateAssetTotal(); }));
  actions.append(rename, del); card.append(image, meta, actions); return card;
}
function updateAssetTotal() { if (els.assetTotal) els.assetTotal.textContent = `${state.assets.length} 项资产`; }
function openAssetModal(options = {}) {
  state.assetModalMode = options.mode || "upload"; state.assetModalCategory = options.category || "character"; state.assetModalImage = options.image || null; state.assetModalSource = options.source || null;
  els.assetCategoryInput.value = state.assetModalCategory; els.assetModalCategory.textContent = `${assetCategory(state.assetModalCategory).english} / ${state.assetModalMode === "generation" ? "FROM CONVERSATION" : "LOCAL ASSET"}`;
  els.assetNameInput.value = state.assetModalImage?.name || "";
  els.assetFileSelected.classList.toggle("hidden", !state.assetModalImage); els.assetFilePicker.classList.toggle("hidden", Boolean(state.assetModalImage));
  if (state.assetModalImage) { els.assetFilePreview.src = state.assetModalImage.dataUrl; els.assetFileName.textContent = state.assetModalImage.name || "生成图片"; }
  els.assetModal.classList.remove("hidden"); els.assetNameInput.focus();
}
function closeAssetModal() { els.assetModal.classList.add("hidden"); state.assetModalImage = null; state.assetModalSource = null; }
async function handleAssetFile(file) { if (!file?.type?.startsWith("image/")) return showToast("请选择图片文件", "error"); const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file); }); state.assetModalImage = { dataUrl, name: file.name }; els.assetFilePreview.src = dataUrl; els.assetFileName.textContent = file.name; els.assetFileSelected.classList.remove("hidden"); els.assetFilePicker.classList.add("hidden"); if (!els.assetNameInput.value) els.assetNameInput.value = file.name.replace(/\.[^.]+$/, ""); }
async function saveAssetFromModal() { if (!state.assetModalImage?.dataUrl) return showToast("请先选择图片", "error"); const title = uniqueAssetTitle(els.assetNameInput.value); const category = els.assetCategoryInput.value; const now = Date.now(); const asset = { id: uid("asset"), title, name: title, category, dataUrl: state.assetModalImage.dataUrl, source: state.assetModalSource || { type: "upload" }, createdAt: now, updatedAt: now }; await putAsset(asset); state.assets = sortAssets([...state.assets, asset]); closeAssetModal(); renderAssetStage(); updateAssetTotal(); showToast(`已添加资产「${title}」`); }
function renderAssetPicker() { const list = state.assets.filter((asset) => state.assetPickerFilter === "all" || asset.category === state.assetPickerFilter); els.assetPickerGrid.replaceChildren(); if (!list.length) { els.assetPickerGrid.innerHTML = '<p class="asset-picker-empty">还没有资产，先去资产页上传一项。</p>'; return; } list.forEach((asset) => { const button = document.createElement("button"); button.type = "button"; button.className = "asset-picker-item"; button.innerHTML = `<img src="${asset.dataUrl}" alt=""><span>${escapeHtml(asset.title)}</span>`; button.addEventListener("click", () => { insertAssetMention(asset); closeAssetPicker(); }); els.assetPickerGrid.append(button); }); refreshIcons(); }
function openAssetPicker() { state.assetPickerFilter = "all"; els.assetPickerModal.classList.remove("hidden"); renderAssetPicker(); }
function closeAssetPicker() { els.assetPickerModal.classList.add("hidden"); els.prompt.focus(); }

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
  if (ratio === "original" && !totalReferenceCount()) {
    showToast("请先上传原图，再使用原图比例", "error");
    return;
  }
  // 特殊模式只支持白名单比例；被禁用的比例不生效，回退到该模式的默认比例。
  const allowedRatios = MODE_ALLOWED_RATIOS[state.mode];
  if (allowedRatios && !allowedRatios.includes(ratio)) {
    ratio = allowedRatios[0];
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
  if (state.mode === "sceneMultiView") return "sceneMultiView";
  return totalReferenceCount() ? "edit" : "generate";
}
function getPromptPlaceholder() {
  return SINGLE_REFERENCE_MODES.includes(state.mode)
    ? PROMPT_PLACEHOLDERS.singleReference
    : PROMPT_PLACEHOLDERS.default;
}
function syncPromptPlaceholder() {
  els.prompt.dataset.placeholder = getPromptPlaceholder();
}
function setMode(mode) {
  const nextMode = ["mask", ...SINGLE_REFERENCE_MODES].includes(mode)
    ? mode
    : "default";
  if (nextMode !== "mask" && state.maskEditorOpen) closeMaskEditor();
  state.mode = nextMode;
  const originalRatio = document.querySelector('[data-ratio="original"]');
  originalRatio?.classList.toggle("hidden", nextMode !== "mask");
  // 模式切换后同步比例按钮的禁用状态；特殊模式下若当前比例不可用则回退默认比例。
  const allowedRatios = MODE_ALLOWED_RATIOS[nextMode];
  document.querySelectorAll(".ratio-option").forEach((button) => {
    const disabledRatio =
      Boolean(allowedRatios) &&
      !allowedRatios.includes(button.dataset.ratio);
    button.disabled = disabledRatio;
    button.setAttribute("aria-disabled", String(disabledRatio));
  });
  if (nextMode !== "mask" && state.ratio === "original") {
    setRatio("1:1");
  }
  if (allowedRatios && !allowedRatios.includes(state.ratio)) {
    setRatio(allowedRatios[0]);
  }
  els.modeLabel.textContent = modeLabels[nextMode];
  syncPromptPlaceholder();
  els.fidelityField.classList.toggle(
    "hidden",
    getEffectiveGenerationMode() === "generate",
  );
  els.maskEditor.classList.toggle(
    "hidden",
    nextMode !== "mask" || !totalReferenceCount(),
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
  const total = totalReferenceCount();
  if (SINGLE_REFERENCE_MODES.includes(state.mode)) {
    els.sourceMeta.textContent = `${total} / 1 张参考图`;
    return;
  }
  els.sourceMeta.textContent = total
    ? `${total} / ${MAX_SOURCE_FILES} 张参考图`
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
  const incomingCount = totalReferenceCount() + incoming.length;
  if (
    SINGLE_REFERENCE_MODES.includes(state.mode) &&
    incomingCount > 1
  ) {
    showToast(`${modeLabels[state.mode]}只能保留 1 张参考图（包含资产），请删除多余引用`, "error");
    return;
  }
  const slots = Math.max(0, MAX_SOURCE_FILES - totalReferenceCount());
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

function createConversation(projectId = state.activeProjectId) {
  return {
    id: uid("conversation"),
    title: "新建对话",
    projectId,
    pinned: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}
async function saveConversation(conversation, options = {}) {
  if (!conversation?.id) return;
  const touchUpdatedAt = options.touchUpdatedAt !== false;
  const previous = state.conversationSaveQueues.get(conversation.id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      if (touchUpdatedAt) conversation.updatedAt = Date.now();
      await putConversation(conversation);
      state.conversations = sortConversations(
        state.conversations
          .filter((item) => item.id !== conversation.id)
          .concat(conversation),
      );
      renderConversationList();
    });
  state.conversationSaveQueues.set(conversation.id, next);
  try {
    await next;
  } finally {
    if (state.conversationSaveQueues.get(conversation.id) === next)
      state.conversationSaveQueues.delete(conversation.id);
  }
}

function conversationActivity(conversation) {
  const messages = conversation?.messages || [];
  return {
    loading: messages.some(
      (message) => message.role === "generation" && message.status === "loading",
    ),
    unread: messages.some(
      (message) =>
        message.role === "generation" &&
        message.status === "done" &&
        message.unread === true,
    ),
  };
}

function projectActivity(projectId) {
  return state.conversations
    .filter((conversation) => conversation.projectId === projectId)
    .reduce(
      (activity, conversation) => {
        const current = conversationActivity(conversation);
        activity.loading ||= current.loading;
        activity.unread ||= current.unread;
        return activity;
      },
      { loading: false, unread: false },
    );
}

function appendActivityIndicator(parent, activity, { hidden = false } = {}) {
  if (hidden || (!activity.loading && !activity.unread)) return null;
  const indicator = document.createElement("span");
  indicator.className = `activity-indicator ${activity.loading ? "loading" : "unread"}`;
  indicator.setAttribute("aria-label", activity.loading ? "正在生成图片" : "有新的生成结果");
  indicator.title = activity.loading ? "正在生成图片" : "有新的生成结果";
  if (parent) parent.append(indicator);
  return indicator;
}

/** 把一组对话渲染进指定容器；侧栏里每个项目分组共用这一份构建逻辑。 */
function renderConversationItems(container, conversations) {
  document.querySelectorAll(".conversation-menu").forEach((menu) => menu.remove());
  container.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.className = "conversation-list-empty";
    empty.textContent = "这个项目还没有对话。";
    container.append(empty);
    return;
  }
  conversations.forEach((conversation) => {
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
    const activityIndicator = appendActivityIndicator(null, conversationActivity(conversation));
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
      if (willOpen) {
        // 弹层挂在 body 上，避免会话列表的 overflow 把它纳入滚动溢出。
        const triggerRect = trigger.getBoundingClientRect();
        const x = Math.max(8, triggerRect.right - menu.offsetWidth);
        const y = Math.min(
          window.innerHeight - menu.offsetHeight - 8,
          triggerRect.bottom + 6,
        );
        menu.style.setProperty("--conversation-menu-x", `${Math.round(x)}px`);
        menu.style.setProperty("--conversation-menu-y", `${Math.round(y)}px`);
        document.body.append(menu);
      }
      menu.classList.toggle("hidden", !willOpen);
      item.classList.toggle("menu-open", willOpen);
    });
    menu.append(pin, rename, del);
    item.append(...[leading, title, time, activityIndicator, trigger, menu].filter(Boolean));
    item.addEventListener("click", () => {
      closeAllMenus();
      openConversation(conversation.id);
      closeMobileHistory();
    });
    // 对话可拖拽到上方任意项目，完成跨项目移动（触屏不支持，属预期）。
    item.draggable = true;
    item.addEventListener("dragstart", (event) => {
      closeAllMenus();
      event.dataTransfer.setData(CONVERSATION_DRAG_TYPE, conversation.id);
      event.dataTransfer.effectAllowed = "move";
      item.classList.add("dragging");
    });
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      document
        .querySelectorAll(".project-item.drop-target")
        .forEach((target) => target.classList.remove("drop-target"));
    });
    item.addEventListener("keydown", (event) => {
      if (event.target !== item) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        item.click();
      }
    });
    container.append(item);
  });
}

/**
 * 侧栏渲染入口：对话已经内嵌进各自的项目分组，不再有独立的「对话记录」栏，
 * 所以这里等价于重渲染一次项目列表。保留函数名，既有调用点无需改动。
 */
function renderConversationList() {
  renderProjectList();
}

/* ---------------------------------------------------------------- 项目 UI */
/** 只渲染项目列表本身，不回头调用 renderConversationList，避免递归。 */
function renderProjectList() {
  if (!els.projectList) return;
  document.querySelectorAll(".project-menu").forEach((menu) => menu.remove());
  els.projectList.replaceChildren();
  if (els.projectTotal) els.projectTotal.textContent = state.projects.length;
  if (!state.projects.length) {
    // 项目列表允许为空（不再自动创建「默认项目」），给一行淡提示收住版面。
    const empty = document.createElement("p");
    empty.className = "project-list-empty";
    empty.textContent = "还没有项目";
    els.projectList.append(empty);
    updateProjectPill();
    refreshIcons();
    return;
  }
  state.projects.forEach((project) => {
    const item = document.createElement("div");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.className = `project-item${project.id === state.activeProjectId ? " active" : ""}`;
    item.dataset.id = project.id;
    item.setAttribute("aria-label", `切换到项目：${project.title}`);
    const expanded = project.id === state.activeProjectId;
    // 只有当前激活项目展开，箭头方向表示它下面有没有摊开对话。
    const caret = document.createElement("span");
    caret.className = "project-item-caret";
    caret.innerHTML = `<i data-lucide="${expanded ? "chevron-down" : "chevron-right"}" aria-hidden="true"></i>`;
    const icon = document.createElement("span");
    icon.className = "project-item-icon";
    icon.innerHTML = `<i data-lucide="${expanded ? "folder-open" : "folder"}" aria-hidden="true"></i>`;
    const title = document.createElement("span");
    title.className = "project-item-title";
    title.textContent = project.title;
    const count = document.createElement("span");
    count.className = "project-item-count";
    count.textContent = String(conversationsInProject(project.id).length);
    // 当前项目的生成状态由其下的对话行展示；未激活项目才在项目行显示状态。
    const activityIndicator = appendActivityIndicator(null, projectActivity(project.id), {
      hidden: expanded,
    });
    const trigger = document.createElement("button");
    trigger.className = "project-menu-trigger";
    trigger.type = "button";
    trigger.innerHTML = '<i data-lucide="ellipsis" aria-hidden="true"></i>';
    trigger.setAttribute("aria-label", "项目操作");
    const menu = document.createElement("div");
    menu.className = "project-menu hidden";
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "重命名项目";
    rename.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.classList.add("hidden");
      const next = window.prompt("输入新的项目名称", project.title);
      if (!next?.trim()) return;
      project.title = next.trim().slice(0, 40);
      saveProject(project);
    });
    const addChat = document.createElement("button");
    addChat.type = "button";
    addChat.textContent = "在此项目新建对话";
    addChat.addEventListener("click", async (event) => {
      event.stopPropagation();
      menu.classList.add("hidden");
      state.activeProjectId = project.id;
      await openNewConversation();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "delete-option";
    del.textContent = "删除项目";
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.classList.add("hidden");
      deleteProject(project.id);
    });
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      document.querySelectorAll(".project-menu").forEach((other) => {
        if (other !== menu) other.classList.add("hidden");
      });
      const willOpen = menu.classList.contains("hidden");
      if (willOpen) {
        // 弹层挂在 body 上，避免项目列表的 overflow 把它纳入滚动溢出。
        const triggerRect = trigger.getBoundingClientRect();
        const x = Math.max(8, triggerRect.right - menu.offsetWidth);
        const y = Math.min(
          window.innerHeight - menu.offsetHeight - 8,
          triggerRect.bottom + 6,
        );
        menu.style.setProperty("--project-menu-x", `${Math.round(x)}px`);
        menu.style.setProperty("--project-menu-y", `${Math.round(y)}px`);
        document.body.append(menu);
      }
      menu.classList.toggle("hidden", !willOpen);
      item.classList.toggle("menu-open", willOpen);
    });
    menu.append(rename, addChat, del);
    item.append(...[caret, icon, title, count, activityIndicator, trigger, menu].filter(Boolean));
    item.addEventListener("click", () => {
      closeAllMenus();
      selectProject(project.id);
      closeMobileHistory();
    });
    // 作为对话拖拽的落点：悬停高亮，松手后把对话移入该项目。
    item.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer.types).includes(CONVERSATION_DRAG_TYPE))
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      item.classList.add("drop-target");
    });
    item.addEventListener("dragleave", (event) => {
      // 鼠标在行内子元素之间移动也会触发 dragleave，只有真正离开整行才取消高亮。
      if (item.contains(event.relatedTarget)) return;
      item.classList.remove("drop-target");
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("drop-target");
      const conversationId = event.dataTransfer.getData(CONVERSATION_DRAG_TYPE);
      moveConversationToProject(conversationId, project.id);
    });
    item.addEventListener("keydown", (event) => {
      if (event.target !== item) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        item.click();
      }
    });
    els.projectList.append(item);
    // 当前激活项目展开：它的对话就缩进列在项目行下面，其余项目保持折叠。
    if (!expanded) return;
    const group = document.createElement("div");
    group.className = "project-conversations";
    group.dataset.projectId = project.id;
    // 分组空白区同样接受对话拖入，避免只有项目行一条窄缝能接住。
    group.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer.types).includes(CONVERSATION_DRAG_TYPE))
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      group.classList.add("drop-target");
    });
    group.addEventListener("dragleave", (event) => {
      if (group.contains(event.relatedTarget)) return;
      group.classList.remove("drop-target");
    });
    group.addEventListener("drop", (event) => {
      event.preventDefault();
      group.classList.remove("drop-target");
      moveConversationToProject(
        event.dataTransfer.getData(CONVERSATION_DRAG_TYPE),
        project.id,
      );
    });
    renderConversationItems(group, conversationsInProject(project.id));
    els.projectList.append(group);
  });
  updateProjectPill();
  refreshIcons();
}
/** 切换当前项目：刷新对话列表，并在没有对话时给一个空白会话。 */
function selectProject(id) {
  state.activeProjectId = id;
  renderProjectList();
  resetConversationStage();
}
/** 把对话移动到另一个项目：只改归属字段，不动 updatedAt，避免排序跳动。 */
async function moveConversationToProject(conversationId, projectId) {
  const conversation = state.conversations.find(
    (entry) => entry.id === conversationId,
  );
  const project = state.projects.find((entry) => entry.id === projectId);
  if (!conversation || !project) return;
  if (conversation.projectId === projectId) return;
  conversation.projectId = projectId;
  await saveConversation(conversation, { touchUpdatedAt: false });
  // 移动后归属项目的生成状态/计数有变化，顺手刷新一次项目列表。
  renderProjectList();
  showToast(`已移动到「${project.title}」`);
}
/** 删除项目：连同其下所有对话一起清理，最后保证至少留下一个项目。 */
async function deleteProject(id) {
  const project = state.projects.find((entry) => entry.id === id);
  if (!project) return;
  const children = conversationsInProject(id);
  askConfirm(
    `删除项目「${project.title}」？`,
    `该项目下的 ${children.length} 个对话也会一并删除，且无法恢复。`,
    async () => {
      await Promise.all(children.map((item) => deleteConversationFromDb(item.id)));
      await deleteProjectFromDb(id);
      state.conversations = state.conversations.filter(
        (item) => item.projectId !== id,
      );
      state.projects = state.projects.filter((item) => item.id !== id);
      state.activeConversationId = null;
      // 删光了就补回「默认项目」，侧栏永远至少有一个可承载对话的项目。
      await ensureProject();
      renderProjectList();
      openNewConversation();
      showToast("项目已删除");
    },
    true,
  );
}
/**
 * 保证项目永远不为空：空库、或项目被删光时，自动创建「默认项目」。
 * 对话必须挂在项目下面，所以「默认项目」就是这条规则的载体，始终存在。
 */
async function ensureProject() {
  if (!state.projects.length) {
    const project = createProject(DEFAULT_PROJECT_TITLE);
    await putProject(project);
    state.projects = sortProjects([project]);
  }
  if (!activeProject()) state.activeProjectId = state.projects[0].id;
  return activeProject();
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
  document
    .querySelectorAll(".project-menu")
    .forEach((menu) => menu.classList.add("hidden"));
  document
    .querySelectorAll(".project-item.menu-open")
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
/** 把主区域恢复到「空白新对话」，但不影响侧栏与项目选中状态。 */
function resetConversationStage() {
  state.activeConversationId = null;
  // 新草稿默认归属当前激活项目，之后可用项目胶囊改绑。
  state.draftProjectId = state.activeProjectId;
  state.draftProjectTitle = null;
  state.sourceFiles = [];
  state.pendingMentions = [];
  state.pendingAssetMentions = [];
  state.assetMentionRange = null;
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
  updateProjectPill();
  closeMentionPicker();
}
async function openNewConversation() {
  setWorkspaceView("conversation");
  if (!activeProject() && state.projects.length)
    state.activeProjectId = state.projects[0].id;
  closeMobileHistory();
  resetConversationStage();
}
async function openConversation(id) {
  setWorkspaceView("conversation");
  const conversation = state.conversations.find((item) => item.id === id);
  if (!conversation) return;
  // 打开历史对话时同步切到它所属的项目，避免侧栏高亮与内容不一致。
  if (conversation.projectId && conversation.projectId !== state.activeProjectId) {
    state.activeProjectId = conversation.projectId;
    renderProjectList();
  }
  state.activeConversationId = id;
  let hasUnread = false;
  conversation.messages.forEach((message) => {
    if (message.role === "generation" && message.unread === true) {
      message.unread = false;
      hasUnread = true;
    }
  });
  if (hasUnread) await saveConversation(conversation, { touchUpdatedAt: false });
  state.sourceFiles = [];
  state.pendingMentions = [];
  state.pendingAssetMentions = [];
  state.assetMentionRange = null;
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
async function ensureConversation(prompt) {
  if (state.activeConversationId)
    return state.conversations.find(
      (item) => item.id === state.activeConversationId,
    );
  // 草稿以胶囊选定的项目为准；未选过时回退到当前激活项目。
  let targetProjectId = state.draftProjectId || state.activeProjectId;
  // 草稿里打了新项目名：此刻才真正落库，并把项目与会话一起建出来。
  const pendingTitle = (state.draftProjectTitle || "").trim();
  if (pendingTitle) {
    // 恰好有同名项目就直接复用，避免侧栏出现两行同名项目。
    const existing = state.projects.find((item) => item.title === pendingTitle);
    if (existing) {
      targetProjectId = existing.id;
    } else {
      const project = createProject(pendingTitle);
      await putProject(project);
      state.projects = sortProjects(state.projects.concat(project));
      targetProjectId = project.id;
      showToast(`已创建项目「${project.title}」`);
    }
    state.draftProjectTitle = null;
  }
  // 项目理论上永不为空；真碰到空库（首次启动）就补一个「默认项目」。
  if (!targetProjectId) targetProjectId = (await ensureProject()).id;
  const conversation = createConversation(targetProjectId);
  conversation.title = titleFromPrompt(prompt);
  state.activeConversationId = conversation.id;
  state.conversations.push(conversation);
  // 首条消息发出后，侧栏正式切到对话所属项目，保证列表里能立刻看到它。
  if (targetProjectId && targetProjectId !== state.activeProjectId) {
    state.activeProjectId = targetProjectId;
    renderProjectList();
  }
  // 草稿阶段结束：归属已落定，把草稿指针同步到真实项目，胶囊才不会继续指向旧项目。
  state.draftProjectId = targetProjectId;
  updateProjectPill();
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
  // 模型是每条生成消息的请求快照，不能使用当前选择值或硬编码名称；否则历史记录会失真。
  const model = message.model || ACTIVE_IMAGE_MODEL;
  details.innerHTML = `<span>${escapeHtml(model)}</span><i></i><span>${modeLabels[message.mode] || "图片生成"}</span><i></i><strong>${escapeHtml(message.ratio || "1:1")}</strong><i></i><strong>${escapeHtml(message.size || "1024x1024")}</strong><i></i><span>${escapeHtml(message.resolution || "1K")}</span>`;
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
    appendGenerationActions(card, message);
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
            downloadName: generatedFileName(message, itemIndex),
          })),
        () => index,
      );
      const useAsReference = document.createElement("button");
      useAsReference.type = "button";
      useAsReference.className = "generated-use-reference";
      useAsReference.setAttribute("aria-label", `用作参考图 ${index + 1}`);
      useAsReference.title = "用作参考图";
      useAsReference.innerHTML = '<i data-lucide="image-plus" aria-hidden="true"></i>';
      useAsReference.addEventListener("click", (event) => {
        // 防止点击事件冒泡到生成图容器，避免误触发图片灯箱预览。
        event.stopPropagation();
        useGeneratedImageAsReference(message, index, image);
      });
      const addAsset = document.createElement("button");
      addAsset.type = "button";
      addAsset.className = "generated-add-asset";
      addAsset.setAttribute("aria-label", `添加图片 ${index + 1} 到资产库`);
      addAsset.title = "添加到资产库";
      addAsset.innerHTML = `<svg class="generated-add-asset-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7.5h16v12H4zM6 4.5h12l2 3H4l2-3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M12 11v5M9.5 13.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>`;
      addAsset.addEventListener("click", (event) => {
        event.stopPropagation();
        openAssetModal({
          mode: "generation",
          image: { dataUrl: image.dataUrl, name: generatedFileName(message, index) },
          source: {
            type: "generation",
            conversationId: state.activeConversationId,
            messageId: message.id,
          },
        });
      });
      const download = document.createElement("a");
      download.className = "generated-download";
      download.href = image.dataUrl;
      download.download = generatedFileName(message, index);
      download.setAttribute("aria-label", `下载图片 ${index + 1}`);
      download.title = `下载图片 ${index + 1}`;
      download.innerHTML = '<i data-lucide="download" aria-hidden="true"></i>';
      const splitGrid = document.createElement("button");
      splitGrid.type = "button";
      splitGrid.className = "generated-split-grid";
      splitGrid.setAttribute("aria-label", `宫格图拆分 ${index + 1}`);
      splitGrid.title = "宫格图拆分";
      splitGrid.innerHTML = '<i data-lucide="grid-2X2" aria-hidden="true"></i>';
      splitGrid.addEventListener("click", (event) => {
        event.stopPropagation();
        splitGeneratedGrid(message, index, image, splitGrid);
      });
      wrap.append(img, useAsReference, addAsset, splitGrid, download);
      images.append(wrap);
    });
    card.append(images);
    appendSplitGridAccordion(card, message);
    appendGenerationActions(card, message);
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
  const refs = state.sourceFiles.map((file, index) => ({
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
  uniqueAssetMentions().forEach((mention, index) => refs.push({
    dataUrl: mention.dataUrl,
    previewDataUrl: mention.dataUrl,
    name: `资产：${mention.title}`,
    assetId: mention.assetId,
    assetTitle: mention.title,
    index: state.sourceFiles.length + index,
  }));
  return refs;
}
function editMessage(message) {
  state.mode = ["mask", ...SINGLE_REFERENCE_MODES].includes(message.mode)
    ? message.mode
    : "default";
  state.ratio = message.ratio || "1:1";
  state.resolution = message.resolution || "1K";
  state.quality = message.quality || "medium";
  state.count = Number(message.count || 1);
  state.width = Number(message.width || calculateDimensions().width);
  state.height = Number(message.height || calculateDimensions().height);
  const allReferences = message.references || [];
  const referenceAssets = allReferences.filter((reference) => reference.assetId || reference.assetTitle);
  const sourceReferences = allReferences.filter((reference) => !reference.assetId && !reference.assetTitle);
  state.sourceFiles = sourceReferences.map((reference, index) => ({
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
  const restoredAssets = message.assetMentions?.length
    ? message.assetMentions
    : referenceAssets.map((reference) => ({
        assetId: reference.assetId || "",
        title: reference.assetTitle || reference.name || "未命名资产",
        dataUrl: reference.dataUrl || reference.previewDataUrl || "",
      }));
  restoredAssets.forEach((asset) => {
    els.prompt.append(document.createTextNode(" "), createAssetMention(asset));
  });
  syncPendingMentions();
  state.mentionCursor = -1;
  els.prompt.dispatchEvent(new Event("input"));
  els.resolution.value = state.resolution;
  els.quality.value = state.quality;
  els.count.value = String(state.count);
  setMode(state.mode);
  setRatio(state.ratio);
  // “重新编辑 / 再次生成”回填历史参数后，同步特殊模式的禁用状态。
  const allowedRatios = MODE_ALLOWED_RATIOS[state.mode];
  document.querySelectorAll(".ratio-option").forEach((button) => {
    const disabledRatio =
      Boolean(allowedRatios) &&
      !allowedRatios.includes(button.dataset.ratio);
    button.disabled = disabledRatio;
    button.setAttribute("aria-disabled", String(disabledRatio));
  });
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
  if (!state.authenticated) {
    openAuthModal();
    return showToast("请先登录，再开始生成", "error");
  }
  if (state.maskEditorOpen) saveActiveMask();
  syncPendingMentions();
  const referenceCount = totalReferenceCount();
  const rawPrompt = getPromptText(false).trim();
  const effectiveMode = getEffectiveGenerationMode();
  // 角色三视图 / 场景多视角可仅依赖参考图与后端模板生成，提示词改为可选。
  if (!rawPrompt && !SINGLE_REFERENCE_MODES.includes(effectiveMode))
    return showToast("请先输入提示词", "error");
  if (SINGLE_REFERENCE_MODES.includes(effectiveMode) && referenceCount !== 1)
    return showToast(`${modeLabels[effectiveMode]}必须传入 1 张参考图（包含资产）`, "error");
  if ((effectiveMode === "edit" || effectiveMode === "mask") && !state.sourceFiles.length && !state.pendingAssetMentions.length)
    return showToast("请先上传原图", "error");
  if (effectiveMode === "mask" && !state.sourceFiles.some((file) => file.maskDataUrl))
    return showToast("请先编辑并保存至少一个蒙版", "error");
  if (effectiveMode === "mask" && !(await validateMaskSources()))
    return showToast(MASK_EDITABLE_ERROR, "error");
  if (referenceCount > MAX_SOURCE_FILES)
    return showToast(`最多只能使用 ${MAX_SOURCE_FILES} 张参考图（包含资产）`, "error");
  // 特殊单参考图模式的模板由后端拼接（prompts/ 目录是唯一来源），
  // 前端只提交用户自己的描述，因此这里始终用带 @ 引用的完整提示词文本。
  const prompt = getPromptText(true).trim();
  const displayPrompt = rawPrompt;
  const conversation = await ensureConversation(prompt);
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
    inputFidelity: Boolean(els.fidelity.checked),
    mentionIndexes: state.pendingMentions.map((mention) => mention.index),
    assetMentions: state.pendingAssetMentions.map((mention) => ({ ...mention })),
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
    unread: false,
    images: [],
  };
  conversation.messages.push(userMessage, generation);
  await saveConversation(conversation);
  renderMessage(userMessage);
  renderMessage(generation);
  scrollToBottom();
  const taskId = generation.id;
  state.generationTasks.set(taskId, { conversationId: conversation.id, projectId: conversation.projectId });
  renderConversationList();
  runGenerationTask(conversation, generation, settings, effectiveMode).catch((error) => {
    // runGenerationTask 内部已把请求错误写入消息；这里只兜底异步异常。
    console.error("生成任务异常", error);
  });
}

async function runGenerationTask(conversation, generation, settings, effectiveMode) {
  const taskId = generation.id;
  try {
    let response;
    if (effectiveMode === "generate") {
      response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: settings.prompt,
          size: settings.size,
          quality: settings.quality,
          n: settings.count,
          model: settings.model,
        }),
      });
    } else {
      const data = new FormData();
      // 使用提交时的引用快照，切换对话/继续上传不会影响后台任务。
      const sourceFiles = await Promise.all(settings.references.map(toUploadFile));
      sourceFiles.forEach((file) =>
        data.append("image", file, file.name || `image-${Date.now()}.png`),
      );
      Object.entries({
        prompt: settings.prompt,
        size: settings.size,
        quality: settings.quality,
        n: settings.count,
        mode: effectiveMode,
        model: settings.model,
      }).forEach(([key, value]) => data.append(key, value));
      if (settings.inputFidelity) data.append("input_fidelity", "high");
      if (effectiveMode === "mask") {
        const blob = dataUrlBlob(settings.references[0]?.maskDataUrl);
        if (blob) data.append("mask", blob, "mask.png");
        settings.references.slice(1).forEach((source, index) => {
          const extraMask = dataUrlBlob(source.maskDataUrl);
          if (extraMask) data.append("mask[]", extraMask, `mask-${index + 2}.png`);
        });
        data.append(
          "mask_count",
          String(settings.references.filter((source) => source.maskDataUrl).length),
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
    // 用户可能在请求返回前删除了项目/对话；此时不把幽灵结果写回数据库。
    if (!state.conversations.some((item) => item.id === conversation.id)) return;
    generation.status = "done";
    generation.images = result.images || [];
    generation.completedAt = Date.now();
    generation.unread = state.activeConversationId !== conversation.id;
    await saveConversation(conversation);
    if (state.activeConversationId === conversation.id)
      renderConversationMessages(conversation);
  } catch (error) {
    if (!state.conversations.some((item) => item.id === conversation.id)) return;
    if (error.status === 401) {
      setAuthenticated(false);
      openAuthModal();
    }
    generation.status = "error";
    generation.error = error.message;
    generation.completedAt = Date.now();
    generation.unread = state.activeConversationId !== conversation.id;
    await saveConversation(conversation);
    if (state.activeConversationId === conversation.id)
      renderConversationMessages(conversation);
    showToast(error.message, "error");
  } finally {
    state.generationTasks.delete(taskId);
    updateGenerationIndicators();
  }
}

function updateGenerationIndicators() {
  renderConversationList();
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitGeneration();
});
els.conversationNav?.addEventListener("click", () => setWorkspaceView("conversation"));
els.assetNav?.addEventListener("click", () => setWorkspaceView("assets"));
els.assetButton?.addEventListener("pointerdown", () => { state.assetMentionRange = currentPromptRange()?.cloneRange() || state.assetMentionRange; });
els.assetButton?.addEventListener("mousedown", (event) => { event.preventDefault(); state.assetMentionRange = currentPromptRange()?.cloneRange() || state.assetMentionRange; });
els.assetButton?.addEventListener("click", openAssetPicker);
els.assetFilePicker?.addEventListener("click", () => els.assetFileInput.click());
els.assetFileChange?.addEventListener("click", () => els.assetFileInput.click());
els.assetFileInput?.addEventListener("change", (event) => { handleAssetFile(event.target.files?.[0]); event.target.value = ""; });
els.cancelAssetModal?.addEventListener("click", closeAssetModal);
els.closeAssetModal?.addEventListener("click", closeAssetModal);
els.assetModal?.addEventListener("click", (event) => { if (event.target.matches("[data-asset-close]")) closeAssetModal(); });
els.assetForm?.addEventListener("submit", (event) => { event.preventDefault(); saveAssetFromModal(); });
els.closeAssetPicker?.addEventListener("click", closeAssetPicker);
els.assetPickerModal?.addEventListener("click", (event) => { if (event.target.matches("[data-asset-picker-close]")) closeAssetPicker(); });
els.assetFilterTabs?.addEventListener("click", (event) => { const button = event.target.closest("[data-asset-filter]"); if (!button) return; state.assetPickerFilter = button.dataset.assetFilter; els.assetFilterTabs.querySelectorAll("[data-asset-filter]").forEach((item) => { const active = item === button; item.classList.toggle("active", active); item.setAttribute("aria-selected", String(active)); }); renderAssetPicker(); });
els.sourceInput.addEventListener("change", (event) => {
  setSourceFiles(event.target.files);
  els.sourceInput.value = "";
});
els.prompt.addEventListener("paste", (event) => {
  // contenteditable 默认会保留来源应用的 HTML/CSS。某些来源给 span 写了
  // white-space: nowrap，造成文本横向撑开、纵向高度不增长。提示词只需要文本，
  // 因此统一按纯文本插入，保留换行但不继承外部样式。
  const text = event.clipboardData?.getData("text/plain");
  if (text == null) return;
  event.preventDefault();
  insertPlainTextAtCursor(text.replace(/\r\n?/g, "\n"));
  els.prompt.dispatchEvent(new Event("input", { bubbles: true }));
});
els.prompt.addEventListener("input", () => {
  syncPendingMentions();
  const value = getPromptText(false);
  els.promptCount.textContent = `${value.length} / 4000`;
  renderFileMeta();
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
  if (
    !event.target.closest(
      ".conversation-menu, .conversation-menu-trigger, .project-menu, .project-menu-trigger",
    )
  )
    closeAllMenus();
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
  if (
    !els.projectPopover.classList.contains("hidden") &&
    !els.projectPopover.contains(event.target) &&
    !event.target.closest("#projectButton")
  )
    setProjectPopoverOpen(false);
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
  setProjectPopoverOpen(false);
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
      SINGLE_REFERENCE_MODES.includes(button.dataset.mode) &&
      totalReferenceCount() > 1
    ) {
      // Single-reference presets accept either one uploaded image or one
      // asset. Preserve the first reference in the same order used by the
      // request, then remove every additional source/asset reference.
      if (state.sourceFiles.length) {
        state.sourceFiles = [state.sourceFiles[0]];
        els.prompt.querySelectorAll(".inline-mention").forEach((mention) => {
          if (Number(mention.dataset.index) === 0) updateInlineMention(mention, 0);
          else mention.remove();
        });
        els.prompt.querySelectorAll(".asset-mention").forEach((mention) => mention.remove());
      } else {
        const assetMentions = [...els.prompt.querySelectorAll(".asset-mention")];
        assetMentions.slice(1).forEach((mention) => mention.remove());
      }
      syncPendingMentions();
      renderMentionTags();
      showToast(`已为${modeLabels[button.dataset.mode]}保留第一张参考图（包含资产）`);
    }
    setMode(button.dataset.mode);
    if (button.closest(".mode-options"))
      setModePopoverOpen(false);
  }),
);
els.settingsButton.addEventListener("click", () => {
  setModePopoverOpen(false);
  setModelPopoverOpen(false);
  setProjectPopoverOpen(false);
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
  setProjectPopoverOpen(false);
  toggleModelPopover();
});
els.closeModel?.addEventListener("click", () => setModelPopoverOpen(false));
els.modeButton.addEventListener("click", () => {
  setSettingsOpen(false);
  setModelPopoverOpen(false);
  setProjectPopoverOpen(false);
  toggleModePopover();
});
els.projectButton.addEventListener("click", () => {
  setSettingsOpen(false);
  setModePopoverOpen(false);
  setModelPopoverOpen(false);
  toggleProjectPopover();
});
els.closeProject?.addEventListener("click", () => setProjectPopoverOpen(false));
els.projectSearchInput.addEventListener("input", () =>
  renderProjectOptions(els.projectSearchInput.value),
);
els.projectCreateToggle.addEventListener("click", () =>
  setProjectCreateRowVisible(true),
);
els.projectCreateConfirm.addEventListener("click", applyDraftProjectName);
els.projectCreateInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyDraftProjectName();
  } else if (event.key === "Escape") {
    event.stopPropagation();
    setProjectCreateRowVisible(false);
  }
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
// ---------- 项目选择器（新建对话绑定项目，对齐 Codex） ----------
/** 胶囊上显示的是草稿待绑定的项目；打开已有对话时胶囊整体隐藏（见 CSS）。 */
function updateProjectPill() {
  if (!els.projectLabel) return;
  const pending = state.draftProjectTitle;
  const target = pending
    ? null
    : state.projects.find((item) => item.id === state.draftProjectId) ||
      activeProject();
  els.projectLabel.textContent = pending || target?.title || "选择项目";
  // 尚未落库的项目用虚线胶囊区分，鼠标悬停说明它什么时候才会真正创建。
  els.projectButton?.classList.toggle("pending", Boolean(pending));
  if (els.projectButton)
    els.projectButton.title = pending
      ? `「${pending}」将在发出首条消息时创建`
      : "选择或新建项目";
}
function renderProjectOptions(filter = "") {
  if (!els.projectOptions) return;
  const keyword = filter.trim().toLowerCase();
  const list = state.projects.filter(
    (project) => !keyword || project.title.toLowerCase().includes(keyword),
  );
  els.projectOptions.innerHTML = "";
  // 草稿里已经打好名字、但还没落库的项目：置顶展示，让用户知道当前挂在谁名下。
  if (state.draftProjectTitle && !keyword) {
    const pending = document.createElement("div");
    pending.className = "project-option pending";
    pending.innerHTML =
      '<span class="model-option-icon"><i data-lucide="clock"></i></span>' +
      '<span class="model-option-copy">' +
      `<span class="model-option-title">${escapeHtml(state.draftProjectTitle)}</span>` +
      '<span class="model-option-desc">发送消息时创建</span>' +
      "</span>";
    els.projectOptions.appendChild(pending);
  }
  if (!list.length) {
    if (state.draftProjectTitle && !keyword) {
      refreshIcons();
      return;
    }
    const empty = document.createElement("p");
    empty.className = "project-options-empty";
    empty.textContent = keyword ? "没有匹配的项目" : "还没有项目，先新建一个";
    els.projectOptions.appendChild(empty);
    return;
  }
  list.forEach((project) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "model-option project-option" +
      // 挂着待创建项目时不给任何现有项目打勾，避免出现两个「当前项」。
      (!state.draftProjectTitle && project.id === state.draftProjectId
        ? " active"
        : "");
    button.dataset.id = project.id;
    button.innerHTML =
      '<span class="model-option-icon"><i data-lucide="folder"></i></span>' +
      '<span class="model-option-copy">' +
      `<span class="model-option-title">${escapeHtml(project.title)}</span>` +
      `<span class="model-option-desc">${conversationsInProject(project.id).length} 个对话</span>` +
      "</span>" +
      '<span class="model-option-state"><i data-lucide="check"></i></span>';
    button.addEventListener("click", () => {
      // 只改草稿归属，不动侧栏高亮；首条消息发出后才正式切到该项目。
      state.draftProjectId = project.id;
      // 改选了现有项目，之前输入的待创建名字作废。
      state.draftProjectTitle = null;
      updateProjectPill();
      setProjectPopoverOpen(false);
    });
    els.projectOptions.appendChild(button);
  });
  refreshIcons();
}
function setProjectCreateRowVisible(visible) {
  els.projectCreateRow.classList.toggle("hidden", !visible);
  els.projectCreateToggle.classList.toggle("hidden", visible);
  if (visible) {
    // 已经打过草稿名字的话预填，方便改名而不是重打。
    els.projectCreateInput.value = state.draftProjectTitle || "";
    els.projectCreateInput.focus();
    els.projectCreateInput.select();
  }
}
/**
 * 确认草稿项目名：这里只把名字记在 state 上，不落库。
 * 真正的项目记录由 ensureConversation() 在首条消息发出时创建，
 * 所以「输入名字后反悔」不会在侧栏留下空项目。
 */
function applyDraftProjectName() {
  const name = els.projectCreateInput.value.trim();
  if (!name) {
    showToast("请输入项目名称", "error");
    els.projectCreateInput.focus();
    return;
  }
  state.draftProjectTitle = name.slice(0, 40);
  state.draftProjectId = null;
  setProjectCreateRowVisible(false);
  updateProjectPill();
  setProjectPopoverOpen(false);
  showToast(`将创建项目「${state.draftProjectTitle}」，发出消息后生效`);
}
function setProjectPopoverOpen(open) {
  els.projectPopover.classList.toggle("hidden", !open);
  els.projectButton.setAttribute("aria-expanded", String(open));
  if (open) {
    // 草稿未选过项目时跟随当前激活项目。
    if (!state.draftProjectId) state.draftProjectId = state.activeProjectId;
    els.projectSearchInput.value = "";
    setProjectCreateRowVisible(false);
    renderProjectOptions();
    positionProjectPopover();
  }
}
function positionProjectPopover() {
  const rect = els.projectButton.getBoundingClientRect();
  const popup = els.projectPopover;
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
function toggleProjectPopover() {
  setProjectPopoverOpen(els.projectPopover.classList.contains("hidden"));
}
window.addEventListener("resize", () => {
  if (!els.modePopover.classList.contains("hidden")) positionModePopover();
  if (!els.settingsPopover.classList.contains("hidden")) positionSettingsPopover();
  if (!els.modelPopover.classList.contains("hidden")) positionModelPopover();
  if (!els.projectPopover.classList.contains("hidden")) positionProjectPopover();
  closeAllMenus();
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
      "这是最后一步，确认后将永久删除所选内容，且无法恢复。";
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
    // 先恢复项目层，再恢复会话；项目层允许为空，由 ensureProject 补「默认项目」。
    state.projects = sortProjects(await getProjects());
    state.conversations = sortConversations(await getConversations());
    state.assets = sortAssets(await getAssets());
    updateAssetTotal();
    renderAssetStage();
    await recoverInterruptedGenerations();
    await ensureProject();
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
    // 老数据（含上面刚导入的历史记录）统一归入「默认项目」，避免出现无归属对话。
    await migrateConversationsToProjects();
    await ensureProject();
    renderProjectList();
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
