// Keep all backend/CLI processes in one owned Unix process group.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.platform !== 'darwin') throw new Error('The macOS desktop runtime requires macOS.');
const parent = Number(process.env.DEVKIT_DESKTOP_PARENT_PID);
if (!Number.isInteger(parent) || parent < 2) throw new Error('Missing desktop launcher PID.');
const child = spawn(process.execPath, [fileURLToPath(new URL('./server/index.mjs', import.meta.url))], {
  env: process.env, stdio: 'inherit', detached: true
});
let stopping = false;
function signalGroup(signal) {
  if (child.pid) { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') console.error(error.message); } }
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true; clearInterval(watchdog);
  signalGroup('SIGTERM');
  // Kill descendants even if the backend itself has already exited.
  setTimeout(() => { signalGroup('SIGKILL'); process.exit(code); }, 1500);
}
const watchdog = setInterval(() => {
  try { process.kill(parent, 0); } catch (error) { if (error.code === 'ESRCH') stop(); }
}, 1000);
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop());
child.on('error', error => { console.error(error.message); stop(1); });
child.on('exit', code => stop(code ?? 1));
