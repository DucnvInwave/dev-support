import { parseJSONDocument, formatJSONDocument, tokenizeJSON } from './json-tools.js';
import { parseTOML, tokenizeTOML } from './toml-tools.js';
import { createCodeEditor } from './code-editor.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const formatSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} KB` : `${(bytes / 1024 ** 2).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} MB`;
const MAX_MATCHES = 10000;

export function validateConfigText(format, text) {
  try {
    if (format === 'json') {
      const { node, stats } = parseJSONDocument(text);
      const warnings = [];
      if (stats.duplicates) warnings.push(`Có ${stats.duplicates} khóa bị trùng; chỉ giá trị cuối cùng được dùng.`);
      if (node.type !== 'object') warnings.push('Nội dung gốc nên là một object { ... }.');
      return { ok: true, node, warnings, summary: `${stats.values.toLocaleString('vi-VN')} giá trị` };
    }
    const { stats } = parseTOML(text);
    return { ok: true, warnings: [], summary: `${stats.keys} khóa · ${stats.tables} bảng` };
  } catch (error) {
    return { ok: false, error: { message: error.message, line: error.line, column: error.column } };
  }
}

// Returns [start, end] ranges of every occurrence; positions index the original text.
export function findMatches(text, query, caseSensitive = false, limit = MAX_MATCHES) {
  if (!query) return [];
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? 'gu' : 'giu'), ranges = [];
  for (const match of text.matchAll(pattern)) { ranges.push([match.index, match.index + match[0].length]); if (ranges.length >= limit) break; }
  return ranges;
}

