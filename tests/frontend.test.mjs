import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, fileIcon, formatDate, formatSize, isPreviewable } from '../src/js/format.js';
import { makeTab, restoreTabs, saveTabs } from '../src/js/tab-state.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('formats sizes and invalid timestamps without throwing', () => {
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(Number.NaN), '—');
  assert.equal(formatDate(0), '—');
  assert.notEqual(formatDate(1_700_000_000), '—');
});

test('escapes text and identifies supported file previews', () => {
  assert.equal(escapeHtml(`<x attr="'">&`), '&lt;x attr=&quot;&#39;&quot;&gt;&amp;');
  assert.equal(fileIcon({ is_dir: true, is_symlink: false }), '📁');
  assert.equal(isPreviewable({ is_dir: false, is_symlink: false, extension: 'png' }), true);
  assert.equal(isPreviewable({ is_dir: false, is_symlink: false, extension: 'exe' }), false);
});

test('persists and restores independent tab histories', () => {
  globalThis.localStorage = memoryStorage();
  const first = makeTab('/home/user');
  first.history.push('/home/user/Documents');
  first.historyIndex = 1;
  const second = makeTab('/tmp');
  saveTabs([first, second], second.id);
  const restored = restoreTabs('/fallback');
  assert.equal(restored.tabs.length, 2);
  assert.equal(restored.tabs[0].history[1], '/home/user/Documents');
  assert.equal(restored.tabs[1].path, '/tmp');
  assert.equal(restored.activeTabId, restored.tabs[1].id);
  delete globalThis.localStorage;
});
