(function (global) {
  "use strict";

  const TRANSLATION_ATTR = "data-toktra";
  const TRANSLATION_VALUE = "translation";
  const TRANSLATION_ERROR_VALUE = "translation-error";
  const TRANSLATION_SELECTOR = `[${TRANSLATION_ATTR}="${TRANSLATION_VALUE}"]`;
  const TRANSLATION_ERROR_SELECTOR = `[${TRANSLATION_ATTR}="${TRANSLATION_ERROR_VALUE}"]`;
  const TRANSLATION_OUTPUT_SELECTOR = `${TRANSLATION_SELECTOR},${TRANSLATION_ERROR_SELECTOR}`;
  const PROGRESS_VALUE = "progress";
  const PROGRESS_SELECTOR = `[${TRANSLATION_ATTR}="${PROGRESS_VALUE}"]`;
  const IGNORED_SELECTOR = [
    `[${TRANSLATION_ATTR}]`,
    "script",
    "style",
    "noscript",
    "template",
    "textarea",
    "input",
    "select",
    "option",
    "svg",
    "canvas",
    "iframe",
    "video",
    "audio",
    "pre",
    "code",
    "kbd",
    "samp",
    "footer",
    "[role='contentinfo']",
    ".toc",
    "#toc",
    ".vector-toc",
    ".vector-body-before-content",
    "#siteSub",
    ".mw-editsection",
    ".reference",
    "sup.reference",
    ".noprint",
    ".hatnote",
    ".navigation-not-searchable",
    ".shortdescription",
    ".navbox",
    ".infobox",
    ".metadata",
    ".ambox",
    "[aria-hidden='true']",
    "[contenteditable='true']"
  ].join(",");

  const TARGET_TAGS = new Set([
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "P",
    "LI",
    "TD",
    "TH",
    "BLOCKQUOTE",
    "FIGCAPTION",
    "CAPTION",
    "DT",
    "DD",
    "SUMMARY",
    "LABEL",
    "LEGEND",
    "DIV",
    "SPAN",
    "BUTTON",
    "A"
  ]);

  const INLINE_TARGET_TAGS = new Set(["SPAN", "BUTTON", "A"]);
  const PLACEHOLDER_TARGET_TAGS = new Set(["INPUT", "TEXTAREA"]);
  const TRANSLATABLE_INPUT_TYPES = new Set(["", "text", "search", "url", "email", "tel", "number"]);
  const APPEND_TAGS = new Set(["LI", "TD", "TH", "DD", "DT", "SUMMARY", "LABEL", "LEGEND"]);
  const TARGET_SELECTOR = Array.from(TARGET_TAGS)
    .map((tagName) => tagName.toLowerCase())
    .join(",");
  const BLOCK_DESCENDANT_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "td",
    "th",
    "blockquote",
    "figcaption",
    "caption",
    "dt",
    "dd",
    "summary",
    "label",
    "legend",
    "a",
    "button"
  ].join(",");
  const INLINE_TARGET_DESCENDANT_SELECTOR = "span,button,a";
  const PLACEHOLDER_SELECTOR = "input[placeholder],textarea[placeholder]";
  const INLINE_PARENT_TARGET_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "td",
    "th",
    "blockquote",
    "figcaption",
    "caption",
    "dt",
    "dd",
    "summary",
    "label",
    "legend",
    "a",
    "button"
  ].join(",");
  const DEFAULT_MAX_TEXT_LENGTH = 3200;
  const OUTLINE_CONTAINER_SELECTOR = [
    "main",
    "article",
    "[role='main']",
    "section",
    "div",
    "p",
    "li",
    "td",
    "th",
    "blockquote",
    "figcaption",
    "span",
    "button",
    "a"
  ].join(",");
  const OUTLINE_SAMPLE_SELECTOR = "h1,h2,h3,p,li,blockquote,figcaption,span,button,a";
  const LAYOUT_SENSITIVE_NAV_SELECTOR = [
    "header nav",
    "header [role='navigation']",
    "header [role='menu']",
    "header [role='menubar']",
    "[role='banner'] nav",
    "[role='banner'] [role='navigation']",
    "[role='banner'] [role='menu']",
    "[role='banner'] [role='menubar']"
  ].join(",");

  function normalizeText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?%)\]])/g, "$1")
      .replace(/([(\\[])\s+/g, "$1")
      .trim();
  }

  function containsCjk(text) {
    return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
  }

  function isLikelyChineseText(text) {
    const normalized = normalizeText(text);
    if (!normalized) return false;
    const cjkCount = (normalized.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latinCount = (normalized.match(/[A-Za-z]/g) || []).length;
    const meaningfulCount = cjkCount + latinCount;
    return cjkCount >= 12 && cjkCount / Math.max(1, meaningfulCount) >= 0.35;
  }

  function isLikelyChinesePage(doc) {
    const documentRef = doc?.nodeType === 9 ? doc : doc?.ownerDocument || global.document;
    if (!documentRef) return false;
    const lang = String(documentRef.documentElement?.lang || "").toLowerCase();
    if (/^(zh|zh-|cmn|yue)/.test(lang)) return true;
    const contentRoot = resolveContentRoot(documentRef.body || documentRef.documentElement);
    const text = collectElementText(contentRoot || documentRef.body || documentRef.documentElement).slice(0, 6000);
    return isLikelyChineseText(text);
  }

  function looksEnglish(text) {
    const normalized = normalizeText(text);
    if (!/[A-Za-z]{2,}/.test(normalized)) return false;
    if (containsCjk(normalized)) return false;

    const compact = normalized.replace(/\s/g, "");
    const latinCount = (compact.match(/[A-Za-z]/g) || []).length;
    const letterLikeCount = (compact.match(/[A-Za-z0-9]/g) || []).length;
    return latinCount >= 4 && latinCount / Math.max(1, letterLikeCount) >= 0.45;
  }

  const COMMON_STANDALONE_WORDS = new Set([
    "about",
    "api",
    "back",
    "blog",
    "cancel",
    "close",
    "contact",
    "copy",
    "download",
    "edit",
    "help",
    "home",
    "login",
    "menu",
    "more",
    "next",
    "open",
    "read",
    "save",
    "search",
    "settings",
    "share",
    "submit",
    "tools",
    "view"
  ]);

  function englishWordTokens(text) {
    return String(text || "").match(/[A-Za-z][A-Za-z0-9’'-]*/g) || [];
  }

  function isCompleteStandaloneWord(word) {
    const normalized = String(word || "").replace(/[’'-]/g, "").toLowerCase();
    if (!normalized) return false;
    if (/^[A-Z]{2,}$/.test(word)) return true;
    if (COMMON_STANDALONE_WORDS.has(normalized)) return true;
    return normalized.length >= 6;
  }

  function isCompleteTranslationUnit(text) {
    const normalized = normalizeText(text);
    if (!normalized || /[-–—]$/.test(normalized)) return false;
    const tokens = englishWordTokens(normalized);
    if (tokens.length !== 1) return tokens.length > 1;
    return isCompleteStandaloneWord(tokens[0]);
  }

  function shouldTranslateText(text, options) {
    const normalized = normalizeText(text);
    const minTextLength = Number(options?.minTextLength ?? 4);
    const maxTextLength = Number(options?.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH);
    if (normalized.length < minTextLength || normalized.length > maxTextLength) return false;
    if (/^[\d\s.,:;!?()[\]{}'"`~@#$%^&*+=|\\/<>-]+$/.test(normalized)) return false;
    if (!isCompleteTranslationUnit(normalized)) return false;
    return looksEnglish(normalized);
  }

  function shouldTranslateSelectionText(text, options) {
    const normalized = normalizeText(text);
    const minTextLength = Number(options?.minSelectionTextLength ?? 2);
    const maxTextLength = Number(options?.maxSelectionTextLength ?? 1200);
    if (normalized.length < minTextLength || normalized.length > maxTextLength) return false;
    if (/^[\d\s.,:;!?()[\]{}'"`~@#$%^&*+=|\\/<>-]+$/.test(normalized)) return false;
    return looksEnglish(normalized);
  }

  function clampPosition(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizeRect(rect) {
    const left = toFiniteNumber(rect?.left, 0);
    const top = toFiniteNumber(rect?.top, 0);
    const right = toFiniteNumber(rect?.right, left + toFiniteNumber(rect?.width, 0));
    const bottom = toFiniteNumber(rect?.bottom, top + toFiniteNumber(rect?.height, 0));
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  function rectsOverlap(first, second, padding) {
    const a = normalizeRect(first);
    const b = normalizeRect(second);
    const gap = toFiniteNumber(padding, 0);
    return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
  }

  function makeFloatingRect(left, top, width, height) {
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height
    };
  }

  function pushBelowAvoidRects(left, top, width, height, avoidRects, collisionPadding) {
    let nextTop = top;
    const rects = Array.from(avoidRects || [])
      .map(normalizeRect)
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .sort((a, b) => a.top - b.top);

    for (const rect of rects) {
      const candidate = makeFloatingRect(left, nextTop, width, height);
      if (rectsOverlap(candidate, rect, collisionPadding)) {
        nextTop = rect.bottom + collisionPadding;
      }
    }
    return nextTop;
  }

  function computeFloatingPosition(anchorRect, options) {
    const anchor = normalizeRect(anchorRect);
    const viewportWidth = Math.max(1, toFiniteNumber(options?.viewportWidth, 1024));
    const viewportHeight = Math.max(1, toFiniteNumber(options?.viewportHeight, 768));
    const margin = Math.max(0, toFiniteNumber(options?.margin, 12));
    const width = Math.max(1, toFiniteNumber(options?.elementWidth, 320));
    const height = Math.max(1, toFiniteNumber(options?.elementHeight, 48));
    const offsetY = Math.max(0, toFiniteNumber(options?.offsetY, 12));
    const horizontalShift = toFiniteNumber(options?.horizontalShift, 0);
    const collisionPadding = Math.max(0, toFiniteNumber(options?.collisionPadding, 8));
    const maxLeft = Math.max(margin, viewportWidth - width - margin);
    const left = clampPosition(anchor.left + horizontalShift, margin, maxLeft);
    let top = pushBelowAvoidRects(left, anchor.bottom + offsetY, width, height, options?.avoidRects, collisionPadding);

    if (top + height + margin > viewportHeight) {
      top = Math.max(margin, anchor.top - height - offsetY);
    }

    return {
      left: Math.round(left),
      top: Math.round(top)
    };
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

  function normalizeStructureStrategy(strategy) {
    const source = strategy && typeof strategy === "object" ? strategy : {};
    const normalized = {
      contentSelectors: normalizeSelectorList(source.contentSelectors, 6),
      excludeSelectors: normalizeSelectorList(source.excludeSelectors, 12)
    };
    const minTextLength = Number(source.minTextLength);
    if (Number.isFinite(minTextLength) && minTextLength >= 4 && minTextLength <= 200) {
      normalized.minTextLength = Math.round(minTextLength);
    }
    return normalized;
  }

  function mergeSelectorValues(first, second, limit) {
    return normalizeSelectorList([...(first || []), ...(second || [])], limit);
  }

  function mergeStructureStrategies(primary, secondary) {
    const left = normalizeStructureStrategy(primary);
    const right = normalizeStructureStrategy(secondary);
    const merged = {
      contentSelectors: mergeSelectorValues(left.contentSelectors, right.contentSelectors, 12),
      excludeSelectors: mergeSelectorValues(left.excludeSelectors, right.excludeSelectors, 24)
    };
    if (Number.isFinite(Number(left.minTextLength))) merged.minTextLength = left.minTextLength;
    else if (Number.isFinite(Number(right.minTextLength))) merged.minTextLength = right.minTextLength;
    return merged;
  }

  function normalizeHostname(hostname) {
    return String(hostname || "")
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .trim()
      .toLowerCase();
  }

  function ruleDomainMatches(hostname, pattern) {
    const host = normalizeHostname(hostname);
    const rule = normalizeHostname(pattern).replace(/^\*\./, "");
    if (!host || !rule) return false;
    return host === rule || host.endsWith(`.${rule}`);
  }

  function parseSiteRules(rulesText, hostname) {
    const contentSelectors = [];
    const excludeSelectors = [];
    String(rulesText || "")
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
      .forEach((line) => {
        const includeIndex = line.indexOf("#+#");
        const excludeIndex = includeIndex < 0 ? line.indexOf("##") : -1;
        const markerIndex = includeIndex >= 0 ? includeIndex : excludeIndex;
        if (markerIndex <= 0) return;
        const domain = line.slice(0, markerIndex).trim();
        const selector = line.slice(markerIndex + (includeIndex >= 0 ? 3 : 2)).trim();
        if (!ruleDomainMatches(hostname, domain)) return;
        if (includeIndex >= 0) contentSelectors.push(selector);
        else excludeSelectors.push(selector);
      });
    return {
      contentSelectors: normalizeSelectorList(contentSelectors, 12),
      excludeSelectors: normalizeSelectorList(excludeSelectors, 24)
    };
  }

  function queryFirstSafe(root, selectors) {
    for (const selector of selectors) {
      try {
        if (root.matches?.(selector)) return root;
        const candidate = root.querySelector?.(selector);
        if (candidate) return candidate;
      } catch {
        // Ignore invalid AI-provided selectors.
      }
    }
    return null;
  }

  function matchesAnySafe(element, selectors) {
    for (const selector of selectors) {
      try {
        if (element.matches?.(selector) || element.closest?.(selector)) return true;
      } catch {
        // Ignore invalid AI-provided selectors.
      }
    }
    return false;
  }

  function hashText(value) {
    const text = normalizeText(value);
    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
    }
    return `t${(hash >>> 0).toString(36)}`;
  }

  function targetKind(element) {
    if (isPlaceholderTarget(element)) return "placeholder";
    const tag = String(element?.tagName || "").toUpperCase();
    if (/^H[1-6]$/.test(tag)) return "heading";
    if (tag === "P" || tag === "BLOCKQUOTE" || tag === "FIGCAPTION" || tag === "CAPTION") return "paragraph";
    if (tag === "LI" || tag === "DD" || tag === "DT" || tag === "SUMMARY") return "list";
    if (tag === "TD" || tag === "TH") return "table";
    if (tag === "A") return "link";
    if (tag === "BUTTON") return "button";
    if (tag === "SPAN" || tag === "LABEL" || tag === "LEGEND") return "inline";
    return "block";
  }

  function targetPriority(kind, position) {
    const kindScore = {
      heading: 100,
      placeholder: 86,
      button: 84,
      link: 80,
      paragraph: 72,
      list: 68,
      table: 64,
      inline: 56,
      block: 52
    }[kind] || 50;
    const top = Number(position?.top);
    const viewportBoost = Number.isFinite(top) && top >= 0 && top < 900 ? 20 : 0;
    return kindScore + viewportBoost;
  }

  function createSegmentTarget(element, text, hash, index) {
    const kind = targetKind(element);
    const position = getVisualPosition({ element }, index);
    const selector = elementSelector(element) || String(element?.tagName || "node").toLowerCase();
    return {
      id: `${hash}:${kind}:${selector}`,
      element,
      text,
      hash,
      kind,
      priority: targetPriority(kind, position),
      position
    };
  }

  function isIgnoredElement(element, options) {
    if (!element || element.nodeType !== 1) return true;
    const strategy = normalizeStructureStrategy(options?.structureStrategy);
    if (strategy.excludeSelectors.length && matchesAnySafe(element, strategy.excludeSelectors)) return true;
    if (isLayoutSensitiveNavigationElement(element)) return true;
    return Boolean(element.closest?.(IGNORED_SELECTOR));
  }

  function isLayoutSensitiveNavigationElement(element) {
    if (!element || element.nodeType !== 1) return false;
    if (element.closest?.(LAYOUT_SENSITIVE_NAV_SELECTOR)) return true;
    const trigger = element.closest?.("[aria-haspopup]");
    if (trigger?.closest?.("header,[role='banner']")) return true;
    const nav = element.closest?.("nav,[role='navigation']");
    return Boolean(nav?.closest?.("header,[role='banner']"));
  }

  function isVisibleElement(element) {
    if (!element || element.nodeType !== 1) return false;
    const view = element.ownerDocument?.defaultView || global;
    const style = view.getComputedStyle ? view.getComputedStyle(element) : null;
    if (style && (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)) {
      return false;
    }
    return true;
  }

  function isTargetElement(element) {
    return Boolean(element && TARGET_TAGS.has(element.tagName));
  }

  function isPlaceholderTarget(element) {
    if (!element || !PLACEHOLDER_TARGET_TAGS.has(element.tagName)) return false;
    if (element.tagName === "INPUT") {
      const type = String(element.getAttribute?.("type") || "").toLowerCase();
      if (!TRANSLATABLE_INPUT_TYPES.has(type)) return false;
    }
    return Boolean(element.getAttribute?.("placeholder"));
  }

  function isIgnoredPlaceholderElement(element) {
    if (!element || element.nodeType !== 1) return true;
    if (element.closest?.(`[${TRANSLATION_ATTR}],script,style,noscript,template,svg,canvas,iframe,video,audio,pre,code,kbd,samp`)) {
      return true;
    }
    if (element.closest?.("[aria-hidden='true'],[contenteditable='true']")) return true;
    return !isVisibleElement(element);
  }

  function resolveContentRoot(root, options) {
    if (!root) return root;
    const base = root.nodeType === 9 ? root.body || root.documentElement : root;
    if (!base || base.nodeType !== 1) return root;
    const strategy = normalizeStructureStrategy(options?.structureStrategy || options);
    const strategyRoot = queryFirstSafe(base, strategy.contentSelectors);
    if (strategyRoot) return strategyRoot;
    const selectors = [
      "main",
      "[role='main']",
      "article",
      "#content",
      ".mw-body",
      ".mw-body-content",
      "#mw-content-text",
      ".mw-parser-output"
    ];
    for (const selector of selectors) {
      if (base.matches?.(selector)) return base;
      const candidate = base.querySelector?.(selector);
      if (candidate) return candidate;
    }
    return base;
  }

  function isSuitableTarget(element, options) {
    if (!element || !isTargetElement(element) || isIgnoredElement(element, options) || !isVisibleElement(element)) return false;
    if (INLINE_TARGET_TAGS.has(element.tagName) && element.parentElement?.closest?.(INLINE_PARENT_TARGET_SELECTOR)) {
      return false;
    }
    if ((element.tagName === "DIV" || element.tagName === "BLOCKQUOTE") && element.querySelector?.(BLOCK_DESCENDANT_SELECTOR)) {
      return false;
    }
    return true;
  }

  function findTargetElement(textNode, root) {
    let element = textNode.parentElement;
    while (element && element !== root && !isTargetElement(element)) {
      if (isIgnoredElement(element)) return null;
      element = element.parentElement;
    }
    if (!element || isIgnoredElement(element) || !isTargetElement(element)) return null;
    return element;
  }

  function textNodesUnder(element) {
    const doc = element.ownerDocument || global.document;
    const view = doc?.defaultView || global;
    const filter = view.NodeFilter || global.NodeFilter || {
      SHOW_TEXT: 4,
      FILTER_ACCEPT: 1,
      FILTER_REJECT: 2
    };
    const nodes = [];
    const walker = doc.createTreeWalker(
      element,
      filter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent || isIgnoredElement(parent)) return filter.FILTER_REJECT;
          return normalizeText(node.textContent) ? filter.FILTER_ACCEPT : filter.FILTER_REJECT;
        }
      }
    );

    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function collectElementText(element, options) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.(IGNORED_SELECTOR).forEach((node) => node.remove());
    const strategy = normalizeStructureStrategy(options?.structureStrategy);
    for (const selector of strategy.excludeSelectors) {
      try {
        clone.querySelectorAll?.(selector).forEach((node) => node.remove());
      } catch {
        // Ignore invalid AI-provided selectors.
      }
    }
    return normalizeText(clone.textContent || "");
  }

  function collectTargets(root, options) {
    if (!root) return [];
    const strategy = normalizeStructureStrategy(options?.structureStrategy);
    const baseRoot = root.nodeType === 9 ? root.body || root.documentElement : root;
    const contentRoot = strategy.contentSelectors.length ? resolveContentRoot(root, { structureStrategy: strategy }) : baseRoot;
    const targets = new Map();
    const candidates = [];

    if (isTargetElement(contentRoot)) candidates.push(contentRoot);
    contentRoot.querySelectorAll?.(TARGET_SELECTOR).forEach((element) => candidates.push(element));

    for (const target of candidates) {
      if (!isSuitableTarget(target, { structureStrategy: strategy }) || targets.has(target)) continue;
      const text = collectElementText(target, { structureStrategy: strategy });
      if (!shouldTranslateText(text, { ...options, minTextLength: strategy.minTextLength ?? options?.minTextLength })) continue;
      const hash = hashText(text);
      const existing = getExistingTranslation(target);
      if (!options?.forceRefresh && existing && existing.dataset.toktraSourceHash === hash) continue;
      let shouldAdd = true;
      for (const [existingElement, existingTarget] of Array.from(targets.entries())) {
        if (existingTarget.text !== text) continue;
        if (existingElement.contains?.(target)) {
          targets.delete(existingElement);
        } else if (target.contains?.(existingElement)) {
          shouldAdd = false;
          break;
        }
      }
      if (!shouldAdd) continue;
      for (const [existingElement, existingTarget] of Array.from(targets.entries())) {
        if (existingTarget.text !== text && existingElement.contains?.(target)) {
          shouldAdd = false;
          break;
        }
      }
      if (!shouldAdd) continue;
      targets.set(target, createSegmentTarget(target, text, hash, targets.size));
    }

    contentRoot.querySelectorAll?.(PLACEHOLDER_SELECTOR).forEach((element) => {
      if (!isPlaceholderTarget(element) || isIgnoredPlaceholderElement(element) || targets.has(element)) return;
      const text = normalizeText(element.getAttribute("placeholder") || "");
      if (!shouldTranslateText(text, { ...options, minTextLength: strategy.minTextLength ?? options?.minTextLength })) return;
      const hash = hashText(text);
      const existing = getExistingTranslation(element);
      const existingHash = existing?.dataset?.toktraSourceHash || existing?.dataset?.toktraPlaceholderSourceHash;
      if (!options?.forceRefresh && existingHash === hash) return;
      targets.set(element, createSegmentTarget(element, text, hash, targets.size));
    });

    return sortTargets(Array.from(targets.values()));
  }

  function selectorToken(value) {
    const token = String(value || "").trim();
    return /^[A-Za-z_][\w-]*$/.test(token) ? token : "";
  }

  function elementSelector(element) {
    if (!element || element.nodeType !== 1) return "";
    const id = selectorToken(element.id);
    if (id) return `#${id}`;
    const classes = Array.from(element.classList || []).map(selectorToken).filter(Boolean).slice(0, 2);
    if (classes.length) return `.${classes.join(".")}`;
    const role = selectorToken(element.getAttribute?.("role"));
    const tag = String(element.tagName || "").toLowerCase();
    if (role) return `${tag}[role="${role}"]`;
    return tag;
  }

  function linkTextLength(element) {
    return Array.from(element.querySelectorAll?.("a") || []).reduce((total, link) => total + normalizeText(link.textContent).length, 0);
  }

  function outlineScore(node) {
    const semanticBoost = /^(main|article|section)$/i.test(node.tag) || /\b(article|content|post|story|body)\b/i.test(node.selector) ? 100 : 0;
    return node.textLength * (1 - Math.min(0.9, node.linkRatio)) + semanticBoost;
  }

  function buildStructureOutline(doc, options) {
    const documentRef = doc?.nodeType === 9 ? doc : doc?.ownerDocument || global.document;
    if (!documentRef) return { url: "", title: "", lang: "", nodes: [], textSamples: [] };
    const maxNodes = Math.max(4, Math.min(80, Number(options?.maxNodes || 40)));
    const maxSampleLength = Math.max(40, Math.min(240, Number(options?.maxSampleLength || 140)));
    const base = documentRef.body || documentRef.documentElement;
    const candidates = Array.from(base?.querySelectorAll?.(OUTLINE_CONTAINER_SELECTOR) || []);
    if (base?.matches?.(OUTLINE_CONTAINER_SELECTOR)) candidates.unshift(base);

    const nodes = candidates
      .map((element) => {
        const text = collectElementText(element);
        const textLength = text.length;
        if (textLength < 24) return null;
        const selector = elementSelector(element);
        if (!selector) return null;
        const links = linkTextLength(element);
        const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
        return {
          selector,
          tag: String(element.tagName || "").toLowerCase(),
          role: element.getAttribute?.("role") || "",
          textLength,
          linkRatio: Number((links / Math.max(1, textLength)).toFixed(2)),
          childCount: element.children?.length || 0,
          top: Number.isFinite(Number(rect?.top)) ? Math.round(Number(rect.top)) : null,
          sample: text.slice(0, maxSampleLength)
        };
      })
      .filter(Boolean)
      .sort((a, b) => outlineScore(b) - outlineScore(a))
      .slice(0, maxNodes);

    const textSamples = Array.from(base?.querySelectorAll?.(OUTLINE_SAMPLE_SELECTOR) || [])
      .map((element) => collectElementText(element).slice(0, maxSampleLength))
      .filter((text) => shouldTranslateText(text, { minTextLength: 12, maxTextLength: maxSampleLength }))
      .slice(0, 12);

    return {
      url: String(options?.url || documentRef.location?.href || ""),
      title: normalizeText(documentRef.title || ""),
      lang: String(documentRef.documentElement?.lang || ""),
      nodes,
      textSamples
    };
  }

  function getVisualPosition(target, index) {
    const rect = typeof target.element.getBoundingClientRect === "function" ? target.element.getBoundingClientRect() : null;
    const top = Number(rect?.top);
    const left = Number(rect?.left);
    return {
      index,
      hasLayout: Number.isFinite(top) && Number.isFinite(left),
      top,
      left
    };
  }

  function sortTargets(items) {
    return items
      .map((item, index) => ({ item, position: getVisualPosition(item, index) }))
      .sort((a, b) => {
        if (a.position.hasLayout && b.position.hasLayout) {
          const topDiff = a.position.top - b.position.top;
          if (Math.abs(topDiff) > 4) return topDiff;
          const leftDiff = a.position.left - b.position.left;
          if (Math.abs(leftDiff) > 4) return leftDiff;
        }
        return a.position.index - b.position.index;
      })
      .map(({ item }) => item);
  }

  function selectProgressiveTargets(items, options) {
    const queuedHashes = options?.queuedHashes || new Set();
    const queuedElements = options?.queuedElements || null;
    const limit = Math.max(1, Math.min(50, Number(options?.limit || 8)));
    const viewportHeight = Math.max(1, Number(options?.viewportHeight || 900));
    const viewportMultiplier = Math.max(1, Math.min(4, Number(options?.viewportMultiplier || 1.6)));
    const nearViewportBottom = viewportHeight * viewportMultiplier;

    return Array.from(items || [])
      .map((item, index) => ({ item, position: getVisualPosition(item, index) }))
      .filter(({ item }) => !(queuedElements?.has?.(item.element) || queuedHashes.has(item.hash)))
      .sort((a, b) => {
        const aTop = a.position.hasLayout ? a.position.top : Number.POSITIVE_INFINITY;
        const bTop = b.position.hasLayout ? b.position.top : Number.POSITIVE_INFINITY;
        const aBucket = aTop <= nearViewportBottom ? 0 : 1;
        const bBucket = bTop <= nearViewportBottom ? 0 : 1;
        if (aBucket !== bBucket) return aBucket - bBucket;
        if (a.position.hasLayout && b.position.hasLayout) {
          const topDiff = a.position.top - b.position.top;
          if (Math.abs(topDiff) > 4) return topDiff;
          const leftDiff = a.position.left - b.position.left;
          if (Math.abs(leftDiff) > 4) return leftDiff;
        }
        return a.position.index - b.position.index;
      })
      .slice(0, limit)
      .map(({ item }) => item);
  }

  function planTranslationWork(items, options) {
    const cache = options?.cache || new Map();
    const queuedElements = options?.queuedElements || null;
    const viewportHeight = Math.max(1, Number(options?.viewportHeight || 900));
    const viewportMultiplier = Math.max(1, Math.min(4, Number(options?.viewportMultiplier || 1.6)));
    const maxScreensAhead = Math.max(1, Math.min(8, Number(options?.maxScreensAhead || 3)));
    const nearViewportBottom = viewportHeight * viewportMultiplier;
    const activeWindowBottom = viewportHeight * maxScreensAhead;
    const activeWindowTop = -viewportHeight;
    const cached = [];
    const pending = [];
    const deferred = [];
    Array.from(items || []).forEach((target) => {
      if (queuedElements?.has?.(target.element)) return;
      const top = Number(target.position?.top);
      const isActiveWindow = !target.position?.hasLayout || !Number.isFinite(top) || (top >= activeWindowTop && top < activeWindowBottom);
      if (!isActiveWindow) {
        deferred.push(target);
        return;
      }
      const translation = cache.get?.(target.hash);
      if (translation) cached.push({ target, translation });
      else pending.push(target);
    });
    const byReadingPriority = (a, b) => {
      const aTop = Number(a.position?.top);
      const bTop = Number(b.position?.top);
      const aBucket = Number.isFinite(aTop) && aTop <= nearViewportBottom ? 0 : 1;
      const bBucket = Number.isFinite(bTop) && bTop <= nearViewportBottom ? 0 : 1;
      if (aBucket !== bBucket) return aBucket - bBucket;
      if (a.position?.hasLayout && b.position?.hasLayout) {
        const topDiff = aTop - bTop;
        if (Math.abs(topDiff) > 4) return topDiff;
        const leftDiff = Number(a.position.left) - Number(b.position.left);
        if (Math.abs(leftDiff) > 4) return leftDiff;
      }
      const indexDiff = Number(a.position?.index || 0) - Number(b.position?.index || 0);
      if (indexDiff) return indexDiff;
      return Number(b.priority || 0) - Number(a.priority || 0);
    };
    cached.sort((a, b) => byReadingPriority(a.target, b.target));
    pending.sort(byReadingPriority);
    return {
      cached,
      pending,
      deferred,
      total: cached.length + pending.length
    };
  }

  function getExistingTranslation(target) {
    if (isPlaceholderTarget(target)) {
      return target.dataset?.toktraPlaceholderSourceHash ? target : null;
    }
    const anchor = resolveRenderAnchor(target);
    if (!anchor) return null;
    if (APPEND_TAGS.has(anchor.tagName)) {
      return Array.from(anchor.children || []).find((child) => child.matches?.(TRANSLATION_OUTPUT_SELECTOR)) || null;
    }
    const next = anchor.nextElementSibling;
    return next?.matches?.(TRANSLATION_OUTPUT_SELECTOR) ? next : null;
  }

  function removeExistingTranslation(target) {
    const existing = getExistingTranslation(target);
    if (existing) existing.remove();
  }

  function removeTranslations(doc) {
    const documentRef = doc?.nodeType === 9 ? doc : doc?.ownerDocument || global.document;
    if (!documentRef) return 0;
    const nodes = Array.from(documentRef.querySelectorAll?.("[data-toktra]") || []);
    nodes.forEach((node) => node.remove());
    const placeholderNodes = Array.from(documentRef.querySelectorAll?.("[data-toktra-placeholder-original]") || []);
    placeholderNodes.forEach((node) => {
      node.setAttribute("placeholder", node.dataset.toktraPlaceholderOriginal || "");
      delete node.dataset.toktraPlaceholderOriginal;
      delete node.dataset.toktraPlaceholderSourceHash;
    });
    return nodes.length + placeholderNodes.length;
  }

  function renderProgress(doc, progress) {
    const documentRef = doc?.nodeType === 9 ? doc : doc?.ownerDocument || global.document;
    if (!documentRef?.body) return null;
    injectStyle(documentRef);
    let node = documentRef.querySelector?.(PROGRESS_SELECTOR);
    if (!node) {
      node = documentRef.createElement("div");
      node.setAttribute(TRANSLATION_ATTR, PROGRESS_VALUE);
      node.className = "toktra-progress";
      documentRef.body.appendChild(node);
    }
    const translated = Math.max(0, Number(progress?.translated || 0));
    const total = Math.max(0, Number(progress?.total || 0));
    const cached = Math.max(0, Number(progress?.cached || 0));
    const failed = Math.max(0, Number(progress?.failed || 0));
    const details = [];
    if (cached) details.push(`缓存 ${cached}`);
    if (failed) details.push(`失败 ${failed}`);
    node.dataset.status = String(progress?.status || (translated >= total ? "complete" : "running"));
    node.textContent = `toktra ${translated}/${total}${details.length ? ` · ${details.join(" · ")}` : ""}`;
    return node;
  }

  function createTranslationNode(doc, text, sourceHash) {
    const node = doc.createElement("div");
    node.setAttribute(TRANSLATION_ATTR, TRANSLATION_VALUE);
    node.dataset.toktraSourceHash = sourceHash;
    node.className = "toktra-translation";
    node.textContent = normalizeText(text);
    return node;
  }

  function createTranslationErrorNode(doc, sourceHash, onRetry, message) {
    const node = doc.createElement("div");
    node.setAttribute(TRANSLATION_ATTR, TRANSLATION_ERROR_VALUE);
    node.dataset.toktraSourceHash = sourceHash;
    node.className = "toktra-translation toktra-translation--error";
    const label = doc.createElement("span");
    label.className = "toktra-translation__error-message";
    label.textContent = message || "翻译失败";
    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "toktra-translation__retry";
    retry.setAttribute("aria-label", "重新翻译当前模块");
    retry.title = "重新翻译当前模块";
    retry.textContent = "重试";
    retry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onRetry === "function") onRetry();
    });
    node.append(label, retry);
    return node;
  }

  function resolveRenderAnchor(target) {
    if (!target || target.nodeType !== 1) return null;
    let anchor = target;
    if (INLINE_TARGET_TAGS.has(target.tagName)) {
      anchor = target.closest?.("a") || target;
      const heading = anchor.parentElement?.closest?.("h1,h2,h3,h4,h5,h6");
      if (heading?.contains?.(anchor)) anchor = heading;
    }
    return anchor;
  }

  function renderTranslation(target, translatedText, sourceHash) {
    if (!target || !translatedText) return null;
    if (isPlaceholderTarget(target)) {
      if (!target.dataset.toktraPlaceholderOriginal) {
        target.dataset.toktraPlaceholderOriginal = target.getAttribute("placeholder") || "";
      }
      target.dataset.toktraPlaceholderSourceHash = sourceHash;
      target.setAttribute("placeholder", normalizeText(translatedText));
      return target;
    }
    const doc = target.ownerDocument || global.document;
    removeExistingTranslation(target);
    const anchor = resolveRenderAnchor(target);
    if (!anchor) return null;
    const node = createTranslationNode(doc, translatedText, sourceHash);
    if (APPEND_TAGS.has(anchor.tagName)) {
      anchor.appendChild(node);
      return node;
    }
    anchor.parentNode?.insertBefore(node, anchor.nextSibling);
    return node;
  }

  function renderTranslationError(target, sourceHash, onRetry, message) {
    if (!target || isPlaceholderTarget(target)) return null;
    const doc = target.ownerDocument || global.document;
    removeExistingTranslation(target);
    const anchor = resolveRenderAnchor(target);
    if (!anchor) return null;
    const node = createTranslationErrorNode(doc, sourceHash, onRetry, message);
    if (APPEND_TAGS.has(anchor.tagName)) {
      anchor.appendChild(node);
      return node;
    }
    anchor.parentNode?.insertBefore(node, anchor.nextSibling);
    return node;
  }

  function injectStyle(doc) {
    const documentRef = doc || global.document;
    if (!documentRef || documentRef.getElementById("toktra-style")) return;
    const style = documentRef.createElement("style");
    style.id = "toktra-style";
    style.setAttribute(TRANSLATION_ATTR, "style");
    style.textContent = `
.toktra-translation{
  box-sizing:border-box;
  margin:.35em 0 .65em;
  padding:.42em .65em;
  border-left:3px solid #2f6f55;
  border-radius:0 5px 5px 0;
  background:#eef7f1;
  color:#24513e;
  font:500 0.92em/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  letter-spacing:0;
}
.toktra-translation--error{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  border-left-color:#b85c2c;
  background:#fff8ef;
  color:#7a3519;
}
.toktra-translation__error-message{
  min-width:0;
}
.toktra-translation__retry{
  flex:0 0 auto;
  min-width:38px;
  height:24px;
  padding:0 8px;
  border:1px solid #d8b79a;
  border-radius:5px;
  background:#fff;
  color:#7a3519;
  cursor:pointer;
  font:700 12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  letter-spacing:0;
}
.toktra-translation__retry:hover{
  background:#fff1e3;
}
li>.toktra-translation,td>.toktra-translation,th>.toktra-translation{
  margin:.35em 0 0;
}
.toktra-selection-button,.toktra-selection-panel,.toktra-selection-panel *{
  box-sizing:border-box;
}
.toktra-progress{
  position:fixed;
  right:14px;
  bottom:14px;
  z-index:2147483646;
  max-width:min(260px,calc(100vw - 28px));
  padding:7px 10px;
  border:1px solid #d8d5ca;
  border-radius:7px;
  background:#fffefa;
  color:#24513e;
  box-shadow:0 10px 28px rgba(20,20,19,.14);
  font:700 12px/1.35 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  letter-spacing:0;
  pointer-events:none;
}
.toktra-progress[data-status="complete"]{
  opacity:.78;
}
.toktra-selection-button{
  position:fixed;
  z-index:2147483647;
  min-width:92px;
  height:30px;
  padding:0 11px;
  border:1px solid #24513e;
  border-radius:7px;
  background:#2f6f55;
  color:#fff;
  box-shadow:0 12px 28px rgba(20,20,19,.22);
  cursor:pointer;
  font:700 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  letter-spacing:0;
}
.toktra-selection-panel{
  position:fixed;
  z-index:2147483647;
  width:min(420px,calc(100vw - 28px));
  max-height:min(360px,calc(100vh - 28px));
  overflow:auto;
  padding:12px 14px 14px;
  border:1px solid #d8d5ca;
  border-radius:8px;
  background:#fffefa;
  color:#171816;
  box-shadow:0 18px 48px rgba(20,20,19,.24);
  font:14px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
  letter-spacing:0;
}
.toktra-selection-panel__top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:8px;
  color:#24513e;
  font-weight:800;
}
.toktra-selection-panel__close{
  width:26px;
  height:26px;
  border:1px solid #e0ded4;
  border-radius:6px;
  background:#fff;
  color:#24513e;
  cursor:pointer;
  font:700 16px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;
}
.toktra-selection-panel__source{
  margin:0 0 9px;
  color:#62645e;
  font-size:12px;
  line-height:1.45;
}
.toktra-selection-panel__result{
  margin:0;
  color:#171816;
  white-space:pre-wrap;
}
.toktra-selection-panel__result[data-loading="true"]{
  display:flex;
  align-items:center;
  gap:9px;
  color:#62645e;
}
.toktra-selection-panel__result[data-loading="true"]::before{
  content:"";
  width:14px;
  height:14px;
  border:2px solid #d7e8dc;
  border-top-color:#2f6f55;
  border-radius:50%;
  animation:toktra-spin .8s linear infinite;
}
@keyframes toktra-spin{to{transform:rotate(360deg)}}
@media print{.toktra-translation{break-inside:avoid}}
`;
    documentRef.head?.appendChild(style);
  }

  global.ToktraCore = {
    APPEND_TAGS,
    IGNORED_SELECTOR,
    TARGET_TAGS,
    TRANSLATION_SELECTOR,
    buildStructureOutline,
    collectTargets,
    computeFloatingPosition,
    containsCjk,
    hashText,
    injectStyle,
    isIgnoredElement,
    isCompleteTranslationUnit,
    isLikelyChinesePage,
    isLikelyChineseText,
    isSuitableTarget,
    looksEnglish,
    mergeStructureStrategies,
    normalizeText,
    normalizeStructureStrategy,
    parseSiteRules,
    planTranslationWork,
    removeTranslations,
    renderProgress,
    renderTranslationError,
    resolveContentRoot,
    renderTranslation,
    rectsOverlap,
    selectProgressiveTargets,
    sortTargets,
    shouldTranslateSelectionText,
    shouldTranslateText
  };
})(globalThis);
