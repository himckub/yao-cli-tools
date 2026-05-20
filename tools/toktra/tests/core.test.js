import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseHTML } from "linkedom";

const coreSource = readFileSync(new URL("../extension/core.js", import.meta.url), "utf8");

function loadCore(html) {
  const { window } = parseHTML(`<!doctype html><html><head></head><body>${html}</body></html>`);
  window.eval(coreSource);
  return { window, document: window.document, core: window.ToktraCore };
}

test("collectTargets skips scripts, code, existing translations, and Chinese text", () => {
  const { document, core } = loadCore(`
    <main>
      <h1>AI agents change software delivery</h1>
      <p>Teams can review changes faster with structured automation.</p>
      <p>这是一段中文，不应该翻译。</p>
      <pre>const label = "English code";</pre>
      <script>window.title = "English script";</script>
      <p data-toktra="translation">Generated English translation UI</p>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 12,
    maxTextLength: 280
  });

  assert.deepEqual(
    targets.map((item) => item.text),
    [
      "AI agents change software delivery",
      "Teams can review changes faster with structured automation."
    ]
  );
});

test("renderTranslation places Chinese text below the source element and replaces stale output", () => {
  const { document, core } = loadCore(`
    <main>
      <p id="lead">This landing page explains a product clearly.</p>
    </main>
  `);
  const lead = document.querySelector("#lead");
  const hash = core.hashText(lead.textContent);

  core.renderTranslation(lead, "这个落地页清楚地解释了一个产品。", hash);
  core.renderTranslation(lead, "这个落地页清楚解释产品。", hash);

  const translations = document.querySelectorAll("[data-toktra='translation']");
  assert.equal(translations.length, 1);
  assert.equal(translations[0].textContent.trim(), "这个落地页清楚解释产品。");
  assert.equal(translations[0].previousElementSibling, lead);
});

test("renderTranslationError inserts a visible retry control for a failed segment", () => {
  const { document, core } = loadCore(`
    <main>
      <p id="lead">This landing page explains a product clearly.</p>
    </main>
  `);
  const lead = document.querySelector("#lead");
  const hash = core.hashText(lead.textContent);
  let retryCount = 0;

  const node = core.renderTranslationError(lead, hash, () => {
    retryCount += 1;
  });
  const retryButton = node.querySelector("button");

  assert.equal(node.dataset.toktra, "translation-error");
  assert.equal(node.dataset.toktraSourceHash, hash);
  assert.match(node.textContent, /翻译失败/);
  assert.equal(retryButton?.getAttribute("aria-label"), "重新翻译当前模块");

  retryButton.click();

  assert.equal(retryCount, 1);
});

test("renderTranslation appends inside list and table cells instead of breaking HTML structure", () => {
  const { document, core } = loadCore(`
    <main>
      <ul><li id="item">Translate this list item.</li></ul>
      <table><tbody><tr><td id="cell">Translate this cell.</td></tr></tbody></table>
    </main>
  `);

  const item = document.querySelector("#item");
  const cell = document.querySelector("#cell");
  core.renderTranslation(item, "翻译这个列表项。", core.hashText(item.textContent));
  core.renderTranslation(cell, "翻译这个单元格。", core.hashText(cell.textContent));

  assert.equal(item.querySelector("[data-toktra='translation']")?.textContent.trim(), "翻译这个列表项。");
  assert.equal(cell.querySelector("[data-toktra='translation']")?.textContent.trim(), "翻译这个单元格。");
});

test("renderTranslation places link and nested span translations outside clickable text", () => {
  const { document, core } = loadCore(`
    <main>
      <h2 id="heading"><a id="title-link">How to Build Entity Authority for AI Search</a></h2>
      <aside>
        <a id="hot-link"><span id="index">2</span><span id="hot-title">How to Build Entity Authority for AI Search</span></a>
      </aside>
    </main>
  `);

  const titleLink = document.querySelector("#title-link");
  const hotTitle = document.querySelector("#hot-title");
  const heading = document.querySelector("#heading");
  const hotLink = document.querySelector("#hot-link");

  core.renderTranslation(titleLink, "如何为 AI 搜索建立实体权威", core.hashText(titleLink.textContent));
  core.renderTranslation(hotTitle, "如何为 AI 搜索建立实体权威", core.hashText(hotTitle.textContent));

  assert.equal(heading.nextElementSibling?.matches("[data-toktra='translation']"), true);
  assert.equal(hotLink.nextElementSibling?.matches("[data-toktra='translation']"), true);
  assert.equal(titleLink.querySelector("[data-toktra='translation']"), null);
  assert.equal(hotLink.querySelector("[data-toktra='translation']"), null);
});

test("collectTargets translates visible input placeholders and restores them on remove", () => {
  const { document, core } = loadCore(`
    <main>
      <input id="search" type="search" placeholder="Search title or excerpt...">
      <input id="password" type="password" placeholder="Enter password">
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 4,
    maxTextLength: 280
  });
  const search = document.querySelector("#search");

  assert.deepEqual(targets.map((item) => item.element.id), ["search"]);
  core.renderTranslation(search, "搜索标题或摘要...", targets[0].hash);

  assert.equal(search.getAttribute("placeholder"), "搜索标题或摘要...");
  assert.equal(core.collectTargets(document.body, { minTextLength: 4 }).length, 0);
  assert.equal(core.removeTranslations(document), 1);
  assert.equal(search.getAttribute("placeholder"), "Search title or excerpt...");
});

