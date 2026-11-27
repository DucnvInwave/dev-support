// RC Sandbox view: hosts the Dancing Road QC sandbox tool (public/rc-sandbox/, synced by
// scripts/sync-rc-sandbox.mjs) inside Devkit. Its API calls go through Devkit's server
// (/api/rc/*), which forwards them to the QC backend, so the page never leaves localhost.
// Drafts only live on the QC backend; nothing here writes to Firebase Remote Config.

const STORE_PASSWORD = 'devkit.rcPassword';
const STORE_NAME = 'devkit.rcName';

export function initRcSandbox({ toast, getToken }) {
  const view = document.querySelector('#rc-view');
  const gate = view.querySelector('#rc-gate');
  const host = view.querySelector('#rc-host');
  const status = view.querySelector('#rc-status');
  let password = '';
  let name = '';
  let loaded = false;
  let started = null;

  const read = key => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const write = (key, value) => { try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch {} };

  // The synced tool expects these globals from the QC web page's own shell.
  window.$ = id => document.getElementById(id);
  window.esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  window.setStatus = (text, error) => { status.textContent = text; status.classList.toggle('error', !!error); };
  window.App = {
    userName: () => name,
    registerTab: (tab, entry) => { started = entry; },
    async api(method, route, payload) {
      const response = await fetch(`/api/rc${route}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Devkit-Token': getToken(),
          'x-admin-key': password,
          'x-qc-name': encodeURIComponent(name),
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { signOut('Mật khẩu sai hoặc đã đổi. Nhập lại.'); throw new Error('Sai mật khẩu'); }
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      return data;
    },
  };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Không nạp được ${src}`));
      document.body.append(script);
    });
  }

  async function loadTool() {
    if (loaded) return;
    const html = await fetch('/rc-sandbox/markup.html').then(r => { if (!r.ok) throw new Error('Không nạp được giao diện RC Sandbox.'); return r.text(); });
    host.innerHTML = html;
    await loadScript('/rc-sandbox/qrcode.js');
    await loadScript('/rc-sandbox/sandbox.js');
    loaded = true;
  }

  function showGate(message = '') {
    gate.hidden = false;
    host.hidden = true;
    view.querySelector('#rc-signout').hidden = true;
    view.querySelector('#rc-gate-error').textContent = message;
    view.querySelector('#rc-name').value = read(STORE_NAME);
  }

  async function enter(nextPassword, nextName, remember) {
    password = nextPassword;
    name = nextName;
    const button = view.querySelector('#rc-enter');
    button.disabled = true;
    try {
      await window.App.api('GET', '/me');
      await loadTool();
    } catch (error) {
      button.disabled = false;
      if (!gate.hidden) view.querySelector('#rc-gate-error').textContent = error.message;
      return;
    }
    button.disabled = false;
    write(STORE_NAME, name);
    write(STORE_PASSWORD, remember ? password : '');
    gate.hidden = true;
    host.hidden = false;
    view.querySelector('#rc-signout').hidden = false;
    view.querySelector('#rc-user').textContent = name;
    if (started) { const entry = started; started = null; entry.start(); }
  }

  function signOut(message) {
    write(STORE_PASSWORD, '');
    password = '';
    showGate(message);
  }

  function submit() {
    const nextName = view.querySelector('#rc-name').value.trim();
    const nextPassword = view.querySelector('#rc-password').value;
    if (!nextName) { view.querySelector('#rc-gate-error').textContent = 'Nhập tên để mọi người biết ai sửa bản nháp.'; return; }
    if (!nextPassword) { view.querySelector('#rc-gate-error').textContent = 'Nhập mật khẩu QC.'; return; }
    enter(nextPassword, nextName, view.querySelector('#rc-remember').checked);
  }

  view.querySelector('#rc-enter').addEventListener('click', submit);
  view.querySelector('#rc-password').addEventListener('keydown', event => { if (event.key === 'Enter') submit(); });
  view.querySelector('#rc-name').addEventListener('keydown', event => { if (event.key === 'Enter') view.querySelector('#rc-password').focus(); });
  view.querySelector('#rc-signout').addEventListener('click', () => { signOut(); toast('Đã thoát RC Sandbox.'); });

  const saved = read(STORE_PASSWORD);
  const savedName = read(STORE_NAME);
  if (saved && savedName) enter(saved, savedName, true); else showGate();
}
