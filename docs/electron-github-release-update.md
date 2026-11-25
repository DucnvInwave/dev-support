# Xây dựng app Electron: build tự động bằng GitHub Actions và kiểm tra cập nhật trong app

Tài liệu này mô tả quy trình đang dùng cho Devkit, viết lại dạng mẫu để áp dụng cho app Electron khác.

**Kết quả cuối cùng:**

1. Lập trình viên nâng version, push code và **push một tag** (ví dụ `1.2.0`).
2. GitHub Actions tự build bộ cài Windows (NSIS `.exe`) và macOS (`.dmg` + `.zip`, Apple Silicon và Intel), chạy test, rồi **tự tạo GitHub Release** kèm file `.sha256`.
3. App đã cài trên máy người dùng tự hỏi GitHub Releases xem có bản mới không. Nếu có, app hiện thông báo kèm ghi chú thay đổi.
   - **Windows:** tải bộ cài, kiểm tra SHA-256, cài im lặng rồi tự mở lại app.
   - **macOS:** tải và mở DMG để người dùng kéo vào Applications.

> Thay các placeholder sau cho app của bạn: `MyApp` (tên sản phẩm), `com.example.myapp` (appId), `OWNER/REPO` (repo GitHub).

---

## Mục lục

1. [Yêu cầu và quyết định thiết kế](#1-yêu-cầu-và-quyết-định-thiết-kế)
2. [Cấu trúc thư mục](#2-cấu-trúc-thư-mục)
3. [Cấu hình electron-builder trong package.json](#3-cấu-hình-electron-builder-trong-packagejson)
4. [Ký ad-hoc cho macOS (afterPack)](#4-ký-ad-hoc-cho-macos-afterpack)
5. [Workflow GitHub Actions: build và phát hành](#5-workflow-github-actions-build-và-phát-hành)
6. [Module kiểm tra cập nhật (main process)](#6-module-kiểm-tra-cập-nhật-main-process)
7. [Nối vào main process: IPC, cài đặt, thoát app](#7-nối-vào-main-process-ipc-cài-đặt-thoát-app)
8. [Preload: cầu nối an toàn cho giao diện](#8-preload-cầu-nối-an-toàn-cho-giao-diện)
9. [Giao diện trong renderer](#9-giao-diện-trong-renderer)
10. [Quy trình phát hành hằng ngày](#10-quy-trình-phát-hành-hằng-ngày)
11. [Kiểm thử](#11-kiểm-thử)
12. [Xử lý sự cố thường gặp](#12-xử-lý-sự-cố-thường-gặp)
13. [Chi phí GitHub Actions](#13-chi-phí-github-actions)
14. [Khi nào nên dùng electron-updater thay thế](#14-khi-nào-nên-dùng-electron-updater-thay-thế)
15. [Checklist áp dụng cho app mới](#15-checklist-áp-dụng-cho-app-mới)

---

## 1. Yêu cầu và quyết định thiết kế

| Hạng mục | Lựa chọn | Lý do |
| --- | --- | --- |
| Đóng gói | `electron-builder` (NSIS cho Windows, DMG + ZIP cho Mac) | Phổ biến, một cấu hình cho cả hai nền tảng |
| Nơi build | GitHub-hosted runners (`windows-latest`, `macos-15`, `macos-15-intel`) | Build Mac cần máy Mac; repo public được dùng miễn phí |
| Kích hoạt | Push tag `X.Y.Z` hoặc `vX.Y.Z` | Chỉ tag mới tạo Release; push code thường không build |
| Nơi lưu bản phát hành | GitHub Releases | Miễn phí, có API công khai, có SHA-256 cho từng file |
| Kiểm tra cập nhật | Tự viết (không thêm thư viện), gọi `GET /repos/OWNER/REPO/releases/latest` | Nhẹ, hiểu rõ từng bước, chạy được với app Mac chưa có Apple Developer ID |
| Cài đặt trên Windows | Chạy bộ cài NSIS với `--updated /S --force-run` | Cài im lặng vào thư mục cũ, tự mở lại app |
| Cài đặt trên macOS | Tải và mở DMG | Tự thay app trên Mac (Squirrel.Mac) **bắt buộc** chữ ký Developer ID |

**Yêu cầu:**

- Repo **public**. Với repo private, app sẽ không gọi được API và không tải được file nếu không có token; nên dùng một repo public riêng chỉ để chứa Release.
- Node.js 20+ trên máy dev; runner dùng Node 22.
- `electron` và `electron-builder` trong `devDependencies`.

---

## 2. Cấu trúc thư mục

```
my-app/
├─ package.json                 # version + cấu hình "build" của electron-builder
├─ desktop/
│  ├─ main.cjs                  # main process: cửa sổ, menu, IPC, cập nhật
│  ├─ preload.cjs               # contextBridge: API an toàn cho renderer
│  ├─ updater.cjs               # logic kiểm tra/tải cập nhật (test được)
│  ├─ icon.ico / icon.png
├─ public/ (hoặc src/renderer)  # giao diện
│  └─ update-ui.js              # banner + nút cập nhật
├─ scripts/
│  └─ after-pack.cjs            # ký ad-hoc gói macOS
├─ test/
│  └─ updater.test.mjs
└─ .github/workflows/
   └─ build-electron.yml        # build + phát hành
```

---

## 3. Cấu hình electron-builder trong package.json

```jsonc
{
  "name": "my-app",
  "version": "1.0.0",                 // NGUỒN DUY NHẤT của version, tag phải trùng
  "main": "desktop/main.cjs",
  "scripts": {
    "test": "node --test",
    "electron": "electron .",
    "electron:dist:win": "electron-builder --win nsis --x64",
    "electron:dist:mac": "electron-builder --mac dmg zip"
  },
  "devDependencies": {
    "electron": "<phiên bản cố định>",
    "electron-builder": "<phiên bản cố định>"
  },
  "build": {
    "appId": "com.example.myapp",
    "productName": "MyApp",
    "directories": { "output": "dist/electron", "buildResources": "desktop" },
    "files": ["desktop/**", "public/**", "package.json"],   // chỉ liệt kê file cần, không đóng gói dữ liệu máy build
    "asar": true,
    "npmRebuild": false,
    "afterPack": "scripts/after-pack.cjs",
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "icon": "desktop/icon.ico",
      "artifactName": "MyApp-${version}-Windows-${arch}-Setup.${ext}"
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,                         // cài theo user → không cần UAC khi cập nhật
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "runAfterFinish": true                       // trang cuối có ô "Run MyApp" khi cài tay
    },
    "mac": {
      "category": "public.app-category.developer-tools",
      "icon": "desktop/icon.png",
      "minimumSystemVersion": "13.0",
      "identity": null,                            // không tìm chứng chỉ; ký ad-hoc ở afterPack
      "artifactName": "MyApp-${version}-macOS-${arch}.${ext}",
      "target": ["dmg", "zip"]
    }
  }
}
```

**Quy ước tên file rất quan trọng.** Module cập nhật nhận diện file theo mẫu tên:

- `MyApp-<version>-Windows-x64-Setup.exe`
- `MyApp-<version>-macOS-arm64.dmg` / `.zip`
- `MyApp-<version>-macOS-x64.dmg` / `.zip`

Đổi `artifactName` thì phải đổi regex `ASSET_NAME` trong [mục 6](#6-module-kiểm-tra-cập-nhật-main-process).

`perMachine: false` giúp cập nhật im lặng không bật hộp thoại UAC. Nếu app bắt buộc cài cho mọi user (`perMachine: true`), bộ cài sẽ cần quyền Administrator mỗi lần cập nhật.

---

## 4. Ký ad-hoc cho macOS (afterPack)

Mac Apple Silicon từ chối mở app tải từ internet nếu app hoàn toàn không có chữ ký. Ký ad-hoc (không cần tài khoản Apple Developer) giải quyết điều này. Người dùng vẫn phải chọn **Privacy & Security → Open Anyway** ở lần mở đầu tiên.

```js
// scripts/after-pack.cjs
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
```

---

## 5. Workflow GitHub Actions: build và phát hành

`.github/workflows/build-electron.yml`:

```yaml
name: Build Electron desktop

on:
  workflow_dispatch:            # bấm tay = chỉ build thử, KHÔNG tạo Release
  push:
    tags:
      # Cả "1.2.0" lẫn "v1.2.0" đều build và phát hành.
      - 'v[0-9]+.[0-9]+.[0-9]+*'
      - '[0-9]+.[0-9]+.[0-9]+*'

permissions:
  contents: read                # mặc định chỉ đọc; job release xin quyền ghi riêng

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: windows-latest, arch: x64,   target: win }
          - { os: macos-15,       arch: arm64, target: mac }   # Apple Silicon
          - { os: macos-15-intel, arch: x64,   target: mac }   # Intel
    runs-on: ${{ matrix.os }}
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      # Chặn phát hành khi quên nâng version: app sẽ tự xưng sai version
      # và người dùng bị nhắc cập nhật mãi.
      - name: Check tag matches package.json version
        if: startsWith(github.ref, 'refs/tags/')
        shell: bash
        run: |
          VERSION=$(node -p "require('./package.json').version")
          if [ "${GITHUB_REF_NAME#v}" != "$VERSION" ]; then
            echo "::error::Tag $GITHUB_REF_NAME không khớp version $VERSION trong package.json."
            exit 1
          fi

      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: npm }
      - run: npm ci --no-audit --no-fund
      - run: npm test

      - name: Build installer
        run: npx electron-builder --${{ matrix.target }} --${{ matrix.arch }} --publish never
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'   # không tìm chứng chỉ ký trên runner

      # (Khuyến nghị) chạy smoke test trên bản đã đóng gói ở đây.

      - uses: actions/upload-artifact@v4
        with:
          name: MyApp-Electron-${{ matrix.target }}-${{ matrix.arch }}
          if-no-files-found: error
          path: |
            dist/electron/*-Setup.exe
            dist/electron/*.dmg
            dist/electron/*.zip

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/')
    runs-on: ubuntu-latest
    permissions:
      contents: write             # cần để tạo Release và upload file
    steps:
      - uses: actions/download-artifact@v4
        with:
          pattern: MyApp-Electron-*
          path: release
          merge-multiple: true

      - name: Create checksums
        working-directory: release
        run: for file in *; do sha256sum "$file" > "$file.sha256"; done

      - name: Publish GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.ref_name }}
        run: |
          # Tạo dạng nháp → upload → công bố, để app không bao giờ thấy Release thiếu file.
          if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            gh release upload "$TAG" release/* --repo "$GITHUB_REPOSITORY" --clobber
          else
            gh release create "$TAG" --repo "$GITHUB_REPOSITORY" --draft --title "v${TAG#v}" --generate-notes --verify-tag
            gh release upload "$TAG" release/* --repo "$GITHUB_REPOSITORY" --clobber
            gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --draft=false --latest
          fi
```

**Ghi chú:**

- Bộ lọc tag dùng cú pháp glob của GitHub, trong đó `+` nghĩa là "một hoặc nhiều ký tự liền trước". Hậu tố `*` cho phép tag như `1.2.0-beta.1`. Tuy vậy, app chỉ nhận Release không phải pre-release (xem mục 6).
- `--generate-notes` tự sinh ghi chú từ các commit/PR kể từ tag trước. App hiển thị nội dung này trong mục "Xem thay đổi". Có thể sửa ghi chú trên GitHub sau khi phát hành.
- Nếu Release cho tag đã được tạo tay từ trước, workflow chỉ upload hoặc ghi đè file.

---

## 6. Module kiểm tra cập nhật (main process)

Tách riêng để test được: không phụ thuộc Electron, nhận `fetch` qua tham số.

```js
// desktop/updater.cjs
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const REPOSITORY = 'OWNER/REPO';
const PRODUCT = 'MyApp';
const LATEST_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const DOWNLOAD_PREFIX = `https://github.com/${REPOSITORY}/releases/download/`;
const ASSET_NAME = new RegExp(`^${PRODUCT}-\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?-(?:Windows-x64-Setup\\.exe|macOS-(?:arm64|x64)\\.(?:dmg|zip))$`);
const MAX_ASSET_BYTES = 1024 ** 3;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value ?? '').trim());
  return match ? { parts: match.slice(1, 4).map(Number), pre: match[4] || '' } : null;
}
// So sánh semver; bản pre-release đứng trước bản chính thức cùng số.
function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) throw new Error(`Phiên bản không hợp lệ: ${!left ? a : b}`);
  for (let i = 0; i < 3; i++) if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre.localeCompare(right.pre, 'en', { numeric: true }) > 0 ? 1 : -1;
}

// Chỉ nhận file đúng tên mẫu, đúng repo, kích thước hợp lý.
function pickAsset(assets = [], platform = process.platform, arch = process.arch) {
  const valid = assets.filter(a => ASSET_NAME.test(a?.name || '') && String(a.browser_download_url || '').startsWith(DOWNLOAD_PREFIX) && a.size > 0 && a.size <= MAX_ASSET_BYTES);
  if (platform === 'win32') return valid.find(a => a.name.endsWith('-Windows-x64-Setup.exe')) || null;
  if (platform === 'darwin') {
    const macArch = arch === 'arm64' ? 'arm64' : 'x64';
    return valid.find(a => a.name.endsWith(`-macOS-${macArch}.dmg`)) || valid.find(a => a.name.endsWith(`-macOS-${macArch}.zip`)) || null;
  }
  return null;
}
// GitHub công bố SHA-256 cho mỗi file ("digest": "sha256:..."); dự phòng bằng file .sha256 do workflow tạo.
function assetChecksum(asset, assets = []) {
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset?.digest || '');
  if (digest) return { sha256: digest[1].toLowerCase() };
  const sidecar = assets.find(i => i?.name === `${asset?.name}.sha256` && String(i.browser_download_url || '').startsWith(DOWNLOAD_PREFIX));
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
  const response = await fetch(LATEST_URL, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': `${PRODUCT}/${current}` },
    signal: AbortSignal.timeout(15000)
  });
  if (response.status === 404) throw new Error('Chưa có bản phát hành nào trên GitHub.');
  if (response.status === 403 || response.status === 429) throw new Error('GitHub tạm giới hạn số lần kiểm tra. Thử lại sau ít phút.');
  if (!response.ok) throw new Error(`Không kiểm tra được cập nhật (GitHub trả về ${response.status}).`);
  return summarizeRelease(await response.json(), { current, platform, arch });
}

// Tải vào file .part, tính SHA-256 trong lúc tải, chỉ giữ file khi khớp.
async function downloadAsset(asset, directory, { fetch, onProgress = () => {} }) {
  if (!asset || !ASSET_NAME.test(asset.name) || !String(asset.url).startsWith(DOWNLOAD_PREFIX)) throw new Error('File cập nhật không hợp lệ.');
  let expected = asset.sha256;
  if (!expected && asset.sidecarUrl) {
    const text = await fetch(asset.sidecarUrl, { signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.text() : '').catch(() => '');
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
    if (expected && actual !== expected) throw new Error('Mã SHA-256 không khớp, đã hủy cài đặt.');
    fs.rmSync(target, { force: true }); fs.renameSync(partial, target);
    return { file: target, sha256: actual, verified: !!expected };
  } catch (error) {
    file.destroy(); fs.rmSync(partial, { force: true });
    throw error;
  }
}

module.exports = { REPOSITORY, parseVersion, compareVersions, pickAsset, summarizeRelease, fetchLatestRelease, downloadAsset };
```

**Các điểm bảo mật đã cài sẵn:**

- Chỉ nhận URL tải bắt đầu bằng `https://github.com/OWNER/REPO/releases/download/`.
- Tên file phải khớp regex. Điều này ngăn path traversal (`../`) và file lạ.
- Kiểm tra kích thước và SHA-256 trước khi chạy bộ cài.
- Bỏ qua bản nháp (draft) và pre-release.

---

## 7. Nối vào main process: IPC, cài đặt, thoát app

Dùng `net.fetch` của Electron thay cho `fetch` của Node, vì `net.fetch` tôn trọng proxy hệ thống (quan trọng với mạng công ty).

```js
// desktop/main.cjs (trích phần liên quan)
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, net } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('./updater.cjs');

let window, updateInfo = null, updateDownload = null, downloadedUpdate = null;

// Chỉ nhận IPC từ cửa sổ chính của app (không từ trang lạ/iframe).
function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Yêu cầu không được phép.');
}

function setupUpdateIPC() {
  ipcMain.handle('app:update-check', async event => {
    trusted(event);
    updateInfo = await updater.fetchLatestRelease({ fetch: net.fetch, current: app.getVersion(), platform: process.platform, arch: process.arch });
    if (downloadedUpdate && downloadedUpdate.name !== updateInfo.asset?.name) downloadedUpdate = null;
    return { ...updateInfo, downloaded: !!downloadedUpdate, checkedAt: new Date().toISOString() };
  });

  ipcMain.handle('app:update-download', async event => {
    trusted(event);
    if (!updateInfo?.available || !updateInfo.asset) throw new Error('Chưa có bản cập nhật để tải.');
    if (downloadedUpdate?.name === updateInfo.asset.name) return { verified: downloadedUpdate.verified };
    const sender = event.sender, asset = updateInfo.asset;
    updateDownload ??= updater.downloadAsset(asset, path.join(app.getPath('temp'), `${app.getName()}-update`), {
      fetch: net.fetch,
      onProgress: progress => { if (!sender.isDestroyed()) sender.send('app:update-progress', progress); }
    }).then(result => { downloadedUpdate = { ...result, name: asset.name }; return { verified: result.verified }; })
      .finally(() => { updateDownload = null; });
    return updateDownload;
  });

  ipcMain.handle('app:update-install', async event => {
    trusted(event);
    if (!downloadedUpdate || !fs.existsSync(downloadedUpdate.file)) throw new Error('Chưa tải xong bản cập nhật.');
    const file = downloadedUpdate.file;
    if (file.endsWith('.exe')) {
      // Cài im lặng sẽ tắt app đang chạy: hỏi trước nếu có việc dở dang.
      if (!(await confirmStopRunningWork())) return { action: 'cancelled' };
      // NSIS của electron-builder:
      //   /S          cài im lặng vào thư mục cũ (đọc InstallLocation trong registry)
      //   --updated   chờ app thoát / tự dừng app, giữ shortcut
      //   --force-run mở app mới khi cài xong (bộ cài assisted chỉ làm điều này khi chạy /S)
      spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
      setTimeout(() => app.quit(), 300);
      return { action: 'installer' };
    }
    const error = await shell.openPath(file);   // macOS: mở DMG/ZIP
    if (error) throw new Error(error);
    if (file.endsWith('.zip')) shell.showItemInFolder(file);
    return { action: file.endsWith('.dmg') ? 'dmg' : 'archive' };
  });

  ipcMain.handle('app:open-release', (event, url) => {
    trusted(event);
    if (!String(url).startsWith(`https://github.com/${updater.REPOSITORY}/`)) throw new Error('Liên kết không hợp lệ.');
    return shell.openExternal(url);
  });
}

// Tùy app: trả về false nếu người dùng muốn tiếp tục công việc đang chạy.
async function confirmStopRunningWork() { return true; }

// Mục menu "Kiểm tra cập nhật…" chuyển yêu cầu sang renderer.
const updateMenuItem = { label: 'Kiểm tra cập nhật…', click: () => window?.webContents.send('app:update-menu') };
```

`BrowserWindow` cần `contextIsolation: true`, `sandbox: true` và `nodeIntegration: false`. Renderer không bao giờ gọi mạng hay chạy file trực tiếp; mọi thứ đi qua IPC ở trên.

---

## 8. Preload: cầu nối an toàn cho giao diện

```js
// desktop/preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
const subscribe = channel => callback => {
  const listener = (_, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('appDesktop', Object.freeze({
  getVersion: () => ipcRenderer.invoke('app:version'),     // tự thêm handler trả app.getVersion()
  checkUpdate: () => ipcRenderer.invoke('app:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('app:update-download'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  openRelease: url => ipcRenderer.invoke('app:open-release', url),
  onUpdateProgress: subscribe('app:update-progress'),
  onUpdateMenu: subscribe('app:update-menu')
}));
```

---

## 9. Giao diện trong renderer

Hành vi tối thiểu nên có:

| Hành vi | Chi tiết |
| --- | --- |
| Tự kiểm tra | ~4 giây sau khi mở app, và mỗi 6 giờ. Có checkbox tắt (lưu trong `localStorage`) |
| Kiểm tra tay | Nút trong Cài đặt và mục menu. Luôn hiện kết quả, kể cả "đã là bản mới nhất" |
| Banner khi có bản mới | Version hiện tại → mới, ngày phát hành, ghi chú thay đổi (`release.body`) |
| Nút chính | Windows: "Tải và cài đặt (N MB)" → thanh tiến độ → xác nhận → cài im lặng. Mac: "Tải về" → mở DMG. Không có file cho máy này: "Tải từ GitHub" |
| Bỏ qua bản này | Lưu version bị bỏ qua; tự kiểm tra không nhắc lại, kiểm tra tay vẫn hiện |
| Lỗi | Tự kiểm tra thì im lặng (chỉ ghi vào dòng trạng thái); kiểm tra tay thì hiện thông báo lỗi |

Khung mã tối giản:

```js
// public/update-ui.js
export function initUpdates({ desktop, toast }) {
  let info = null;
  async function check(manual = false) {
    try {
      const update = await desktop.checkUpdate();
      const skipped = !manual && localStorage.getItem('updateSkip') === update.latest;
      info = skipped ? { ...update, available: false } : update;
      renderBanner(info);                              // tự viết: hiện/ẩn banner theo info.available
      if (manual && !update.available) toast(`Đã là bản mới nhất (${update.current}).`);
    } catch (error) { if (manual) toast(error.message, true); }
  }
  async function install() {
    if (info.installKind === 'page') return desktop.openRelease(info.pageUrl);
    if (!info.downloaded) { await desktop.downloadUpdate(); info.downloaded = true; }
    if (info.installKind === 'installer' && !confirm(`Cài ${info.latest}? App sẽ đóng, cập nhật trong nền rồi tự mở lại.`)) return;
    await desktop.installUpdate();
  }
  desktop.onUpdateProgress(({ received, total }) => renderProgress(received / total));
  desktop.onUpdateMenu(() => check(true));
  if (localStorage.getItem('updateAuto') !== 'off') {
    setTimeout(() => check(), 4000);
    setInterval(() => check(), 6 * 60 * 60 * 1000);
  }
  return { check, install };
}
```

Nếu dùng Content-Security-Policy với `connect-src 'self'` thì vẫn không sao: renderer không gọi GitHub trực tiếp, main process làm việc đó.

---

## 10. Quy trình phát hành hằng ngày

```sh
# 1. Nâng version (cập nhật cả package.json và package-lock.json, không tự tạo tag)
npm version 1.2.0 --no-git-tag-version

# 2. Commit
git commit -am "1.2.0: mô tả thay đổi"

# 3. Tạo tag TRÙNG version và push cả code lẫn tag
git tag 1.2.0
git push origin main 1.2.0
```

Sau khoảng 10–15 phút, Release `v1.2.0` xuất hiện với các file:

```
MyApp-1.2.0-Windows-x64-Setup.exe        (+ .sha256)
MyApp-1.2.0-macOS-arm64.dmg / .zip       (+ .sha256)
MyApp-1.2.0-macOS-x64.dmg / .zip         (+ .sha256)
```

App trên máy người dùng sẽ báo bản mới ở lần mở tiếp theo, hoặc trong vòng 6 giờ.

| Bạn làm gì | Kết quả |
| --- | --- |
| Push code lên `main` | Không build |
| Push tag `X.Y.Z` / `vX.Y.Z` | Build, test, tạo Release, app nhận được cập nhật |
| Actions → Run workflow | Chỉ build thử; bộ cài ở mục Artifacts, không tạo Release |

**Lưu ý:**

- **Tính năng cập nhật chỉ có từ bản đầu tiên chứa nó.** Người dùng bản cũ hơn phải cài tay một lần.
- **Thay đổi cách cài đặt (ví dụ tham số NSIS) có hiệu lực chậm một bản.** Code chạy bộ cài nằm trong app *đang chạy*. Ví dụ: nếu thêm `--force-run` ở bản 1.1.8, lần cập nhật 1.1.7 → 1.1.8 vẫn theo cách cũ; từ 1.1.8 → 1.1.9 mới theo cách mới.
- Không xóa Release cũ mà người dùng có thể đang cần; app luôn lấy bản `latest`.

---

## 11. Kiểm thử

**Unit test** cho `updater.cjs` với `fetch` giả lập (không gọi mạng):

```js
// test/updater.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { compareVersions, pickAsset, summarizeRelease } = createRequire(import.meta.url)('../desktop/updater.cjs');

test('so sánh version', () => {
  assert.equal(compareVersions('1.1.10', '1.1.9'), 1);
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('2.0.0-beta.2', '2.0.0'), -1);
});
// Nên có thêm: chọn đúng file theo nền tảng; từ chối URL ngoài repo và tên "../";
// tải với SHA-256 đúng/sai; file thiếu dung lượng; lỗi 403/404/500 từ API.
```

**Kiểm tra với GitHub thật** mà không cần cài app (chạy bằng Node):

```sh
node -e "require('./desktop/updater.cjs').fetchLatestRelease({ fetch, current: '0.0.1', platform: 'win32', arch: 'x64' }).then(console.log)"
```

**Kiểm tra trọn quy trình** cần hai bản liên tiếp đều có tính năng cập nhật:

1. Phát hành `N`, cài tay bản `N`.
2. Phát hành `N+1`.
3. Mở app bản `N` → thấy banner → cập nhật → app tự mở lại với version `N+1`.

**Giả lập version cũ để chụp giao diện** mà không phải phát hành: tạo script harness, ghi đè `app.getVersion = () => '0.0.1'` rồi `require('./desktop/main.cjs')`. Chạy bằng `electron harness.cjs` với thư mục dữ liệu và profile riêng.

---

## 12. Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
| --- | --- | --- |
| Workflow đỏ ở bước "Check tag matches package.json version" | Quên nâng `version` trước khi gắn tag | Nâng version và commit; xóa tag cũ (`git tag -d X` + `git push origin :refs/tags/X`); gắn lại tag vào commit mới (`git tag -f X`) rồi push |
| Push tag nhưng workflow không chạy | Tag không khớp bộ lọc, hoặc tag được tạo bằng token `GITHUB_TOKEN` của workflow khác | Dùng tag dạng `1.2.0`/`v1.2.0` và push từ máy |
| Job `release` lỗi 403 / "Resource not accessible by integration" | Quyền của token bị giới hạn | Settings → Actions → General → Workflow permissions → **Read and write**, rồi chạy lại job |
| App báo "GitHub tạm giới hạn số lần kiểm tra" | API không đăng nhập: tối đa 60 lần/giờ cho mỗi IP | Giữ chu kỳ kiểm tra thưa (6 giờ); nhiều máy chung một IP công ty thì cân nhắc chu kỳ dài hơn |
| App không thấy bản mới | Release đang là draft/pre-release; hoặc tên file không khớp regex; hoặc `latest` đang trỏ bản khác | Kiểm tra trang Release, tên file và nhãn "Latest" |
| Mac báo app "bị hỏng / không mở được" | Chưa ký, hoặc bị gắn cờ quarantine | Đảm bảo `afterPack` ký ad-hoc; người dùng chọn Privacy & Security → Open Anyway |
| Cập nhật Windows hiện bộ cài có giao diện | App đang chạy là bản chưa có tham số `/S --force-run` | Bình thường cho một lần; bản sau sẽ cài im lặng |
| Sau khi cài im lặng app không tự mở lại | Bộ cài bị chặn (antivirus) hoặc lỗi giữa chừng | Mở app bằng tay; kiểm tra log; có thể tải Setup từ Release để cài tay |
| `npm run electron` chạy như Node, không mở cửa sổ | Biến môi trường `ELECTRON_RUN_AS_NODE=1` (hay gặp trong terminal của VS Code) | `Remove-Item Env:ELECTRON_RUN_AS_NODE` (PowerShell) hoặc `env -u ELECTRON_RUN_AS_NODE` |

---

## 13. Chi phí GitHub Actions

- **Repo public:** runner chuẩn do GitHub cung cấp (Windows, macOS, Linux) **miễn phí**. File đính kèm Release không tính phí lưu trữ (mỗi file tối đa 2 GB).
- **Repo private:** chỉ có một lượng phút miễn phí mỗi tháng tùy gói tài khoản. Phút trên Windows và nhất là macOS được tính gấp nhiều lần so với Linux. Artifact cũng tính vào dung lượng lưu trữ.
- Mỗi lần phát hành theo workflow trên chạy 3 job build (mỗi job khoảng 5–10 phút) và 1 job release ngắn trên Linux.
- Bảng giá có thể thay đổi; xem [About billing for GitHub Actions](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions) trước khi áp dụng cho repo private.

---

## 14. Khi nào nên dùng electron-updater thay thế

[`electron-updater`](https://www.electron.build/auto-update) (cùng hệ sinh thái electron-builder) tự tải và cài, hỗ trợ tải từng phần (differential). Nó cần:

- Cấu hình `"publish": { "provider": "github" }` và file `latest.yml` / `latest-mac.yml` trong Release (electron-builder tự tạo khi `--publish always`).
- **Trên macOS: app phải được ký bằng Apple Developer ID** (và nên notarize). Bản ký ad-hoc không tự cập nhật được.

Nên chuyển sang `electron-updater` khi đã có chứng chỉ Apple Developer ID (và chứng chỉ ký code Windows nếu muốn tránh cảnh báo SmartScreen), hoặc khi file cài lớn và cần tải từng phần. Cách tự viết trong tài liệu này phù hợp khi chưa có chứng chỉ, muốn ít phụ thuộc và kiểm soát rõ giao diện.

---

## 15. Checklist áp dụng cho app mới

- [ ] Repo public (hoặc repo public riêng để chứa Release).
- [ ] `package.json`: `version`, `build.appId`, `productName`, `artifactName` theo mẫu `MyApp-${version}-…`, `nsis.perMachine: false`, `runAfterFinish: true`, `mac.identity: null`.
- [ ] `scripts/after-pack.cjs` ký ad-hoc cho macOS.
- [ ] `.github/workflows/build-electron.yml`: đổi tên artifact `MyApp-Electron-*`, thêm smoke test nếu có.
- [ ] `desktop/updater.cjs`: đổi `REPOSITORY`, `PRODUCT`; regex khớp `artifactName`.
- [ ] `main.cjs`: IPC `update-check` / `update-download` / `update-install` / `open-release`; dùng `net.fetch`; mục menu "Kiểm tra cập nhật…"; hỏi trước khi tắt app nếu có việc đang chạy.
- [ ] `preload.cjs`: expose API qua `contextBridge`; cửa sổ dùng `contextIsolation` + `sandbox`.
- [ ] Renderer: banner, nút cập nhật, tiến độ tải, "Bỏ qua bản này", tùy chọn tự kiểm tra.
- [ ] Unit test cho `updater.cjs`.
- [ ] Phát hành bản đầu tiên (`git tag X.Y.Z && git push origin main X.Y.Z`); kiểm tra Release có đủ 5 file cài và 5 file `.sha256`.
- [ ] Cài tay bản đầu tiên; phát hành bản kế tiếp; kiểm tra app tự báo, tự cài và tự mở lại.
