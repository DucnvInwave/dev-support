import { spawn } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

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

export async function resolveTools(settings = {}) {
  const environment = commandEnvironment();
  const candidates = [settings.sdkRoot, environment.ANDROID_SDK_ROOT, environment.ANDROID_HOME,
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Android', 'Sdk')].filter(Boolean);
  // Unity installs its own Android SDK under each editor version.
  if (process.platform === 'win32') {
    const editorRoot = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Unity/Hub/Editor');
    try { for (const version of (await readdir(editorRoot)).sort().reverse()) candidates.push(path.join(editorRoot, version, 'Editor/Data/PlaybackEngines/AndroidPlayer/SDK')); } catch {}
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

export function execute(file, args, { onOutput = () => {}, timeout = 30000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    let output = '', finished = false;
    const child = spawn(file, args, { windowsHide: true, shell: false, env: commandEnvironment(env) });
    const timer = setTimeout(() => { child.kill(); finish(new Error('Lệnh vượt quá thời gian chờ. Kiểm tra thiết bị hoặc đăng nhập Firebase rồi thử lại.')); }, timeout);
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
  const args = ['crashlytics:symbols:upload', `--app=${appId}`, symbolsPath, '--non-interactive'];
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    // Execute the actual Node CLI, so paths and user input never pass through cmd.exe.
    const entry = path.join(path.dirname(file), 'node_modules/firebase-tools/lib/bin/firebase.js');
    if (!await exists(entry)) throw new Error('Không tìm thấy Firebase CLI. Cấu hình đường dẫn firebase.js trong Cài đặt hoặc cài npm install -g firebase-tools.');
    return { file: process.execPath, args: [entry, ...args] };
  }
  return /\.[cm]?js$/i.test(file) ? { file: process.execPath, args: [file, ...args] } : { file, args };
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
