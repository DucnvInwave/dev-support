// Copies the RC Sandbox tool from the Dancing Road QC web page into public/rc-sandbox/.
// The files are committed and reviewed like any other change, so Devkit never runs
// code fetched at runtime.
//
//   npm run sync:rc                       (from https://dancing-road.web.app)
//   npm run sync:rc -- D:/repo/hosting/qc (from a local checkout)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'public', 'rc-sandbox');
const source = process.argv[2] || 'https://dancing-road.web.app';
const remote = /^https:\/\//.test(source);

async function load(file) {
  if (!remote) return readFile(path.join(source, file), 'utf8');
  const response = await fetch(`${source.replace(/\/+$/, '')}/${file}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

// Every rule is prefixed with .qc-root so the tool's styles never leak into Devkit.
export function scopeCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([^{}]+)\{([^{}]*)\}/g, (rule, selectors, body) => {
    const scoped = selectors.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      if (s === ':root' || s === 'html' || s === 'body') return '.qc-root';
      if (s === '*') return '.qc-root, .qc-root *';
      return `.qc-root ${s}`;
    });
    return `${[...new Set(scoped)].join(', ')} {${body}}\n`;
  });
}

// The sandbox tab section plus its dialogs, without the page's own shell.
export function extractSection(html) {
  const start = html.indexOf('<section id="tab-sandbox"');
  const dialog = html.indexOf('id="sendDialog"', start);
  const end = html.indexOf('</section>', dialog);
  if (start < 0 || dialog < 0 || end < 0) throw new Error('Could not find the sandbox section in index.html');
  return html.slice(start, end + '</section>'.length).replace('class="tabpage hidden"', 'class="tabpage"');
}

const header = () => `Synced from ${source} on ${new Date().toISOString().slice(0, 10)} by scripts/sync-rc-sandbox.mjs. Do not edit; change the QC web page and sync again.`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [html, js, css, qr] = await Promise.all(['index.html', 'sandbox.js', 'app.css', 'vendor/qrcode.js'].map(load));
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'markup.html'), `<!-- ${header()} -->\n${extractSection(html)}\n`);
  await writeFile(path.join(out, 'sandbox.js'), `// ${header()}\n${js}`);
  await writeFile(path.join(out, 'sandbox.css'), `/* ${header()} */\n${scopeCss(css)}`);
  await writeFile(path.join(out, 'qrcode.js'), qr);
  console.log(`RC Sandbox synced into ${path.relative(root, out)}`);
}
