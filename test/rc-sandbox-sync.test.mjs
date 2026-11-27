import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scopeCss, extractSection } from '../scripts/sync-rc-sandbox.mjs';

test('RC Sandbox styles are scoped so they cannot restyle Devkit', () => {
  const css = scopeCss(':root { --a: 1; }\nhtml, body { margin: 0; }\n* { box-sizing: border-box; }\nbutton, input { font: inherit; }\n.card .head { gap: 4px; }');
  assert.match(css, /^\.qc-root \{ --a: 1; \}/m);
  assert.match(css, /^\.qc-root \{ margin: 0; \}/m);
  assert.match(css, /^\.qc-root, \.qc-root \* \{ box-sizing/m);
  assert.match(css, /^\.qc-root button, \.qc-root input \{/m);
  assert.match(css, /^\.qc-root \.card \.head \{/m);
});

test('the synced tool is the sandbox section only, shown by default', () => {
  const html = '<header>shell</header><section id="tab-sandbox" class="tabpage hidden"><div id="editor"></div><dialog id="sendDialog"></dialog></section><script src="app.js"></script>';
  const section = extractSection(html);
  assert.match(section, /^<section id="tab-sandbox" class="tabpage">/);
  assert.match(section, /<\/section>$/);
  assert.doesNotMatch(section, /shell|app\.js/);
});

test('committed RC Sandbox files are present and scoped', async () => {
  const css = await readFile(new URL('../public/rc-sandbox/sandbox.css', import.meta.url), 'utf8');
  for (const line of css.split('\n').filter(l => /^[^\s/}].*\{/.test(l))) assert.match(line, /^\.qc-root/);
  const markup = await readFile(new URL('../public/rc-sandbox/markup.html', import.meta.url), 'utf8');
  assert.match(markup, /id="sendDialog"/);
});
