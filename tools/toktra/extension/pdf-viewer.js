import * as pdfjsLib from "./vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const core = globalThis.ToktraCore;
const pdfCore = globalThis.ToktraPdfViewerCore;
const pagesEl = document.getElementById("pdfPages");
const pageRailEl = document.getElementById("pdfPageRail");
const statusEl = document.getElementById("pdfStatus");
const sourceEl = document.getElementById("pdfSource");
const refreshButton = document.getElementById("refreshPdf");
const exportButton = document.getElementById("exportPdf");

const state = {
  settings: null,
  segments: [],
  queuedElements: new WeakSet(),
  pending: new Map(),
  memoryCache: new Map(),
  pageElements: new Map(),
  pageLayouts: new Map(),
  pageTextItems: new Map(),
  renderedPreviews: new Set(),
  previewObserver: null,
  translating: false,
  scanTimer: null,
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

function sourceUrl() {
  return new URL(location.href).searchParams.get("src") || "";
}

function setStatus(text) {
  statusEl.textContent = text;
}

function resetProgress(total) {
  state.progress = {
    total,
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
  setStatus(`已处理 ${state.progress.translated}/${state.progress.total}`);
}

function beginRetry(count) {
  if (!state.progress) return;
  state.progress.failed = Math.max(0, state.progress.failed - Math.max(1, Number(count || 1)));
  state.progress.status = "running";
  core.renderProgress(document, state.progress);
  setStatus(`已处理 ${state.progress.translated}/${state.progress.total}`);
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

function markPageHasTranslation(element) {
  element?.closest?.(".pdf-page")?.classList.add("pdf-page--has-translation");
}

function resetPageTranslationStates() {
  document.querySelectorAll(".pdf-page--has-translation").forEach((page) => page.classList.remove("pdf-page--has-translation"));
}

function renderPdfTranslation(element, translation, sourceHash) {
  if (!element || !translation) return null;
  element.dataset.status = "translated";
  element.dataset.toktraSourceHash = sourceHash;
  element.replaceChildren(document.createTextNode(core.normalizeText ? core.normalizeText(translation) : String(translation || "").replace(/\s+/g, " ").trim()));
  markPageHasTranslation(element);
  return element;
}

function renderPdfTranslationError(element, item, message) {
  if (!element) return null;
  element.dataset.status = "error";
  element.dataset.toktraSourceHash = item?.hash || "";
  const label = document.createElement("span");
  label.textContent = message || "翻译失败";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "pdf-translation-segment__retry";
  retry.textContent = "重试";
  retry.title = "重新翻译当前模块";
  retry.setAttribute("aria-label", "重新翻译当前模块");
  retry.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    retryFailedElement(item, element);
  });
  element.replaceChildren(label, retry);
  markPageHasTranslation(element);
  return element;
}

function clearPdfTranslations() {
  document.querySelectorAll('.pdf-translation-segment[data-needs-translation="true"]').forEach((element) => {
    element.dataset.status = "idle";
    element.textContent = "";
  });
  resetPageTranslationStates();
}

function renderFailedItem(item, message) {
  if (!item) return 0;
  let failed = 0;
  item.elements.forEach((element) => {
    if (!document.documentElement.contains(element)) return;
    renderPdfTranslationError(element, item, message || "翻译失败");
    failed += 1;
  });
  if (failed) incrementProgress({ failed });
  return failed;
}

function queueTarget(target, forceRefresh) {
  const cached = !forceRefresh ? state.memoryCache.get(target.hash) : null;
  if (cached) {
    renderPdfTranslation(target.element, cached, target.hash);
    incrementProgress({ translated: 1, cached: 1 });
    return;
  }
  const existing = state.pending.get(target.hash);
  const item =
    existing || {
      id: target.id,
      text: target.text,
      hash: target.hash,
      kind: target.kind,
      elements: new Set(),
      forceRefresh: false
    };
  item.forceRefresh = item.forceRefresh || Boolean(forceRefresh);
  item.elements.add(target.element);
  state.pending.set(target.hash, item);
}

async function flushPending() {
  if (state.translating || !state.pending.size) return;
  state.translating = true;
  try {
    while (state.pending.size) {
      const batchSize = Math.max(1, Math.min(20, Number(state.settings?.batchSize || 8)));
      const batches = [];
      for (let index = 0; index < 4 && state.pending.size; index += 1) {
        const batch = Array.from(state.pending.values()).slice(0, batchSize);
        batch.forEach((item) => state.pending.delete(item.hash));
        batches.push(batch);
      }
      await Promise.all(
        batches.map(async (batch) => {
          const response = await sendMessage({
            type: "TOKTRA_TRANSLATE",
            segments: batch.map((item) => ({ id: item.id, text: item.text, hash: item.hash, kind: item.kind })),
            forceRefresh: batch.some((item) => item.forceRefresh)
          });
          if (!response?.ok) {
            batch.forEach((item) => renderFailedItem(item, "翻译失败"));
            return;
          }
          const translationsById = new Map(Array.from(response.results || []).map((result) => [result.id, result.text]));
          batch.forEach((item, index) => {
            const translation = translationsById.get(item.id) || response.translations?.[index];
            if (!translation) {
              renderFailedItem(item, "翻译失败");
              return;
            }
            state.memoryCache.set(item.hash, translation);
            let rendered = 0;
            item.elements.forEach((element) => {
              if (document.documentElement.contains(element)) {
                const renderedNode = renderPdfTranslation(element, translation, item.hash);
                if (renderedNode) {
                  rendered += 1;
                }
              }
            });
            if (rendered) incrementProgress({ translated: rendered });
          });
        })
      );
    }
  } finally {
    state.translating = false;
  }
}

function scanVisible(forceRefresh) {
  const visibleSegments = pdfCore.selectVisiblePdfSegments(state.segments, {
    scrollTop: window.scrollY,
    viewportHeight: window.innerHeight,
    screensAhead: 3
  });
  const targets = visibleSegments
    .map((segment) => {
      const rect = segment.element.getBoundingClientRect();
      return {
        id: segment.id,
        element: segment.element,
        text: segment.text,
        hash: segment.hash,
        kind: segment.kind || "pdf-paragraph",
        priority: 70,
        position: {
          index: segment.index,
          hasLayout: true,
          top: rect.top,
          left: rect.left
        }
      };
    })
    .filter((target) => forceRefresh || !state.queuedElements.has(target.element));
  const plan = core.planTranslationWork(targets, {
    cache: forceRefresh ? new Map() : state.memoryCache,
    queuedElements: state.queuedElements,
    viewportHeight: window.innerHeight,
    maxScreensAhead: 3
  });
  resetProgress(plan.total);
  plan.cached.forEach(({ target, translation }) => {
    state.queuedElements.add(target.element);
    renderPdfTranslation(target.element, translation, target.hash);
    incrementProgress({ translated: 1, cached: 1 });
  });
  plan.pending.forEach((target) => {
    state.queuedElements.add(target.element);
    queueTarget(target, forceRefresh);
  });
  flushPending();
}

function scheduleScan(delay) {
  window.clearTimeout(state.scanTimer);
  state.scanTimer = window.setTimeout(() => scanVisible(false), delay);
}

function createPageRailButton(pageNumber) {
  if (!pageRailEl) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pdf-page-rail__button";
  button.textContent = String(pageNumber);
  button.setAttribute("aria-label", `跳转到第 ${pageNumber} 页`);
  button.addEventListener("click", () => {
    state.pageElements.get(pageNumber)?.page.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  pageRailEl.appendChild(button);
}

function normalizePageLayout(layout) {
  const width = Math.max(1, Number(layout?.width || 612));
  const height = Math.max(1, Number(layout?.height || 792));
  const scale = Math.max(0.3, Number(layout?.scale || 1));
  return {
    width,
    height,
    scale,
    cssWidth: Math.round(width * scale),
    cssHeight: Math.round(height * scale)
  };
}

function createCanvasForViewport(viewport, pixelRatio, className) {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  canvas.width = Math.floor(viewport.width * pixelRatio);
  canvas.height = Math.floor(viewport.height * pixelRatio);
  canvas.style.width = `${Math.round(viewport.width)}px`;
  canvas.style.height = `${Math.round(viewport.height)}px`;
  return canvas;
}

function maskPdfText(context, viewport, textItems, pixelRatio) {
  const rects = pdfCore.pdfTextMaskRects(textItems, viewport, { padding: 2.5 });
  if (!rects.length) return;
  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#fff";
  rects.forEach((rect) => {
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
  });
  context.restore();
}

async function renderPdfCanvas(page, viewport, pixelRatio, className) {
  const canvas = createCanvasForViewport(viewport, pixelRatio, className);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context is unavailable.");
  await page.render({
    canvasContext: context,
    viewport,
    transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
  }).promise;
  return { canvas, context };
}

function createPageElement(pageNumber, layout) {
  const pageLayout = normalizePageLayout(layout || state.pageLayouts.get(pageNumber));
  const page = document.createElement("section");
  page.className = "pdf-page";
  page.dataset.pageNumber = String(pageNumber);

  const originalPane = document.createElement("article");
  originalPane.className = "pdf-page-pane pdf-page-original";
  originalPane.setAttribute("aria-label", `第 ${pageNumber} 页原文`);
  const preview = document.createElement("figure");
  preview.className = "pdf-page-media";
  preview.dataset.pagePreview = String(pageNumber);
  const loading = document.createElement("div");
  loading.className = "pdf-page-media__loading";
  loading.textContent = "原始 PDF 页面加载中...";
  preview.appendChild(loading);
  originalPane.appendChild(preview);

  const translationPane = document.createElement("article");
  translationPane.className = "pdf-page-pane pdf-page-translation";
  translationPane.setAttribute("aria-label", `第 ${pageNumber} 页译文`);
  const textLayer = document.createElement("div");
  textLayer.className = "pdf-page-text";
  const translationSheet = document.createElement("div");
  translationSheet.className = "pdf-translation-sheet";
  translationSheet.dataset.pageNumber = String(pageNumber);
  translationSheet.style.setProperty("--pdf-page-width", `${pageLayout.cssWidth}px`);
  translationSheet.style.setProperty("--pdf-page-height", `${pageLayout.cssHeight}px`);
  translationSheet.style.setProperty("--pdf-page-ratio", String(pageLayout.height / pageLayout.width));
  const empty = document.createElement("p");
  empty.className = "pdf-page-empty";
  empty.textContent = "译文会按当前阅读位置自动加载。";
  translationSheet.appendChild(empty);
  textLayer.appendChild(translationSheet);
  translationPane.appendChild(textLayer);

  page.append(originalPane, translationPane);
  pagesEl.appendChild(page);
  createPageRailButton(pageNumber);
  state.pageElements.set(pageNumber, { page, preview, textLayer, translationSheet, layout: pageLayout });
  return state.pageElements.get(pageNumber);
}

function renderSegments(rawSegments, pageCount, pageLayouts) {
  pagesEl.textContent = "";
  if (pageRailEl) pageRailEl.textContent = "";
  state.segments = [];
  state.pageElements = new Map();
  state.pageLayouts = pageLayouts || new Map();
  state.renderedPreviews = new Set();
  if (state.previewObserver) {
    state.previewObserver.disconnect();
    state.previewObserver = null;
  }
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    createPageElement(pageNumber, state.pageLayouts.get(pageNumber));
  }
  rawSegments.forEach((segment, index) => {
    const currentPage = state.pageElements.get(segment.pageNumber) || createPageElement(segment.pageNumber);
    const line = document.createElement("div");
    line.className = "pdf-translation-segment";
    const needsTranslation = core.shouldTranslateText(segment.text, state.settings);
    line.dataset.status = "idle";
    line.dataset.needsTranslation = String(needsTranslation);
    line.dataset.kind = segment.kind === "pdf-line" || segment.text.length < 90 ? "heading" : "paragraph";
    line.setAttribute("aria-label", segment.text);
    const scale = Number(currentPage.layout?.scale || 1);
    line.style.setProperty("--pdf-segment-left", `${Math.round(Number(segment.left || 0) * scale)}px`);
    line.style.setProperty("--pdf-segment-top", `${Math.round(Number(segment.pageTop ?? segment.top ?? 0) * scale)}px`);
    line.style.setProperty("--pdf-segment-width", `${Math.max(24, Math.round(Number(segment.width || currentPage.layout.width * 0.75) * scale))}px`);
    line.style.setProperty("--pdf-segment-height", `${Math.max(12, Math.round(Number(segment.height || segment.fontSize || 12) * scale))}px`);
    line.style.setProperty("--pdf-segment-font-size", `${Math.max(8, Math.round(Number(segment.fontSize || 11) * scale * 0.88))}px`);
    line.style.setProperty("--pdf-segment-rotation", `${Number(segment.angle || 0)}deg`);
    if (!needsTranslation) line.classList.add("pdf-translation-segment--copy");
    currentPage.translationSheet.appendChild(line);
    const hash = core.hashText(segment.text);
    if (!needsTranslation) {
      renderPdfTranslation(line, segment.text, hash);
      return;
    }
    state.segments.push({
      ...segment,
      id: `${segment.id}:${hash}`,
      index,
      hash,
      element: line,
      needsTranslation: core.shouldTranslateText(segment.text, state.settings)
    });
  });
}

async function renderPagePreview(pdf, pageNumber) {
  if (state.renderedPreviews.has(pageNumber)) return;
  const entry = state.pageElements.get(pageNumber);
  if (!entry) return;
  state.renderedPreviews.add(pageNumber);
  try {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Number(entry.layout?.scale || pdfCore.pdfPagePreviewScale(baseViewport, { maxCssWidth: 820 }));
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(2, Math.max(1, Number(window.devicePixelRatio || 1)));
    const { canvas } = await renderPdfCanvas(page, viewport, pixelRatio, "pdf-page-media__canvas");
    entry.preview.replaceChildren(canvas);
    const { canvas: underlay, context: underlayContext } = await renderPdfCanvas(page, viewport, pixelRatio, "pdf-translation-underlay");
    underlay.className = "pdf-translation-underlay";
    maskPdfText(underlayContext, viewport, state.pageTextItems.get(pageNumber), pixelRatio);
    entry.translationSheet.querySelector(".pdf-translation-underlay")?.remove();
    entry.translationSheet.prepend(underlay);
  } catch {
    entry.preview.textContent = "图片/图表暂不可用。";
  }
}

function schedulePagePreviews(pdf) {
  const pages = Array.from(state.pageElements.values());
  if (!pages.length) return;
  if (!("IntersectionObserver" in window)) {
    pages.slice(0, 3).forEach((entry) => renderPagePreview(pdf, Number(entry.page.dataset.pageNumber)));
    return;
  }
  state.previewObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const pageNumber = Number(entry.target.dataset.pageNumber);
        state.previewObserver?.unobserve(entry.target);
        renderPagePreview(pdf, pageNumber);
      });
    },
    { rootMargin: "1200px 0px" }
  );
  pages.forEach((entry) => state.previewObserver.observe(entry.page));
}

