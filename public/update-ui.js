// Desktop-only update UI. All network access happens in the Electron main process.
const $ = selector => document.querySelector(selector);
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const formatMB = bytes => `${(bytes / 1024 / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
const formatDate = value => value ? new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

export function initUpdates({ desktop, info, toast, store }) {
  const state = { info: null, busy: false, checking: false };
  $('#app-version').textContent = `v${info.version}`;
  $('#update-settings').hidden = false;
  $('#update-auto').checked = store.get('updateAuto', 'on') !== 'off';
  setStatus(`Phiên bản hiện tại: ${info.version}.`);

  function setStatus(text) { $('#update-status-text').textContent = text; }
  function installLabel(update) {
    if (update.installKind === 'page') return 'Tải từ GitHub';
    if (update.downloaded) return update.installKind === 'installer' ? 'Cài đặt ngay' : 'Mở file đã tải';
    return update.installKind === 'installer' ? `Tải và cài đặt (${formatMB(update.asset.size)})` : `Tải về (${formatMB(update.asset.size)})`;
  }
  function render() {
    const update = state.info, show = !!update?.available;
    $('#update-notice').hidden = !show;
    $('#app-version').classList.toggle('has-update', show);
    $('#app-version').title = show ? `Đã có bản ${update.latest}` : '';
    $('#settings-update-dot').hidden = $('#settings-update-badge').hidden = !show;
    $('#settings-update-badge').title = show ? `Đã có Devkit ${update.latest}` : '';
    $('#nav-settings').setAttribute('aria-label', show ? `Cài đặt — đã có bản cập nhật ${update.latest}` : 'Cài đặt');
    $('#update-settings-install').hidden = !show;
    $('#update-settings').classList.toggle('has-update', show);
    if (!show) return;
    $('#update-title').textContent = `Đã có Devkit ${update.latest}`;
    $('#update-summary').textContent = `Bạn đang dùng bản ${update.current}.${update.publishedAt ? ` Bản mới phát hành ngày ${formatDate(update.publishedAt)}.` : ''}${update.installKind === 'page' ? ' Chưa có file cài đặt cho máy này trong bản phát hành; hãy mở trang GitHub để tải.' : ''}`;
    $('#update-notes-details').hidden = !update.notes.trim();
    $('#update-notes').textContent = update.notes.trim();
    $('#update-install span').textContent = installLabel(update);
    $('#update-install').disabled = $('#update-settings-install').disabled = state.busy;
    $('#update-settings-install span').textContent = installLabel(update);
    $('#update-skip').hidden = state.busy;
  }

  async function check({ manual = false } = {}) {
    if (state.checking) return;
    state.checking = true; $('#update-check').disabled = true;
    if (manual) setStatus('Đang kiểm tra cập nhật…');
    try {
      const update = await desktop.checkUpdate();
      if (update.disabled) return;
      store.set('updateCheckedAt', update.checkedAt);
      const skipped = !manual && store.get('updateSkip') === update.latest;
      state.info = skipped ? { ...update, available: false } : update;
      setStatus(update.available
        ? `Phiên bản hiện tại: ${update.current}. Đã có bản ${update.latest}.`
        : `Phiên bản hiện tại: ${update.current} — đây là bản mới nhất. Kiểm tra lúc ${new Date(update.checkedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.`);
      render();
      if (manual) {
        if (update.available) { $('#update-notice').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); toast(`Đã có Devkit ${update.latest}.`); }
        else toast(`Devkit ${update.current} đã là bản mới nhất.`);
      }
    } catch (error) {
      setStatus(`Phiên bản hiện tại: ${info.version}. ${error.message}`);
      if (manual) toast(error.message, true);
    } finally { state.checking = false; $('#update-check').disabled = false; }
  }

  async function install() {
    const update = state.info; if (!update?.available || state.busy) return;
    if (update.installKind === 'page') { await desktop.openRelease(update.pageUrl).catch(error => toast(error.message, true)); return; }
    state.busy = true; render();
    try {
      if (!update.downloaded) {
        $('#update-progress').hidden = false; $('#update-progress-bar').value = 0;
        $('#update-progress-label').textContent = 'Đang tải bản cập nhật…';
        const result = await desktop.downloadUpdate();
        update.downloaded = true;
        $('#update-progress-label').textContent = result.verified ? 'Đã tải xong và kiểm tra mã SHA-256.' : 'Đã tải xong.';
      }
      if (update.installKind === 'installer') {
        if (!confirm(`Cài Devkit ${update.latest} ngay?\n\nDevkit sẽ đóng, cập nhật trong nền (khoảng 10–30 giây) rồi tự mở lại. Không cần thao tác gì thêm.`)) return;
        const result = await desktop.installUpdate();
        if (result?.action === 'cancelled') return;
        $('#update-progress').hidden = false;
        $('#update-progress-label').textContent = 'Đang cài đặt… Devkit sẽ tự mở lại khi xong.';
        toast('Đang cài bản cập nhật. Devkit sẽ tự mở lại sau ít giây.');
      } else {
        await desktop.installUpdate();
        toast(update.installKind === 'dmg'
          ? 'Đã mở file DMG. Chọn Devkit → Dừng và thoát, rồi kéo Devkit vào thư mục Applications để thay bản cũ.'
          : 'Đã mở file tải về. Thoát Devkit rồi thay Devkit.app trong Applications bằng bản mới.');
      }
    } catch (error) { toast(error.message, true); $('#update-progress-label').textContent = error.message; }
    finally { state.busy = false; render(); }
  }

  desktop.onUpdateProgress(({ received, total }) => {
    const percent = total ? Math.min(100, Math.round(received / total * 100)) : 0;
    $('#update-progress-bar').value = percent;
    $('#update-progress-label').textContent = `Đang tải bản cập nhật… ${percent}% (${formatMB(received)}${total ? ` / ${formatMB(total)}` : ''})`;
  });
  desktop.onUpdateMenu(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); check({ manual: true }); });
  $('#update-install').onclick = install;
  $('#update-settings-install').onclick = install;
  $('#update-open-page').onclick = () => state.info && desktop.openRelease(state.info.pageUrl).catch(error => toast(error.message, true));
  $('#update-skip').onclick = () => {
    if (!state.info) return;
    store.set('updateSkip', state.info.latest);
    state.info = { ...state.info, available: false }; render();
    toast(`Sẽ không nhắc lại bản ${state.info.latest}. Bạn vẫn có thể kiểm tra trong Cài đặt.`);
  };
  $('#update-check').onclick = () => check({ manual: true });
  $('#update-auto').onchange = event => store.set('updateAuto', event.target.checked ? 'on' : 'off');

  if ($('#update-auto').checked) {
    setTimeout(() => check(), 4000);
    setInterval(() => { if ($('#update-auto').checked && document.visibilityState !== 'hidden') check(); }, CHECK_INTERVAL);
  }
  return { check };
}