test("collectTargets supports direct div text used by modern web apps", () => {
  const { document, core } = loadCore(`
    <main>
      <div id="card">This dashboard card explains the current account status.</div>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 12,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["card"]);
});

test("collectTargets captures nested inline text modules used by modern web apps", () => {
  const { document, core } = loadCore(`
    <main>
      <div id="card">
        <div id="shell">
          <span id="headline">This nested interface text appears in a span-only module.</span>
        </div>
      </div>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 12,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["headline"]);
});

test("collectTargets groups span-split sentences into the nearest complete block", () => {
  const { document, core } = loadCore(`
    <main>
      <div id="sentence">
        <span>Assessing the impact of this network requires care.</span>
        <span>Our primary source of evidence is the scammers' own inputs.</span>
      </div>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 4,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => [item.element.id, item.text]), [
    ["sentence", "Assessing the impact of this network requires care. Our primary source of evidence is the scammers' own inputs."]
  ]);
});

test("shouldTranslateText rejects incomplete clipped word fragments", () => {
  const { core } = loadCore("");

  assert.equal(core.shouldTranslateText("Impac", { minTextLength: 4 }), false);
  assert.equal(core.shouldTranslateText("Impact", { minTextLength: 4 }), true);
  assert.equal(core.shouldTranslateText("Assessing the impact of this network requires care.", { minTextLength: 4 }), true);
});

test("collectTargets prefers leaf div text modules over duplicate parent containers", () => {
  const { document, core } = loadCore(`
    <main>
      <div id="outer">
        <div id="inner">This nested div-only module should be translated once.</div>
      </div>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 12,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["inner"]);
});

test("collectTargets captures standalone article links outside headings", () => {
  const { document, core } = loadCore(`
    <main>
      <section class="featured">
        <a id="featured-link" href="/article">How to Build Entity Authority for AI Search</a>
      </section>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 12,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["featured-link"]);
});

test("collectTargets prefers containing links over nested link spans", () => {
  const { document, core } = loadCore(`
    <aside>
      <a id="hot-link" href="/post">
        <span id="rank">2</span>
        <span id="hot-title">How to Build Entity Authority for AI Search</span>
      </a>
    </aside>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 4,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["hot-link"]);
  assert.equal(targets[0].text, "2 How to Build Entity Authority for AI Search");
});

