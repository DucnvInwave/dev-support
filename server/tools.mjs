import { spawn } from 'node:child_process';
import { access, readdir, stat, realpath, open } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

export const APP_ID = '1:528923424982:android:46195f809d709f94';
export const validPackage = value => typeof value === 'string' && /^(?:[A-Za-z_][\w]*\.)+[A-Za-z_][\w]*$/.test(value) && value.length <= 255;
export const validAppId = value => typeof value === 'string' && /^1:\d+:android:[a-f\d]+$/i.test(value);
export const validSerial = value => typeof value === 'string' && /^[\w.:[\]-]{1,160}$/.test(value);
export async function exists(file) { try { await access(file); return true; } catch { return false; } }

export function commandEnvironment(source = process.env, platform = process.platform) {
  const env = { ...source };
  if (platform !== 'win32') return env;
  const get = key => env[Object.keys(env).find(name => name.toLowerCase() === key.toLowerCase())];
  const setDefault = (key, value) => { if (!get(key) && value) env[key] = value; };
  const windows = get('SystemRoot') || get('windir') || 'C:\\Windows';
  const drive = path.win32.parse(windows).root.replace(/\\$/, '') || 'C:';
  setDefault('SystemRoot', windows); setDefault('windir', windows);
  setDefault('SystemDrive', drive); setDefault('ComSpec', path.win32.join(windows, 'System32', 'cmd.exe'));
  setDefault('ProgramData', `${drive}\\ProgramData`); setDefault('ALLUSERSPROFILE', get('ProgramData'));
  const profile = get('USERPROFILE');
  if (profile) { setDefault('APPDATA', path.win32.join(profile, 'AppData', 'Roaming')); setDefault('LOCALAPPDATA', path.win32.join(profile, 'AppData', 'Local')); }
  return env;
}

export async function findOnPath(name) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const ext of process.platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const file = path.join(dir.replace(/^"|"$/g, ''), name + ext);
      if (await exists(file)) return file;
    }
  }
  return null;
}

export function sdkCandidates(settings = {}, environment = commandEnvironment(), platform = process.platform, home = homedir()) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return [...new Set([settings.sdkRoot, environment.ANDROID_SDK_ROOT, environment.ANDROID_HOME,
    platform === 'win32' && environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Android', 'Sdk'),
    platform === 'darwin' && join(home, 'Library/Android/sdk')].filter(Boolean))];
}

export async function resolveTools(settings = {}) {
  const candidates = sdkCandidates(settings);
  // Unity installs its own Android SDK under each editor version.
  if (process.platform === 'win32') {
    const editorRoot = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Unity/Hub/Editor');
    try { for (const version of (await readdir(editorRoot)).sort().reverse()) candidates.push(path.join(editorRoot, version, 'Editor/Data/PlaybackEngines/AndroidPlayer/SDK')); } catch {}
  }
  if (process.platform === 'darwin') {
    const editorRoot = '/Applications/Unity/Hub/Editor';
    try { for (const version of (await readdir(editorRoot)).sort().reverse()) candidates.push(path.join(editorRoot, version, 'Unity.app/Contents/PlaybackEngines/AndroidPlayer/SDK')); } catch {}
  }
  const sdkRoot = candidates.find(Boolean) || '';
  let adb = settings.adbPath || null;
  if (!adb) for (const sdk of candidates) { const candidate = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'); if (await exists(candidate)) { adb = candidate; break; } }
  adb ||= await findOnPath('adb');
  let monitor = null;
  for (const sdk of candidates) { const candidate = path.join(sdk, 'tools', process.platform === 'win32' ? 'monitor.bat' : 'monitor'); if (await exists(candidate)) { monitor = candidate; break; } }
  const firebase = settings.firebasePath || await findOnPath('firebase');
  return { sdkRoot, adb: adb && await exists(adb) ? adb : null, firebase: firebase && await exists(firebase) ? firebase : null, monitor };
}

const activeCommands = new Set();
function trackCommand(child, group) {
  let closed;
  const entry = { child, group, closed: new Promise(resolve => { closed = resolve; }) };
  activeCommands.add(entry);
  child.once('close', () => { activeCommands.delete(entry); closed(); });
  return entry;
}
async function terminateCommand(entry) {
  const { child, group } = entry;
  if (!child.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const windows = commandEnvironment().SystemRoot || 'C:/Windows';
    await new Promise(resolve => {
      const killer = spawn(path.join(windows, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', env: commandEnvironment() });
      const timer = setTimeout(() => { killer.kill(); child.kill(); resolve(); }, 3500);
      const done = () => { clearTimeout(timer); if (child.exitCode === null) child.kill(); resolve(); };
      killer.once('error', done); killer.once('close', done);
    });
  } else if (group) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  } else child.kill();
  await Promise.race([entry.closed, new Promise(resolve => setTimeout(resolve, 2000))]);
}
export async function stopCommands() {
  await Promise.allSettled([...activeCommands].map(terminateCommand));
}
export function execute(file, args, { onOutput = () => {}, timeout = 30000, env = process.env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    let output = '', finished = false;
    const environment = commandEnvironment(env);
    // Electron is also the Node runtime used to run a locally installed Firebase CLI.
    if (process.versions.electron || process.env.DEVKIT_ELECTRON === '1') environment.ELECTRON_RUN_AS_NODE = '1';
    const group = process.platform !== 'win32' && process.env.DEVKIT_ELECTRON === '1';
    const child = spawn(file, args, { windowsHide: true, shell: false, detached: group, env: environment, cwd });
    const tracked = trackCommand(child, group);
    const timer = setTimeout(() => {
      finish(new Error('Lệnh vượt quá thời gian chờ. Kiểm tra thiết bị hoặc đăng nhập Firebase rồi thử lại.'));
      void terminateCommand(tracked);
    }, timeout);
    const finish = (error, code) => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(Object.assign(error, { output })) : resolve({ code, output }); };
    child.on('error', error => finish(error));
    for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', text => {
      output = (output + text).slice(-200000); onOutput(text);
    });
    child.on('close', code => finish(null, code));
  });
}

