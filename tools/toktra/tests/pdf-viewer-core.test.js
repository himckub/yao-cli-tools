import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const pdfCoreSource = readFileSync(new URL("../extension/pdf-viewer-core.js", import.meta.url), "utf8");

function loadPdfCore() {
  const context = {};
  Function("globalThis", `${pdfCoreSource}\nreturn globalThis.ToktraPdfViewerCore;`)(context);
  return context.ToktraPdfViewerCore;
}

test("groupPdfTextItems creates top-to-bottom paragraph segments for PDF pages", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "second", transform: [1, 0, 0, 1, 90, 700], width: 48 },
      { str: "line completes the sentence.", transform: [1, 0, 0, 1, 145, 700], width: 220 },
      { str: "The first line contains enough words to be treated as body copy rather than a short heading and the", transform: [1, 0, 0, 1, 80, 760], width: 720 }
    ],
    { pageNumber: 2, pageTop: 1000 }
  );

  assert.deepEqual(
    segments.map((segment) => [segment.id, segment.text, segment.top]),
    [
      ["p2-s1", "The first line contains enough words to be treated as body copy rather than a short heading and the second line completes the sentence.", 1000]
    ]
  );
});

test("pdfPagePreviewScale keeps original PDF page previews readable without oversized canvases", () => {
  const core = loadPdfCore();

  assert.equal(core.pdfPagePreviewScale({ width: 600 }, { maxCssWidth: 900 }), 1.5);
  assert.equal(core.pdfPagePreviewScale({ width: 1800 }, { maxCssWidth: 900 }), 0.5);
  assert.equal(core.pdfPagePreviewScale({ width: 0 }, { maxCssWidth: 900 }), 1);
});

test("pdfTextMaskRects maps PDF text items into padded viewport rectangles", () => {
  const core = loadPdfCore();
  const viewport = {
    convertToViewportRectangle(rect) {
      const [x1, y1, x2, y2] = rect;
      return [x1 * 2, 2000 - y1 * 2, x2 * 2, 2000 - y2 * 2];
    }
  };

  const rects = core.pdfTextMaskRects(
    [
      { str: "Idea Stage", transform: [1, 0, 0, 18, 100, 700], width: 120, height: 18 },
      { str: "", transform: [1, 0, 0, 10, 0, 0], width: 10, height: 10 }
    ],
    viewport,
    { padding: 2 }
  );

  assert.deepEqual(rects, [{ x: 198, y: 562, width: 244, height: 40 }]);
});

test("groupPdfTextItems merges wrapped PDF lines into paragraph segments", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "Executive Summary", transform: [1, 0, 0, 1, 80, 800], width: 160 },
      { str: "Our mission is to ensure that artificial general intelligence benefits all of humanity. We advance this", transform: [1, 0, 0, 1, 80, 700], width: 760 },
      { str: "mission by deploying our innovations to build AI tools that help people solve really hard problems.", transform: [1, 0, 0, 1, 80, 660], width: 720 },
      { str: "In the two years since we began publishing these threat reports, we have gained important insights", transform: [1, 0, 0, 1, 80, 560], width: 740 },
      { str: "into the ways threat actors attempt to abuse AI models.", transform: [1, 0, 0, 1, 80, 520], width: 460 }
    ],
    { pageNumber: 1, pageTop: 0 }
  );

  assert.deepEqual(
    segments.map((segment) => [segment.kind, segment.text]),
    [
      ["pdf-paragraph", "Executive Summary"],
      [
        "pdf-paragraph",
        "Our mission is to ensure that artificial general intelligence benefits all of humanity. We advance this mission by deploying our innovations to build AI tools that help people solve really hard problems."
      ],
      [
        "pdf-paragraph",
        "In the two years since we began publishing these threat reports, we have gained important insights into the ways threat actors attempt to abuse AI models."
      ]
    ]
  );
});

test("groupPdfTextItems drops fragmentary clipped PDF words", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "Fragmen", transform: [1, 0, 0, 1, 80, 700], width: 50 },
      { str: "Assessing the impact of this network requires care. Our primary source of evidence is the scammers’ own inputs.", transform: [1, 0, 0, 1, 80, 640], width: 760 }
    ],
    { pageNumber: 8, pageTop: 0 }
  );

  assert.deepEqual(
    segments.map((segment) => segment.text),
    ["Assessing the impact of this network requires care. Our primary source of evidence is the scammers’ own inputs."]
  );
});

