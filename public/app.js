import { initJSONFormatter } from './json-ui.js';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(key, fallback = '') { try { return localStorage.getItem(`devkit.${key}`) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(`devkit.${key}`, value); } catch {} } };
const state = { token: '', settings: {}, status: null, jobs: [], view: 'overview', filter: 'all', file: null, pending: false, uploading: false, selectedJob: null, online: false, jobsLoaded: false, debugRequest: 0 };
const mobileNav = matchMedia('(max-width:760px)');
function syncSidebar() {
  const open = $('#sidebar').classList.contains('open');
  $('#sidebar').inert = mobileNav.matches && !open;
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
  $('#menu-toggle').setAttribute('aria-controls', 'sidebar');
}
mobileNav.addEventListener('change', syncSidebar);
const views = {
  overview: ['Tổng quan', 'Hôm nay, bạn cần làm gì', 'Chọn công cụ phù hợp. Hướng dẫn đã có sẵn để bạn dễ dàng làm theo.', 'grid'],
  debug: ['Firebase DebugView', 'Firebase DebugView', 'Nhập mã ứng dụng, chọn điện thoại và bật theo dõi. Bạn có thể xem sự kiện trong Firebase DebugView.', 'bug'],
  symbols: ['Crashlytics Symbols', 'Crashlytics Symbols', 'Gửi file symbols lên Firebase Crashlytics để thông tin báo lỗi hiển thị đầy đủ, dễ kiểm tra.', 'upload'],
  monitor: ['Android Monitor', 'Android Monitor', 'Mở Android Monitor đã cài trên máy để theo dõi điện thoại đang kết nối.', 'monitor'],
  json: ['JSON Formatter', 'JSON Formatter', 'Ba góc nhìn cho cùng một nội dung: JSON gốc, bản định dạng và thông tin dễ đọc.', 'code'],
  csv: ['CSV Viewer', 'CSV Viewer', 'Mở file CSV, tìm nội dung và sắp xếp dữ liệu trong một bảng rõ ràng.', 'table'],
  history: ['Lịch sử hoạt động', 'Những việc bạn đã thực hiện', 'Xem lại các thao tác và chọn một hoạt động để đọc kết quả chi tiết.', 'clock'],
  devices: ['Thiết bị kết nối', 'Điện thoại đã sẵn sàng chưa', 'Kết nối điện thoại Android bằng cáp USB. Các thiết bị được tìm thấy sẽ xuất hiện bên dưới.', 'phone'],
  settings: ['Cài đặt', 'Mọi thứ theo ý bạn', 'Các công cụ được tự động tìm trên máy. Bạn chỉ cần thay đổi cài đặt khi cần.', 'settings']
};

