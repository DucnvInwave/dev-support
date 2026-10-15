const { pathToFileURL } = require('node:url');
const path = require('node:path');
const parentPID = Number(process.env.DEVKIT_ELECTRON_PARENT_PID);
let modulePromise, stopping = false;
const send = message => process.parentPort.postMessage(message);
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(watchdog);
  try { await (await modulePromise).stopServer(); } catch (error) { send({ type: 'error', message: error.message }); }
  send({ type: 'stopped' }); process.exit(0);
}
const watchdog = setInterval(() => {
  if (!Number.isInteger(parentPID) || parentPID < 2) return void stop();
  try { process.kill(parentPID, 0); } catch (error) { if (error.code === 'ESRCH') void stop(); }
}, 1000);
process.parentPort.on('message', event => { if (event.data?.type === 'stop') void stop(); });
modulePromise = import(pathToFileURL(path.join(__dirname, '../server/index.mjs')).href);
modulePromise.then(server => server.ready).then(address => {
  if (!stopping) send({ type: 'ready', ...address });
}).catch(error => { send({ type: 'error', message: error.message }); process.exit(1); });
