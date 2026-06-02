import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDb } from '../src/db.js';
import { PageStore } from '../src/page-store.js';

async function createStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokhtml-test-'));
  const watchDir = path.join(dataDir, 'watch');
  const config = {
    name: 'tokhtml',
    rootDir: dataDir,
    host: '127.0.0.1',
    port: 0,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    generatedDir: path.join(dataDir, 'generated'),
    versionsDir: path.join(dataDir, 'versions'),
    publicDir: path.join(dataDir, 'public'),
    watchDirs: [watchDir],
    allowSourceWrite: false,
  };
  const db = createDb(config);
  const store = new PageStore(config, db);
  await store.ensureStorage();
  return { store, db, config, dataDir, watchDir };
}

test('imports uploaded HTML and extracts directory name from relative path', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'a.html',
    relativePath: 'watch-demo-a/a.html',
    buffer: Buffer.from('<!doctype html><title>目录导入 A</title><h1>备用标题</h1>'),
  });

  assert.equal(page.title, '目录导入 A');
  assert.equal(page.directoryName, 'watch-demo-a');
  assert.equal(page.fileName, 'a.html');
  assert.equal(page.revision, 1);
  assert.match(await store.readPageHtml(page), /目录导入 A/);
});

test('imports upload folders with sibling assets and injects a page asset base', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const pages = await store.importUploadFiles([
    {
      fileName: 'index.html',
      relativePath: 'campaign/index.html',
      buffer: Buffer.from(
        '<!doctype html><html><head><title>活动页</title><link rel="stylesheet" href="css/style.css"></head><body><img src="images/logo.png"><h1>活动页</h1></body></html>',
      ),
    },
    {
      fileName: 'style.css',
      relativePath: 'campaign/css/style.css',
      buffer: Buffer.from('body{color:#123}'),
    },
    {
      fileName: 'logo.png',
      relativePath: 'campaign/images/logo.png',
      buffer: Buffer.from('png-bytes'),
    },
  ]);

  assert.equal(pages.length, 1);
  assert.equal(pages[0].directoryName, 'campaign');
  assert.equal(pages[0].fileName, 'index.html');
  assert.match(await store.readPageHtml(pages[0]), /<base data-tokhtml-base href="\/page-assets\/[^/]+\/campaign\/">/);
  await fs.access(path.join(path.dirname(pages[0].sourcePath), 'css', 'style.css'));
  await fs.access(path.join(path.dirname(pages[0].sourcePath), 'images', 'logo.png'));
});

test('injects configured tracking code into newly generated HTML pages', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await store.saveSettings({
    trackingCode: '<script data-test-tracker>window.__tracked = true;</script>',
  });

  const page = await store.importBuffer({
    fileName: 'tracked.html',
    relativePath: 'tracked.html',
    buffer: Buffer.from('<!doctype html><html><head><title>统计页</title></head><body><h1>统计页</h1></body></html>'),
  });
  const html = await store.readPageHtml(page);

  assert.match(html, /<!-- tokhtml-tracking:start -->/);
  assert.match(html, /<script data-test-tracker>window\.__tracked = true;<\/script>/);
  assert.ok(html.indexOf('data-test-tracker') < html.indexOf('</head>'));
  assert.equal((html.match(/data-test-tracker/g) || []).length, 1);
});

test('autosaves content with revision lock and creates restorable versions', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'landing.html',
    relativePath: 'landing.html',
    buffer: Buffer.from('<!doctype html><html><head><title>原始标题</title></head><body><h1>原始标题</h1></body></html>'),
  });

  const saved = await store.savePageContent(page.id, {
    revision: page.revision,
    reason: 'autosave',
    html: '<!doctype html><html><head><title>新标题</title></head><body><h1>新标题</h1><p>已修改</p></body></html>',
  });

  assert.equal(saved.title, '新标题');
  assert.equal(saved.revision, 2);
  assert.equal(saved.edited, true);
  assert.equal(store.listVersions(page.id).length, 1);

  await assert.rejects(
    () =>
      store.savePageContent(page.id, {
        revision: page.revision,
        html: '<!doctype html><title>旧版本提交</title>',
      }),
    /Revision conflict/,
  );

  const restored = await store.restoreVersion(page.id, store.listVersions(page.id).at(-1).id);
  assert.equal(restored.revision, 3);
  assert.match(await store.readPageHtml(restored), /原始标题/);
});

