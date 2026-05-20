(function () {
  "use strict";

  const domainEl = document.getElementById("domain");
  const stateBadge = document.getElementById("stateBadge");
  const messageEl = document.getElementById("message");
  const translateButton = document.getElementById("translateNow");
  const manualModeButton = document.getElementById("setManualMode");
  const siteAutoModeButton = document.getElementById("setSiteAutoMode");
  const globalAutoModeButton = document.getElementById("setGlobalAutoMode");
  const optionsButton = document.getElementById("openOptions");
  const sourceLanguageSelect = document.getElementById("sourceLanguage");
  const targetLanguageSelect = document.getElementById("targetLanguage");
  const modelSelect = document.getElementById("modelSelect");
  const preciseTranslationToggle = document.getElementById("preciseTranslation");
  const selectionTranslationToggle = document.getElementById("selectionTranslation");

  let activeTab = null;
  let settings = null;

  function canInjectIntoUrl(url) {
    try {
      const protocol = new URL(url || "").protocol;
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  }

  function isPdfUrl(url) {
    try {
      const parsed = new URL(url || "");
      if (/\.pdf$/i.test(parsed.pathname)) return true;
      if (/(\.|^)arxiv\.org$/i.test(parsed.hostname) && /^\/pdf\/[^/]+/i.test(parsed.pathname)) return true;
      const wrappedSource = parsed.searchParams.get("src") || parsed.searchParams.get("file");
      return wrappedSource ? isPdfUrl(wrappedSource) : false;
    } catch {
      return false;
    }
  }

  function pdfViewerUrl(url) {
    let source = url || "";
    try {
      const parsed = new URL(source);
      source = parsed.searchParams.get("src") || parsed.searchParams.get("file") || source;
    } catch {
      // Keep the original URL.
    }
    return chrome.runtime.getURL(`pdf-viewer.html?src=${encodeURIComponent(source)}`);
  }

  function openPdfViewer(url) {
    const viewerUrl = pdfViewerUrl(url);
    if (activeTab?.id && chrome.tabs.update) {
      return new Promise((resolve) => {
        chrome.tabs.update(activeTab.id, { url: viewerUrl }, () => {
          const error = chrome.runtime.lastError;
          if (error && chrome.tabs.create) {
            chrome.tabs.create({ url: viewerUrl });
            resolve({ ok: true, currentTab: false, error: error.message });
            return;
          }
          resolve({ ok: true, currentTab: true });
        });
      });
    }
    chrome.tabs.create({ url: viewerUrl });
    return Promise.resolve({ ok: true, currentTab: false });
  }

  function isMissingReceiverError(message) {
    return /receiving end does not exist|could not establish connection/i.test(String(message || ""));
  }

  function describeTabError(message, url) {
    if (!canInjectIntoUrl(url)) {
      return "当前页面是 Chrome 或扩展内置页面，浏览器不允许 toktra 注入。请切换到普通网页后再使用。";
    }
    if (isMissingReceiverError(message)) {
      return "当前网页还没有注入 toktra，已尝试重新注入。请稍后再试或刷新页面。";
    }
    return `当前页面无法连接 toktra：${message || "未知错误"}`;
  }

  function sendRuntime(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) resolve({ ok: false, error: error.message });
        else resolve(response || { ok: false, error: "Empty response" });
      });
    });
  }

  function sendTab(message) {
    if (!activeTab?.id) {
      return Promise.resolve({ ok: false, error: "没有可用的当前标签页。" });
    }
    if (!canInjectIntoUrl(activeTab.url)) {
      return Promise.resolve({ ok: false, error: describeTabError("", activeTab.url) });
    }

    return sendTabMessage(message).then(async (response) => {
      if (response.ok || !response.needsInjection) return response;
      const injected = await injectContentScripts();
      if (!injected.ok) return injected;
      return sendTabMessage(message);
    });
  }

  function sendTabMessage(message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTab.id, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          resolve({
            ok: false,
            error: describeTabError(error.message, activeTab.url),
            needsInjection: isMissingReceiverError(error.message) && canInjectIntoUrl(activeTab.url)
          });
        }
        else resolve(response || { ok: true });
      });
    });
  }

  async function injectContentScripts() {
    if (!chrome.scripting?.executeScript) {
      return { ok: false, error: "当前 Chrome 环境不支持主动注入脚本，请刷新网页后再试。" };
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        files: ["core.js", "content.js"]
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: describeTabError(error.message, activeTab.url) };
    }
  }

  function getHostname(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  }

  function normalizeDomains(domains) {
    return Array.from(domains || []).map((domain) => String(domain).toLowerCase()).filter(Boolean);
  }

  function isBlocked(hostname) {
    return normalizeDomains(settings?.blockedDomains).includes(hostname);
  }

  function removeDomain(domains, hostname) {
    return normalizeDomains(domains).filter((domain) => domain !== hostname);
  }

  function addDomain(domains, hostname) {
    const next = new Set(normalizeDomains(domains));
    if (hostname) next.add(hostname);
    return Array.from(next);
  }

  function render() {
    const hostname = getHostname(activeTab?.url);
    domainEl.textContent = hostname || "此页面不可注入";
    translateButton.textContent = isPdfUrl(activeTab?.url) ? "翻译 PDF" : "手动翻译当前页";
    syncQuickControls();
    if (!settings?.apiKey) {
      stateBadge.textContent = "缺 API";
      stateBadge.dataset.tone = "error";
      messageEl.textContent = "先在设置里填写 OpenAI-compatible API。";
    } else if (!settings.enabled) {
      stateBadge.textContent = "停用";
      stateBadge.dataset.tone = "idle";
      messageEl.textContent = "toktra 已停用，请在设置中启用。";
    } else if (!settings.autoTranslate) {
      stateBadge.textContent = "手动";
      stateBadge.dataset.tone = "idle";
      messageEl.textContent = "手动模式：页面不会自动翻译，可点击手动翻译或使用划线翻译。";
    } else if (settings.domainMode === "allowlist") {
      stateBadge.textContent = "站点";
      stateBadge.dataset.tone = "saved";
      messageEl.textContent = hostname && !isBlocked(hostname) && normalizeDomains(settings.allowDomains).includes(hostname)
        ? "仅当前网站会自动翻译。"
        : "仅指定网站会自动翻译，当前网站不在列表中。";
    } else if (hostname && !isBlocked(hostname) && settings.enabled) {
      stateBadge.textContent = "启用";
      stateBadge.dataset.tone = "saved";
      messageEl.textContent = "所有网站会自动翻译。";
    } else {
      stateBadge.textContent = "停用";
      stateBadge.dataset.tone = "idle";
      messageEl.textContent = "此域名当前不会自动翻译。";
    }
  }

  function ensureOption(select, value, label) {
    if (!select || !value) return;
    const exists = Array.from(select.options || []).some((option) => option.value === value);
    if (exists) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label || value;
    select.appendChild(option);
  }

  function setControlValue(control, value) {
    if (!control) return;
    try {
      control.value = value;
    } catch {
      Array.from(control.options || []).forEach((option) => {
        option.selected = option.value === String(value);
      });
    }
  }

  function getControlValue(control, fallback) {
    if (!control) return fallback;
    if (control.value) return control.value;
    return Array.from(control.options || []).find((option) => option.selected)?.value || fallback;
  }

  function syncQuickControls() {
    if (!settings) return;
    ensureOption(modelSelect, settings.model, settings.model);
    setControlValue(sourceLanguageSelect, settings.sourceLanguage || "auto");
    setControlValue(targetLanguageSelect, settings.targetLanguage || "zh-CN");
    setControlValue(modelSelect, settings.model || "gpt-4.1-mini");
    preciseTranslationToggle.checked = Boolean(settings.preciseTranslation);
    selectionTranslationToggle.checked = settings.selectionTranslation !== false;
  }

  async function saveSettings(nextSettings) {
    const response = await sendRuntime({ type: "TOKTRA_SAVE_SETTINGS", settings: nextSettings });
    if (response.ok) settings = response.settings;
    return response;
  }

  async function saveQuickSetting(patch, message) {
    if (!settings) return;
    messageEl.textContent = "正在保存快捷设置...";
    const response = await saveSettings({ ...settings, ...patch });
    if (!response.ok) {
      messageEl.textContent = response.error || "快捷设置保存失败。";
      render();
      return;
    }
    messageEl.textContent = message || "快捷设置已保存。";
    render();
  }

  async function load() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0] || null;
    const response = await sendRuntime({ type: "TOKTRA_GET_SETTINGS" });
    if (response.ok) settings = response.settings;
    render();
  }

  translateButton.addEventListener("click", async () => {
    if (isPdfUrl(activeTab?.url)) {
      const result = await openPdfViewer(activeTab.url);
      messageEl.textContent = result.currentTab
        ? "已在当前标签页打开 toktra PDF 翻译视图。"
        : "已打开 toktra PDF 翻译视图。";
      return;
    }
    messageEl.textContent = "已开启当前页面翻译，译文会从页面上方开始渐进式加载。";
    const response = await sendTab({ type: "TOKTRA_SCAN_NOW", forceRefresh: true });
    if (!response.ok) {
      messageEl.textContent = response.error || "当前页面无法注入。";
    }
  });

  manualModeButton.addEventListener("click", async () => {
    if (!settings) return;
    messageEl.textContent = "正在切换到手动模式...";
    const response = await saveSettings({ ...settings, autoTranslate: false });
    if (!response.ok) {
      messageEl.textContent = response.error || "切换失败。";
      return;
    }
    await sendTab({ type: "TOKTRA_STOP_TRANSLATION" });
    messageEl.textContent = "已切换到手动模式。";
    render();
  });

  siteAutoModeButton.addEventListener("click", async () => {
    const hostname = getHostname(activeTab?.url);
    if (!hostname || !settings) return;
    messageEl.textContent = "正在开启当前网站自动翻译...";
    const response = await saveSettings({
      ...settings,
      enabled: true,
      autoTranslate: true,
      domainMode: "allowlist",
      allowDomains: addDomain(settings.allowDomains, hostname),
      blockedDomains: removeDomain(settings.blockedDomains, hostname)
    });
    if (!response.ok) {
      messageEl.textContent = response.error || "切换失败。";
      return;
    }
    await sendTab({ type: "TOKTRA_SCAN_NOW" });
    messageEl.textContent = "已开启当前网站自动翻译。";
    render();
  });

  globalAutoModeButton.addEventListener("click", async () => {
    if (!settings) return;
    const hostname = getHostname(activeTab?.url);
    messageEl.textContent = "正在开启所有网站自动翻译...";
    const response = await saveSettings({
      ...settings,
      enabled: true,
      autoTranslate: true,
      domainMode: "all",
      blockedDomains: removeDomain(settings.blockedDomains, hostname)
    });
    if (!response.ok) {
      messageEl.textContent = response.error || "切换失败。";
      return;
    }
    await sendTab({ type: "TOKTRA_SCAN_NOW" });
    messageEl.textContent = "已开启所有网站自动翻译。";
    render();
  });

  optionsButton.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  sourceLanguageSelect.addEventListener("change", () => {
    saveQuickSetting({ sourceLanguage: getControlValue(sourceLanguageSelect, "auto") }, "原文语言设置已保存。");
  });

  targetLanguageSelect.addEventListener("change", () => {
    saveQuickSetting({ targetLanguage: getControlValue(targetLanguageSelect, "zh-CN") }, "目标语言设置已保存。");
  });

  modelSelect.addEventListener("change", () => {
    saveQuickSetting({ model: getControlValue(modelSelect, "gpt-4.1-mini") }, "翻译模型已保存。");
  });

  preciseTranslationToggle.addEventListener("change", () => {
    saveQuickSetting({ preciseTranslation: preciseTranslationToggle.checked }, "AI 精翻设置已保存。");
  });

  selectionTranslationToggle.addEventListener("change", () => {
    saveQuickSetting({ selectionTranslation: selectionTranslationToggle.checked }, "划词翻译设置已保存。");
  });

  globalThis.ToktraPopup = {
    canInjectIntoUrl,
    describeTabError,
    isPdfUrl,
    pdfViewerUrl,
    openPdfViewer,
    addDomain,
    removeDomain
  };

  load();
})();