function toast(message, error = false) {
  const node = document.createElement('div'); node.className = `toast${error ? ' error' : ''}`;
  node.innerHTML = `${icon(error ? 'help' : 'check')}<span class="toast-message">${escape(message)}</span><button aria-label="Đóng thông báo">${icon('x')}</button>`;
  node.querySelector('button').onclick = () => node.remove(); $('#toasts').append(node);
  setTimeout(() => node.remove(), error ? 11000 : 5500);
}
async function api(route, options = {}) {
  const response = await fetch(`/api${route}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), 'X-Devkit-Token': state.token, ...options.headers } });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Chưa kết nối được ứng dụng. Hãy kiểm tra cửa sổ đang chạy devkit và tải lại trang.');
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Không thực hiện được thao tác.'); return result;
}
function setConnection(online) {
  state.online = online;
  $('#connection-text').textContent = online ? 'Đã kết nối' : 'Mất kết nối';
  $('#local-status').textContent = online ? 'Ứng dụng đã sẵn sàng' : 'Chưa kết nối được ứng dụng';
  for (const element of ['#sidebar-dot', '#connection-dot']) $(element).classList.toggle('error', !online);
}
let csvViewer;
function openCSVViewer() {
  if (csvViewer) return;
  csvViewer = import('./csv-ui.js').then(({ initCSVViewer }) => initCSVViewer({ toast, copy })).catch(() => {
    csvViewer = null;
    $('#csv-status').textContent = 'Chưa nạp được công cụ CSV. Hãy khởi động lại Node rồi tải lại trang để cập nhật các file mới.';
    $('#csv-status').className = 'json-status error';
  });
}
function navigate(view, scroll = true) {
  if (!views[view]) view = 'overview'; state.view = view;
  const [label, title, description] = views[view];
  $('#breadcrumb').textContent = label;
  const punctuation = ['overview', 'devices'].includes(view) ? '?' : ['history', 'settings'].includes(view) ? '.' : '';
  $('#page-title').innerHTML = `${escape(title)}${punctuation ? `<span class="title-dot">${punctuation}</span>` : ''}`;
  $('#page-description').textContent = description;
  document.title = `${label} — devkit`;
  $$('.nav-item').forEach(button => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#hero').hidden = view !== 'overview';
  $('#tools-section').hidden = !['overview', 'debug', 'symbols', 'monitor'].includes(view);
  $('#tools-tabs').hidden = view !== 'overview';
  $('.tools-section .section-heading').hidden = view !== 'overview';
  $('#tools-grid').classList.toggle('single-tool', view !== 'overview');
  $('#json-view').hidden = view !== 'json';
  $('#csv-view').hidden = view !== 'csv';
  if (view === 'csv') openCSVViewer();
  $('#console-panel').hidden = ['json', 'csv'].includes(view) || !state.selectedJob;
  $('#devices-view').hidden = view !== 'devices';
  $('#settings-view').hidden = view !== 'settings';
  $('#activity-layout').hidden = ['settings', 'devices', 'json', 'csv'].includes(view);
  $('#activity-layout').classList.toggle('history-mode', view === 'history');
  $('#environment-panel').hidden = view === 'history';
  $('#all-history').hidden = view === 'history';
  $('#clear-history').hidden = view !== 'history';
  $('#sidebar').classList.remove('open');
  syncSidebar();
  applyFilter(); renderJobs();
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}
function applyFilter() {
  $$('.tool-card').forEach(card => { card.hidden = state.view === 'overview' ? state.filter !== 'all' && !card.dataset.category.split(' ').includes(state.filter) : card.dataset.tool !== state.view; });
}
function fillSettings() {
  $('#sdk-root').value = state.settings.sdkRoot || '';
  $('#adb-path').value = state.settings.adbPath || '';
  $('#firebase-path').value = state.settings.firebasePath || '';
  $('#default-app-id').value = state.settings.appId || '';
  $('#app-id').value = state.settings.appId || '1:528923424982:android:46195f809d709f94';
}
async function refreshStatus(showMessage = false) {
  $('#refresh-devices').classList.add('refreshing');
  try {
    const status = await api('/status'); state.status = status; setConnection(true);
    const oldSerial = $('#device-select').value || store.get('serial');
    const connected = status.devices.filter(device => device.state === 'device');
    const select = $('#device-select');
    select.replaceChildren();
    if (!connected.length) select.add(new Option(status.tools.adb ? 'Chưa có thiết bị kết nối' : 'Chưa tìm thấy ADB', ''));
    else {
      select.add(new Option('Chọn thiết bị Android', ''));
      for (const device of connected) select.add(new Option(`${device.model} · ${device.serial}`, device.serial));
      select.value = connected.some(device => device.serial === oldSerial) ? oldSerial : connected.length === 1 ? connected[0].serial : '';
    }
    if (select.value) store.set('serial', select.value);
    for (const [name, available] of Object.entries({ adb: !!status.tools.adb && !status.adbError, firebase: !!status.tools.firebase, monitor: !!status.tools.monitor })) {
      const node = $(`#env-${name}`); node.textContent = available ? 'Đã tìm thấy' : name === 'adb' && status.adbError ? 'Không phản hồi' : 'Chưa tìm thấy';
      node.className = `env-value ${available ? 'available' : 'unavailable'}`;
      node.title = status.tools[name] || (name === 'monitor' ? 'Cần Android SDK Tools cũ có monitor.bat.' : 'Cấu hình đường dẫn trong Cài đặt.');
    }
    renderDevices(); await readDebugState();
    if (showMessage) toast(status.adbError || (connected.length ? `Đã tìm thấy ${connected.length} thiết bị sẵn sàng.` : !status.tools.adb ? 'Chưa tìm thấy công cụ kết nối điện thoại. Xem phần Cài đặt hoặc Hướng dẫn để được hỗ trợ.' : 'Đã làm mới. Chưa có thiết bị được cấp quyền kết nối.'), !!status.adbError);
  } catch (error) { setConnection(false); if (showMessage) toast(error.message, true); }
  finally { $('#refresh-devices').classList.remove('refreshing'); }
}
async function readDebugState() {
  const requestId = ++state.debugRequest, serial = $('#device-select').value;
  if (!serial) { $('#debug-state').innerHTML = '<span class="dot muted"></span><span>Chọn thiết bị để kiểm tra trạng thái</span>'; return; }
  $('#debug-state').innerHTML = '<span class="dot muted"></span><span>Đang kiểm tra chế độ theo dõi…</span>';
  try {
    const result = await api(`/debug-state?serial=${encodeURIComponent(serial)}`);
    if (requestId !== state.debugRequest) return;
    const enabled = result.packageName && result.packageName !== '.none.';
    $('#debug-state').innerHTML = `<span class="dot${enabled ? '' : ' muted'}"></span><span>${enabled ? `Đang theo dõi: ${escape(result.packageName)}` : 'Chế độ theo dõi đang tắt'}</span>`;
    $('#debug-state').title = enabled ? result.packageName : '';
  } catch (error) { if (requestId === state.debugRequest) $('#debug-state').innerHTML = `<span class="dot error"></span><span>${escape(error.message)}</span>`; }
}
function renderDevices() {
  const devices = state.status?.devices || [];
  $('#device-list').innerHTML = devices.length ? devices.map(device => `<div class="device-item"><span class="tool-icon icon-lime">${icon('phone')}</span><div><h3>${escape(device.model)}</h3><p>${escape(device.serial)}</p></div><span class="device-state ${device.state === 'device' ? '' : 'bad'}">${escape(({ device: 'Sẵn sàng', unauthorized: 'Chưa cấp quyền', offline: 'Offline' })[device.state] || device.state)}</span></div>`).join('') : `<div class="device-empty"><span class="tool-icon icon-lime">${icon('phone')}</span><h3>Chờ một kết nối mới</h3><p>${state.status?.tools.adb ? 'Cắm cáp USB, bật USB debugging và chấp nhận kết nối trên thiết bị.' : 'Chưa tìm thấy công cụ kết nối điện thoại. Mở Cài đặt để chọn công cụ Android SDK, hoặc xem Hướng dẫn để được hỗ trợ.'}</p></div>`;
}
const statusLabel = { success: 'Thành công', running: 'Đang chạy', queued: 'Đang chờ', error: 'Thất bại' };
function jobTitle(job) {
  if (job.type === 'symbols') return 'Gửi file hỗ trợ báo lỗi';
  if (job.type === 'monitor') return 'Mở công cụ theo dõi thiết bị';
  if (job.type === 'debug') return job.title.startsWith('Tắt') ? 'Tắt theo dõi sự kiện' : 'Bật theo dõi sự kiện';
  return job.title;
}
function renderJobs() {
  $('#history-count').textContent = state.jobs.length;
  const jobs = state.view === 'history' ? state.jobs : state.jobs.slice(0, 3);
  $('#empty-activity').hidden = jobs.length > 0;
  $('#activity-rows').innerHTML = jobs.map(job => `<button class="activity-row" data-job="${escape(job.id)}" title="Xem kết quả chi tiết"><span class="activity-title">${icon(({ debug: 'bug', symbols: 'upload', monitor: 'monitor' })[job.type] || 'terminal')}<span>${escape(jobTitle(job))}</span></span><span class="job-status ${escape(job.status)}">${statusLabel[job.status] || 'Không rõ'}</span><time class="job-time" datetime="${escape(job.createdAt)}" title="${escape(new Date(job.createdAt).toLocaleString('vi-VN'))}">${formatTime(job.createdAt)}</time></button>`).join('');
  $$('#activity-rows [data-job]').forEach(button => button.onclick = () => openConsole(button.dataset.job));
  if (state.selectedJob) renderConsole();
  updateBusy();
}
function formatTime(value) {
  const date = new Date(value), today = new Date();
  return date.toDateString() === today.toDateString() ? date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
async function refreshJobs() {
  try {
    const jobs = await api('/jobs');
    const old = new Map(state.jobs.map(job => [job.id, job.status]));
    if (state.jobsLoaded) for (const job of jobs) {
      if (old.get(job.id) === 'running' && job.status !== 'running') {
        toast(`${jobTitle(job)}: ${statusLabel[job.status].toLowerCase()}.${job.status === 'error' ? ' Chọn hoạt động để xem chi tiết.' : ''}`, job.status === 'error');
        if (job.type === 'debug') readDebugState();
      }
    }
    state.jobs = jobs; state.jobsLoaded = true; renderJobs();
  } catch { /* Connection is reported by the status check. */ }
}
function updateBusy() {
  const busy = state.pending || state.uploading || state.jobs.some(job => job.status === 'running');
  for (const selector of ['#debug-enable', '#debug-disable', '#upload-symbols', '#open-monitor', '#clear-history']) $(selector).disabled = busy;
  $('#dropzone').disabled = state.uploading;
  $('#app-id').disabled = state.uploading;
}
function openConsole(id, scroll = true) {
  state.selectedJob = id; $('#console-panel').hidden = false; renderConsole();
  if (scroll) $('#console-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function renderConsole() {
  const job = state.jobs.find(job => job.id === state.selectedJob); if (!job) return;
  $('#console-title').textContent = jobTitle(job);
  $('#console-status').className = `job-status ${job.status}`;
  $('#console-status').textContent = statusLabel[job.status] || '';
  $('#console-command').textContent = `$ ${job.command}`;
  const output = $('#console-output'), follow = output.scrollHeight - output.clientHeight - output.scrollTop < 45;
  output.textContent = (job.output || (job.status === 'running' ? 'Đang thực hiện. Bạn chờ một chút nhé…' : 'Không có thông tin trả về.')).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  if (follow) output.scrollTop = output.scrollHeight;
}
async function action(route, data) {
  if (!state.online) { toast('Chưa kết nối được ứng dụng. Hãy kiểm tra cửa sổ đang chạy devkit và tải lại trang.', true); return; }
  if (state.pending || state.uploading || state.jobs.some(job => job.status === 'running')) return;
  state.pending = true; updateBusy();
  try {
    const job = await api(route, { method: 'POST', body: JSON.stringify(data) });
    state.jobs.unshift(job); renderJobs(); openConsole(job.id); toast('Đã bắt đầu. Kết quả sẽ được hiển thị bên dưới.');
  } catch (error) { toast(error.message, true); }
  finally { state.pending = false; updateBusy(); }
}
function setFile(file) {
  if (!file) return;
  if (!/\.zip$/i.test(file.name)) { toast('Vui lòng chọn file symbols.zip do nhóm phát triển cung cấp.', true); return; }
  if (file.size > 1024 ** 3) { toast('File vượt quá giới hạn 1 GB.', true); return; }
  if (file.size < 4) { toast('File rỗng hoặc không hợp lệ.', true); return; }
  state.file = file; $('#dropzone').classList.add('has-file');
  $('#file-label').textContent = file.name;
  $('#file-meta').textContent = `${(file.size / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} MB · Nhấn để chọn file khác`;
  $('.dropzone-icon').innerHTML = icon('file');
}
async function uploadSymbols() {
  if (!state.file) { toast('Bạn hãy chọn file symbols.zip trước khi nhấn Gửi file.', true); $('#dropzone').focus(); return; }
  const appId = $('#app-id').value.trim();
  if (!/^1:\d+:android:[a-f\d]+$/i.test(appId)) { toast('Mã ứng dụng Firebase chưa đúng. Hãy kiểm tra lại mã hoặc dùng mã mặc định trong Cài đặt.', true); $('#app-id').focus(); return; }
  if (!state.online) { toast('Chưa kết nối được ứng dụng trên máy.', true); return; }
  if (state.pending || state.uploading || state.jobs.some(job => job.status === 'running')) return;
  state.uploading = true; updateBusy(); $('#upload-progress').hidden = false;
  $('#upload-progress-label').textContent = 'Đang chuẩn bị file trên máy…';
  $('#upload-progress-bar').value = 0;
  try {
    const job = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); xhr.open('POST', `/api/symbols?appId=${encodeURIComponent(appId)}`);
      xhr.timeout = 15 * 60 * 1000; xhr.setRequestHeader('X-Devkit-Token', state.token); xhr.setRequestHeader('Content-Type', 'application/zip');
      xhr.upload.onprogress = event => { if (event.lengthComputable) { const percent = Math.round(event.loaded / event.total * 100); $('#upload-progress-bar').value = percent; $('#upload-progress-label').textContent = percent === 100 ? 'Đang kiểm tra file và chuẩn bị gửi đến Firebase…' : `Đang chuẩn bị file trên máy… ${percent}%`; } };
      xhr.onload = () => { let result; try { result = JSON.parse(xhr.responseText); } catch { reject(new Error('Phản hồi từ backend không hợp lệ.')); return; } if (xhr.status >= 200 && xhr.status < 300) resolve(result); else reject(new Error(result.error || 'Upload không thành công.')); };
      xhr.onerror = () => reject(new Error('Mất kết nối khi chuyển file. Kiểm tra backend local rồi thử lại.'));
      xhr.ontimeout = () => reject(new Error('Chuyển file vượt quá thời gian chờ.')); xhr.send(state.file);
    });
    state.jobs.unshift(job); renderJobs(); openConsole(job.id); toast('Đang gửi file đến Firebase. Bạn có thể theo dõi kết quả bên dưới.');
  } catch (error) { toast(error.message, true); }
  finally { state.uploading = false; $('#upload-progress').hidden = true; updateBusy(); }
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Đã sao chép. Bạn có thể dán vào nơi cần dùng.'); }
  catch { toast('Chưa sao chép được. Bạn có thể bôi đen phần kết quả rồi sao chép.', true); }
}
function showHelp() { if (!$('#help-dialog').open) $('#help-dialog').showModal(); }
function renderSearch() {
  const query = $('#tool-search').value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('đ', 'd');
  const matches = Object.entries(views).filter(([key, value]) => `${key} ${value[0]} ${value[2]}`.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replaceAll('đ', 'd').includes(query));
  $('#search-results').innerHTML = matches.length ? matches.map(([key, value]) => `<button class="search-result" data-result="${key}">${icon(value[3])}<span>${escape(value[0])}</span>${icon('arrow')}</button>`).join('') : '<div class="search-no-results">Chưa tìm thấy công cụ phù hợp.</div>';
  $$('#search-results button').forEach(button => button.onclick = () => { $('#search-dialog').close(); navigate(button.dataset.result); });
}
function openSearch() { $('#search-dialog').showModal(); $('#tool-search').value = ''; renderSearch(); $('#tool-search').focus(); }

