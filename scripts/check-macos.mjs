import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
if (process.platform !== 'darwin') throw new Error('Run the macOS bundle check on macOS.');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const temp = await mkdtemp(path.join(tmpdir(), 'devkit mac app check '));
const extracted = path.join(temp, 'extracted'); await mkdir(extracted);
const zip = path.join(root, 'dist', 'Devkit-' + pkg.version + '-macos-' + process.arch + '.zip');
await exec('/usr/bin/ditto', ['-x', '-k', zip, extracted]);
const app = path.join(extracted, 'Devkit.app');
const home = path.join(temp, 'Application Support', 'Devkit');
const data = path.join(home, 'data'); await mkdir(data, { recursive: true });
const settings = JSON.stringify({ sdkRoot: '', adbPath: '', firebasePath: '', appId: '1:123:android:abc' });
const history = '[]';
await writeFile(path.join(data, 'settings.json'), settings); await writeFile(path.join(data, 'history.json'), history);
const env = { ...process.env, DEVKIT_DESKTOP_HOME: home, DEVKIT_DATA_DIR: data, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
for (let run = 0; run < 2; run++) {
  const result = await exec(path.join(app, 'Contents/MacOS/Devkit'), ['--smoke-test'], { env, timeout: 60000, maxBuffer: 1024 * 1024 });
  console.log(result.stdout.trim());
  const [address] = (await readFile(path.join(home, 'desktop-port.txt'), 'utf8')).split('\n');
  let connected = false;
  try { connected = (await fetch(address.replace('localhost', '127.0.0.1') + '/api/health', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
  assert.equal(connected, false, 'backend must stop after launcher exits');
}
assert.equal(await readFile(path.join(data, 'settings.json'), 'utf8'), settings);
assert.equal(await readFile(path.join(data, 'history.json'), 'utf8'), history);
assert.deepEqual(await readdir(path.join(data, 'uploads')), []);
console.log('PASS: extracted app, initial launch/relaunch, backend cleanup and data preservation');