test("collectTargets emits stable segment metadata for scheduling", () => {
  const { document, core } = loadCore(`
    <main>
      <h1 id="hero">How to Reduce Brand Ambiguity in AI Search Results</h1>
      <button id="search">Search</button>
      <input id="query" type="search" placeholder="Search title or excerpt...">
    </main>
  `);
  const hero = document.querySelector("#hero");
  const search = document.querySelector("#search");
  const query = document.querySelector("#query");
  hero.getBoundingClientRect = () => ({ top: 160, left: 40 });
  search.getBoundingClientRect = () => ({ top: 40, left: 600 });
  query.getBoundingClientRect = () => ({ top: 40, left: 420 });

  const targets = core.collectTargets(document.body, {
    minTextLength: 4,
    maxTextLength: 280
  });

  assert.deepEqual(
    targets.map((item) => [item.element.id, item.kind, item.id.startsWith(`${item.hash}:`), item.priority > 0]),
    [
      ["query", "placeholder", true, true],
      ["search", "button", true, true],
      ["hero", "heading", true, true]
    ]
  );
  assert.deepEqual(targets.map((item) => item.position.hasLayout), [true, true, true]);
});

test("planTranslationWork prioritizes cached and viewport segments while keeping all work queued", () => {
  const { document, core } = loadCore(`
    <main>
      <h1 id="hero">Hero text for immediate translation</h1>
      <p id="below">Lower article paragraph should still be translated later.</p>
      <p id="cached">Cached paragraph should render immediately.</p>
    </main>
  `);
  const hero = document.querySelector("#hero");
  const below = document.querySelector("#below");
  const cached = document.querySelector("#cached");
  hero.getBoundingClientRect = () => ({ top: 120, left: 20 });
  below.getBoundingClientRect = () => ({ top: 1800, left: 20 });
  cached.getBoundingClientRect = () => ({ top: 1500, left: 20 });
  const targets = core.collectTargets(document.body, { minTextLength: 4 });
  const cachedTarget = targets.find((item) => item.element.id === "cached");

  const plan = core.planTranslationWork(targets, {
    cache: new Map([[cachedTarget.hash, "已缓存段落。"]]),
    queuedElements: new WeakSet(),
    viewportHeight: 800
  });

  assert.deepEqual(plan.cached.map((item) => item.target.element.id), ["cached"]);
  assert.equal(plan.pending.length, 2);
  assert.equal(plan.pending[0].element.id, "hero");
  assert.equal(plan.pending[1].element.id, "below");
  assert.equal(plan.total, 3);
});

test("planTranslationWork defers segments beyond the current three-screen window", () => {
  const { document, core } = loadCore(`
    <main>
      <p id="s1">First screen paragraph for translation.</p>
      <p id="s2">Second screen paragraph for translation.</p>
      <p id="s3">Third screen paragraph for translation.</p>
      <p id="s4">Fourth screen paragraph should wait.</p>
    </main>
  `);
  ["s1", "s2", "s3", "s4"].forEach((id, index) => {
    document.querySelector(`#${id}`).getBoundingClientRect = () => ({ top: index * 900 + 20, left: 20 });
  });

  const targets = core.collectTargets(document.body, { minTextLength: 4 });
  const plan = core.planTranslationWork(targets, {
    cache: new Map(),
    queuedElements: new WeakSet(),
    viewportHeight: 900,
    maxScreensAhead: 3
  });

  assert.deepEqual(plan.pending.map((item) => item.element.id), ["s1", "s2", "s3"]);
  assert.deepEqual(plan.deferred.map((item) => item.element.id), ["s4"]);
  assert.equal(plan.total, 3);
});