test('rescans watch directory and upserts HTML files', async (t) => {
  const { store, db, dataDir, watchDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  await fs.mkdir(path.join(watchDir, 'school'), { recursive: true });
  await fs.writeFile(
    path.join(watchDir, 'school', 'admission.html'),
    '<!doctype html><html><head><title>招生页</title></head><body><h1>招生页</h1></body></html>',
  );
  const watch = await store.addWatchDir({ path: watchDir, name: 'html-inbox', createIfMissing: true });
  const scanned = await store.rescanWatchDir(watch.id);
  const pages = store.listPages();

  assert.equal(scanned.htmlCount, 1);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].directoryName, 'school');
  assert.equal(pages[0].sourceType, 'watch');
});

test('paginates page list with a default page size of 20', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  for (let index = 1; index <= 25; index += 1) {
    await store.importBuffer({
      fileName: `page-${String(index).padStart(2, '0')}.html`,
      relativePath: `page-${String(index).padStart(2, '0')}.html`,
      buffer: Buffer.from(`<!doctype html><html><head><title>页面 ${index}</title></head><body><h1>页面 ${index}</h1></body></html>`),
    });
  }

  const firstPage = store.listPagesPage();
  const secondPage = store.listPagesPage({ page: 2 });

  assert.equal(firstPage.pages.length, 20);
  assert.equal(firstPage.pagination.pageSize, 20);
  assert.equal(firstPage.pagination.total, 25);
  assert.equal(firstPage.pagination.totalPages, 2);
  assert.equal(secondPage.pages.length, 5);
  assert.equal(secondPage.pagination.page, 2);
});

test('tracks page access count for generated HTML views', async (t) => {
  const { store, db, dataDir } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'view-count.html',
    relativePath: 'view-count.html',
    buffer: Buffer.from('<!doctype html><html><head><title>访问统计</title></head><body><h1>访问统计</h1></body></html>'),
  });

  assert.equal(page.accessCount, 0);
  assert.equal(store.incrementAccessCount(page.id).accessCount, 1);
  assert.equal(store.incrementAccessCount(page.id).accessCount, 2);
  assert.equal(store.getPage(page.id).accessCount, 2);
});

test('moves deleted pages into an inaccessible recycle bin and restores them', async (t) => {
  const { store, db, dataDir, config } = await createStore();
  t.after(() => db.close());
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const page = await store.importBuffer({
    fileName: 'trash-me.html',
    relativePath: 'trash-me.html',
    buffer: Buffer.from('<!doctype html><html><head><title>回收站页面</title></head><body><h1>回收站页面</h1></body></html>'),
  });
  const originalGeneratedPath = page.generatedPath;
  await fs.access(originalGeneratedPath);

  const trashed = await store.deletePage(page.id);
  assert.equal(trashed.deletedAt.length > 0, true);
  assert.equal(trashed.status, 'trashed');
  assert.equal(store.listPages().length, 0);
  assert.equal(store.listPages({ scope: 'trash' }).length, 1);
  await assert.rejects(() => fs.access(originalGeneratedPath));
  await fs.access(trashed.generatedPath);
  assert.match(trashed.generatedPath, new RegExp(`${path.sep}trash${path.sep}`.replace(/\\/g, '\\\\')));

  const restored = await store.restoreDeletedPage(page.id);
  assert.equal(restored.deletedAt, '');
  assert.equal(restored.status, 'published');
  assert.equal(restored.generatedPath, path.join(config.generatedDir, `${page.slug}.html`));
  assert.equal(store.listPages().length, 1);
  assert.equal(store.listPages({ scope: 'trash' }).length, 0);
  await fs.access(restored.generatedPath);
});
