const net = require('node:net');
const path = require('node:path');
function desktopPaths({ env = process.env, platform = process.platform, userData }) {
  const home = path.resolve(env.DEVKIT_DESKTOP_HOME || (platform === 'win32' && env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Devkit') : userData));
  return { home, data: path.resolve(env.DEVKIT_DATA_DIR || path.join(home, 'data')), profile: path.resolve(env.DEVKIT_ELECTRON_PROFILE || userData) };
}
async function selectPort(preferred = 3210) {
  const candidates = [...new Set([preferred, ...Array.from({ length: 50 }, (_, index) => 3210 + index), 0])];
  for (const port of candidates) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) continue;
    const probe = net.createServer();
    const available = await new Promise(resolve => {
      probe.once('error', () => resolve(null));
      probe.listen(port, '127.0.0.1', () => { const selected = probe.address().port; probe.close(() => resolve(selected)); });
    });
    if (available !== null) return available;
  }
  throw new Error('Không tìm được cổng cho Devkit.');
}
function isAppURL(value, origin) { try { return new URL(value).origin === origin; } catch { return false; } }
function isExternalURL(value) {
  try { const url = new URL(value); return !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))); } catch { return false; }
}
module.exports = { desktopPaths, selectPort, isAppURL, isExternalURL };
