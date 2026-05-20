(function (global) {
  "use strict";

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function itemX(item) {
    return Number(item?.transform?.[4] || 0);
  }

  function itemY(item) {
    return Number(item?.transform?.[5] || 0);
  }

  function itemWidth(item) {
    return Math.max(0, Number(item?.width || 0));
  }

  function itemHeight(item) {
    return Math.max(0, Number(item?.height || item?.transform?.[3] || 0));
  }

  function itemAngle(item) {
    const transform = item?.transform || [];
    const a = Number(transform[0] || 0);
    const b = Number(transform[1] || 0);
    if (!a && !b) return 0;
    const angle = Math.round((Math.atan2(b, a) * 180) / Math.PI);
    if (angle > 180) return angle - 360;
    if (angle <= -180) return angle + 360;
    return angle;
  }

  function lineText(line) {
    return normalizeText(Array.from(line?.items || []).sort((a, b) => a.x - b.x).map((item) => item.text).join(" "));
  }

  function lowerMedian(numbers, fallback) {
    const values = Array.from(numbers || []).filter((number) => Number.isFinite(number) && number > 0).sort((a, b) => a - b);
    if (!values.length) return fallback;
    return values[Math.floor((values.length - 1) / 2)];
  }

  function isStandaloneHeading(line) {
    const text = String(line?.text || "");
    if (!text || text.length > 90) return false;
    const wordCount = (text.match(/[A-Za-z0-9]+/g) || []).length;
    return wordCount > 0 && wordCount <= 9 && !/[.!?;,]$/.test(text);
  }

  function startsListItem(text) {
    return /^([*•-]|\d+[.)]|[A-Z][.)])\s+/.test(String(text || ""));
  }

  const COMMON_STANDALONE_WORDS = new Set([
    "abstract",
    "api",
    "appendix",
    "background",
    "behavior",
    "case",
    "content",
    "conclusion",
    "impact",
    "introduction",
    "operation",
    "overview",
    "references",
    "scam",
    "studies",
    "study",
    "summary"
  ]);

  function englishWordTokens(text) {
    return String(text || "").match(/[A-Za-z][A-Za-z0-9’'-]*/g) || [];
  }

  function isCompleteStandaloneWord(word) {
    const normalized = String(word || "").replace(/[’'-]/g, "").toLowerCase();
    if (!normalized) return false;
    if (/^[A-Z]{2,}$/.test(word)) return true;
    if (COMMON_STANDALONE_WORDS.has(normalized)) return true;
    return false;
  }

  function isCompleteTranslationUnit(text) {
    const normalized = normalizeText(text);
    if (!normalized || /[-–—]$/.test(normalized)) return false;
    const tokens = englishWordTokens(normalized);
    if (tokens.length !== 1) return tokens.length > 1;
    return isCompleteStandaloneWord(tokens[0]);
  }

  function joinParagraphText(lines) {
    return Array.from(lines || []).reduce((text, line) => {
      const next = String(line?.text || "");
      if (!text) return next;
      if (/-$/.test(text) && /^[a-z]/.test(next)) return `${text.slice(0, -1)}${next}`;
      return `${text} ${next}`;
    }, "");
  }

  const PDF_TEXT_REPAIRS = new Map([
    ["behavio", "Behavior"],
    ["case studie", "Case Studies"],
    ["executive summar", "Executive Summary"],
    ["impac", "Impact"]
  ]);

  function repairPdfText(text) {
    const normalized = normalizeText(text);
    return PDF_TEXT_REPAIRS.get(normalized.toLowerCase()) || normalized;
  }

  function hasPdfTextRepair(text) {
    return PDF_TEXT_REPAIRS.has(normalizeText(text).toLowerCase());
  }

  function shouldSplitHeading(previous, line, gap, regularGap) {
    if (!isStandaloneHeading(previous) || !isStandaloneHeading(line)) return false;
    if (hasPdfTextRepair(previous.text) && hasPdfTextRepair(line.text)) return true;
    if (/[,:;]$/.test(previous.text) || /[a-z]$/.test(previous.text)) return false;
    return gap >= Math.max(24, regularGap * 1.25);
  }

  function groupLinesByColumn(lines, options) {
    const tolerance = Math.max(36, Number(options?.columnLeftTolerance || 72));
    const groups = [];
    Array.from(lines || [])
      .sort((a, b) => {
        const topDiff = a.top - b.top;
        if (Math.abs(topDiff) > 4) return topDiff;
        return a.left - b.left;
      })
      .forEach((line) => {
        let group = groups.find((candidate) => Math.abs(candidate.left - line.left) <= tolerance);
        if (!group) {
          group = { left: line.left, lines: [] };
          groups.push(group);
        }
        group.lines.push(line);
        group.left = (group.left * (group.lines.length - 1) + line.left) / group.lines.length;
      });
    return groups;
  }

  function mergeColumnLinesIntoParagraphs(lines, options) {
    const pageNumber = Math.max(1, Number(options?.pageNumber || 1));
    const regularGap = Math.max(8, lowerMedian(
      lines.slice(1).map((line, index) => Math.abs(lines[index].y - line.y)),
      Number(options?.lineGap || 18)
    ));
    const gapThreshold = Math.max(regularGap + 8, regularGap * 1.6);
    const indentThreshold = Math.max(28, Number(options?.indentThreshold || 32));
    const paragraphs = [];
    let current = null;

    lines.forEach((line) => {
      if (!current) {
        current = { lines: [line] };
        return;
      }
      const previous = current.lines.at(-1);
      const gap = Math.abs(previous.y - line.y);
      const indentChange = Math.abs(line.left - previous.left);
      const startsNewParagraph =
        gap > gapThreshold ||
        startsListItem(line.text) ||
        shouldSplitHeading(previous, line, gap, regularGap) ||
        (indentChange > indentThreshold && /[.!?:;)]$/.test(previous.text)) ||
        (isStandaloneHeading(previous) && line.text.length > previous.text.length * 1.5);

      if (startsNewParagraph) {
        paragraphs.push(current);
        current = { lines: [line] };
      }
      else {
        current.lines.push(line);
      }
    });
    if (current) paragraphs.push(current);

    return paragraphs
      .map((paragraph, index) => {
        const firstLine = paragraph.lines[0];
        return {
          id: `p${pageNumber}-s${index + 1}`,
          pageNumber,
          text: repairPdfText(joinParagraphText(paragraph.lines)),
          top: Math.round(firstLine.top),
          pageTop: Math.round(firstLine.pageTop || 0),
          left: Math.round(Math.min(...paragraph.lines.map((line) => line.left))),
          width: Math.max(
            1,
            Math.round(
              Math.max(...paragraph.lines.map((line) => line.left + Number(line.width || 0))) -
                Math.min(...paragraph.lines.map((line) => line.left))
            )
          ),
          height: Math.max(
            1,
            Math.round(
              Math.max(...paragraph.lines.map((line) => Number(line.pageTop || 0) + Number(line.height || 0))) -
                Math.min(...paragraph.lines.map((line) => Number(line.pageTop || 0)))
            )
          ),
          angle: Math.round(lowerMedian(paragraph.lines.map((line) => Number(line.angle || 0) + 181), 181) - 181),
          fontSize: Math.max(1, lowerMedian(paragraph.lines.map((line) => Number(line.fontSize || 0)), 11)),
          pageWidth: Number(options?.pageWidth || firstLine.pageWidth || 0),
          pageHeight: Number(options?.pageHeight || firstLine.pageHeight || 0),
          kind: "pdf-paragraph"
        };
      })
      .filter((segment) => segment.text && (options?.includeLayoutOnly || isCompleteTranslationUnit(segment.text)));
  }

  function mergeLinesIntoParagraphs(lines, options) {
    return groupLinesByColumn(lines, options)
      .flatMap((group) => mergeColumnLinesIntoParagraphs(group.lines, options))
      .sort((a, b) => {
        const topDiff = a.top - b.top;
        if (Math.abs(topDiff) > 4) return topDiff;
        return a.left - b.left;
      })
      .map((segment, index) => ({ ...segment, id: `p${segment.pageNumber}-s${index + 1}` }));
  }

  function splitLineByXGaps(line, options) {
    const gapThreshold = Math.max(56, Number(options?.columnGap || 72));
    const parts = [];
    const sortedItems = Array.from(line.items || []).sort((a, b) => a.x - b.x);
    let current = null;
    sortedItems.forEach((item) => {
      const itemRight = item.x + itemWidth(item);
      if (!current) {
        current = { y: line.y, items: [item], right: itemRight };
        return;
      }
      const gap = item.x - current.right;
      if (gap > gapThreshold) {
        parts.push(current);
        current = { y: line.y, items: [item], right: itemRight };
      }
      else {
        current.items.push(item);
        current.right = Math.max(current.right, itemRight);
      }
    });
    if (current) parts.push(current);
    return parts;
  }

  function lineMetrics(line, maxY, options) {
    const left = Math.min(...line.items.map((item) => item.x));
    const right = Math.max(...line.items.map((item) => item.x + itemWidth(item)));
    const heights = line.items.map((item) => item.height).filter((height) => height > 0);
    const fontSize = Math.max(1, lowerMedian(heights, Number(options?.fontSize || 11)));
    const angles = line.items.map((item) => item.angle).filter((angle) => Number.isFinite(angle));
    const angle = Math.round(lowerMedian(angles.map((value) => value + 181), 181) - 181);
    const pageHeight = Number(options?.pageHeight || 0);
    const relativeTop = pageHeight > 0 ? Math.max(0, pageHeight - line.y - fontSize) : Math.max(0, maxY - line.y);
    const globalPageTop = Math.max(0, Number(options?.pageTop || 0));
    return {
      left: Math.round(left),
      width: Math.max(1, Math.round(right - left)),
      pageTop: Math.round(relativeTop),
      top: Math.round(globalPageTop + relativeTop),
      angle,
      fontSize: Math.round(fontSize * 10) / 10,
      height: Math.max(1, Math.round(fontSize * 1.25))
    };
  }

  function groupPdfTextItems(items, options) {
    const pageNumber = Math.max(1, Number(options?.pageNumber || 1));
    const pageWidth = Math.max(0, Number(options?.pageWidth || 0));
    const pageHeight = Math.max(0, Number(options?.pageHeight || 0));
    const tolerance = Math.max(1, Number(options?.lineTolerance || 4));
    const readable = Array.from(items || [])
      .map((item) => ({
        text: normalizeText(item?.str),
        x: itemX(item),
        y: itemY(item),
        width: itemWidth(item),
        height: itemHeight(item),
        angle: itemAngle(item)
      }))
      .filter((item) => item.text);
    if (!readable.length) return [];

    const maxY = Math.max(...readable.map((item) => item.y));
    const lines = [];
    readable
      .sort((a, b) => {
        const yDiff = b.y - a.y;
        if (Math.abs(yDiff) > tolerance) return yDiff;
        return a.x - b.x;
      })
      .forEach((item) => {
        let line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
        if (!line) {
          line = { y: item.y, items: [] };
          lines.push(line);
        }
        line.items.push(item);
      });

    const visualLines = lines
      .flatMap((line) => splitLineByXGaps(line, options))
      .sort((a, b) => {
        const yDiff = b.y - a.y;
        if (Math.abs(yDiff) > tolerance) return yDiff;
        return Math.min(...a.items.map((item) => item.x)) - Math.min(...b.items.map((item) => item.x));
      })
      .map((line, index) => ({
        id: `p${pageNumber}-l${index + 1}`,
        pageNumber,
        text: lineText(line),
        ...lineMetrics(line, maxY, { ...options, pageWidth, pageHeight }),
        pageWidth,
        pageHeight,
        y: line.y,
        kind: "pdf-line"
      }))
      .filter((segment) => segment.text);
    const segments = mergeLinesIntoParagraphs(visualLines, { ...options, pageNumber, pageWidth, pageHeight });
    return options?.includeLayoutOnly ? segments.filter((segment) => segment.text) : segments;
  }

  function liveSegmentTop(segment, scrollTop) {
    const rect = segment?.element?.getBoundingClientRect?.();
    const rectTop = Number(rect?.top);
    if (Number.isFinite(rectTop)) return scrollTop + rectTop;
    return Number(segment?.top);
  }

  function selectVisiblePdfSegments(segments, options) {
    const scrollTop = Math.max(0, Number(options?.scrollTop || 0));
    const viewportHeight = Math.max(1, Number(options?.viewportHeight || 900));
    const screensAhead = Math.max(1, Math.min(8, Number(options?.screensAhead || 3)));
    const top = scrollTop - viewportHeight;
    const bottom = scrollTop + viewportHeight * screensAhead;
    return Array.from(segments || []).filter((segment) => {
      const segmentTop = liveSegmentTop(segment, scrollTop);
      return Number.isFinite(segmentTop) && segmentTop >= top && segmentTop < bottom;
    });
  }

  function pdfPagePreviewScale(viewport, options) {
    const width = Number(viewport?.width || 0);
    if (!Number.isFinite(width) || width <= 0) return 1;
    const maxCssWidth = Math.max(320, Number(options?.maxCssWidth || 920));
    const minScale = Math.max(0.4, Number(options?.minScale || 0.5));
    const maxScale = Math.min(2, Math.max(minScale, Number(options?.maxScale || 1.5)));
    return Math.min(maxScale, Math.max(minScale, maxCssWidth / width));
  }

  function pdfTextMaskRects(items, viewport, options) {
    const padding = Math.max(0, Number(options?.padding || 1.5));
    if (!viewport || typeof viewport.convertToViewportRectangle !== "function") return [];
    return Array.from(items || [])
      .map((item) => {
        const text = normalizeText(item?.str);
        const x = itemX(item);
        const y = itemY(item);
        const width = itemWidth(item);
        const height = Math.max(0, Number(item?.height || item?.transform?.[3] || 0));
        if (!text || !Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return null;
        const rect = viewport.convertToViewportRectangle([x, y, x + width, y + height]);
        const left = Math.min(rect[0], rect[2]) - padding;
        const top = Math.min(rect[1], rect[3]) - padding;
        const right = Math.max(rect[0], rect[2]) + padding;
        const bottom = Math.max(rect[1], rect[3]) + padding;
        return {
          x: Math.round(left),
          y: Math.round(top),
          width: Math.round(right - left),
          height: Math.round(bottom - top)
        };
      })
      .filter(Boolean);
  }

  global.ToktraPdfViewerCore = {
    groupPdfTextItems,
    pdfPagePreviewScale,
    pdfTextMaskRects,
    selectVisiblePdfSegments
  };
})(globalThis);
