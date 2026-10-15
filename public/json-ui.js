import { parseJSONDocument, formatJSONDocument, MAX_JSON_BYTES, tokenizeJSON, findJSONBracketPair, highlightJSONRange } from './json-tools.js';

export function initJSONFormatter({ toast, copy }) {
  const $ = selector => document.querySelector(selector);
  const input = $('#json-input'), output = $('#json-output'), tree = $('#json-tree');
  const inputEditor = createJSONCodeEditor(input), outputEditor = createJSONCodeEditor(output);
  let timer, revision = 0, filename = 'formatted.json', formattedResult = ''; 
  const expandDialog = $('#json-expand-dialog');
  let expanded = null;
  function rememberScroll(column) {
    return [...column.querySelectorAll('.json-editor, .json-tree')].map(node => ({ node, top: node.scrollTop, left: node.scrollLeft }));
  }
  function restoreScroll(positions) {
    for (const { node, top, left } of positions) { node.scrollTop = top; node.scrollLeft = left; }
  }
  function syncExpandedStatus() {
    const status = $('#json-status'), mirror = $('#json-expand-status');
    mirror.textContent = status.textContent;
    mirror.className = status.className;
  }
  for (const button of document.querySelectorAll('[data-json-expand]')) {
    const column = button.closest('.json-column');
    const title = column.querySelector('h2');
    button.addEventListener('click', () => {
      if (expandDialog.open) { expandDialog.close(); return; }
      const marker = document.createComment('JSON column position');
      column.before(marker);
      expanded = { column, button, marker, positions: rememberScroll(column) };
      expandDialog.setAttribute('aria-labelledby', title.id);
      expandDialog.querySelector('.json-expand-content').append(column);
      button.setAttribute('aria-expanded', 'true');
      button.setAttribute('aria-label', 'Thu nhỏ ' + title.textContent);
      button.title = 'Thu nhỏ ' + title.textContent;
      button.querySelector('span').textContent = 'Thu nhỏ';
      button.querySelector('use').setAttribute('href', '#i-restore');
      syncExpandedStatus();
      document.body.classList.add('json-expanded');
      expandDialog.showModal();
      button.focus({ preventScroll: true });
      restoreScroll(expanded.positions);
    });
  }
  expandDialog.addEventListener('close', () => {
    if (!expanded) return;
    const { column, button, marker } = expanded;
    const positions = rememberScroll(column);
    marker.replaceWith(column);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', 'Phóng to ' + column.querySelector('h2').textContent);
    button.title = button.getAttribute('aria-label');
    button.querySelector('span').textContent = 'Phóng to';
    button.querySelector('use').setAttribute('href', '#i-expand');
    document.body.classList.remove('json-expanded');
    button.focus({ preventScroll: true });
    restoreScroll(positions);
    expanded = null;
  });
  window.addEventListener('hashchange', () => { if (expandDialog.open) expandDialog.close(); });
  const types = { object: 'Nhóm', array: 'Danh sách', string: 'Văn bản', number: 'Số', boolean: 'Có / Không', null: 'Trống' };
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setStatus(message, kind = '') {
    $('#json-status').textContent = message; $('#json-status').className = 'json-status' + (kind ? ' ' + kind : '');
    input.setAttribute('aria-invalid', String(kind === 'error'));
    if (expandDialog.open) syncExpandedStatus();
  }
  function resetResult(message = 'Thông tin sẽ được chia thành từng nhóm để bạn dễ theo dõi.') {
    formattedResult = ''; output.value = ''; outputEditor.refresh(); $('#json-output-meta').textContent = 'Chờ nội dung';
    tree.replaceChildren(element('p', 'json-empty', message));
    $('#json-summary').hidden = true;
    for (const id of ['json-copy', 'json-download', 'json-collapse']) $('#' + id).disabled = true;
  }
  function byteSize(text) { return new Blob([text]).size; }
  function sizeLabel(bytes) { return bytes < 1024 ? bytes + ' B' : (bytes / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' KB'; }
  function renderNode(node, label, isRoot = false) {
    const container = node.type === 'array' || node.type === 'object';
    const wrapper = element(container ? 'details' : 'div', 'json-node' + (container ? ' json-group' : ' json-leaf'));
    const heading = container ? element('summary', 'json-node-heading') : wrapper;
    heading.append(element('span', 'json-key', label), element('span', 'json-type json-type-' + node.type, types[node.type]));
    if (container) {
      const count = node.children.length;
      heading.append(element('span', 'json-node-count', count.toLocaleString('vi-VN') + (node.type === 'array' ? ' phần tử' : ' trường')));
      wrapper.append(heading);
      const body = element('div', 'json-children'); wrapper.append(body);
      let shown = 0, loaded = false;
      const children = node.type === 'object' && $('#json-sort').checked ? [...node.children].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : node.children;
      function loadBatch() {
        body.querySelector(':scope > .json-more')?.remove();
        const limit = Math.min(shown + 50, count);
        for (; shown < limit; shown++) {
          const child = children[shown];
          body.append(renderNode(node.type === 'object' ? child.node : child, node.type === 'object' ? child.key : 'Phần tử ' + (shown + 1)));
        }
        if (!count) body.append(element('p', 'json-empty', 'Nhóm này chưa có dữ liệu.'));
        if (shown < count) {
          const more = element('button', 'text-button json-more', 'Xem thêm (' + (count - shown).toLocaleString('vi-VN') + ' còn lại)');
          more.onclick = loadBatch; body.append(more);
        }
        loaded = true;
      }
      wrapper.addEventListener('toggle', () => { if (wrapper.open && !loaded) loadBatch(); });
      if (isRoot) { wrapper.open = true; loadBatch(); }
    } else {
      const text = node.type === 'boolean' ? (node.value ? 'Có (true)' : 'Không (false)') : node.type === 'null' ? 'Không có giá trị (null)' : node.type === 'string' && node.value === '' ? '(Văn bản rỗng)' : String(node.value);
      const value = element('span', 'json-value', text.length > 2000 ? text.slice(0, 2000) + '…' : text);
      wrapper.append(value);
      if (text.length > 2000) wrapper.append(element('small', 'json-truncated', 'Đang xem 2.000 ký tự đầu. Nội dung đầy đủ nằm ở cột đã định dạng.'));
    }
    return wrapper;
  }
  function format() {
    clearTimeout(timer);
    inputEditor.refresh();
    const source = input.value, bytes = byteSize(source);
    $('#json-input-meta').textContent = source ? sizeLabel(bytes) : 'Chưa có dữ liệu';
    resetResult();
    if (!source.trim()) { setStatus('Sẵn sàng. Nhập JSON hoặc mở file .json (tối đa 5 MB).'); return false; }
    if (bytes > MAX_JSON_BYTES) { setStatus('Nội dung vượt quá 5 MB. Hãy chia dữ liệu thành file nhỏ hơn.', 'error'); return false; }
    try {
      const { node, stats } = parseJSONDocument(source);
      const indent = $('#json-indent').value;
      const result = formatJSONDocument(node, {
        indent: indent === 'compact' ? '' : indent === 'tab' ? '\t' : ' '.repeat(Number(indent)),
        sortKeys: $('#json-sort').checked, escapeUnicode: $('#json-unicode').checked,
        newline: $('#json-newline').value === 'crlf' ? '\r\n' : '\n'
      });
      if (byteSize(result) > 20 * 1024 * 1024) throw new Error('Kết quả vượt quá 20 MB. Hãy chọn thu gọn hoặc chia nhỏ dữ liệu.');
      formattedResult = result; output.value = result; outputEditor.refresh();
      $('#json-output-meta').textContent = sizeLabel(byteSize(result));
      tree.replaceChildren(renderNode(node, 'Dữ liệu', true));
      const summary = $('#json-summary'); summary.hidden = false;
      summary.replaceChildren(...[stats.values.toLocaleString('vi-VN') + ' giá trị', stats.objects + ' nhóm', stats.arrays + ' danh sách'].map(text => element('span', '', text)));
      for (const id of ['json-copy', 'json-download', 'json-collapse']) $('#' + id).disabled = false;
      setStatus(stats.duplicates ? 'JSON hợp lệ · Có ' + stats.duplicates + ' tên trường bị trùng trong cùng nhóm. Kết quả giữ nguyên các trường; hãy kiểm tra trước khi sử dụng.' : 'JSON hợp lệ · Đã định dạng. Số dài và thứ tự phần tử trong danh sách được giữ nguyên.', stats.duplicates ? 'warning' : 'success');
      return true;
    } catch (error) {
      resetResult('Sửa nội dung JSON ở cột đầu để xem thông tin.');
      setStatus((error.line ? 'Lỗi tại dòng ' + error.line + ', cột ' + error.column + ': ' : '') + error.message, 'error');
      return false;
    }
  }
  function changed() {
    revision++; clearTimeout(timer); resetResult();
    $('#json-input-meta').textContent = input.value ? sizeLabel(byteSize(input.value)) : 'Chưa có dữ liệu';
    if (!input.value.trim()) { format(); return; }
    setStatus($('#json-auto').checked ? 'Đang kiểm tra nội dung…' : 'Nội dung hoặc tùy chọn đã thay đổi. Nhấn Định dạng để cập nhật kết quả.');
    if ($('#json-auto').checked) timer = setTimeout(format, 350);
  }
  async function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_JSON_BYTES) { toast('File vượt quá 5 MB. Hãy chọn file nhỏ hơn.', true); return; }
    const current = ++revision; clearTimeout(timer); resetResult();
    setStatus('Đang đọc file ' + file.name + '…');
    try {
      const text = await file.text();
      if (current !== revision) return;
      filename = file.name.replace(/\.[^.]+$/, '') + '.formatted.json';
      input.value = text; format();
    } catch { if (current === revision) setStatus('Không đọc được file. Hãy chọn lại hoặc dán nội dung trực tiếp.', 'error'); }
  }
  input.addEventListener('input', changed);
  for (const id of ['json-indent', 'json-newline', 'json-sort', 'json-unicode', 'json-auto']) $('#' + id).addEventListener('change', changed);
  $('#json-format').onclick = format;
  $('#json-open').onclick = () => { $('#json-file').value = ''; $('#json-file').click(); };
  $('#json-file').onchange = event => loadFile(event.target.files[0]);
  for (const name of ['dragenter', 'dragover']) input.addEventListener(name, event => { event.preventDefault(); input.classList.add('drag-over'); });
  for (const name of ['dragleave', 'drop']) input.addEventListener(name, event => {
    event.preventDefault(); input.classList.remove('drag-over');
    if (name === 'drop') {
      if (event.dataTransfer.files.length === 1) loadFile(event.dataTransfer.files[0]);
      else toast('Hãy kéo thả một file JSON mỗi lần.', true);
    }
  });
  $('#json-sample').onclick = () => {
    filename = 'dancing-road.formatted.json';
    input.value = '{"game":"Dancing Road","package":"com.amanotes.pamadancingroad","active":true,"version":"3.0.0","levels":[{"name":"Bắt đầu","difficulty":"Dễ","rewards":100},{"name":"Tăng tốc","difficulty":"Vừa","rewards":250}],"player":{"id":9007199254740993123,"name":"Minh Anh","tags":["new","android"]},"note":null}';
    revision++; format();
  };
  $('#json-clear').onclick = () => { revision++; input.value = ''; filename = 'formatted.json'; format(); input.focus(); };
  $('#json-copy').onclick = () => { if (formattedResult) copy(formattedResult); };
  $('#json-download').onclick = () => {
    if (!formattedResult) return;
    const url = URL.createObjectURL(new Blob([formattedResult], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Đã chuẩn bị file JSON để tải xuống.');
  };
  $('#json-collapse').onclick = () => tree.querySelectorAll('details').forEach(node => { node.open = false; });
}

// Keep a native textarea for editing/IME/undo and paint only visible lines behind it.
function createJSONCodeEditor(textarea) {
  const shell = document.createElement('div'); shell.className = 'json-code';
  const gutter = document.createElement('div'); gutter.className = 'json-line-numbers'; gutter.setAttribute('aria-hidden', 'true');
  const numbers = document.createElement('div'); gutter.append(numbers);
  const viewport = document.createElement('div'); viewport.className = 'json-code-viewport';
  const paint = document.createElement('pre'); paint.className = 'json-code-paint'; paint.setAttribute('aria-hidden', 'true');
  const content = document.createElement('code'); content.className = 'json-code-content'; paint.append(content);
  textarea.before(shell); shell.append(gutter, viewport); viewport.append(paint, textarea);
  textarea.setAttribute('wrap', 'off');
  let source = null, tokens = [], lines = [0], pending = 0, indentSize = 2;
  function render() {
    pending = 0;
    if (!textarea.clientHeight || !textarea.clientWidth) return;
    const style = getComputedStyle(textarea), lineHeight = parseFloat(style.lineHeight);
    const first = Math.max(0, Math.floor(textarea.scrollTop / lineHeight) - 2);
    const last = Math.min(lines.length, first + Math.ceil(textarea.clientHeight / lineHeight) + 5);
    const start = lines[first] ?? source.length, end = lines[last] ?? source.length;
    const active = document.activeElement === textarea && textarea.selectionStart === textarea.selectionEnd ? findJSONBracketPair(tokens, textarea.selectionStart) : [];
    content.innerHTML = highlightJSONRange(source, tokens, start, end, active, indentSize);
    content.style.transform = 'translate(' + -textarea.scrollLeft + 'px,' + (first * lineHeight - textarea.scrollTop) + 'px)';
    paint.style.width = textarea.clientWidth + 'px'; paint.style.height = textarea.clientHeight + 'px';
    numbers.textContent = Array.from({ length: last - first }, (_, index) => first + index + 1).join('\n');
    numbers.style.transform = 'translateY(' + (first * lineHeight - textarea.scrollTop) + 'px)';
  }
  function schedule() { if (!pending) pending = requestAnimationFrame(render); }
  function refresh() {
    if (source !== textarea.value) {
      source = textarea.value;
      ({ tokens, lines } = tokenizeJSON(source));
      const widths = [...source.slice(0, 10000).matchAll(/\n( +)\S/g)].map(match => match[1].length);
      indentSize = widths.some(width => width % 4 !== 0) ? 2 : widths.length ? 4 : 2;
    }
    schedule();
  }
  textarea.addEventListener('input', refresh);
  for (const event of ['scroll', 'click', 'keyup', 'select', 'focus', 'blur', 'compositionend']) textarea.addEventListener(event, schedule);
  const observer = new ResizeObserver(schedule); observer.observe(textarea);
  document.addEventListener('selectionchange', () => { if (document.activeElement === textarea) schedule(); });
  refresh(); shell.classList.add('json-code-ready');
  return { refresh };
}
