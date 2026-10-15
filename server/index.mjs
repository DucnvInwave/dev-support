import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { APP_ID, resolveTools, execute, parseDevices, debugArgs, firebaseInvocation, validateZip, validSerial, validAppId } from './tools.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const local = process.env.DEVKIT_DATA_DIR || path.join(root, '.local');
await mkdir(path.join(local, 'uploads'), { recursive: true });
const token = randomBytes(32).toString('hex');
const port = Number(process.env.PORT || 3210);
const readJSON = async (file, fallback) => { try { return JSON.parse(await readFile(path.join(local, file), 'utf8')); } catch { return fallback; } };
let settings = await readJSON('settings.json', { sdkRoot: '', adbPath: '', firebasePath: '', appId: APP_ID });
const jobs = (await readJSON('history.json', [])).map(job => ['running', 'queued'].includes(job.status) ? { ...job, status: 'error', output: `${job.output || ''}\nServer đã dừng trước khi xác nhận kết quả.` } : job);
const saveHistory = () => writeFile(path.join(local, 'history.json'), JSON.stringify(jobs.slice(0, 100), null, 2));
let saveQueue = Promise.resolve();
const persist = () => { saveQueue = saveQueue.catch(() => {}).then(saveHistory); saveQueue.catch(console.error); };
const json = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
async function body(req) {
  let content = ''; for await (const chunk of req) { content += chunk; if (content.length > 16000) throw new Error('Dữ liệu quá lớn.'); }
  try { return JSON.parse(content); } catch { throw new Error('JSON không hợp lệ.'); }
}
function startJob(type, title, command, task) {
  if (jobs.some(job => job.status === 'running')) throw new Error('Một lệnh đang chạy. Vui lòng chờ hoàn tất.');
  const job = { id: randomUUID(), type, title, command, status: 'running', createdAt: new Date().toISOString(), output: '' };
  jobs.unshift(job); jobs.splice(100); persist();
  const log = text => { job.output = (job.output + text).slice(-200000); };
  Promise.resolve().then(() => task(log)).then(result => {
    job.status = result.code === 0 ? 'success' : 'error';
    if (!job.output.trim()) log(result.code === 0 ? 'Lệnh đã thực thi thành công.\n' : `Lệnh kết thúc với mã lỗi ${result.code}.\n`);
  }).catch(error => { job.status = 'error'; log(`\n${error.message}\n`); }).finally(() => { job.finishedAt = new Date().toISOString(); persist(); });
  return job;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!allowedHosts.includes(req.headers.host)) return json(res, 403, { error: 'Host không được phép.' });
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && !allowedHosts.some(host => req.headers.origin === `http://${host}`)) return json(res, 403, { error: 'Origin không được phép.' });
      if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-devkit-token'] !== token) return json(res, 403, { error: 'Phiên làm việc không hợp lệ. Tải lại trang.' });
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { token, settings });
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const tools = await resolveTools(settings); let devices = [], adbError = '';
        if (tools.adb) { try { const result = await execute(tools.adb, ['devices', '-l'], { timeout: 12000 }); if (result.code === 0) devices = parseDevices(result.output); else adbError = result.output; } catch (error) { adbError = error.message; } }
        return json(res, 200, { tools, devices, adbError, platform: process.platform });
      }
      if (req.method === 'GET' && url.pathname === '/api/jobs') return json(res, 200, jobs);
      if (req.method === 'GET' && url.pathname === '/api/debug-state') {
        const serial = url.searchParams.get('serial'); if (!validSerial(serial)) throw new Error('Thiết bị không hợp lệ.');
        const tools = await resolveTools(settings); if (!tools.adb) throw new Error('Chưa tìm thấy ADB. Cấu hình Android SDK trong Cài đặt.');
        const result = await execute(tools.adb, ['-s', serial, 'shell', 'getprop', 'debug.firebase.analytics.app']);
        if (result.code !== 0) throw new Error(result.output || 'Không đọc được trạng thái DebugView.');
        return json(res, 200, { packageName: result.output.trim() });
      }
      if (req.method === 'POST' && url.pathname === '/api/settings') {
        const input = await body(req);
        for (const key of ['sdkRoot', 'adbPath', 'firebasePath']) if (typeof input[key] !== 'string' || input[key].length > 2048 || /[\r\n\0]/.test(input[key])) throw new Error('Đường dẫn không hợp lệ.');
        if (!validAppId(input.appId)) throw new Error('Firebase App ID Android không hợp lệ.');
        settings = { sdkRoot: input.sdkRoot.trim(), adbPath: input.adbPath.trim(), firebasePath: input.firebasePath.trim(), appId: input.appId };
        await writeFile(path.join(local, 'settings.json'), JSON.stringify(settings, null, 2));
        return json(res, 200, settings);
      }
      if (req.method === 'POST' && url.pathname === '/api/debug') {
        const input = await body(req); if (typeof input.enabled !== 'boolean') throw new Error('Trạng thái debug không hợp lệ.');
        const args = debugArgs(input.serial, input.packageName, input.enabled);
        const tools = await resolveTools(settings); if (!tools.adb) throw new Error('Chưa tìm thấy ADB. Cấu hình Android SDK trong Cài đặt.');
        const job = startJob('debug', input.enabled ? 'Bật Firebase DebugView' : 'Tắt Firebase DebugView', `adb ${args.join(' ')}`, async log => {
          const result = await execute(tools.adb, args, { onOutput: log });
          if (result.code === 0) {
            const check = await execute(tools.adb, ['-s', input.serial, 'shell', 'getprop', 'debug.firebase.analytics.app']);
            if (check.code !== 0 || check.output.trim() !== (input.enabled ? input.packageName : '.none.')) throw new Error('Không xác nhận được thuộc tính debug trên thiết bị.');
            log(`DebugView ${input.enabled ? `đã bật cho ${input.packageName}` : 'đã tắt'} trên ${input.serial}.\n`);
          } return result;
        }); return json(res, 202, job);
      }
      if (req.method === 'POST' && url.pathname === '/api/symbols') {
        if (jobs.some(j => j.status === 'running')) throw new Error('Một lệnh đang chạy. Vui lòng chờ hoàn tất.');
        const appId = url.searchParams.get('appId'); if (!validAppId(appId)) throw new Error('Firebase App ID Android không hợp lệ.');
        const tools = await resolveTools(settings); if (!tools.firebase) throw new Error('Chưa tìm thấy Firebase CLI. Cài npm install -g firebase-tools và chạy firebase login.');
        const file = path.join(local, 'uploads', `${randomUUID()}.zip`); let size = 0;
        try {
          await pipeline(req, new Transform({ transform(chunk, encoding, callback) { size += chunk.length; callback(size > 1024 ** 3 ? new Error('File vượt quá giới hạn 1 GB.') : null, chunk); } }), createWriteStream(file, { flags: 'wx' }));
          await validateZip(file); const invocation = await firebaseInvocation(tools.firebase, appId, file);
          const job = startJob('symbols', 'Upload Crashlytics symbols', `firebase crashlytics:symbols:upload --app=${appId} "symbols.zip"`, async log => {
            try { return await execute(invocation.file, invocation.args, { onOutput: log, timeout: 20 * 60 * 1000 }); }
            finally { await rm(file, { force: true }); }
          }); return json(res, 202, job);
        } catch (error) { await rm(file, { force: true }); throw error; }
      }
      if (req.method === 'POST' && url.pathname === '/api/monitor') {
        const input = await body(req);
        if (typeof input.elevated !== 'boolean') throw new Error('Tùy chọn quyền Administrator không hợp lệ.');
        const tools = await resolveTools(settings); if (!tools.monitor) throw new Error('Không tìm thấy tools/monitor.bat. Android Device Monitor chỉ có trong SDK Tools cũ. Hãy chọn SDK tương ứng trong Cài đặt.');
        const job = startJob('monitor', 'Mở Android Device Monitor', tools.monitor, async log => {
          if (process.platform !== 'win32') throw new Error('Tính năng mở monitor.bat yêu cầu Windows.');
          const script = `$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; try { Start-Process -FilePath '${tools.monitor.replaceAll("'", "''")}' ${input.elevated ? '-Verb RunAs' : ''} -WindowStyle Hidden; Write-Output 'Đã gửi yêu cầu mở Android Monitor.' } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
          return execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-InputFormat', 'Text', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { onOutput: log, timeout: 120000 });
        }); return json(res, 202, job);
      }
      if (req.method === 'DELETE' && url.pathname === '/api/jobs') {
        if (jobs.some(j => j.status === 'running')) throw new Error('Không thể xóa lịch sử khi có lệnh đang chạy.');
        jobs.length = 0; persist(); return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'API không tồn tại.' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method không được hỗ trợ.' });
    const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/json-tools.js': ['json-tools.js', 'text/javascript; charset=utf-8'], '/json-ui.js': ['json-ui.js', 'text/javascript; charset=utf-8'], '/csv-tools.js': ['csv-tools.js', 'text/javascript; charset=utf-8'], '/csv-ui.js': ['csv-ui.js', 'text/javascript; charset=utf-8'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
    const asset = assets[url.pathname]; if (!asset) return json(res, 404, { error: 'Không tìm thấy trang.' });
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    res.end(req.method === 'HEAD' ? undefined : await readFile(path.join(root, 'public', asset[0])));
  } catch (error) { if (!res.headersSent && !res.destroyed) json(res, 400, { error: error.message }); }
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n  Không thể khởi động devkit: cổng ${port} đang được sử dụng.\n  Nếu devkit đã chạy, mở http://localhost:${port}\n  Hoặc dừng phiên cũ bằng Ctrl+C và chạy lại.\n  Để dùng cổng khác trong PowerShell:\n    $env:PORT = '${port === 3211 ? 3212 : 3211}'\n    npm start\n`);
  } else {
    console.error(`\n  Không thể khởi động devkit: ${error.message}\n`);
  }
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`\n  devkit · Your everyday dev companion\n  Open http://localhost:${port}\n  Local only · Ctrl+C to stop\n`));
