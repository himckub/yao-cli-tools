import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";

const popupSource = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
const popupHtml = readFileSync(new URL("../extension/popup.html", import.meta.url), "utf8");
const uiCss = readFileSync(new URL("../extension/ui.css", import.meta.url), "utf8");

function loadPopup(overrides = {}) {
  const { window } = parseHTML(popupHtml);
  const runtimeMessages = [];
  const tabMessages = [];
  const settings = overrides.settings || { enabled: true, autoTranslate: true, apiKey: "key", blockedDomains: [] };
  window.chrome = {
    runtime: {
      sendMessage(message, callback) {
        runtimeMessages.push(message);
        if (message.type === "TOKTRA_SAVE_SETTINGS") {
          Object.assign(settings, message.settings);
          callback({ ok: true, settings });
          return;
        }
        callback({ ok: true, settings });
      },
      openOptionsPage() {},
      getURL(path) {
        return `chrome-extension://toktra/${path}`;
      }
    },
    tabs: {
      query() {
        return Promise.resolve([{ id: 1, url: overrides.tabUrl || "https://example.com/page" }]);
      },
      create(createProperties, callback) {
        tabMessages.push({ type: "CREATE_TAB", ...createProperties });
        callback?.({ id: 2, url: createProperties.url });
      },
      update(tabId, updateProperties, callback) {
        tabMessages.push({ type: "UPDATE_TAB", tabId, ...updateProperties });
        callback?.({ id: tabId, url: updateProperties.url });
      },
      sendMessage(_tabId, message, callback) {
        tabMessages.push(message);
        callback({ ok: true });
      }
    },
    scripting: {
      executeScript() {
        return Promise.resolve();
      }
    }
  };
  Function("document", "chrome", "globalThis", popupSource)(window.document, window.chrome, window);
  return { popup: window.ToktraPopup, document: window.document, runtimeMessages, tabMessages, settings };
}

function selectValue(document, id, value) {
  const select = document.getElementById(id);
  Object.defineProperty(select, "value", { configurable: true, writable: true, value });
  Array.from(select.options || []).forEach((option) => {
    option.selected = option.value === value;
  });
  return select;
}

function changeEvent(document) {
  return new document.defaultView.Event("change");
}

test("popup only attempts content script injection on normal web pages", () => {
  const { popup } = loadPopup();

  assert.equal(popup.canInjectIntoUrl("https://en.wikipedia.org/wiki/Golden_Bough_(Aeneid)"), true);
  assert.equal(popup.canInjectIntoUrl("http://127.0.0.1:18082"), true);
  assert.equal(popup.canInjectIntoUrl("chrome://extensions"), false);
  assert.equal(popup.canInjectIntoUrl("chrome-extension://abc/popup.html"), false);
});

test("popup converts missing receiver errors into Chinese user-facing messages", () => {
  const { popup } = loadPopup();

  assert.equal(
    popup.describeTabError("Could not establish connection. Receiving end does not exist.", "https://example.com"),
    "当前网页还没有注入 toktra，已尝试重新注入。请稍后再试或刷新页面。"
  );
  assert.equal(
    popup.describeTabError("Could not establish connection. Receiving end does not exist.", "chrome://extensions"),
    "当前页面是 Chrome 或扩展内置页面，浏览器不允许 toktra 注入。请切换到普通网页后再使用。"
  );
});

test("popup quick panel uses compact cards and switch controls", () => {
  const { window } = parseHTML(popupHtml);
  const document = window.document;

  assert.equal(document.querySelector(".quick-panel__title")?.textContent.trim(), "翻译设置");
  assert.equal(document.querySelectorAll(".language-card").length, 2);
  assert.equal(document.querySelector(".model-row select#modelSelect") !== null, true);
  assert.equal(document.querySelectorAll(".switch-row input + .switch-track").length, 2);
  assert.match(uiCss, /\.switch-input:checked\s*\+\s*\.switch-track/);
  assert.match(uiCss, /\.quick-panel__body/);
});

test("popup select controls use aligned custom icons", () => {
  assert.match(uiCss, /\.quick-panel select\s*\{[\s\S]*appearance:\s*none/);
  assert.match(uiCss, /\.quick-panel select\s*\{[\s\S]*background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(uiCss, /\.language-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+32px\s+minmax\(0,\s*1fr\)/);
  assert.match(uiCss, /\.language-arrow::before/);
});

test("popup exposes manual, site auto, and global auto modes", async () => {
  const { document, runtimeMessages, tabMessages, settings } = loadPopup();
  await new Promise((resolve) => setTimeout(resolve, 0));

  document.getElementById("setManualMode").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById("translateNow").textContent, "手动翻译当前页");
  assert.equal(document.getElementById("setManualMode").textContent, "手动模式");
  assert.equal(document.getElementById("setSiteAutoMode").textContent, "仅此网站自动翻译");
  assert.equal(document.getElementById("setGlobalAutoMode").textContent, "所有网站自动翻译");
  assert.equal(runtimeMessages.at(-1).type, "TOKTRA_SAVE_SETTINGS");
  assert.equal(runtimeMessages.at(-1).settings.autoTranslate, false);
  assert.deepEqual(tabMessages.at(-1), { type: "TOKTRA_STOP_TRANSLATION" });
  assert.equal(settings.autoTranslate, false);

  document.getElementById("setSiteAutoMode").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtimeMessages.at(-1).type, "TOKTRA_SAVE_SETTINGS");
  assert.equal(runtimeMessages.at(-1).settings.autoTranslate, true);
  assert.equal(runtimeMessages.at(-1).settings.domainMode, "allowlist");
  assert.deepEqual(runtimeMessages.at(-1).settings.allowDomains, ["example.com"]);

  document.getElementById("setGlobalAutoMode").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtimeMessages.at(-1).settings.autoTranslate, true);
  assert.equal(runtimeMessages.at(-1).settings.domainMode, "all");
});

