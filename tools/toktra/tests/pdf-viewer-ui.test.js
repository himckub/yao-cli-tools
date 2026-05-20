import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const viewerHtml = readFileSync(new URL("../extension/pdf-viewer.html", import.meta.url), "utf8");
const viewerCss = readFileSync(new URL("../extension/pdf-viewer.css", import.meta.url), "utf8");
const viewerJs = readFileSync(new URL("../extension/pdf-viewer.js", import.meta.url), "utf8");

test("pdf viewer uses a reader shell with page navigation and split panes", () => {
  assert.match(viewerHtml, /id="pdfPageRail"/);
  assert.match(viewerHtml, /class="pdf-reader"/);
  assert.match(viewerCss, /\.pdf-page\s*\{[\s\S]*grid-template-columns:\s*minmax\(420px,\s*1fr\)\s+minmax\(360px,\s*0\.92fr\)/);
  assert.match(viewerCss, /\.pdf-page-original/);
  assert.match(viewerCss, /\.pdf-page-translation/);
});

test("pdf viewer keeps the original PDF canvas intact beside translated text", () => {
  assert.match(viewerJs, /originalPane\.className = "pdf-page-pane pdf-page-original"/);
  assert.match(viewerJs, /translationPane\.className = "pdf-page-pane pdf-page-translation"/);
  assert.doesNotMatch(viewerJs, /canvasHasVisibleMedia/);
});

test("pdf viewer masks source text only on the translated PDF underlay", () => {
  assert.match(viewerJs, /pageTextItems:\s*new Map\(\)/);
  assert.match(viewerJs, /function maskPdfText\(context,\s*viewport,\s*textItems,\s*pixelRatio\)/);
  assert.match(viewerJs, /pdfCore\.pdfTextMaskRects\(textItems,\s*viewport/);
  assert.match(viewerJs, /underlay\.className = "pdf-translation-underlay"/);
  assert.match(viewerJs, /entry\.translationSheet\.prepend\(underlay\)/);
  assert.match(viewerJs, /state\.pageTextItems\.set\(pageNumber,\s*textContent\.items\)/);
  assert.match(viewerCss, /\.pdf-translation-underlay\s*\{[\s\S]*position:absolute/);
  assert.match(viewerCss, /\.pdf-translation-segment\s*\{[\s\S]*z-index:2/);
});

test("pdf viewer renders translated pages with preserved PDF geometry and export control", () => {
  assert.match(viewerHtml, /id="exportPdf"/);
  assert.match(viewerJs, /translationSheet\.className = "pdf-translation-sheet"/);
  assert.match(viewerJs, /renderPdfTranslation\(element,\s*translation,\s*item\.hash\)/);
  assert.match(viewerJs, /style\.setProperty\("--pdf-segment-left"/);
  assert.match(viewerJs, /window\.print\(\)/);
  assert.match(viewerCss, /\.pdf-translation-sheet\s*\{[\s\S]*position:relative/);
  assert.match(viewerCss, /\.pdf-translation-segment\s*\{[\s\S]*position:absolute/);
  assert.match(viewerCss, /@media print[\s\S]*\.pdf-page-original/);
});

test("pdf viewer copies layout-only PDF text and preserves rotation on the translated page", () => {
  assert.match(viewerJs, /needsTranslation:\s*core\.shouldTranslateText/);
  assert.match(viewerJs, /line\.classList\.add\("pdf-translation-segment--copy"\)/);
  assert.match(viewerJs, /style\.setProperty\("--pdf-segment-rotation"/);
  assert.match(viewerCss, /transform:rotate\(var\(--pdf-segment-rotation\)\)/);
});
