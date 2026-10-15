import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const childScript = 'process.on("SIGTERM",()=>{});console.log("CHILD_READY");setInterval(()=>{},1000)';
const serverScript = [
  'import {spawn} from "node:child_process";',
  'import {writeFileSync} from "node:fs";',
  'const child=spawn(process.execPath,["-e",' + JSON.stringify(childScript) + '],{stdio:["ignore","pipe","ignore"]});',
  'child.stdout.once("data",()=>{writeFileSync(process.env.RECORD,JSON.stringify({backend:process.pid,descendant:child.pid}));console.log("READY")});',
  'setInterval(()=>{},1000);'
].join('\n');
for (const orphan of [false, true]) {
  test(orphan ? 'macOS watchdog cleans up backend and descendants when launcher disappears' : 'macOS shutdown kills descendants even after backend exits', { skip: process.platform !== 'darwin', timeout: 15000 }, async t => {
    const temp = await mkdtemp(path.join(tmpdir(), 'devkit process group '));
    await mkdir(path.join(temp, 'server'));
    await writeFile(path.join(temp, 'desktop.mjs'), await readFile(new URL('../scripts/macos/desktop.mjs', import.meta.url)));
    await writeFile(path.join(temp, 'server/index.mjs'), serverScript);
    const record = path.join(temp, 'record.json');
    const worker = spawn(process.execPath, [path.join(temp, 'desktop.mjs')], {
      env: { ...process.env, RECORD: record, DEVKIT_DESKTOP_PARENT_PID: orphan ? '2147483646' : String(process.pid) }, stdio: ['ignore', 'pipe', 'pipe']
    });
    let pids;
    t.after(async () => {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      if (pids) { try { process.kill(-pids.backend, 'SIGKILL'); } catch {} }
      await rm(temp, { recursive: true, force: true });
    });
    const closed = new Promise((resolve, reject) => { worker.once('error', reject); worker.once('close', resolve); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 5000);
      worker.stdout.on('data', chunk => { if (String(chunk).includes('READY')) { clearTimeout(timer); resolve(); } });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
    });
    pids = JSON.parse(await readFile(record, 'utf8'));
    if (!orphan) worker.kill('SIGTERM');
    assert.equal(await closed, 0);
    let alive = true;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { process.kill(pids.descendant, 0); } catch (error) { if (error.code === 'ESRCH') { alive = false; break; } throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(alive, false, 'SIGTERM-resistant descendant must be stopped');
    assert.throws(() => process.kill(pids.backend, 0), { code: 'ESRCH' });
  });
}