test("site rules parse into additive include and exclude structure strategies", () => {
  const { core } = loadCore("");

  const rules = core.parseSiteRules(
    `
tdwh.com##.promo
tdwh.com#+#.ne-content
*.example.com#+#main
other.com##.ignored
`,
    "www.tdwh.com"
  );
  const merged = core.mergeStructureStrategies(
    { contentSelectors: [".ai-content"], excludeSelectors: [".ad"], minTextLength: 8 },
    rules
  );

  assert.deepEqual(rules.excludeSelectors, [".promo"]);
  assert.deepEqual(rules.contentSelectors, [".ne-content"]);
  assert.deepEqual(merged.contentSelectors, [".ai-content", ".ne-content"]);
  assert.deepEqual(merged.excludeSelectors, [".ad", ".promo"]);
  assert.equal(merged.minTextLength, 8);
});

test("renderProgress updates and removes a low-noise page progress indicator", () => {
  const { document, core } = loadCore("<main></main>");

  const node = core.renderProgress(document, {
    translated: 12,
    total: 85,
    cached: 4,
    failed: 1,
    status: "running"
  });

  assert.equal(node.dataset.toktra, "progress");
  assert.match(node.textContent, /toktra 12\/85/);
  assert.match(node.textContent, /缓存 4/);
  assert.match(node.textContent, /失败 1/);
  assert.equal(core.removeTranslations(document), 2);
  assert.equal(document.querySelector("[data-toktra='progress']"), null);
});

test("injectStyle keeps translation left edge square instead of rounded", () => {
  const { document, core } = loadCore("<main></main>");

  core.injectStyle(document);
  const styleText = document.getElementById("toktra-style")?.textContent || "";
  const translationRule = /\.toktra-translation\{(?<body>[^}]+)\}/.exec(styleText)?.groups?.body || "";

  assert.match(translationRule, /border-left:3px solid #2f6f55/);
  assert.match(translationRule, /border-radius:0 5px 5px 0/);
  assert.doesNotMatch(translationRule, /border-radius:5px;/);
});

test("collectTargets skips layout-sensitive header navigation while keeping hero content", () => {
  const { document, core } = loadCore(`
    <header>
      <nav><a id="nav">GEOInsights</a></nav>
      <section class="hero"><h1 id="hero">Build Better AI Search Visibility</h1></section>
    </header>
    <main>
      <p id="body">This body paragraph should be translated after the hero title.</p>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 4,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["hero", "body"]);
});

test("collectTargets skips header dropdown menus that would collapse page layout", () => {
  const { document, core } = loadCore(`
    <header role="banner">
      <nav>
        <button id="meet" aria-haspopup="menu">Meet Claude</button>
        <div role="menu">
          <a id="code">Claude Code</a>
          <a id="slack">Claude for Slack</a>
        </div>
      </nav>
    </header>
    <main>
      <h1 id="title">The Founder's Playbook</h1>
      <p id="lead">This article paragraph should remain readable after translation.</p>
    </main>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 4,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["title", "lead"]);
});