export function parseDevices(output) {
  return output.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('List of devices') && !line.startsWith('*')).map(line => {
    const [serial, state, ...parts] = line.trim().split(/\s+/);
    return { serial, state, model: (parts.find(p => p.startsWith('model:'))?.slice(6) || serial).replaceAll('_', ' ') };
  }).filter(device => device.serial && device.state);
}

export function debugArgs(serial, packageName, enabled) {
  if (!validSerial(serial)) throw new Error('Vui lòng chọn thiết bị hợp lệ.');
  if (enabled && !validPackage(packageName)) throw new Error('Package name không hợp lệ. Ví dụ: com.company.game');
  return ['-s', serial, 'shell', 'setprop', 'debug.firebase.analytics.app', enabled ? packageName : '.none.'];
}

export async function firebaseInvocation(file, appId, symbolsPath) {
  if (!validAppId(appId)) throw new Error('Firebase App ID Android không hợp lệ.');
  const nodeExecutable = process.versions.electron && process.env.DEVKIT_NODE_EXECUTABLE ? process.env.DEVKIT_NODE_EXECUTABLE : process.execPath;
  const args = ['crashlytics:symbols:upload', `--app=${appId}`, symbolsPath, '--non-interactive', '--debug'];
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    // Execute the actual Node CLI, so paths and user input never pass through cmd.exe.
    const entry = path.join(path.dirname(file), 'node_modules/firebase-tools/lib/bin/firebase.js');
    if (!await exists(entry)) throw new Error('Không tìm thấy Firebase CLI. Cấu hình đường dẫn firebase.js trong Cài đặt hoặc cài npm install -g firebase-tools.');
    return { file: nodeExecutable, args: [entry, ...args] };
  }
  if (process.platform !== 'win32') {
    // npm exposes an extensionless symlink on macOS. Use the bundled Node
    // for that JS entry point, even when Finder has no Node on PATH.
    const resolved = await realpath(file).catch(() => file);
    if (/\.[cm]?js$/i.test(resolved)) file = resolved;
    else {
      let handle;
      try {
        handle = await open(resolved, 'r');
        const header = Buffer.alloc(256); const { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (/^#![^\r\n]*\bnode(?:\s|$)/.test(header.subarray(0, bytesRead).toString()))
          return { file: nodeExecutable, args: [resolved, ...args] };
      } catch {} finally { await handle?.close(); }
    }
  }
  return /\.[cm]?js$/i.test(file) ? { file: nodeExecutable, args: [file, ...args] } : { file, args };
}


export function launchMacMonitor(file, { onOutput = () => {} } = {}) {
  // The legacy launcher is a shell script. Its path remains a separate argument.
  return new Promise((resolve, reject) => {
    const group = process.env.DEVKIT_ELECTRON === '1';
    const child = spawn('/bin/sh', [file], { stdio: 'ignore', detached: group, env: commandEnvironment() });
    trackCommand(child, group);
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      const output = 'Đã gửi yêu cầu mở Android Monitor.\n'; onOutput(output);
      resolve({ code: 0, output });
    });
  });
}

export async function validateZip(file) {
  const info = await stat(file);
  if (info.size < 4) throw new Error('File ZIP rỗng hoặc không hợp lệ.');
  const { open } = await import('node:fs/promises');
  const handle = await open(file, 'r');
  try {
    const bytes = Buffer.alloc(4); await handle.read(bytes, 0, 4, 0);
    if (!['504b0304', '504b0506', '504b0708'].includes(bytes.toString('hex'))) throw new Error('Nội dung file không phải định dạng ZIP.');
  } finally { await handle.close(); }
}

// Firebase invokes java from PATH; honor JAVA_HOME for apps opened without a terminal.
export async function inspectJava({ env = process.env, run = execute } = {}) {
  const environment = commandEnvironment(env);
  const key = name => Object.keys(environment).find(item => item.toLowerCase() === name.toLowerCase());
  const home = environment[key('JAVA_HOME')]?.replace(/^"|"$/g, '');
  let file = 'java';
  if (home) {
    const candidate = path.join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    if (await exists(candidate)) {
      file = candidate;
      const pathKey = key('PATH') || 'PATH';
      environment[pathKey] = path.dirname(candidate) + path.delimiter + (environment[pathKey] || '');
    }
  }
  const help = 'Cài Java JDK 17 (64-bit), thêm thư mục bin vào PATH hoặc đặt JAVA_HOME, rồi chọn Dừng và thoát Devkit và mở lại. Kiểm tra bằng java -version trên máy này.';
  try {
    const result = await run(file, ['-version'], { env: environment, timeout: 10000 });
    if (result.code !== 0) return { ready: false, env: environment, message: 'Java không khởi động được. ' + result.output.trim().slice(0, 2000) + '\n' + help };
    return { ready: true, env: environment, message: result.output.trim().slice(0, 2000) || 'Java đã phản hồi.' };
  } catch (error) {
    return { ready: false, env: environment, message: (error.code === 'ENOENT' ? 'Chưa tìm thấy Java trong môi trường của Devkit. ' : 'Không kiểm tra được Java: ' + error.message + '. ') + help };
  }
}
