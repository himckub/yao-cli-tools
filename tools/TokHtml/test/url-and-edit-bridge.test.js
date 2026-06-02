import assert from 'node:assert/strict';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { buildManagedSlug } from '../src/html.js';
import { editableElementSelector, injectEditBridge } from '../src/edit-bridge.js';

test('buildManagedSlug creates a short six-character URL slug for uploads', () => {
  const slug = buildManagedSlug({
    code: 'f812c6',
  });

  assert.equal(slug, 'f812c6');
  assert.match(slug, /^[a-z0-9]{6}$/);
});

test('editableElementSelector covers common text modules beyond paragraphs', () => {
  const { document } = parseHTML(`
    <main>
      <div class="card">卡片文案</div>
      <span>标签文案</span>
      <a href="#">链接文案</a>
      <button>按钮文案</button>
      <p>段落文案</p>
    </main>
  `);

  const editableTexts = Array.from(document.querySelectorAll(editableElementSelector)).map((node) => node.textContent.trim());

  assert.deepEqual(editableTexts, ['卡片文案', '标签文案', '链接文案', '按钮文案', '段落文案']);
});

test('injectEditBridge uses a structured kami-style floating toolbar', () => {
  const html = injectEditBridge(
    { id: 'page-1', slug: 'f812c6', revision: 1 },
    '<!doctype html><html><head><title>页面</title></head><body><h1>页面</h1></body></html>',
  );

  assert.match(html, /tokhtml-edit-panel/);
  assert.match(html, /tokhtml-edit-panel__brand/);
  assert.match(html, /tokhtml-edit-panel__status/);
  assert.match(html, /tokhtml-edit-panel__actions/);
  assert.match(html, /href="\/admin"/);
  assert.doesNotMatch(html, /href="\/">管理器/);
});