test("collectTargets includes readable sidebar and navigation modules", () => {
  const { document, core } = loadCore(`
    <main>
      <p id="body">This body paragraph should be translated.</p>
    </main>
    <aside>
      <nav><a id="nav-link">Reports</a></nav>
      <section>
        <a id="side-link">Why Knowledge Graphs Matter for GEO Marketing</a>
      </section>
    </aside>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 4,
    maxTextLength: 280
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["body", "nav-link", "side-link"]);
});

test("selectProgressiveTargets can queue duplicate text in different visible modules", () => {
  const { document, core } = loadCore(`
    <main>
      <a id="left">How to Build Entity Authority for AI Search</a>
      <aside><a id="right">How to Build Entity Authority for AI Search</a></aside>
    </main>
  `);
  const left = document.querySelector("#left");
  const right = document.querySelector("#right");
  left.getBoundingClientRect = () => ({ top: 120, left: 20 });
  right.getBoundingClientRect = () => ({ top: 120, left: 600 });
  const queuedElements = new WeakSet([left]);

  const selected = core.selectProgressiveTargets(
    [
      { element: left, hash: "same" },
      { element: right, hash: "same" }
    ],
    {
      limit: 4,
      viewportHeight: 800,
      queuedElements
    }
  );

  assert.deepEqual(selected.map((item) => item.element.id), ["right"]);
});

test("collectTargets prefers the main article root and keeps Wikipedia paragraphs as units", () => {
  const { document, core } = loadCore(`
    <div id="content">
      <h1 id="firstHeading">Golden Bough (Aeneid)</h1>
      <div id="mw-content-text">
        <div class="mw-parser-output">
          <p id="lead">The Golden Bough is a fantastical object described in the <a>Aeneid</a><sup class="reference">[1]</sup>.</p>
          <div><p id="second">Virgil associates it with both death and immortality.</p></div>
        </div>
      </div>
    </div>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 8,
    maxTextLength: 400
  });

  assert.deepEqual(
    targets.map((item) => [item.element.id, item.text]),
    [
      ["firstHeading", "Golden Bough (Aeneid)"],
      ["lead", "The Golden Bough is a fantastical object described in the Aeneid."],
      ["second", "Virgil associates it with both death and immortality."]
    ]
  );
});

test("collectTargets applies a domain structure strategy root and exclusions", () => {
  const { document, core } = loadCore(`
    <div class="layout">
      <div class="menu"><p id="menu">Navigation text should not be part of the article translation.</p></div>
      <div class="story">
        <p id="lead">This article paragraph should be translated as the first readable unit.</p>
        <div class="promo"><p id="promo">This promotional text should be excluded from translation.</p></div>
        <p id="body">This second article paragraph should also be translated.</p>
      </div>
    </div>
  `);

  const targets = core.collectTargets(document.body, {
    minTextLength: 12,
    maxTextLength: 280,
    structureStrategy: {
      contentSelectors: [".story"],
      excludeSelectors: [".promo"]
    }
  });

  assert.deepEqual(targets.map((item) => item.element.id), ["lead", "body"]);
});

test("buildStructureOutline summarizes readable page containers for AI analysis", () => {
  const { document, core } = loadCore(`
    <header><p>Account navigation and utility links.</p></header>
    <section class="article-shell">
      <h1>Golden Bough research notes</h1>
      <p>The Golden Bough appears in an article-like passage with enough readable text.</p>
    </section>
  `);
  document.title = "Golden Bough";

  const outline = core.buildStructureOutline(document, {
    url: "https://example.com/wiki/golden-bough",
    maxNodes: 8,
    maxSampleLength: 90
  });

  assert.equal(outline.url, "https://example.com/wiki/golden-bough");
  assert.equal(outline.title, "Golden Bough");
  assert.equal(outline.nodes.some((node) => node.selector === ".article-shell" && node.textLength > 80), true);
  assert.equal(outline.textSamples.some((sample) => sample.includes("Golden Bough appears")), true);
});

test("collectTargets includes long article paragraphs with default settings", () => {
  const longSentence = "The Golden Bough appears in a complex passage about Aeneas and the Underworld. ";
  const paragraph = longSentence.repeat(28);
  const { document, core } = loadCore(`<main><p id="long">${paragraph}</p></main>`);

  const targets = core.collectTargets(document.body);

  assert.deepEqual(targets.map((item) => item.element.id), ["long"]);
});

test("collectTargets sorts targets from top to bottom when layout boxes are available", () => {
  const { document, core } = loadCore(`
    <main>
      <p id="third">This paragraph is lower on the rendered page.</p>
      <p id="first">This paragraph appears near the top of the rendered page.</p>
      <p id="second">This paragraph appears between the other two paragraphs.</p>
    </main>
  `);
  document.querySelector("#third").getBoundingClientRect = () => ({ top: 300, left: 10 });
  document.querySelector("#first").getBoundingClientRect = () => ({ top: 20, left: 10 });
  document.querySelector("#second").getBoundingClientRect = () => ({ top: 160, left: 10 });

  const targets = core.collectTargets(document.body);

  assert.deepEqual(targets.map((item) => item.element.id), ["first", "second", "third"]);
});