async function loadPdf() {
  const src = sourceUrl();
  if (!src) {
    setStatus("缺少 PDF 地址。");
    return;
  }
  sourceEl.textContent = src;
  const settingsResponse = await sendMessage({ type: "TOKTRA_GET_SETTINGS" });
  if (!settingsResponse?.ok || !settingsResponse.settings?.apiKey) {
    setStatus("请先在 toktra 设置里配置 API。");
    return;
  }
  state.settings = settingsResponse.settings;
  core.injectStyle(document);
  setStatus("正在读取 PDF 文本...");
  const response = await fetch(src);
  if (!response.ok) throw new Error(`PDF 请求失败：HTTP ${response.status}`);
  const data = await response.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const rawSegments = [];
  const pageLayouts = new Map();
  state.pageTextItems = new Map();
  let pageTop = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const scale = pdfCore.pdfPagePreviewScale(viewport, { maxCssWidth: 820 });
    pageLayouts.set(pageNumber, { width: viewport.width, height: viewport.height, scale });
    const textContent = await page.getTextContent();
    state.pageTextItems.set(pageNumber, textContent.items);
    rawSegments.push(
      ...pdfCore.groupPdfTextItems(textContent.items, {
        pageNumber,
        pageTop,
        pageWidth: viewport.width,
        pageHeight: viewport.height,
        includeLayoutOnly: true
      })
    );
    pageTop += Math.round(viewport.height || 1100) + 80;
  }
  renderSegments(rawSegments, pdf.numPages, pageLayouts);
  schedulePagePreviews(pdf);
  setStatus(`已提取 ${state.segments.length} 个 PDF 翻译文本段。`);
  scanVisible(false);
}

refreshButton.addEventListener("click", () => {
  state.queuedElements = new WeakSet();
  state.pending.clear();
  clearPdfTranslations();
  scanVisible(true);
});
exportButton?.addEventListener("click", () => {
  setStatus("正在打开打印窗口，可选择“另存为 PDF”导出中文译文。");
  window.print();
});
window.addEventListener("scroll", () => scheduleScan(160), { passive: true });
window.addEventListener("resize", () => scheduleScan(220), { passive: true });

loadPdf().catch((error) => {
  setStatus(error.message || "PDF 载入失败。");
});
