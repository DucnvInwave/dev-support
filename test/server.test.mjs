import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

test('local HTTP server serves the app and protects command endpoints', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'devkit-api-test-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, env: { ...process.env, PORT: String(port), DEVKIT_DATA_DIR: temp, DEVKIT_DESKTOP_INSTANCE: '0123456789abcdef0123456789abcdef' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => { const closed = new Promise(resolve => child.once('close', resolve)); child.kill(); await closed; await rm(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000); child.once('error', reject); child.stdout.on('data', chunk => { if (String(chunk).includes('Open http://')) { clearTimeout(timer); resolve(); } }); });
  const response = await fetch(base); assert.equal(response.status, 200); assert.match(await response.text(), /Firebase DebugView/);
  const duplicate = spawn(process.execPath, ['server/index.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true, env: { ...process.env, PORT: String(port), DEVKIT_DATA_DIR: temp }, stdio: ['ignore', 'pipe', 'pipe'] });
  let duplicateOutput = '';
  duplicate.stdout.setEncoding('utf8').on('data', text => { duplicateOutput += text; });
  duplicate.stderr.setEncoding('utf8').on('data', text => { duplicateOutput += text; });
  const duplicateExit = await new Promise((resolve, reject) => { duplicate.once('error', reject); duplicate.once('close', resolve); });
  assert.equal(duplicateExit, 1);
  assert.match(duplicateOutput, new RegExp(`cổng ${port} đang được sử dụng`));
  assert.ok(duplicateOutput.includes(`http://localhost:${port}`));
  assert.match(duplicateOutput, process.platform === 'win32' ? /\$env:PORT/ : /PORT=\d+ npm start/);
  assert.doesNotMatch(duplicateOutput, /Unhandled 'error' event|node:events|at Server\./);
  assert.equal((await fetch(base)).status, 200, 'the existing server is left running');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const health = await fetch(base + '/api/health');
  assert.deepEqual(await health.json(), { app: 'devkit', runtime: process.version, desktop: true });
  assert.equal(health.headers.get('x-devkit-instance'), '0123456789abcdef0123456789abcdef');
  for (const file of ['/styles.css', '/app.js', '/json-tools.js', '/json-ui.js', '/csv-tools.js', '/csv-ui.js', '/favicon.svg']) assert.equal((await fetch(base + file)).status, 200);
  assert.equal((await fetch(base + '/server/index.mjs')).status, 404);
  assert.equal((await fetch(base + '/.local/settings.json')).status, 404);
  const session = await fetch(base + '/api/session').then(r => r.json()); assert.match(session.token, /^[a-f0-9]{64}$/);
  const post = (route, data, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Devkit-Token': session.token, ...headers }, body: JSON.stringify(data) });
  assert.equal((await post('/api/debug', { serial: 'test', enabled: true, packageName: 'com.test.app' }, { 'X-Devkit-Token': '' })).status, 403);
  assert.equal((await post('/api/debug', {}, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await post('/api/debug', { serial: 'test;whoami', enabled: true, packageName: 'com.test.app' })).status, 400);
  assert.equal((await post('/api/debug', { serial: 'test', enabled: 'true', packageName: 'com.test.app' })).status, 400);
  assert.equal((await post('/api/debug', { serial: 'test', enabled: true, packageName: 'com.test.app;whoami' })).status, 400);
  assert.equal((await post('/api/monitor', { elevated: 'true' })).status, 400);
  assert.equal((await post('/api/settings', { sdkRoot: '', adbPath: '', firebasePath: '', appId: 'invalid' })).status, 400);
  const settings = { sdkRoot: 'C:/test SDK', adbPath: '', firebasePath: '', appId: '1:123:android:abc' };
  assert.equal((await post('/api/settings', settings)).status, 200);
  assert.deepEqual((await fetch(base + '/api/session').then(r => r.json())).settings, settings);
  assert.deepEqual(await fetch(base + '/api/jobs').then(r => r.json()), []);
  // A fake CLI exercises the complete ZIP upload path without contacting Firebase.
  const fakeCLI = path.join(temp, 'fake firebase.cjs');
  await writeFile(fakeCLI, "const assert = require('node:assert/strict');\nconst path = require('node:path');\nconst expected = path.resolve(process.env.DEVKIT_DATA_DIR, 'firebase-workspace');\nassert.equal(require('node:fs').realpathSync(process.cwd()), require('node:fs').realpathSync(expected), 'Firebase must run in writable user data, not the installation directory');\nrequire('node:child_process').execFileSync(process.execPath, ['-e', \"const fs=require('node:fs'); fs.mkdirSync('.crashlytics',{recursive:true}); fs.writeFileSync('.crashlytics/dump_syms.fixture','extracted');\"], {windowsHide:true});\nconsole.log(JSON.stringify(process.argv.slice(2)));\n");
  assert.equal((await post('/api/settings', { ...settings, firebasePath: fakeCLI })).status, 200);
  const upload = await fetch(base + '/api/symbols?appId=' + encodeURIComponent(settings.appId), {
    method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Devkit-Token': session.token },
    body: Buffer.from('504b0506000000000000000000000000000000000000', 'hex')
  });
  assert.equal(upload.status, 202);
  const accepted = await upload.json();
  assert.equal(accepted.type, 'symbols');
  let completed;
  for (let attempt = 0; attempt < 100; attempt++) {
    completed = (await fetch(base + '/api/jobs').then(r => r.json())).find(job => job.id === accepted.id);
    if (completed.status !== 'running' && completed.finishedAt) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(completed.status, 'success', completed.output);
  assert.equal(await readFile(path.join(temp, 'firebase-workspace', '.crashlytics', 'dump_syms.fixture'), 'utf8'), 'extracted', 'Buildtools child process writes cache under user data');
  const args = JSON.parse(completed.output.trim().split(/\r?\n/).at(-1));
  assert.deepEqual(args.slice(0, 2), ['crashlytics:symbols:upload', '--app=' + settings.appId]);
  assert.equal(path.dirname(args[2]), path.join(temp, 'uploads'));
  assert.equal(args[3], '--non-interactive');
  assert.equal(args[4], '--debug', 'Buildtools stderr is inherited so Java errors are visible');
  assert.match(completed.output, /\[Java\]/);
  assert.deepEqual(await readdir(path.join(temp, 'uploads')), [], 'temporary ZIP removed after CLI exits');
  // Simulate a Java failure emitted only on stderr: --debug must expose it.
  await writeFile(fakeCLI, "if(process.argv.includes('--debug'))console.error('UnsupportedClassVersionError: fixture Java is too old');else console.log('An unknown error occurred');process.exitCode=1;");
  const failedUpload = await fetch(base + '/api/symbols?appId=' + encodeURIComponent(settings.appId), {
    method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Devkit-Token': session.token },
    body: Buffer.from('504b0506000000000000000000000000000000000000', 'hex')
  });
  assert.equal(failedUpload.status, 202);
  const failedId = (await failedUpload.json()).id;
  let failed;
  for (let attempt = 0; attempt < 100; attempt++) {
    failed = (await fetch(base + '/api/jobs').then(r => r.json())).find(job => job.id === failedId);
    if (failed.finishedAt) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(failed.status, 'error');
  assert.match(failed.output, /UnsupportedClassVersionError: fixture Java is too old/);
  assert.deepEqual(await readdir(path.join(temp, 'uploads')), [], 'temporary ZIP removed after Java failure');
  const hostStatus = await new Promise((resolve, reject) => { const request = http.get(base + '/api/session', { headers: { Host: `attacker.example:${port}` } }, res => { res.resume(); resolve(res.statusCode); }); request.on('error', reject); });
  assert.equal(hostStatus, 403);
});
