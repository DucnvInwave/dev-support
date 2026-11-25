// Update checks against GitHub Releases. Pure helpers are exported for tests;
// network access is injected so the main process can use Electron's net.fetch
// (honours system proxy settings).
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const REPOSITORY = 'DucnvInwave/dev-support';
const LATEST_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPOSITORY}/releases/download/`;
const ASSET_NAME = /^Devkit-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-(?:Windows-x64-Setup\.exe|macOS-(?:arm64|x64)\.(?:dmg|zip))$/;
const MAX_ASSET_BYTES = 1024 ** 3;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value ?? '').trim());
  return match ? { parts: match.slice(1, 4).map(Number), pre: match[4] || '' } : null;
}
// Semantic-version comparison; a pre-release sorts before its final release.
function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw new Error(`Phiên bản không hợp lệ: ${!left ? a : b}`);
  for (let index = 0; index < 3; index++) if (left.parts[index] !== right.parts[index]) return left.parts[index] > right.parts[index] ? 1 : -1;
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre, 'en', { numeric: true }) > 0 ? 1 : -1;
}

function pickAsset(assets = [], platform = process.platform, arch = process.arch) {
  const valid = assets.filter(asset => ASSET_NAME.test(asset?.name || '') && String(asset.browser_download_url || '').startsWith(DOWNLOAD_PREFIX) && asset.size > 0 && asset.size <= MAX_ASSET_BYTES);
  if (platform === 'win32') return valid.find(asset => asset.name.endsWith('-Windows-x64-Setup.exe')) || null;
  if (platform === 'darwin') {
    const macArch = arch === 'arm64' ? 'arm64' : 'x64';
    return valid.find(asset => asset.name.endsWith(`-macOS-${macArch}.dmg`)) || valid.find(asset => asset.name.endsWith(`-macOS-${macArch}.zip`)) || null;
  }
  return null;
}
function assetChecksum(asset, assets = []) {
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset?.digest || '');
  if (digest) return { sha256: digest[1].toLowerCase() };
  const sidecar = assets.find(item => item?.name === `${asset?.name}.sha256` && String(item.browser_download_url || '').startsWith(DOWNLOAD_PREFIX));
  return sidecar ? { sidecarUrl: sidecar.browser_download_url } : {};
}

function summarizeRelease(release, { current, platform = process.platform, arch = process.arch }) {
  if (!release || release.draft || release.prerelease || !parseVersion(release.tag_name)) throw new Error('GitHub không trả về bản phát hành hợp lệ.');
  const latest = release.tag_name.replace(/^v/, '');
  const asset = pickAsset(release.assets, platform, arch);
  return {
    current, latest, available: compareVersions(latest, current) > 0,
    name: release.name || `v${latest}`,
    notes: String(release.body || '').slice(0, 4000),
    publishedAt: release.published_at || null,
    pageUrl: String(release.html_url || '').startsWith(`https://github.com/${REPOSITORY}/`) ? release.html_url : `https://github.com/${REPOSITORY}/releases`,
    asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url, ...assetChecksum(asset, release.assets) } : null,
    installKind: !asset ? 'page' : asset.name.endsWith('.exe') ? 'installer' : asset.name.endsWith('.dmg') ? 'dmg' : 'archive'
  };
}

async function fetchLatestRelease({ fetch, current, platform, arch }) {
  const response = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `Devkit/${current}` }, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) throw new Error('Chưa có bản phát hành nào trên GitHub.');
  if (response.status === 403 || response.status === 429) throw new Error('GitHub tạm giới hạn số lần kiểm tra. Thử lại sau ít phút.');
  if (!response.ok) throw new Error(`Không kiểm tra được cập nhật (GitHub trả về ${response.status}).`);
  return summarizeRelease(await response.json(), { current, platform, arch });
}

async function downloadAsset(asset, directory, { fetch, onProgress = () => {} }) {
  if (!asset || !ASSET_NAME.test(asset.name) || !String(asset.url).startsWith(DOWNLOAD_PREFIX)) throw new Error('File cập nhật không hợp lệ.');
  let expected = asset.sha256;
  if (!expected && asset.sidecarUrl) {
    const text = await fetch(asset.sidecarUrl, { signal: AbortSignal.timeout(15000) }).then(response => response.ok ? response.text() : '').catch(() => '');
    expected = /^[a-f0-9]{64}\b/i.exec(text.trim())?.[0].toLowerCase();
  }
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, asset.name), partial = `${target}.part`;
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Không tải được file cập nhật (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || asset.size;
  const hash = createHash('sha256'), file = fs.createWriteStream(partial);
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > MAX_ASSET_BYTES) throw new Error('File cập nhật vượt quá giới hạn.');
      hash.update(value);
      if (!file.write(value)) await new Promise(resolve => file.once('drain', resolve));
      onProgress({ received, total });
    }
    await new Promise((resolve, reject) => file.end(error => error ? reject(error) : resolve()));
    if (received !== asset.size) throw new Error('File tải về không đủ dung lượng. Hãy thử lại.');
    const actual = hash.digest('hex');
    if (expected && actual !== expected) throw new Error('Mã kiểm tra SHA-256 không khớp, file cập nhật có thể bị hỏng. Đã hủy cài đặt.');
    fs.rmSync(target, { force: true }); fs.renameSync(partial, target);
    return { file: target, sha256: actual, verified: !!expected };
  } catch (error) {
    file.destroy(); fs.rmSync(partial, { force: true });
    throw error;
  }
}

// Removes installers that are no longer useful so the download folder does not grow by
// ~100 MB per release: unfinished .part files, versions already installed (<= current),
// and any version other than `keep` (the one about to be downloaded).
function cleanupDownloads(directory, { current, keep } = {}) {
  let names;
  try { names = fs.readdirSync(directory); } catch { return []; }
  const removed = [];
  for (const name of names) {
    const base = name.endsWith('.part') ? name.slice(0, -5) : name;
    if (!ASSET_NAME.test(base)) continue; // never touch files the updater did not create
    const version = /^Devkit-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-/.exec(base)[1];
    const stale = name.endsWith('.part')
      || (current && compareVersions(version, current) <= 0)
      || (keep && base !== keep);
    if (!stale) continue;
    try { fs.rmSync(path.join(directory, name), { force: true }); removed.push(name); } catch { /* in use; retry next time */ }
  }
  return removed;
}

module.exports = { REPOSITORY, LATEST_URL, parseVersion, compareVersions, pickAsset, summarizeRelease, fetchLatestRelease, downloadAsset, cleanupDownloads };