test("selectProgressiveTargets prioritizes visible and near-viewport targets", () => {
  const { document, core } = loadCore(`
    <main>
      <p id="first">This paragraph appears near the current viewport.</p>
      <p id="second">This paragraph appears immediately after the first paragraph.</p>
      <p id="late">This paragraph is much further down the page.</p>
    </main>
  `);
  const first = document.querySelector("#first");
  const second = document.querySelector("#second");
  const late = document.querySelector("#late");
  first.getBoundingClientRect = () => ({ top: 60, left: 10 });
  second.getBoundingClientRect = () => ({ top: 520, left: 10 });
  late.getBoundingClientRect = () => ({ top: 2400, left: 10 });

  const selected = core.selectProgressiveTargets(
    [
      { element: late, hash: "late" },
      { element: first, hash: "first" },
      { element: second, hash: "second" }
    ],
    {
      limit: 2,
      viewportHeight: 800,
      viewportMultiplier: 1.5,
      queuedHashes: new Set(["first"])
    }
  );

  assert.deepEqual(selected.map((item) => item.hash), ["second", "late"]);
});

test("isLikelyChinesePage detects Chinese pages from html lang and dominant body text", () => {
  const zhByLang = loadCore(`<main><p>This text is English, but the document language is Chinese.</p></main>`);
  zhByLang.document.documentElement.lang = "zh-CN";

  const zhByText = loadCore(`
    <main>
      <p>这是一个中文页面，主要内容已经是中文，不需要再进行英文到中文翻译。</p>
      <p>页面中偶尔出现 English product name 不应该触发翻译。</p>
    </main>
  `);

  const enPage = loadCore(`<main><p>This is an English article with enough text to translate.</p></main>`);

  assert.equal(zhByLang.core.isLikelyChinesePage(zhByLang.document), true);
  assert.equal(zhByText.core.isLikelyChinesePage(zhByText.document), true);
  assert.equal(enPage.core.isLikelyChinesePage(enPage.document), false);
});

test("removeTranslations clears rendered translations from the current page", () => {
  const { document, core } = loadCore(`
    <main>
      <p id="lead">This landing page explains a product clearly.</p>
      <p data-toktra="translation">这个落地页清楚解释产品。</p>
      <style data-toktra="style">.toktra-translation{}</style>
    </main>
  `);

  const removed = core.removeTranslations(document);

  assert.equal(removed, 2);
  assert.equal(document.querySelectorAll("[data-toktra]").length, 0);
});

test("shouldTranslateSelectionText accepts short English selections and skips Chinese selections", () => {
  const { core } = loadCore(`<main></main>`);

  assert.equal(core.shouldTranslateSelectionText("Golden Bough"), true);
  assert.equal(core.shouldTranslateSelectionText("Aeneas travels to Cumae."), true);
  assert.equal(core.shouldTranslateSelectionText("这是中文选中文本"), false);
  assert.equal(core.shouldTranslateSelectionText("12345?!"), false);
});

test("computeFloatingPosition pushes the selection button below nearby translate widgets", () => {
  const { core } = loadCore(`<main></main>`);

  const position = core.computeFloatingPosition(
    { left: 140, top: 80, right: 260, bottom: 104, width: 120, height: 24 },
    {
      elementWidth: 92,
      elementHeight: 30,
      viewportWidth: 500,
      viewportHeight: 360,
      offsetY: 8,
      collisionPadding: 8,
      avoidRects: [{ left: 170, top: 108, right: 224, bottom: 140, width: 54, height: 32 }]
    }
  );

  assert.deepEqual(position, { left: 140, top: 148 });
});
