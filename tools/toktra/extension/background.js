(function (global) {
  "use strict";

  const DEFAULT_SETTINGS = {
    enabled: true,
    autoTranslate: true,
    apiBaseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    translationProvider: "openai-compatible",
    sourceLanguage: "auto",
    targetLanguage: "zh-CN",
    promptVersion: "v1",
    temperature: 0.1,
    minTextLength: 4,
    maxTextLength: 3200,
    batchSize: 8,
    smartStructure: true,
    preciseTranslation: false,
    selectionTranslation: true,
    domainMode: "all",
    allowDomains: [],
    blockedDomains: [],
    siteRules: "",
    systemPrompt:
      "You translate English into Simplified Chinese. Keep names, URLs, code, numbers, and formatting intent. Return only a valid JSON array of translated strings in the same order as the input array."
  };

  const SETTINGS_KEY = "toktraSettings";
  const SECRET_KEY = "toktraSecret";
  const CACHE_KEY = "toktraCache";
  const STRATEGY_KEY = "toktraDomainStrategies";
  const CURRENT_SETTINGS_VERSION = 2;
  const MAX_CACHE_ITEMS = 500;
  const MAX_STRATEGY_ITEMS = 120;
  const DEFAULT_TRANSLATION_RETRIES = 3;
  const DEFAULT_RETRY_DELAY_MS = 300;
  let cacheWriteQueue = Promise.resolve();

  function chromeApi() {
    return global.chrome;
  }

  function storageGet(area, defaults) {
    const api = chromeApi()?.storage?.[area];
    if (!api) return Promise.resolve(defaults || {});
    return new Promise((resolve, reject) => {
      try {
        const maybePromise = api.get(defaults, (result) => {
          const error = chromeApi()?.runtime?.lastError;
          if (error) reject(new Error(error.message));
          else resolve(result || {});
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then((result) => resolve(result || {}), reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(area, value) {
    const api = chromeApi()?.storage?.[area];
    if (!api) return Promise.resolve();
    return new Promise((resolve, reject) => {
      try {
        const maybePromise = api.set(value, () => {
          const error = chromeApi()?.runtime?.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(resolve, reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  async function getSettings() {
    const [syncData, localData] = await Promise.all([
      storageGet("sync", { [SETTINGS_KEY]: {} }),
      storageGet("local", { [SECRET_KEY]: {} })
    ]);
    const publicSettings = migrateLoadedSettings(syncData[SETTINGS_KEY] || {});
    const secret = localData[SECRET_KEY] || {};
    return {
      ...DEFAULT_SETTINGS,
      ...publicSettings,
      apiKey: secret.apiKey || publicSettings.apiKey || ""
    };
  }

  function migrateLoadedSettings(publicSettings) {
    const next = { ...(publicSettings || {}) };
    const version = Number(next.settingsVersion || 0);
    if (!version && Number(next.minTextLength) === 16) {
      next.minTextLength = DEFAULT_SETTINGS.minTextLength;
    }
    next.settingsVersion = CURRENT_SETTINGS_VERSION;
    return next;
  }

  async function saveSettings(nextSettings) {
    const { apiKey, ...publicSettings } = { ...nextSettings };
    await Promise.all([
      storageSet("sync", { [SETTINGS_KEY]: { ...publicSettings, settingsVersion: CURRENT_SETTINGS_VERSION } }),
      storageSet("local", { [SECRET_KEY]: { apiKey: apiKey || "" } })
    ]);
    return getSettings();
  }

  function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveChatUrl(apiBaseUrl) {
    const base = normalizeBaseUrl(apiBaseUrl);
    if (!base) return "";
    if (/\/chat\/completions$/i.test(base)) return base;
    return `${base}/chat/completions`;
  }

  function extractJsonArray(value) {
    const content = String(value || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      const start = content.indexOf("[");
      const end = content.lastIndexOf("]");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(content.slice(start, end + 1));
        if (Array.isArray(parsed)) return parsed;
      }
    }
    throw new Error("Translation API did not return a JSON array.");
  }

  function extractJsonObject(value) {
    const content = String(value || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(content.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      }
    }
    throw new Error("Structure API did not return a JSON object.");
  }

  function normalizeHostname(hostname) {
    return String(hostname || "")
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .trim()
      .toLowerCase();
  }

  function normalizeSelectorList(selectors, limit) {
    const seen = new Set();
    const result = [];
    for (const value of Array.from(selectors || [])) {
      const selector = String(value || "").trim();
      if (!selector || selector.length > 160 || /[<>{}]/.test(selector) || seen.has(selector)) continue;
      seen.add(selector);
      result.push(selector);
      if (result.length >= limit) break;
    }
    return result;
  }

  function normalizeDomainStrategy(hostname, value) {
    const source = value && typeof value === "object" ? value : {};
    const strategy = {
      version: 1,
      hostname: normalizeHostname(hostname),
      contentSelectors: normalizeSelectorList(source.contentSelectors, 6),
      excludeSelectors: normalizeSelectorList(source.excludeSelectors, 12),
      updatedAt: Number(source.updatedAt) || Date.now()
    };
    if (source.signature) strategy.signature = String(source.signature).slice(0, 80);
    const minTextLength = Number(source.minTextLength);
    if (Number.isFinite(minTextLength) && minTextLength >= 4 && minTextLength <= 200) {
      strategy.minTextLength = Math.round(minTextLength);
    }
    return strategy;
  }

  function hashValue(value) {
    let hash = 2166136261;
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    for (let index = 0; index < normalized.length; index += 1) {
      hash ^= normalized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function cacheNamespace(settings) {
    const provider = settings.translationProvider || DEFAULT_SETTINGS.translationProvider;
    const sourceLanguage = settings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage;
    const targetLanguage = settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
    const model = settings.model || DEFAULT_SETTINGS.model;
    const promptVersion = settings.promptVersion || DEFAULT_SETTINGS.promptVersion;
    const promptHash = hashValue(settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt);
    const precision = settings.preciseTranslation ? "precise" : "standard";
    return [provider, sourceLanguage, targetLanguage, model, promptVersion, promptHash, precision].join(":");
  }

  function cacheKey(text, settings) {
    return `v2:${hashValue(cacheNamespace(settings))}:${hashValue(text)}`;
  }

  async function readCache() {
    const data = await storageGet("local", { [CACHE_KEY]: {} });
    return data[CACHE_KEY] || {};
  }

  async function writeCache(cache) {
    const entries = Object.entries(cache).slice(-MAX_CACHE_ITEMS);
    await storageSet("local", { [CACHE_KEY]: Object.fromEntries(entries) });
  }

  async function mergeCache(updates) {
    if (!Object.keys(updates || {}).length) return;
    const write = async () => {
      const latest = await readCache();
      await writeCache({ ...latest, ...updates });
    };
    cacheWriteQueue = cacheWriteQueue.then(write, write);
    return cacheWriteQueue;
  }

  async function readStrategies() {
    const data = await storageGet("local", { [STRATEGY_KEY]: {} });
    return data[STRATEGY_KEY] || {};
  }

  async function writeStrategies(strategies) {
    const entries = Object.entries(strategies)
      .sort((a, b) => Number(a[1]?.updatedAt || 0) - Number(b[1]?.updatedAt || 0))
      .slice(-MAX_STRATEGY_ITEMS);
    await storageSet("local", { [STRATEGY_KEY]: Object.fromEntries(entries) });
  }

  async function getDomainStrategy(hostname) {
    const normalized = normalizeHostname(hostname);
    if (!normalized) return null;
    const strategies = await readStrategies();
    return strategies[normalized] || null;
  }

  async function saveDomainStrategy(hostname, strategy) {
    const normalized = normalizeHostname(hostname);
    if (!normalized) return null;
    const strategies = await readStrategies();
    const next = normalizeDomainStrategy(normalized, { ...strategy, updatedAt: Date.now() });
    strategies[normalized] = next;
    await writeStrategies(strategies);
    return next;
  }

  function getTranslationProvider(settings) {
    const name = settings.translationProvider || DEFAULT_SETTINGS.translationProvider;
    if (name !== "openai-compatible") {
      return { name, ok: false, error: `Unsupported translation provider: ${name}` };
    }
    return {
      name,
      ok: true,
      maxBatchSize: 20,
      translate: (texts, providerSettings) => translateWithOpenAI(texts, providerSettings)
    };
  }

  async function translateWithOpenAI(texts, settings) {
    const response = await global.fetch(resolveChatUrl(settings.apiBaseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: Number(settings.temperature ?? 0.1),
        messages: [
          { role: "system", content: translationSystemPrompt(settings) },
          { role: "user", content: JSON.stringify(texts) }
        ]
      })
    });
    if (!response.ok) {
      return { ok: false, errorCode: "api_error", error: `Translation API returned HTTP ${response.status}.` };
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || "";
    try {
      return { ok: true, translations: extractJsonArray(content) };
    } catch (error) {
      return { ok: false, errorCode: "bad_response", error: error.message };
    }
  }

  function sleep(ms) {
    const timer = global.setTimeout || setTimeout;
    return new Promise((resolve) => timer(resolve, ms));
  }

  function translationSystemPrompt(settings) {
    const base = settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
    if (!settings.preciseTranslation) return base;
    return `${base}\nUse precise, context-aware translation. Preserve the author's intent, domain terms, and paragraph-level coherence. Prefer natural Simplified Chinese over literal word-by-word translation.`;
  }

  function retryOption(value, fallback, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(max, Math.round(number)));
  }

  function translationError(message, errorCode) {
    const error = new Error(message);
    error.errorCode = errorCode;
    return error;
  }

  function normalizeProviderTranslations(translations, expectedLength) {
    if (!Array.isArray(translations) || translations.length !== expectedLength) {
      throw translationError("Translation count does not match input count.", "bad_response");
    }
    const normalized = translations.map((translation) => String(translation || "").trim());
    if (normalized.some((translation) => !translation)) {
      throw translationError("Translation API returned an empty translation.", "bad_response");
    }
    return normalized;
  }

  async function translateWithRetries(provider, texts, settings, options) {
    const maxRetries = retryOption(options?.maxRetries ?? settings.translationRetries, DEFAULT_TRANSLATION_RETRIES, 5);
    const baseDelay = retryOption(options?.retryDelayMs ?? settings.translationRetryDelayMs, DEFAULT_RETRY_DELAY_MS, 5000);
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await provider.translate(texts, settings);
        if (!response?.ok) {
          throw translationError(response?.error || "Translation API request failed.", response?.errorCode || "api_error");
        }
        return {
          ok: true,
          translations: normalizeProviderTranslations(response.translations, texts.length),
          attempts: attempt + 1
        };
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) break;
        const delay = baseDelay ? baseDelay * Math.pow(2, Math.min(attempt, 3)) : 0;
        if (delay) await sleep(delay);
      }
    }

    return {
      ok: false,
      errorCode: lastError?.errorCode || "translation_failed",
      error: lastError?.message || "Translation failed after retry attempts."
    };
  }

  async function translateTexts(texts, explicitSettings, options) {
    const settings = { ...DEFAULT_SETTINGS, ...(explicitSettings || (await getSettings())) };
    const forceRefresh = Boolean(options?.forceRefresh);
    const input = Array.from(texts || []).map((text) => String(text || ""));
    if (!input.length) return { ok: true, translations: [] };
    if (!settings.apiKey) {
      return { ok: false, errorCode: "missing_api_key", error: "API key is not configured." };
    }
    const provider = getTranslationProvider(settings);
    if (!provider.ok) {
      return { ok: false, errorCode: "unsupported_provider", error: provider.error };
    }

    const cache = await readCache();
    const result = new Array(input.length);
    const cacheHits = new Array(input.length).fill(false);
    const missing = [];
    input.forEach((text, index) => {
      const key = cacheKey(text, settings);
      if (!forceRefresh && cache[key]) {
        result[index] = cache[key].translation;
        cacheHits[index] = true;
      }
      else missing.push({ text, index, key });
    });

    if (missing.length) {
      const response = await translateWithRetries(provider, missing.map((item) => item.text), settings, options);
      if (!response.ok) return response;
      const translated = response.translations || [];
      const updates = {};
      missing.forEach((item, offset) => {
        const translation = String(translated[offset] || "").trim();
        result[item.index] = translation;
        updates[item.key] = { translation, updatedAt: Date.now() };
      });
      await mergeCache(updates);
    }

    return { ok: true, translations: result, cacheHits };
  }

  async function translateSegments(segments, explicitSettings, options) {
    const input = Array.from(segments || []).map((segment, index) => ({
      id: String(segment?.id || segment?.hash || `segment-${index}`),
      text: String(segment?.text || ""),
      hash: String(segment?.hash || ""),
      kind: String(segment?.kind || "")
    }));
    const response = await translateTexts(
      input.map((segment) => segment.text),
      explicitSettings,
      options
    );
    if (!response.ok) return response;
    return {
      ...response,
      results: input.map((segment, index) => ({
        id: segment.id,
        text: response.translations[index],
        cacheHit: Boolean(response.cacheHits?.[index])
      }))
    };
  }

  async function analyzeDomainStructure(hostname, outline, explicitSettings) {
    const settings = explicitSettings || (await getSettings());
    const normalizedHostname = normalizeHostname(hostname);
    if (!normalizedHostname) {
      return { ok: false, errorCode: "bad_domain", error: "Domain is empty." };
    }
    if (!settings.smartStructure) {
      return { ok: false, errorCode: "disabled", error: "Smart structure analysis is disabled." };
    }
    if (!settings.apiKey) {
      return { ok: false, errorCode: "missing_api_key", error: "API key is not configured." };
    }

    const response = await global.fetch(resolveChatUrl(settings.apiBaseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You analyze webpage structure for a browser translation extension. Return only a JSON object with contentSelectors, excludeSelectors, and optional minTextLength. Use stable CSS selectors from the provided outline. Prefer broad readable content roots, repeated cards, navigation/header modules, sidebar lists, footer links, and div/span content containers when their visible text is user-facing. Exclude ads, comments, code blocks, cookie banners, hidden nodes, and purely mechanical utility UI. Choose selectors that maximize translated user-visible English text without duplicating the same container."
          },
          {
            role: "user",
            content: JSON.stringify({
              hostname: normalizedHostname,
              outline
            })
          }
        ]
      })
    });
    if (!response.ok) {
      return { ok: false, errorCode: "api_error", error: `Structure API returned HTTP ${response.status}.` };
    }
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || "";
    const parsed = extractJsonObject(content);
    const strategy = await saveDomainStrategy(normalizedHostname, { ...parsed, signature: outline?.signature });
    return { ok: true, strategy };
  }

  function addMessageListener() {
    const runtime = chromeApi()?.runtime;
    if (!runtime?.onMessage) return;
    runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object" || !String(message.type || "").startsWith("TOKTRA_")) {
        return false;
      }
      (async () => {
        if (message.type === "TOKTRA_GET_SETTINGS") {
          return { ok: true, settings: await getSettings() };
        }
        if (message.type === "TOKTRA_SAVE_SETTINGS") {
          return { ok: true, settings: await saveSettings(message.settings || {}) };
        }
        if (message.type === "TOKTRA_TRANSLATE") {
          if (Array.isArray(message.segments)) {
            return translateSegments(message.segments || [], undefined, { forceRefresh: Boolean(message.forceRefresh) });
          }
          return translateTexts(message.texts || [], undefined, { forceRefresh: Boolean(message.forceRefresh) });
        }
        if (message.type === "TOKTRA_GET_DOMAIN_STRATEGY") {
          return { ok: true, strategy: await getDomainStrategy(message.hostname) };
        }
        if (message.type === "TOKTRA_ANALYZE_STRUCTURE") {
          return analyzeDomainStructure(message.hostname, message.outline || {});
        }
        return { ok: false, error: "Unknown toktra message." };
      })()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    });
  }

  global.ToktraBackground = {
    DEFAULT_SETTINGS,
    analyzeDomainStructure,
    extractJsonArray,
    extractJsonObject,
    cacheKey,
    getSettings,
    getDomainStrategy,
    getTranslationProvider,
    normalizeDomainStrategy,
    resolveChatUrl,
    saveSettings,
    translateSegments,
    translateTexts
  };

  addMessageListener();
})(globalThis);
