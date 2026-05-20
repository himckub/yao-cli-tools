(function () {
  "use strict";

  const form = document.getElementById("settingsForm");
  const status = document.getElementById("status");
  const resetButton = document.getElementById("resetDefaults");

  function setStatus(text, tone) {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) resolve({ ok: false, error: error.message });
        else resolve(response || { ok: false, error: "Empty response" });
      });
    });
  }

  function domainListToText(domains) {
    return Array.from(domains || []).join("\n");
  }

  function textToDomainList(text) {
    return String(text || "")
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function field(name) {
    return form.elements?.namedItem?.(name) || form.querySelector(`[name="${name}"]`);
  }

  function setFieldValue(name, value) {
    const control = field(name);
    if (!control) return;
    try {
      control.value = value;
    } catch {
      Array.from(control.options || []).forEach((option) => {
        option.selected = option.value === String(value);
      });
    }
  }

  function modeFromSettings(settings) {
    if (!settings.autoTranslate) return "manual";
    if (settings.domainMode === "allowlist") return "site";
    return "global";
  }

  function applyModeToSettings(settings, mode) {
    const next = { ...settings };
    if (mode === "manual") {
      next.autoTranslate = false;
    } else if (mode === "site") {
      next.autoTranslate = true;
      next.domainMode = "allowlist";
    } else {
      next.autoTranslate = true;
      next.domainMode = "all";
    }
    return next;
  }

  function fillForm(settings) {
    field("enabled").checked = Boolean(settings.enabled);
    field("smartStructure").checked = settings.smartStructure !== false;
    field("preciseTranslation").checked = Boolean(settings.preciseTranslation);
    field("selectionTranslation").checked = settings.selectionTranslation !== false;
    setFieldValue("translationMode", modeFromSettings(settings));
    setFieldValue("sourceLanguage", settings.sourceLanguage || "auto");
    setFieldValue("targetLanguage", settings.targetLanguage || "zh-CN");
    setFieldValue("apiBaseUrl", settings.apiBaseUrl || "");
    setFieldValue("apiKey", settings.apiKey || "");
    setFieldValue("model", settings.model || "");
    setFieldValue("temperature", settings.temperature ?? 0.1);
    setFieldValue("minTextLength", settings.minTextLength ?? 4);
    setFieldValue("maxTextLength", settings.maxTextLength ?? 1200);
    setFieldValue("batchSize", settings.batchSize ?? 8);
    setFieldValue("allowDomains", domainListToText(settings.allowDomains));
    setFieldValue("blockedDomains", domainListToText(settings.blockedDomains));
    setFieldValue("siteRules", settings.siteRules || "");
    setFieldValue("systemPrompt", settings.systemPrompt || "");
  }

  function readForm() {
    const base = {
      enabled: field("enabled").checked,
      smartStructure: field("smartStructure").checked,
      preciseTranslation: field("preciseTranslation").checked,
      selectionTranslation: field("selectionTranslation").checked,
      sourceLanguage: field("sourceLanguage").value,
      targetLanguage: field("targetLanguage").value,
      apiBaseUrl: field("apiBaseUrl").value.trim(),
      apiKey: field("apiKey").value.trim(),
      model: field("model").value.trim(),
      temperature: Number(field("temperature").value || 0.1),
      minTextLength: Number(field("minTextLength").value || 4),
      maxTextLength: Number(field("maxTextLength").value || 1200),
      batchSize: Number(field("batchSize").value || 8),
      allowDomains: textToDomainList(field("allowDomains").value),
      blockedDomains: textToDomainList(field("blockedDomains").value),
      siteRules: field("siteRules").value.trim(),
      systemPrompt: field("systemPrompt").value.trim()
    };
    return applyModeToSettings(base, field("translationMode").value);
  }

  async function load() {
    const response = await sendMessage({ type: "TOKTRA_GET_SETTINGS" });
    if (!response.ok) {
      setStatus(response.error || "读取失败", "error");
      return;
    }
    fillForm(response.settings);
    setStatus("已加载", "saved");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setStatus("保存中", "saving");
    const response = await sendMessage({ type: "TOKTRA_SAVE_SETTINGS", settings: readForm() });
    if (!response.ok) {
      setStatus(response.error || "保存失败", "error");
      return;
    }
    fillForm(response.settings);
    setStatus("已保存", "saved");
  });

  resetButton.addEventListener("click", async () => {
    const response = await sendMessage({ type: "TOKTRA_SAVE_SETTINGS", settings: {} });
    if (!response.ok) {
      setStatus(response.error || "恢复失败", "error");
      return;
    }
    fillForm(response.settings);
    setStatus("已恢复默认", "saved");
  });

  load();

  globalThis.ToktraOptions = {
    applyModeToSettings,
    modeFromSettings
  };
})();
