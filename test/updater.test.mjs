import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const { compareVersions, pickAsset, summarizeRelease, fetchLatestRelease, downloadAsset, REPOSITORY } = createRequire(import.meta.url)('../desktop/updater.cjs');

const base = `https://github.com/${REPOSITORY}/releases/download/1.2.0/`;
const asset = (name, size = 10, extra = {}) => ({ name, size, browser_download_url: base + name, ...extra });
const release = (overrides = {}) => ({
  tag_name: '1.2.0', name: 'v1.2.0', body: '## Thay đổi\n- Config Editor', published_at: '2026-12-01T00:00:00Z', html_url: `https://github.com/${REPOSITORY}/releases/tag/1.2.0`, draft: false, prerelease: false,
  assets: [asset('Devkit-1.2.0-Windows-x64-Setup.exe', 100, { digest: 'sha256:' + 'a'.repeat(64) }), asset('Devkit-1.2.0-macOS-arm64.dmg'), asset('Devkit-1.2.0-macOS-arm64.zip'), asset('Devkit-1.2.0-macOS-x64.zip'), asset('Devkit-1.2.0-macOS-x64.zip.sha256', 90)],
  ...overrides
});
const response = (body, { status = 200, headers = {} } = {}) => new Response(body, { status, headers });

test('compares semantic versions with optional v prefix and pre-releases', () => {
  assert.equal(compareVersions('1.1.10', '1.1.9'), 1);
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0-beta.2', '2.0.0'), -1);
  assert.equal(compareVersions('2.0.0-beta.10', '2.0.0-beta.2'), 1);
  assert.throws(() => compareVersions('latest', '1.0.0'), /không hợp lệ/);
});

test('picks the installer for each platform and rejects foreign download URLs', () => {
  const assets = release().assets;
  assert.equal(pickAsset(assets, 'win32', 'x64').name, 'Devkit-1.2.0-Windows-x64-Setup.exe');
  assert.equal(pickAsset(assets, 'darwin', 'arm64').name, 'Devkit-1.2.0-macOS-arm64.dmg', 'DMG preferred');
  assert.equal(pickAsset(assets, 'darwin', 'x64').name, 'Devkit-1.2.0-macOS-x64.zip', 'ZIP fallback');
  assert.equal(pickAsset(assets, 'linux', 'x64'), null);
  assert.equal(pickAsset([{ ...assets[0], browser_download_url: 'https://evil.example/Devkit-1.2.0-Windows-x64-Setup.exe' }], 'win32'), null);
  assert.equal(pickAsset([asset('../Devkit-1.2.0-Windows-x64-Setup.exe')], 'win32'), null);
});

test('summarizes releases, flags newer versions and picks a checksum source', () => {
  const win = summarizeRelease(release(), { current: '1.1.4', platform: 'win32', arch: 'x64' });
  assert.equal(win.available, true);
  assert.equal(win.latest, '1.2.0');
  assert.equal(win.installKind, 'installer');
  assert.equal(win.asset.sha256, 'a'.repeat(64));
  const macIntel = summarizeRelease(release(), { current: '1.1.4', platform: 'darwin', arch: 'x64' });
  assert.equal(macIntel.installKind, 'archive');
  assert.equal(macIntel.asset.sidecarUrl, base + 'Devkit-1.2.0-macOS-x64.zip.sha256');
  assert.equal(summarizeRelease(release({ tag_name: 'v1.1.4' }), { current: '1.1.4', platform: 'win32' }).available, false);
  assert.equal(summarizeRelease(release({ assets: [] }), { current: '1.1.4', platform: 'win32' }).installKind, 'page');
  assert.throws(() => summarizeRelease(release({ draft: true }), { current: '1.1.4' }), /không trả về/);
});

test('reports GitHub API errors in plain language', async () => {
  const check = status => fetchLatestRelease({ fetch: async () => response('{}', { status }), current: '1.1.4', platform: 'win32', arch: 'x64' });
  await assert.rejects(check(404), /Chưa có bản phát hành/);
  await assert.rejects(check(403), /giới hạn/);
  await assert.rejects(check(500), /500/);
  const ok = await fetchLatestRelease({ fetch: async url => { assert.match(url, /releases\/latest$/); return response(JSON.stringify(release())); }, current: '1.1.4', platform: 'win32', arch: 'x64' });
  assert.equal(ok.available, true);
});

test('downloads updates with progress and verifies SHA-256 before keeping the file', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'devkit-update-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const content = Buffer.from('installer-bytes'.repeat(1000));
  const sha256 = createHash('sha256').update(content).digest('hex');
  const target = { name: 'Devkit-1.2.0-Windows-x64-Setup.exe', size: content.length, url: base + 'Devkit-1.2.0-Windows-x64-Setup.exe' };
  const fetch = async () => response(content, { headers: { 'content-length': String(content.length) } });
  const progress = [];
  const result = await downloadAsset({ ...target, sha256 }, dir, { fetch, onProgress: value => progress.push(value) });
  assert.equal(result.verified, true);
  assert.deepEqual(await readFile(result.file), content);
  assert.equal(progress.at(-1).received, content.length);

  await assert.rejects(downloadAsset({ ...target, sha256: 'b'.repeat(64) }, dir, { fetch }), /SHA-256 không khớp/);
  await assert.rejects(downloadAsset({ ...target, size: content.length + 1 }, dir, { fetch }), /không đủ dung lượng/);
  await assert.rejects(downloadAsset({ ...target, url: 'https://evil.example/x.exe' }, dir, { fetch }), /không hợp lệ/);
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.part')), [], 'partial downloads are removed');

  const sidecar = await downloadAsset({ ...target, sidecarUrl: base + 'x.sha256' }, dir, { fetch: async url => url.endsWith('.sha256') ? response(`${sha256}  ${target.name}\n`) : fetch() });
  assert.equal(sidecar.verified, true);
});

test('cleans up installed, unfinished and superseded update downloads only', async t => {
  const { cleanupDownloads } = createRequire(import.meta.url)('../desktop/updater.cjs');
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'devkit-cleanup-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = ['Devkit-1.1.7-Windows-x64-Setup.exe', 'Devkit-1.1.9-Windows-x64-Setup.exe', 'Devkit-1.2.0-Windows-x64-Setup.exe', 'Devkit-1.2.1-Windows-x64-Setup.exe.part', 'Devkit-1.3.0-macOS-arm64.dmg', 'notes.txt'];
  for (const name of files) await writeFile(path.join(dir, name), 'x');

  assert.deepEqual(cleanupDownloads(dir, { current: '1.1.9' }).sort(), ['Devkit-1.1.7-Windows-x64-Setup.exe', 'Devkit-1.1.9-Windows-x64-Setup.exe', 'Devkit-1.2.1-Windows-x64-Setup.exe.part']);
  assert.deepEqual((await readdir(dir)).sort(), ['Devkit-1.2.0-Windows-x64-Setup.exe', 'Devkit-1.3.0-macOS-arm64.dmg', 'notes.txt'], 'newer downloads and unrelated files are kept');

  assert.deepEqual(cleanupDownloads(dir, { current: '1.1.9', keep: 'Devkit-1.3.0-macOS-arm64.dmg' }), ['Devkit-1.2.0-Windows-x64-Setup.exe']);
  assert.deepEqual((await readdir(dir)).sort(), ['Devkit-1.3.0-macOS-arm64.dmg', 'notes.txt']);
  assert.deepEqual(cleanupDownloads(path.join(dir, 'missing'), { current: '1.0.0' }), []);
});