$$('[data-view]').forEach(button => button.onclick = () => navigate(button.dataset.view));
$$('[data-filter]').forEach(button => button.onclick = () => {
  state.filter = button.dataset.filter;
  $$('[data-filter]').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-selected', tab === button ? 'true' : 'false'); });
  applyFilter();
});
const dancingRoadPackage = 'com.amanotes.pamadancingroad';
const savedPackage = store.get('package');
let customPackage = savedPackage === dancingRoadPackage ? '' : savedPackage;
function selectDebugProject() {
  const isDancingRoad = $('#debug-project').value === 'dancing-road';
  $('#package-name').value = isDancingRoad ? dancingRoadPackage : customPackage;
  $('#package-name').readOnly = isDancingRoad;
  $('#package-help').textContent = isDancingRoad
    ? 'Mã ứng dụng của Dancing Road đã được điền sẵn. Chọn “Ứng dụng khác” nếu cần đổi mã.'
    : 'Nhập mã ứng dụng cần theo dõi. Bạn có thể hỏi nhóm phát triển để lấy mã.';
}
$('#debug-project').value = store.get('debugProject') === 'custom' || (savedPackage && savedPackage !== dancingRoadPackage) ? 'custom' : 'dancing-road';
selectDebugProject();
$('#debug-project').addEventListener('change', () => {
  selectDebugProject();
  store.set('debugProject', $('#debug-project').value);
  store.set('package', $('#package-name').value);
});
$('#package-name').addEventListener('input', event => {
  customPackage = event.target.value;
  store.set('package', customPackage);
});
$('#device-select').onchange = () => { store.set('serial', $('#device-select').value); readDebugState(); };
$('#debug-enable').onclick = () => {
  const packageName = $('#package-name').value.trim(), serial = $('#device-select').value;
  if (!/^(?:[A-Za-z_][\w]*\.)+[A-Za-z_][\w]*$/.test(packageName)) { toast('Mã ứng dụng chưa đúng định dạng. Ví dụ: com.company.yourgame. Bạn có thể hỏi nhóm phát triển để lấy mã.', true); $('#package-name').focus(); return; }
  if (!serial) { toast('Hãy kết nối điện thoại và chọn thiết bị trước khi bật theo dõi.', true); $('#device-select').focus(); return; }
  action('/debug', { packageName, serial, enabled: true });
};
$('#debug-disable').onclick = () => {
  const serial = $('#device-select').value;
  if (!serial) { toast('Hãy chọn điện thoại bạn muốn tắt chế độ theo dõi.', true); return; }
  action('/debug', { serial, enabled: false });
};
$('#open-monitor').onclick = () => action('/monitor', { elevated: $('#monitor-elevated').checked });
$('#upload-symbols').onclick = uploadSymbols;
$('#symbols-file').onchange = event => setFile(event.target.files[0]);
$('#dropzone').onclick = () => { $('#symbols-file').value = ''; $('#symbols-file').click(); };
for (const name of ['dragenter', 'dragover']) $('#dropzone').addEventListener(name, event => { event.preventDefault(); if (!state.uploading) $('#dropzone').classList.add('drag-over'); });
for (const name of ['dragleave', 'drop']) $('#dropzone').addEventListener(name, event => { event.preventDefault(); $('#dropzone').classList.remove('drag-over'); if (name === 'drop' && !state.uploading) { if (event.dataTransfer.files.length !== 1) toast('Mỗi lần chỉ chọn một file symbols.zip.', true); else setFile(event.dataTransfer.files[0]); } });
// Prevent a dropped ZIP from navigating the browser away from the workspace.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('#refresh-devices').onclick = () => refreshStatus(true);
$('#device-page-refresh').onclick = () => refreshStatus(true);
$('#hero-start').onclick = () => { navigate('debug'); $('#package-name').focus({ preventScroll: true }); };
$('#all-history').onclick = () => navigate('history');
$('#environment-settings').onclick = () => navigate('settings');
$('#clear-history').onclick = async () => {
  try { await api('/jobs', { method: 'DELETE' }); state.jobs = []; state.selectedJob = null; $('#console-panel').hidden = true; renderJobs(); toast('Đã xóa lịch sử hoạt động.'); }
  catch (error) { toast(error.message, true); }
};
$('#settings-form').onsubmit = async event => {
  event.preventDefault(); const button = $('#settings-form button[type="submit"]'); button.disabled = true;
  try {
    state.settings = await api('/settings', { method: 'POST', body: JSON.stringify({ sdkRoot: $('#sdk-root').value.trim(), adbPath: $('#adb-path').value.trim(), firebasePath: $('#firebase-path').value.trim(), appId: $('#default-app-id').value.trim() }) });
    fillSettings(); toast('Đã lưu cài đặt trên máy của bạn.'); await refreshStatus();
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
};
$$('[data-copy]').forEach(button => button.onclick = () => {
  const serial = $('#device-select').value, packageName = $('#package-name').value.trim() || 'PACKAGE_NAME';
  copy(button.dataset.copy === 'debug' ? `adb${serial ? ` -s ${serial}` : ''} shell setprop debug.firebase.analytics.app ${packageName}` : `firebase crashlytics:symbols:upload --app=${$('#app-id').value.trim()} "${state.file?.name || 'path symbols.zip'}"`);
});
$('#copy-log').onclick = () => copy(`${$('#console-command').textContent}\n${$('#console-output').textContent}`);
$('#close-console').onclick = () => { state.selectedJob = null; $('#console-panel').hidden = true; };
$('#help-button').onclick = showHelp; $('#monitor-help').onclick = showHelp; $('#sidebar-help').onclick = showHelp;
$('#close-help').onclick = () => $('#help-dialog').close();
$('#search-button').onclick = openSearch;
$('#close-search').onclick = () => $('#search-dialog').close();
$('#tool-search').oninput = renderSearch;
$('#tool-search').onkeydown = event => { if (event.key === 'Enter') $('#search-results button')?.click(); if (event.key === 'ArrowDown') { event.preventDefault(); $('#search-results button')?.focus(); } };
for (const dialog of $$('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
$('#menu-toggle').onclick = () => { $('#sidebar').classList.toggle('open'); syncSidebar(); };
document.addEventListener('click', event => { if (!event.target.closest('#sidebar') && !event.target.closest('#menu-toggle')) { $('#sidebar').classList.remove('open'); syncSidebar(); } });
function setTheme(dark) { document.body.classList.toggle('dark', dark); $('#theme-toggle').innerHTML = icon(dark ? 'sun' : 'moon'); $('#theme-toggle').setAttribute('aria-label', dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'); }
setTheme(store.get('theme') === 'dark');
$('#theme-toggle').onclick = () => { const dark = !document.body.classList.contains('dark'); setTheme(dark); store.set('theme', dark ? 'dark' : 'light'); };
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if ($('#search-dialog').open) $('#search-dialog').close(); else openSearch(); } if (event.key === 'Escape') { $('#sidebar').classList.remove('open'); syncSidebar(); } });
window.addEventListener('hashchange', () => navigate(location.hash.slice(1), false));
initJSONFormatter({ toast, copy });
navigate(location.hash.slice(1) || 'overview', false);
async function connect(notify = true) { try { const session = await api('/session'); state.token = session.token; state.settings = session.settings; fillSettings(); setConnection(true); await Promise.allSettled([refreshStatus(), refreshJobs()]); } catch { setConnection(false); if (notify) toast('Chưa kết nối được ứng dụng. Hãy chạy devkit trên máy và tải lại trang.', true); } }
await connect();
async function poll() { if (document.visibilityState !== 'hidden') { if (!state.online) await connect(false); else await refreshJobs(); } setTimeout(poll, state.jobs.some(job => job.status === 'running') ? 1000 : 3500); }
setTimeout(poll, 1500);
setInterval(() => { if (document.visibilityState !== 'hidden' && !state.pending && !state.uploading && !state.jobs.some(job => job.status === 'running')) refreshStatus(); }, 15000);