test("groupPdfTextItems repairs common clipped PDF headings before translation", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "Executive Summar", transform: [1, 0, 0, 1, 80, 820], width: 150 },
      { str: "Case Studie", transform: [1, 0, 0, 1, 80, 760], width: 120 },
      { str: "Behavio", transform: [1, 0, 0, 1, 80, 700], width: 80 },
      { str: "Impac", transform: [1, 0, 0, 1, 80, 640], width: 60 }
    ],
    { pageNumber: 9, pageTop: 0 }
  );

  assert.deepEqual(
    segments.map((segment) => segment.text),
    ["Executive Summary", "Case Studies", "Behavior", "Impact"]
  );
});

test("groupPdfTextItems keeps wrapped sentence continuations together", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "The sting (extract money): the scammer generates", transform: [1, 0, 0, 1, 80, 720], width: 360 },
      { str: "content designed to convince the target to hand over", transform: [1, 0, 0, 1, 90, 704], width: 390 },
      { str: "money. The reasons given can vary enormously.", transform: [1, 0, 0, 1, 90, 688], width: 360 }
    ],
    { pageNumber: 6, pageTop: 0 }
  );

  assert.deepEqual(
    segments.map((segment) => segment.text),
    ["The sting (extract money): the scammer generates content designed to convince the target to hand over money. The reasons given can vary enormously."]
  );
});

test("groupPdfTextItems separates distant same-row text into different visual lines", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "Investment scams tell the targets to put their", transform: [1, 0, 0, 1, 80, 700], width: 310 },
      { str: "money into non-existent investments.", transform: [1, 0, 0, 1, 90, 684], width: 250 },
      { str: "Cold-call SMS from the scam operation", transform: [1, 0, 0, 1, 500, 700], width: 260 }
    ],
    { pageNumber: 6, pageTop: 0 }
  );

  assert.deepEqual(
    segments.map((segment) => segment.text),
    [
      "Investment scams tell the targets to put their money into non-existent investments.",
      "Cold-call SMS from the scam operation"
    ]
  );
});

test("groupPdfTextItems preserves page-local layout metadata for translated PDF pages", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "Title line", transform: [1, 0, 0, 20, 120, 760], width: 160, height: 20 },
      { str: "Body text wraps on a second line for translation layout.", transform: [1, 0, 0, 11, 120, 700], width: 360, height: 11 },
      { str: "The continuation should keep the same left edge.", transform: [1, 0, 0, 11, 120, 686], width: 310, height: 11 }
    ],
    { pageNumber: 4, pageTop: 1800, pageWidth: 612, pageHeight: 792 }
  );

  assert.equal(segments[0].pageWidth, 612);
  assert.equal(segments[0].pageHeight, 792);
  assert.equal(segments[0].pageTop, 12);
  assert.equal(segments[0].left, 120);
  assert.equal(segments[0].width, 160);
  assert.equal(segments[0].fontSize, 20);
  assert.equal(segments[1].pageTop, 81);
  assert.equal(segments[1].left, 120);
  assert.equal(segments[1].width, 360);
  assert.equal(segments[1].fontSize, 11);
});

test("groupPdfTextItems can preserve rotated layout-only PDF labels", () => {
  const core = loadPdfCore();

  const segments = core.groupPdfTextItems(
    [
      { str: "2604.25707v2 [cs.IR] 29 Apr 2026", transform: [0, 18, -18, 0, 42, 450], width: 270, height: 18 }
    ],
    { pageNumber: 1, pageWidth: 612, pageHeight: 792, includeLayoutOnly: true }
  );

  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "2604.25707v2 [cs.IR] 29 Apr 2026");
  assert.equal(segments[0].angle, 90);
  assert.equal(segments[0].left, 42);
  assert.equal(segments[0].pageTop, 324);
});

test("selectVisiblePdfSegments keeps current screen plus the next two screens only", () => {
  const core = loadPdfCore();
  const segments = [
    { id: "a", top: 100 },
    { id: "b", top: 950 },
    { id: "c", top: 1800 },
    { id: "d", top: 2900 },
    { id: "e", top: 3900 }
  ];

  const selected = core.selectVisiblePdfSegments(segments, {
    scrollTop: 0,
    viewportHeight: 1000,
    screensAhead: 3
  });

  assert.deepEqual(selected.map((segment) => segment.id), ["a", "b", "c", "d"]);
});

test("selectVisiblePdfSegments prefers live DOM position over stale PDF coordinates", () => {
  const core = loadPdfCore();
  const segments = [
    {
      id: "visible-now",
      top: 5000,
      element: {
        getBoundingClientRect() {
          return { top: 120 };
        }
      }
    },
    {
      id: "stale-only",
      top: 10200,
      element: {
        getBoundingClientRect() {
          return { top: 5200 };
        }
      }
    }
  ];

  const selected = core.selectVisiblePdfSegments(segments, {
    scrollTop: 10000,
    viewportHeight: 1000,
    screensAhead: 3
  });

  assert.deepEqual(selected.map((segment) => segment.id), ["visible-now"]);
});
