const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, shell, ipcMain, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { desktopPaths, selectPort, isAppURL, isExternalURL } = require('./runtime.cjs');
app.setName('Devkit');
app.setAppUserModelId('local.devkit.desktop');
const paths = desktopPaths({ userData: app.getPath('userData') });
app.setPath('userData', paths.profile);
const smoke = process.argv.includes('--smoke-test');
if (smoke && (process.env.DEVKIT_SMOKE_TEST !== '1' || !process.env.DEVKIT_DESKTOP_HOME || !process.env.DEVKIT_ELECTRON_PROFILE)) throw new Error('Smoke test requires isolated data and profile directories.');
let window, tray, backend, origin = '', quitting = false, allowQuit = false, backendStopped = false;
let lastPage = '', smokeReport = {};
const nonce = randomBytes(16).toString('hex');
fs.mkdirSync(paths.home, { recursive: true }); fs.mkdirSync(paths.data, { recursive: true });
const logfile = path.join(paths.home, 'electron.log');
try { if (fs.statSync(logfile).size > 1024 * 1024) fs.writeFileSync(logfile, ''); } catch {}
function log(text) { try { fs.appendFileSync(logfile, String(text) + '\n'); } catch {} }
function showWindow() {
  if (!origin) return;
  if (!window || window.isDestroyed()) createWindow();
  if (window.isMinimized()) window.restore(); window.show(); window.focus();
}
function external(url) { if (isExternalURL(url)) void shell.openExternal(url).catch(error => log(error.message)); }
function createWindow() {
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 650, show: false, title: 'Devkit', backgroundColor: '#f7f8f4', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false }
  });
  window.once('ready-to-show', () => { if (!smoke) window.show(); });
  window.on('close', event => {
    if (!quitting && tray) { event.preventDefault(); window.hide(); }
  });
  window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppURL(url, origin)) { event.preventDefault(); external(url); } });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('did-navigate-in-page', (_, url) => { if (isAppURL(url, origin)) lastPage = url; });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && permission === 'clipboard-sanitized-write'));
  window.webContents.session.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === 'clipboard-sanitized-write');
  const loaded = window.loadURL(lastPage || origin);
  loaded.catch(error => log(error.stack));
  return loaded;
}
function setupMenu() {
  const common = [{ label: 'Mở Devkit', click: showWindow }, { label: 'Mở thư mục dữ liệu', click: () => void shell.openPath(paths.data) }, { label: 'Mở log ứng dụng', click: () => void shell.openPath(logfile) }, { type: 'separator' }, { label: 'Dừng và thoát', accelerator: 'CommandOrControl+Q', click: () => app.quit() }];
  const menu = Menu.buildFromTemplate(common);
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: process.platform === 'darwin' ? 20 : 24, height: process.platform === 'darwin' ? 20 : 24 }));
    tray.setToolTip('Devkit'); tray.setContextMenu(menu); tray.on('double-click', showWindow);
  } catch (error) { log('Tray: ' + error.message); }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Devkit', submenu: [...(process.platform === 'darwin' ? [{ role: 'about' }, { type: 'separator' }] : []), ...common] },
    { label: 'Chỉnh sửa', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Hiển thị', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : [])] }
  ]));
}
function trusted(event) { if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppURL(event.senderFrame.url, origin)) throw new Error('Yêu cầu không được phép.'); }
function setupIPC() {
  ipcMain.handle('devkit:info', event => { trusted(event); return { version: app.getVersion(), platform: process.platform, dataDirectory: paths.data }; });
  ipcMain.handle('devkit:show-data', event => { trusted(event); return shell.openPath(paths.data); });
  ipcMain.handle('devkit:choose-path', async (event, kind) => {
    trusted(event);
    if (!['sdk', 'adb', 'firebase'].includes(kind)) throw new Error('Loại công cụ không hợp lệ.');
    const result = await dialog.showOpenDialog(window, { title: { sdk: 'Chọn thư mục Android SDK', adb: 'Chọn ADB', firebase: 'Chọn Firebase CLI' }[kind], properties: [kind === 'sdk' ? 'openDirectory' : 'openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
}
async function previousInstance() {
  try {
    const lines = fs.readFileSync(path.join(paths.home, 'desktop-port.txt'), 'utf8').split(/\r?\n/);
    const address = new URL(lines[0]);
    if (!['localhost', '127.0.0.1'].includes(address.hostname) || address.protocol !== 'http:' || !/^[a-f0-9]{32}$/.test(lines[1])) return;
    const response = await fetch(address.origin.replace('localhost', '127.0.0.1') + '/api/health', { signal: AbortSignal.timeout(1200) });
    if (response.ok && response.headers.get('X-Devkit-Instance') === lines[1]) throw Object.assign(new Error('Một bản Devkit khác đang dùng cùng dữ liệu. Hãy chọn Dừng và thoát bản cũ rồi mở ứng dụng Electron.'), { liveDevkit: true });
  } catch (error) { if (error.liveDevkit) throw error; }
}
async function startBackend() {
  await previousInstance();
  const port = await selectPort();
  const env = { ...process.env, PORT: String(port), DEVKIT_DATA_DIR: paths.data, DEVKIT_DESKTOP_INSTANCE: nonce, DEVKIT_ELECTRON: '1', DEVKIT_ELECTRON_PARENT_PID: String(process.pid), DEVKIT_NODE_EXECUTABLE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.platform === 'darwin') env.PATH = ['/opt/homebrew/bin', '/usr/local/bin', path.join(app.getPath('home'), '.npm-global/bin'), path.join(app.getPath('home'), 'Library/Android/sdk/platform-tools'), env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'].join(':');
  const backendEntry = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked/desktop/backend.cjs') : path.join(__dirname, 'backend.cjs');
  backend = utilityProcess.fork(backendEntry, [], { serviceName: 'Devkit Backend', stdio: 'pipe', env });
  backend.stdout?.on('data', chunk => log(chunk)); backend.stderr?.on('data', chunk => log(chunk));
  backend.on('exit', code => {
    backendStopped = true; log('Backend exited: ' + code);
    if (origin && !quitting) {
      void dialog.showMessageBox({ type: 'error', message: 'Backend Devkit đã dừng', detail: 'Mở lại ứng dụng để khôi phục kết nối. Các thao tác chưa hoàn tất cần được kiểm tra lại.', buttons: ['Khởi động lại', 'Đóng'] }).then(({ response }) => { if (!response) app.relaunch(); app.quit(); });
    }
  });
  const address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Khởi động backend quá lâu. Xem electron.log.')), 20000);
    backend.once('exit', code => { clearTimeout(timer); reject(new Error('Backend không khởi động được (' + code + '). Xem electron.log.')); });
    backend.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message); }
      else if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message)); }
    });
  });
  const health = await fetch(address.url + '/api/health', { signal: AbortSignal.timeout(3000) });
  if (!health.ok || health.headers.get('X-Devkit-Instance') !== nonce) throw new Error('Không xác nhận được backend Devkit.');
  origin = address.url;
  fs.writeFileSync(path.join(paths.home, 'desktop-port.txt'), origin + '\n' + nonce);
}
async function stopBackend() {
  if (!backend || backendStopped) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { backend.kill(); resolve(); }, 10000);
    backend.once('exit', () => { clearTimeout(timer); resolve(); });
    try { backend.postMessage({ type: 'stop' }); } catch { clearTimeout(timer); backend.kill(); resolve(); }
  });
}
async function requestQuit() {
  if (quitting) return;
  quitting = true;
  try {
    let jobs = [];
    if (origin && !backendStopped) jobs = await fetch(origin + '/api/jobs', { signal: AbortSignal.timeout(1500) }).then(response => response.json()).catch(() => []);
    if (!smoke && jobs.some(job => job.status === 'running')) {
      const { response } = await dialog.showMessageBox({ type: 'question', message: 'Một tác vụ đang chạy', detail: 'Thoát Devkit sẽ hủy tác vụ đó.', buttons: ['Tiếp tục sử dụng', 'Dừng và thoát'], defaultId: 0, cancelId: 0 });
      if (response === 0) { quitting = false; return; }
    }
    await stopBackend();
    tray?.destroy(); tray = null; allowQuit = true; app.quit();
  } catch (error) { log(error.stack); allowQuit = true; app.exit(1); }
}
app.on('before-quit', event => { if (!allowQuit) { event.preventDefault(); void requestQuit(); } });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('activate', showWindow);
if (!app.requestSingleInstanceLock()) app.exit(0);
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    setupIPC(); if (!smoke) setupMenu();
    await startBackend(); await createWindow();
    if (smoke) await require('./smoke.cjs').check({ app, window, origin, paths, report: smokeReport });
  }).then(() => { if (smoke) app.quit(); }).catch(async error => {
    log(error.stack); quitting = true;
    await stopBackend();
    if (smoke) { fs.writeFileSync(path.join(paths.home, 'electron-smoke.json'), JSON.stringify({ ok: false, error: error.stack }, null, 2)); app.exit(1); }
    else { dialog.showErrorBox('Chưa mở được Devkit', error.message); app.exit(1); }
  });
}