test("popup quick controls save language, model, precision, and selection settings", async () => {
  const { document, runtimeMessages, settings } = loadPopup({
    settings: {
      enabled: true,
      autoTranslate: true,
      apiKey: "key",
      blockedDomains: [],
      sourceLanguage: "auto",
      targetLanguage: "zh-CN",
      model: "gpt-4.1-mini",
      preciseTranslation: false,
      selectionTranslation: true
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  selectValue(document, "targetLanguage", "zh-TW").dispatchEvent(changeEvent(document));
  await new Promise((resolve) => setTimeout(resolve, 0));

  selectValue(document, "modelSelect", "deepseek-v4-flash").dispatchEvent(changeEvent(document));
  await new Promise((resolve) => setTimeout(resolve, 0));

  document.getElementById("preciseTranslation").checked = true;
  document.getElementById("preciseTranslation").dispatchEvent(changeEvent(document));
  await new Promise((resolve) => setTimeout(resolve, 0));

  document.getElementById("selectionTranslation").checked = false;
  document.getElementById("selectionTranslation").dispatchEvent(changeEvent(document));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(runtimeMessages.at(-1).type, "TOKTRA_SAVE_SETTINGS");
  assert.equal(settings.targetLanguage, "zh-TW");
  assert.equal(settings.model, "deepseek-v4-flash");
  assert.equal(settings.preciseTranslation, true);
  assert.equal(settings.selectionTranslation, false);
});

test("popup explains global disabled state instead of domain disabled state", async () => {
  const { document } = loadPopup({
    settings: { enabled: true, autoTranslate: false, apiKey: "key", blockedDomains: [] }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById("stateBadge").textContent, "手动");
  assert.equal(document.getElementById("message").textContent, "手动模式：页面不会自动翻译，可点击手动翻译或使用划线翻译。");
});

test("manual translate gives an immediate progressive loading message", async () => {
  const { document, tabMessages } = loadPopup({
    settings: { enabled: true, autoTranslate: false, apiKey: "key", blockedDomains: [] }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  document.getElementById("translateNow").click();
  assert.equal(document.getElementById("message").textContent, "已开启当前页面翻译，译文会从页面上方开始渐进式加载。");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(tabMessages.at(-1), { type: "TOKTRA_SCAN_NOW", forceRefresh: true });
});

test("manual translate opens the toktra PDF viewer in the current tab for PDF URLs", async () => {
  const { document, tabMessages, popup } = loadPopup({
    tabUrl: "https://example.com/report.pdf",
    settings: { enabled: true, autoTranslate: false, apiKey: "key", blockedDomains: [] }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(popup.isPdfUrl("https://example.com/report.pdf?download=1"), true);
  assert.equal(popup.isPdfUrl("https://arxiv.org/pdf/2604.25707"), true);
  assert.equal(popup.isPdfUrl("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?src=https%3A%2F%2Fexample.com%2Fwrapped.pdf"), true);
  document.getElementById("translateNow").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById("message").textContent, "已在当前标签页打开 toktra PDF 翻译视图。");
  assert.equal(tabMessages.at(-1).type, "UPDATE_TAB");
  assert.equal(tabMessages.at(-1).tabId, 1);
  assert.match(tabMessages.at(-1).url, /^chrome-extension:\/\/toktra\/pdf-viewer\.html\?src=/);
  assert.match(decodeURIComponent(tabMessages.at(-1).url), /https:\/\/example\.com\/report\.pdf/);
});

test("manual translate routes arxiv pdf paths without .pdf suffix through the PDF viewer", async () => {
  const arxivPdfUrl = "https://arxiv.org/pdf/2604.25707";
  const { document, tabMessages, popup } = loadPopup({
    tabUrl: arxivPdfUrl,
    settings: { enabled: true, autoTranslate: false, apiKey: "key", blockedDomains: [] }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById("translateNow").textContent, "翻译 PDF");
  assert.equal(popup.isPdfUrl(arxivPdfUrl), true);
  document.getElementById("translateNow").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(document.getElementById("message").textContent, "已在当前标签页打开 toktra PDF 翻译视图。");
  assert.equal(tabMessages.at(-1).type, "UPDATE_TAB");
  assert.equal(new URL(tabMessages.at(-1).url).searchParams.get("src"), arxivPdfUrl);
});

test("manual translate routes local file PDF URLs through the current tab viewer", async () => {
  const localPdfUrl = "file:///Users/example/Documents/sample.pdf";
  const { document, tabMessages, popup } = loadPopup({
    tabUrl: localPdfUrl,
    settings: { enabled: true, autoTranslate: false, apiKey: "key", blockedDomains: [] }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(popup.isPdfUrl(localPdfUrl), true);
  assert.equal(
    popup.isPdfUrl(`chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?src=${encodeURIComponent(localPdfUrl)}`),
    true
  );
  document.getElementById("translateNow").click();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(tabMessages.at(-1).type, "UPDATE_TAB");
  assert.equal(tabMessages.at(-1).tabId, 1);
  const viewerUrl = new URL(tabMessages.at(-1).url);
  assert.equal(viewerUrl.searchParams.get("src"), localPdfUrl);
  assert.match(decodeURI(viewerUrl.searchParams.get("src")), /file:\/\/\/Users\/example\/Documents\/sample\.pdf/);
});