export function initConfigEditor({ api, toast, copy, ensureLocalSession, webMode }) {
  const editor = $('#config-editor'), status = $('#config-status');
  const searchInput = $('#config-search-input'), replaceInput = $('#config-replace-input');
  const state = { files: [], file: null, original: '', mtimeMs: null, check: null, saving: false, loaded: false };
  const search = { ranges: [], active: -1 };
  const code = createCodeEditor(editor, {
    marks: () => search.ranges.length ? search : null,
    errorLine: () => state.check && !state.check.ok ? state.check.error.line || 0 : 0
  });
  let validateTimer, searchTimer;
  const dirty = () => !!state.file && editor.value !== state.original;

  function renderFiles() {
    const groups = [...new Set(state.files.map(file => file.group))];
    $('#config-files').innerHTML = groups.map(group => `<div class="config-group"><p class="config-group-label">${escape(group)}</p>${state.files.filter(file => file.group === group).map(file => `<button class="config-file${state.file?.id === file.id ? ' active' : ''}" data-config="${escape(file.id)}" title="${escape(file.path)}"${state.file?.id === file.id ? ' aria-current="true"' : ''}><span class="config-file-name">${escape(file.name)}<span class="config-format">${file.format.toUpperCase()}</span></span><span class="config-file-meta ${file.exists ? '' : 'missing'}">${file.exists ? formatSize(file.size) : 'Chưa có file · sẽ tạo mới khi lưu'}</span></button>`).join('')}</div>`).join('');
    for (const button of $('#config-files').querySelectorAll('[data-config]')) button.onclick = () => open(button.dataset.config);
  }
  function setStatus(text, kind = '') { status.textContent = text; status.className = `json-status${kind ? ` ${kind}` : ''}`; }
  function updateControls() {
    const loaded = !!state.file && !state.saving;
    $('#config-dirty').hidden = !dirty();
    $('#config-save').disabled = !loaded || !dirty() || !state.check?.ok;
    $('#config-revert').disabled = !loaded || !dirty();
    $('#config-format-button').disabled = !loaded || state.file.format !== 'json' || !state.check?.ok;
    $('#config-format-button').hidden = state.file?.format === 'toml';
    $('#config-backup').disabled = !loaded;
    $('#config-expand').disabled = !state.file;
    $('#config-goto-error').hidden = !state.check || state.check.ok || !state.check.error.line;
    $('#config-editor-wrap').classList.toggle('invalid', !!state.check && !state.check.ok);
    for (const selector of ['#config-search-input', '#config-replace-toggle']) $(selector).disabled = !state.file;
    $('#config-search-prev').disabled = $('#config-search-next').disabled = !search.ranges.length;
    $('#config-replace-one').disabled = search.active < 0;
    $('#config-replace-all').disabled = !search.ranges.length;
  }
  function validate() {
    clearTimeout(validateTimer);
    if (!state.file) return;
    const format = state.file.format.toUpperCase();
    if (!editor.value.trim() && state.file.format === 'json') state.check = { ok: false, error: { message: 'File JSON không được để trống. Tối thiểu cần {}.' } };
    else state.check = validateConfigText(state.file.format, editor.value);
    const check = state.check;
    if (!check.ok) setStatus(`⚠ Sai định dạng ${format}${check.error.line ? ` tại dòng ${check.error.line}, cột ${check.error.column}` : ''}: ${check.error.message} Không thể lưu cho đến khi sửa lỗi.`, 'error');
    else if (check.warnings.length) setStatus(`${format} hợp lệ, nhưng cần chú ý: ${check.warnings.join(' ')}`, 'warning');
    else setStatus(`✓ ${format} hợp lệ · ${check.summary}${dirty() ? ' · Có thay đổi chưa lưu' : ''}`, 'success');
    updateControls(); code.refresh();
  }
  function setExpanded(expanded) {
    const panel = $('.config-editor-panel'), button = $('#config-expand');
    if (expanded === panel.classList.contains('expanded')) return;
    panel.classList.toggle('expanded', expanded);
    document.body.classList.toggle('config-expanded', expanded);
    button.setAttribute('aria-pressed', String(expanded));
    button.title = expanded ? 'Thu nhỏ khung soạn thảo (Esc)' : 'Phóng to khung soạn thảo (Ctrl+Shift+E)';
    button.innerHTML = `<svg aria-hidden="true"><use href="#i-${expanded ? 'restore' : 'expand'}"/></svg><span>${expanded ? 'Thu nhỏ' : 'Phóng to'}</span>`;
    code.refresh();
    if (state.file) editor.focus({ preventScroll: true });
  }
  const isExpanded = () => $('.config-editor-panel').classList.contains('expanded');
  function confirmDiscard() { return !dirty() || confirm(`File ${state.file.name} có thay đổi chưa lưu. Bỏ các thay đổi này?`); }
  // Replace the whole document through the editing pipeline so Ctrl+Z still works.
  function replaceDocument(text) {
    editor.focus(); editor.select();
    if (!document.execCommand('insertText', false, text) || editor.value !== text) { editor.value = text; editor.dispatchEvent(new Event('input')); }
  }

  // ---- Search & replace ----
  function lineOf(position) {
    const lines = code.lineStarts(); let low = 0, high = lines.length - 1;
    while (low < high) { const middle = (low + high + 1) >> 1; if (lines[middle] <= position) low = middle; else high = middle - 1; }
    return low;
  }
  let measure;
  function charWidth() {
    measure ??= document.createElement('canvas').getContext('2d');
    const style = getComputedStyle(editor); measure.font = `${style.fontSize} ${style.fontFamily}`;
    return measure.measureText('0').width || 9;
  }
  function revealRange([start, end]) {
    const style = getComputedStyle(editor), lineHeight = parseFloat(style.lineHeight) || 24;
    const line = lineOf(start), top = line * lineHeight;
    if (top < editor.scrollTop || top + lineHeight > editor.scrollTop + editor.clientHeight - lineHeight) editor.scrollTop = Math.max(0, top - editor.clientHeight / 2);
    const column = start - code.lineStarts()[line], left = column * charWidth(), width = (end - start) * charWidth();
    if (left < editor.scrollLeft || left + width > editor.scrollLeft + editor.clientWidth - 60) editor.scrollLeft = Math.max(0, left - editor.clientWidth / 3);
    editor.setSelectionRange(start, end);
  }
  function renderCount() {
    const node = $('#config-search-count'), total = search.ranges.length;
    node.classList.toggle('empty', !!searchInput.value && !total);
    node.textContent = !searchInput.value ? '' : !total ? 'Không tìm thấy' : `${search.active + 1}/${total >= MAX_MATCHES ? `${MAX_MATCHES}+` : total}`;
  }
  function runSearch({ reveal = false, from = editor.selectionStart } = {}) {
    clearTimeout(searchTimer);
    search.ranges = state.file ? findMatches(editor.value, searchInput.value, $('#config-search-case').checked) : [];
    const next = search.ranges.findIndex(([start]) => start >= from);
    search.active = search.ranges.length ? (next >= 0 ? next : 0) : -1;
    renderCount(); updateControls(); code.refresh();
    if (reveal && search.active >= 0) revealRange(search.ranges[search.active]);
  }
  function step(direction) {
    if (!search.ranges.length) return;
    search.active = (search.active + direction + search.ranges.length) % search.ranges.length;
    revealRange(search.ranges[search.active]); renderCount(); code.refresh();
  }
  function openSearch(withReplace = false) {
    if (!state.file) return;
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    if (document.activeElement === editor && selected && !selected.includes('\n') && selected.length < 200) searchInput.value = selected;
    if (withReplace) toggleReplace(true);
    searchInput.focus(); searchInput.select();
    runSearch({ reveal: true, from: editor.selectionStart });
  }
  function toggleReplace(force) {
    const show = force ?? $('#config-replace').hidden;
    $('#config-replace').hidden = !show;
    $('#config-replace-toggle').setAttribute('aria-expanded', String(show));
    $('#config-replace-toggle').textContent = show ? 'Ẩn thay thế' : 'Thay thế';
    if (show) replaceInput.focus();
  }
  function replaceOne() {
    const range = search.ranges[search.active]; if (!range) return;
    editor.focus(); editor.setSelectionRange(...range);
    if (!document.execCommand('insertText', false, replaceInput.value)) {
      editor.setRangeText(replaceInput.value, range[0], range[1], 'end'); editor.dispatchEvent(new Event('input'));
    }
    runSearch({ reveal: true, from: range[0] + replaceInput.value.length });
    replaceInput.focus();
  }
  function replaceAll() {
    const count = search.ranges.length; if (!count) return;
    let text = '', cursor = 0;
    for (const [start, end] of search.ranges) { text += editor.value.slice(cursor, start) + replaceInput.value; cursor = end; }
    replaceDocument(text + editor.value.slice(cursor));
    runSearch();
    toast(`Đã thay ${count.toLocaleString('vi-VN')} kết quả. Bấm Ctrl+Z trong ô soạn thảo để hoàn tác.`);
  }

  async function loadList() {
    if (webMode) return;
    try {
      await ensureLocalSession();
      const result = await api('/config-files');
      state.files = result.files;
      $('#config-home').textContent = `Thư mục người dùng trên máy này: ${result.home}`;
      renderFiles();
      if (!state.file && state.files.length) await open(state.files[0].id, false);
    } catch (error) { $('#config-files').innerHTML = `<p class="json-empty">${escape(error.message)}</p>`; }
  }
  async function open(id, ask = true) {
    if (ask && state.file?.id !== id && !confirmDiscard()) return;
    try {
      const file = await api(`/config-file?id=${encodeURIComponent(id)}`);
      state.file = file; state.original = file.content; state.mtimeMs = file.mtimeMs;
      state.files = state.files.map(item => item.id === id ? { ...item, ...file, content: undefined } : item);
      editor.disabled = false; editor.value = file.content; editor.scrollTop = 0; editor.scrollLeft = 0; editor.setSelectionRange(0, 0);
      code.setTokenizer(file.format === 'toml' ? tokenizeTOML : tokenizeJSON);
      $('#config-file-name').textContent = file.name;
      $('#config-format').hidden = false; $('#config-format').textContent = file.format.toUpperCase();
      $('#config-path').textContent = file.path; $('#config-copy-path').disabled = false;
      $('#config-description').textContent = file.description;
      $('#config-sensitive').hidden = !file.sensitive;
      renderFiles(); validate(); runSearch();
      if (!file.exists) setStatus(`Chưa có file tại ${file.path}. Nhập nội dung và bấm Lưu để tạo mới.`, 'warning');
    } catch (error) { toast(error.message, true); }
  }
  async function save(force = false) {
    if (!state.file || state.saving) return;
    validate();
    if (!state.check.ok) { toast('File đang sai định dạng nên chưa được lưu. Hãy sửa lỗi được báo phía trên.', true); goToError(); return; }
    if (!dirty() && !force) return;
    state.saving = true; updateControls();
    try {
      await ensureLocalSession();
      const result = await api('/config-file', { method: 'POST', body: JSON.stringify({ id: state.file.id, content: editor.value, expectedMtimeMs: state.mtimeMs, force }) });
      state.original = editor.value; state.mtimeMs = result.mtimeMs;
      state.file = { ...state.file, ...result };
      state.files = state.files.map(item => item.id === result.id ? { ...item, ...result } : item);
      renderFiles();
      toast(`Đã lưu ${result.name}.${result.backup ? ' Bản cũ đã được sao lưu.' : ''} Khởi động lại ${result.group === 'Claude' ? 'Claude Code' : 'Codex'} để áp dụng.`);
    } catch (error) {
      if (error.data?.conflict) {
        if (confirm(`${error.message}\n\nOK: ghi đè bằng nội dung bạn đang sửa.\nCancel: giữ nguyên, bạn có thể bấm "Tải lại danh sách" hoặc mở lại file để xem bản mới.`)) { state.saving = false; return save(true); }
      } else toast(error.message, true);
    } finally { state.saving = false; validate(); }
  }
  function goToError() {
    const error = state.check?.error; if (!error?.line) return;
    const index = Math.min(editor.value.length, (code.lineStarts()[error.line - 1] ?? 0) + Math.max(0, error.column - 1));
    editor.focus();
    revealRange([index, Math.min(index + 1, editor.value.length)]);
  }

  editor.addEventListener('input', () => {
    updateControls();
    clearTimeout(validateTimer); validateTimer = setTimeout(validate, editor.value.length > 500000 ? 600 : 200);
    if (searchInput.value) { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(), 150); }
  });
  editor.addEventListener('keydown', event => {
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && key === 's') { event.preventDefault(); save(); }
    if (mod && key === 'f') { event.preventDefault(); openSearch(); }
    if (mod && key === 'h') { event.preventDefault(); openSearch(true); }
    if (event.key === 'F3') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape' && isExpanded()) { event.preventDefault(); setExpanded(false); }
    if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); document.execCommand('insertText', false, '  '); }
  });
  document.addEventListener('keydown', event => {
    if ($('#config-view').hidden) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'e') { event.preventDefault(); if (state.file) setExpanded(!isExpanded()); return; }
    // Esc in the search/replace boxes first returns to the editor; a second Esc collapses.
    if (event.key === 'Escape' && isExpanded() && event.target !== editor && event.target !== searchInput && event.target !== replaceInput && !document.querySelector('dialog[open]')) { setExpanded(false); return; }
    if (!(event.ctrlKey || event.metaKey) || event.target === editor) return;
    if (key === 'f' || key === 'h') { event.preventDefault(); openSearch(key === 'h'); }
    if (key === 's' && dirty()) { event.preventDefault(); save(); }
  });
  searchInput.addEventListener('input', () => runSearch({ reveal: true, from: search.ranges[search.active]?.[0] ?? editor.selectionStart }));
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    if (event.key === 'F3') { event.preventDefault(); step(event.shiftKey ? -1 : 1); }
    if (event.key === 'Escape') { event.preventDefault(); const range = search.ranges[search.active]; editor.focus(); if (range) editor.setSelectionRange(...range); }
  });
  replaceInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); if (event.ctrlKey || event.metaKey) replaceAll(); else replaceOne(); }
    if (event.key === 'Escape') { event.preventDefault(); toggleReplace(false); searchInput.focus(); }
  });
  $('#config-search-case').onchange = () => runSearch({ reveal: true });
  $('#config-search-next').onclick = () => step(1);
  $('#config-search-prev').onclick = () => step(-1);
  $('#config-replace-toggle').onclick = () => toggleReplace();
  $('#config-replace-one').onclick = replaceOne;
  $('#config-replace-all').onclick = replaceAll;

  $('#config-save').onclick = () => save();
  $('#config-revert').onclick = () => { if (confirm('Hoàn tác mọi thay đổi chưa lưu?')) replaceDocument(state.original); };
  $('#config-format-button').onclick = () => {
    const check = validateConfigText('json', editor.value); if (!check.ok) return;
    replaceDocument(formatJSONDocument(check.node, { indent: '  ' }) + (state.original.endsWith('\n') ? '\n' : ''));
  };
  $('#config-goto-error').onclick = goToError;
  $('#config-expand').onclick = () => setExpanded(!isExpanded());
  $('#config-copy-path').onclick = () => copy($('#config-path').textContent);
  $('#config-refresh').onclick = async () => { if (!confirmDiscard()) return; const id = state.file?.id; state.file = null; await loadList(); if (id) await open(id, false); };
  $('#config-backup').onclick = async () => {
    try {
      const backup = await api(`/config-backup?id=${encodeURIComponent(state.file.id)}`);
      if (!confirm(`Nạp bản sao lưu "${backup.name}" vào trình soạn thảo? Nội dung hiện tại trong ô soạn thảo sẽ bị thay thế (file chỉ thay đổi khi bạn bấm Lưu).`)) return;
      replaceDocument(backup.content);
    } catch (error) { toast(error.message, true); }
  };
  window.addEventListener('beforeunload', event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } });

  return {
    show() { if (!state.loaded) { state.loaded = true; loadList(); } code.refresh(); },
    confirmLeave: () => { const ok = confirmDiscard(); if (ok) setExpanded(false); return ok; }
  };
}
