(function () {
  "use strict";

  const CONTENT_VERSION = "0.2.1";
  const STRUCTURE_STRATEGY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_TRANSLATION_CONCURRENCY = 4;
  if (window.__toktraLoaded === CONTENT_VERSION) return;
  window.__toktraLoaded = CONTENT_VERSION;

  const core = window.ToktraCore;
  if (!core) return;

  const state = {
    settings: null,
    pending: new Map(),
    memoryCache: new Map(),
    translating: false,
    scanTimer: null,
    observer: null,
    scrollMounted: false,
    disabledForPage: false,
    selectionText: "",
    domainStrategy: null,
    structureAnalyzing: false,
    generation: 0,
    queuedElements: new WeakSet(),
    progress: null
  };

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) resolve({ ok: false, error: error.message });
        else resolve(response || { ok: false, error: "Empty response" });
      });
    });
  }

  function currentHostname() {
    return location.hostname.replace(/^www\./i, "").toLowerCase();
  }

  function normalizeDomains(domains) {
    return Array.from(domains || [])
      .map((domain) => String(domain || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].trim().toLowerCase())
      .filter(Boolean);
  }

  function domainMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
  }

  function isToktraUsable(settings) {
    if (!settings?.enabled) return false;
    if (!settings.apiKey) return false;
    return true;
  }

  function isAutoTranslateEnabledForDomain(settings) {
    if (!isToktraUsable(settings)) return false;
    if (!settings.autoTranslate) return false;
    const hostname = currentHostname();
    const blocked = normalizeDomains(settings.blockedDomains);
    if (blocked.some((domain) => domainMatches(hostname, domain))) return false;
    if (settings.domainMode === "allowlist") {
      const allowed = normalizeDomains(settings.allowDomains);
      return allowed.some((domain) => domainMatches(hostname, domain));
    }
    return true;
  }

  function selectionAllowed(settings) {
    return isToktraUsable(settings) && settings.selectionTranslation !== false;
  }

  function scheduleScan(delay) {
    window.clearTimeout(state.scanTimer);
    if (state.disabledForPage) return;
    state.scanTimer = window.setTimeout(scanNow, delay ?? 250);
  }

  function queueTarget(target, forceRefresh) {
    const cached = !forceRefresh ? state.memoryCache.get(target.hash) : null;
    if (cached) {
      core.renderTranslation(target.element, cached, target.hash);
      return;
    }
    const existing = state.pending.get(target.hash);
    const item =
      existing && existing.generation === state.generation
        ? existing
        : {
            id: target.id || target.hash,
            text: target.text,
            hash: target.hash,
            kind: target.kind || "",
            elements: new Set(),
            forceRefresh: false,
            generation: state.generation
          };
    item.forceRefresh = item.forceRefresh || Boolean(forceRefresh);
    item.elements.add(target.element);
    state.pending.set(target.hash, item);
  }

  async function flushPending() {
    if (state.translating || !state.settings) return;
    if (!state.pending.size) return;
    state.translating = true;
    try {
      let firstRound = true;
      while (state.pending.size) {
        const batchSize = Math.max(1, Math.min(20, Number(state.settings.batchSize || 8)));
        const concurrency = firstRound ? 1 : MAX_TRANSLATION_CONCURRENCY;
        const batches = [];
        firstRound = false;
        for (let index = 0; index < concurrency && state.pending.size; index += 1) {
          const batch = Array.from(state.pending.values()).slice(0, batchSize);
          batch.forEach((item) => state.pending.delete(item.hash));
          batches.push(batch);
        }
        await Promise.all(
          batches.map(async (batch) => {
            const response = await sendMessage({
              type: "TOKTRA_TRANSLATE",
              segments: batch.map((item) => ({
                id: item.id,
                text: item.text,
                hash: item.hash,
                kind: item.kind
              })),
              forceRefresh: batch.some((item) => item.forceRefresh)
            });
            if (!response?.ok) {
              console.warn("[toktra] translation failed:", response?.error || response?.errorCode || "unknown error");
              batch.forEach((item) => renderFailedItem(item, "翻译失败"));
              return;
            }
            const translationsById = new Map(Array.from(response.results || []).map((result) => [result.id, result.text]));
            batch.forEach((item, index) => {
              const translation = translationsById.get(item.id) || response.translations?.[index];
              if (!item) return;
              if (!translation) {
                renderFailedItem(item, "翻译失败");
                return;
              }
              if (item.generation !== state.generation) return;
              state.memoryCache.set(item.hash, translation);
              let rendered = 0;
              item.elements.forEach((element) => {
                if (document.documentElement.contains(element)) {
                  core.renderTranslation(element, translation, item.hash);
                  rendered += 1;
                }
              });
              if (rendered) incrementProgress({ translated: rendered });
            });
          })
        );
      }
    } finally {
      state.translating = false;
      if (state.pending.size) {
        flushPending();
      }
    }
  }

  function queueProgressiveTargets(targets, forceRefresh) {
    const plan = core.planTranslationWork(targets, {
      cache: forceRefresh ? new Map() : state.memoryCache,
      queuedElements: state.queuedElements,
      viewportHeight: window.innerHeight,
      viewportMultiplier: 1.6,
      maxScreensAhead: 3
    });
    resetProgress(plan.total);
    plan.cached.forEach(({ target, translation }) => {
      state.queuedElements.add(target.element);
      core.renderTranslation(target.element, translation, target.hash);
      incrementProgress({ translated: 1, cached: 1 });
    });
    plan.pending.forEach((target) => {
      state.queuedElements.add(target.element);
      queueTarget(target, forceRefresh);
    });
    return plan.cached.length + plan.pending.length;
  }

  function resetProgress(total) {
    state.progress = {
      total: Math.max(0, Number(total || 0)),
      translated: 0,
      cached: 0,
      failed: 0,
      status: total ? "running" : "idle"
    };
    if (total) core.renderProgress(document, state.progress);
  }

  function incrementProgress(delta) {
    if (!state.progress) return;
    state.progress.translated = Math.min(state.progress.total, state.progress.translated + Math.max(0, Number(delta?.translated || 0)));
    state.progress.cached += Math.max(0, Number(delta?.cached || 0));
    state.progress.failed += Math.max(0, Number(delta?.failed || 0));
    state.progress.status = state.progress.translated + state.progress.failed >= state.progress.total ? "complete" : "running";
    core.renderProgress(document, state.progress);
  }

  function beginRetry(count) {
    if (!state.progress) return;
    state.progress.failed = Math.max(0, state.progress.failed - Math.max(1, Number(count || 1)));
    state.progress.status = "running";
    core.renderProgress(document, state.progress);
  }

  function retryFailedElement(item, element) {
    if (!item || !element || !document.documentElement.contains(element)) return;
    beginRetry(1);
    state.queuedElements.delete(element);
    state.pending.delete(item.hash);
    state.queuedElements.add(element);
    queueTarget(
      {
        id: item.id,
        element,
        text: item.text,
        hash: item.hash,
        kind: item.kind
      },
      true
    );
    flushPending();
  }

  function renderFailedItem(item, message) {
    if (!item || item.generation !== state.generation) return 0;
    let failed = 0;
    item.elements.forEach((element) => {
      if (!document.documentElement.contains(element)) return;
      core.renderTranslationError(element, item.hash, () => retryFailedElement(item, element), message || "翻译失败");
      failed += 1;
    });
    if (failed) incrementProgress({ failed });
    return failed;
  }

  function collectPageTargets(forceRefresh) {
    const baseOptions = { ...state.settings, forceRefresh };
    const merged = new Map();
    const addTargets = (targets) => {
      Array.from(targets || []).forEach((target) => {
        if (!merged.has(target.element)) merged.set(target.element, target);
      });
    };
    const rules = core.parseSiteRules(state.settings?.siteRules || "", currentHostname());
    const ruleExclusions = { excludeSelectors: rules.excludeSelectors };
    addTargets(core.collectTargets(document.body, { ...baseOptions, structureStrategy: ruleExclusions }));
    if (rules.contentSelectors?.length) {
      addTargets(core.collectTargets(document.body, { ...baseOptions, structureStrategy: rules }));
    }
    if (state.domainStrategy) {
      const strategy = core.mergeStructureStrategies(state.domainStrategy, ruleExclusions);
      addTargets(
        core.collectTargets(document.body, {
          ...baseOptions,
          structureStrategy: strategy
        })
      );
    }
    return core.sortTargets(Array.from(merged.values()));
  }

  function scanNow(options) {
    window.clearTimeout(state.scanTimer);
    if (state.disabledForPage) return { ok: false, reason: "disabled" };
    if (!state.settings || !isToktraUsable(state.settings)) return;
    if (core.isLikelyChinesePage(document)) {
      return { ok: false, reason: "chinese_page" };
    }
    core.injectStyle(document);
    const forceRefresh = Boolean(options?.forceRefresh);
    if (forceRefresh) {
      state.generation += 1;
      state.pending.clear();
      state.queuedElements = new WeakSet();
    }
    const targets = collectPageTargets(forceRefresh);
    const queued = queueProgressiveTargets(targets, forceRefresh);
    flushPending();
    return { ok: true, queued, total: targets.length };
  }

  function stopTranslation() {
    state.disabledForPage = true;
    window.clearTimeout(state.scanTimer);
    state.pending.clear();
    state.queuedElements = new WeakSet();
    state.progress = null;
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    const removed = core.removeTranslations(document);
    return { ok: true, removed };
  }

  function removeSelectionUi() {
    document.querySelectorAll("[data-toktra='selection-button'],[data-toktra='selection-panel']").forEach((node) => node.remove());
    state.selectionText = "";
  }

  function outlineSignature(outline) {
    const structuralNodes = Array.from(outline?.nodes || [])
      .slice(0, 32)
      .map((node) => [node.selector, node.tag, node.role, node.childCount, Math.round(Number(node.textLength || 0) / 120)]);
    return core.hashText(JSON.stringify(structuralNodes));
  }

  function strategyIsFresh(strategy, signature) {
    if (!strategy) return false;
    if (signature && strategy.signature && strategy.signature !== signature) return false;
    const updatedAt = Number(strategy.updatedAt || 0);
    return updatedAt && Date.now() - updatedAt < STRUCTURE_STRATEGY_TTL_MS;
  }

  async function loadDomainStrategy() {
    if (!state.settings?.smartStructure) return null;
    const response = await sendMessage({ type: "TOKTRA_GET_DOMAIN_STRATEGY", hostname: currentHostname() });
    if (response?.ok) state.domainStrategy = response.strategy || null;
    return state.domainStrategy;
  }

  async function loadStrategyAndAnalyze(options) {
    if (!state.settings?.smartStructure || state.disabledForPage) return;
    const previousSignature = state.domainStrategy?.signature || "";
    const strategy = await loadDomainStrategy();
    if (strategy && !state.disabledForPage && strategy.signature !== previousSignature) {
      scanNow({ forceRefresh: Boolean(options?.forceRefresh) });
    }
    analyzeStructureIfNeeded({ force: Boolean(options?.force) });
  }

  async function analyzeStructureIfNeeded(options) {
    if (!state.settings?.smartStructure || !isToktraUsable(state.settings) || state.structureAnalyzing) return;
    if (core.isLikelyChinesePage(document)) return;
    const outline = core.buildStructureOutline(document, {
      url: location.href,
      maxNodes: 40,
      maxSampleLength: 140
    });
    if (!outline.nodes.length) return;
    const signature = outlineSignature(outline);
    if (!options?.force && strategyIsFresh(state.domainStrategy, signature)) return;

    state.structureAnalyzing = true;
    try {
      const response = await sendMessage({
        type: "TOKTRA_ANALYZE_STRUCTURE",
        hostname: currentHostname(),
        outline: { ...outline, signature }
      });
      if (!response?.ok || !response.strategy) return;
      if (state.disabledForPage) return;
      const previousSignature = state.domainStrategy?.signature || "";
      state.domainStrategy = response.strategy;
      if (response.strategy.signature !== previousSignature || options?.force) {
        scanNow();
      }
    } finally {
      state.structureAnalyzing = false;
    }
  }

  const FLOATING_TRANSLATE_WIDGET_SELECTOR = [
    "#gtx-trans",
    ".gtx-trans",
    ".gtx-trans-icon",
    "#goog-gt-tt",
    ".goog-tooltip",
    ".goog-te-balloon-frame",
    "iframe.goog-te-menu-frame",
    "iframe.goog-te-balloon-frame",
    "[class*='VIpgJd-ZVi9od']"
  ].join(",");

  function isRectNearSelection(rect, anchorRect) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top < anchorRect.bottom + 140 &&
      rect.bottom > anchorRect.top - 40 &&
      rect.left < anchorRect.right + 180 &&
      rect.right > anchorRect.left - 180
    );
  }

  function getFloatingAvoidRects(anchorRect) {
    return Array.from(document.querySelectorAll(FLOATING_TRANSLATE_WIDGET_SELECTOR))
      .filter((node) => !node.closest?.("[data-toktra]"))
      .map((node) => node.getBoundingClientRect?.())
      .filter((rect) => rect && isRectNearSelection(rect, anchorRect));
  }

  function positionElement(node, rect, options) {
    const position = core.computeFloatingPosition(rect, {
      elementWidth: node.offsetWidth || options?.elementWidth || 320,
      elementHeight: node.offsetHeight || options?.elementHeight || 48,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      margin: options?.margin ?? 12,
      offsetY: options?.offsetY ?? 12,
      horizontalShift: options?.horizontalShift ?? 0,
      collisionPadding: options?.collisionPadding ?? 8,
      avoidRects: options?.avoidRects || []
    });
    node.style.left = `${position.left}px`;
    node.style.top = `${position.top}px`;
  }

  function getSelectionRect(selection) {
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height)) return rect;
    const rects = Array.from(range.getClientRects());
    return rects.find((item) => item.width || item.height) || null;
  }

  function selectionStartsInIgnoredArea(selection) {
    const node = selection?.anchorNode;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest?.("[data-toktra],script,style,textarea,input,select,option,pre,code,kbd,samp"));
  }

  function showSelectionButton(text, rect) {
    removeSelectionUi();
    core.injectStyle(document);
    state.selectionText = text;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toktra-selection-button";
    button.dataset.toktra = "selection-button";
    button.setAttribute("aria-label", "toktra 划线翻译");
    button.textContent = "toktra 翻译";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => translateSelection(text, rect));
    document.body.appendChild(button);
    positionElement(button, rect, {
      elementWidth: 92,
      elementHeight: 30,
      offsetY: 36,
      horizontalShift: -8,
      avoidRects: getFloatingAvoidRects(rect)
    });
  }

  function showSelectionPanel(text, rect, statusText, translatedText, loading) {
    removeSelectionUi();
    core.injectStyle(document);
    const panel = document.createElement("section");
    panel.className = "toktra-selection-panel";
    panel.dataset.toktra = "selection-panel";

    const top = document.createElement("div");
    top.className = "toktra-selection-panel__top";
    const title = document.createElement("span");
    title.textContent = statusText;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toktra-selection-panel__close";
    close.setAttribute("aria-label", "关闭划线翻译");
    close.textContent = "x";
    close.addEventListener("click", removeSelectionUi);
    top.append(title, close);

    const source = document.createElement("p");
    source.className = "toktra-selection-panel__source";
    source.textContent = text;
    const result = document.createElement("p");
    result.className = "toktra-selection-panel__result";
    if (loading) result.dataset.loading = "true";
    result.textContent = translatedText || "";
    panel.append(top, source, result);
    document.body.appendChild(panel);
    positionElement(panel, rect, { offsetY: 12 });
  }

  async function translateSelection(text, rect) {
    showSelectionPanel(text, rect, "toktra 划线翻译", "翻译中...", true);
    const response = await sendMessage({ type: "TOKTRA_TRANSLATE", texts: [text] });
    if (!response?.ok || !response.translations?.[0]) {
      showSelectionPanel(text, rect, "toktra 划线翻译", response?.error || "翻译失败。");
      return;
    }
    showSelectionPanel(text, rect, "toktra 划线翻译", response.translations[0]);
  }

  function handleSelection() {
    if (!selectionAllowed(state.settings)) return;
    const selection = window.getSelection();
    const text = core.normalizeText(selection?.toString() || "");
    if (!core.shouldTranslateSelectionText(text, state.settings)) {
      removeSelectionUi();
      return;
    }
    if (selectionStartsInIgnoredArea(selection)) {
      removeSelectionUi();
      return;
    }
    const rect = getSelectionRect(selection);
    if (!rect) {
      removeSelectionUi();
      return;
    }
    showSelectionButton(text, rect);
  }

  function mountSelectionTranslation() {
    document.addEventListener("mouseup", () => window.setTimeout(handleSelection, 0));
    document.addEventListener("keyup", (event) => {
      if (event.key === "Escape") removeSelectionUi();
      else window.setTimeout(handleSelection, 0);
    });
    document.addEventListener("mousedown", (event) => {
      if (!event.target?.closest?.("[data-toktra='selection-button'],[data-toktra='selection-panel']")) {
        removeSelectionUi();
      }
    });
    window.addEventListener("scroll", removeSelectionUi, { passive: true });
  }

  function mutationIsToktraOnly(mutation) {
    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (
      nodes.length &&
      nodes.every((node) => node.nodeType === 1 && (node.matches?.("[data-toktra]") || node.querySelector?.("[data-toktra]")))
    ) {
      return true;
    }
    const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
    return Boolean(target?.closest?.("[data-toktra]"));
  }

  function observe() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver((mutations) => {
      if (mutations.every(mutationIsToktraOnly)) return;
      scheduleScan(500);
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    if (!state.scrollMounted) {
      state.scrollMounted = true;
      window.addEventListener("scroll", () => scheduleScan(180), { passive: true });
      window.addEventListener("resize", () => scheduleScan(220), { passive: true });
    }
  }

  async function boot() {
    const response = await sendMessage({ type: "TOKTRA_GET_SETTINGS" });
    if (!response?.ok) {
      console.warn("[toktra] failed to load settings:", response?.error || "unknown error");
      return;
    }
    state.settings = response.settings;
    if (!isToktraUsable(state.settings)) return;
    mountSelectionTranslation();
    if (!isAutoTranslateEnabledForDomain(state.settings)) return;
    if (core.isLikelyChinesePage(document)) return;
    scanNow();
    observe();
    loadStrategyAndAnalyze();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TOKTRA_SCAN_NOW") {
      sendMessage({ type: "TOKTRA_GET_SETTINGS" }).then((response) => {
        if (response?.ok) state.settings = response.settings;
        state.disabledForPage = false;
        const forceRefresh = Boolean(message.forceRefresh);
        const result = scanNow({ forceRefresh });
        if (result?.reason === "chinese_page") {
          sendResponse({ ok: false, reason: "chinese_page", error: "当前页面看起来是中文页，已跳过翻译。" });
          return;
        }
        observe();
        sendResponse({ ok: true, queued: result?.queued || 0, total: result?.total || 0 });
        loadStrategyAndAnalyze({ force: forceRefresh, forceRefresh });
      });
      return true;
    }
    if (message?.type === "TOKTRA_STOP_TRANSLATION") {
      sendResponse(stopTranslation());
      return false;
    }
    if (message?.type === "TOKTRA_SETTINGS_UPDATED") {
      state.settings = message.settings;
      scheduleScan(50);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
