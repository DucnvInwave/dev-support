import { MAX_CSV_BYTES, parseCSV, decodeCSVBuffer, buildCSVTable, normalizeCSVSearch } from './csv-tools.js';
export function initCSVViewer({ toast, copy }) {
  const $ = selector => document.querySelector(selector);
  let fileBuffer = null, source = '', sourceName = '', encodingLabel = '', records = [], headers = [], rows = [], filtered = [], searchCache = [], page = 0, sortColumn = -1, direction = 1, revision = 0, searchTimer, cellValue = '';
  const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
  const wrap = $('#csv-table-wrap'), panel = $('#csv-table-panel'), expandDialog = $('#csv-expand-dialog'), cellDialog = $('#csv-cell-dialog');
  let marker = null;
  const delimiterNames = { ',': 'dấu phẩy', ';': 'dấu chấm phẩy', '\t': 'Tab', '|': 'dấu gạch đứng' };
  const number = value => value.toLocaleString('vi-VN');
  function el(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function status(message, kind = '') { $('#csv-status').textContent = message; $('#csv-status').className = 'json-status' + (kind ? ' ' + kind : ''); }
  function closeExpanded() { if (expandDialog.open) expandDialog.close(); }
  function resetTable(message = 'Chọn file hoặc dùng ví dụ. Bấm vào một ô để xem đầy đủ nội dung.') {
    records = []; headers = []; rows = []; filtered = []; searchCache = []; page = 0; sortColumn = -1;
    cellValue = ''; $('#csv-cell-value').textContent = ''; $('#csv-cell-meta').textContent = '';
    wrap.replaceChildren(el('div', 'csv-empty', message));
    $('#csv-summary').textContent = 'Chưa có dữ liệu'; $('#csv-range').textContent = 'Chưa có dòng dữ liệu'; $('#csv-page-label').textContent = 'Trang 0 / 0';
    for (const id of ['csv-prev', 'csv-next', 'csv-search', 'csv-expand']) $('#' + id).disabled = true;
  }
  function openCell(row, column) {
    cellValue = row.values[column] ?? '';
    $('#csv-cell-title').textContent = headers[column];
    $('#csv-cell-meta').textContent = 'Dòng dữ liệu ' + number(row.index) + ' · Dòng bắt đầu trong file: ' + number(row.line) + ' · ' + number(cellValue.length) + ' ký tự';
    $('#csv-cell-value').textContent = cellValue || '(Ô trống)';
    cellDialog.showModal();
  }
  function pageSize() { return Math.max(1, Math.min(Number($('#csv-page-size').value), Math.floor(10000 / Math.max(1, headers.length)))); }
  function render() {
    const size = pageSize(), pages = Math.ceil(filtered.length / size);
    page = Math.max(0, Math.min(page, pages - 1));
    const start = page * size, end = Math.min(start + size, filtered.length);
    wrap.replaceChildren();
    if (headers.length) {
      const table = el('table', 'csv-table'), caption = el('caption', 'sr-only', sourceName + '. Bấm vào tiêu đề cột để sắp xếp, bấm vào ô để xem đầy đủ nội dung.');
      table.append(caption);
      const thead = document.createElement('thead'), head = document.createElement('tr');
      const indexHead = el('th', 'csv-row-number', '#'); indexHead.scope = 'col'; head.append(indexHead);
      headers.forEach((header, index) => {
        const th = document.createElement('th'); th.scope = 'col'; th.setAttribute('aria-sort', sortColumn === index ? direction === 1 ? 'ascending' : 'descending' : 'none');
        const button = el('button', 'csv-sort', header); button.title = header + ' · Bấm để sắp xếp'; button.append(el('span', 'csv-sort-indicator', sortColumn === index ? direction === 1 ? '↑' : '↓' : '↕'));
        button.onclick = () => { if (sortColumn === index) direction *= -1; else { sortColumn = index; direction = 1; } filter(); };
        th.append(button); head.append(th);
      });
      thead.append(head); table.append(thead);
      const tbody = document.createElement('tbody');
      for (const row of filtered.slice(start, end)) {
        const tr = document.createElement('tr'), index = el('th', 'csv-row-number', number(row.index)); index.scope = 'row'; index.title = 'Dòng bắt đầu trong file: ' + row.line; tr.append(index);
        headers.forEach((_, column) => {
          const td = document.createElement('td'), value = row.values[column] ?? '';
          const button = el('button', 'csv-cell' + (value === '' ? ' csv-cell-empty' : ''));
          button.append(el('span', 'csv-cell-text', value ? value.slice(0, 300) + (value.length > 300 ? '…' : '') : '(trống)'));
          button.setAttribute('aria-label', headers[column] + ', dòng ' + row.index + ': ' + (value ? value.slice(0, 150) : 'ô trống'));
          button.title = 'Bấm để xem đầy đủ nội dung ô'; button.onclick = () => openCell(row, column); td.append(button); tr.append(td);
        });
        tbody.append(tr);
      }
      table.append(tbody); wrap.append(table);
      if (!filtered.length) wrap.append(el('div', 'csv-empty', rows.length ? 'Không có dòng phù hợp. Hãy thử từ khóa khác.' : 'File chỉ có tiêu đề, chưa có dòng dữ liệu.'));
    } else wrap.append(el('div', 'csv-empty', 'File chưa có dữ liệu để hiển thị.'));
    $('#csv-range').textContent = filtered.length ? number(start + 1) + '–' + number(end) + ' / ' + number(filtered.length) + ' dòng' + (filtered.length !== rows.length ? ' phù hợp (tổng ' + number(rows.length) + ')' : '') : '0 / ' + number(rows.length) + ' dòng';
    $('#csv-page-label').textContent = 'Trang ' + (pages ? page + 1 : 0) + ' / ' + number(pages);
    $('#csv-prev').disabled = !pages || page === 0; $('#csv-next').disabled = !pages || page + 1 >= pages;
    wrap.scrollTop = 0;
  }
  function filter() {
    clearTimeout(searchTimer);
    const query = normalizeCSVSearch($('#csv-search').value.trim());
    filtered = rows.filter((_, index) => !query || searchCache[index].includes(query));
    if (sortColumn >= 0) filtered.sort((a, b) => direction * collator.compare(a.values[sortColumn] ?? '', b.values[sortColumn] ?? '') || a.index - b.index);
    page = 0; render();
  }
  function parse() {
    clearTimeout(searchTimer); resetTable();
    try {
      const result = parseCSV(source, { delimiter: $('#csv-delimiter').value === 'tab' ? '\t' : $('#csv-delimiter').value, skipEmptyLines: $('#csv-skip-empty').checked });
      records = result.rows;
      const model = buildCSVTable(records, $('#csv-header').checked);
      headers = model.headers; rows = model.data;
      searchCache = rows.map(row => normalizeCSVSearch(row.values.join('\u0000')));
      $('#csv-summary').textContent = number(rows.length) + ' dòng dữ liệu · ' + number(headers.length) + ' cột';
      $('#csv-search').disabled = !rows.length; $('#csv-expand').disabled = !headers.length;
      status(!records.length ? 'Nội dung CSV đang trống.' : 'Đã đọc ' + sourceName + ' · Phân cách bằng ' + delimiterNames[result.delimiter] + (encodingLabel ? ' · ' + encodingLabel.toUpperCase() : '') + (model.unevenRows ? ' · Có ' + number(model.unevenRows) + ' dòng có số ô khác dòng đầu. Các ô thiếu được để trống, ô thừa vẫn được hiển thị.' : ' · Bấm tiêu đề cột để sắp xếp.'), model.unevenRows ? 'warning' : records.length ? 'success' : '');
      filter();
    } catch (error) { resetTable('Chưa đọc được CSV. Hãy kiểm tra nội dung hoặc thử dấu phân cách khác.'); status(error.message, 'error'); }
  }
  function reparse() {
    if (!sourceName) return;
    try {
      if (fileBuffer) { const decoded = decodeCSVBuffer(fileBuffer, $('#csv-encoding').value); source = decoded.text; encodingLabel = decoded.encoding; }
      parse();
    } catch (error) { resetTable('Hãy thử bảng mã ký tự khác để đọc file.'); status(error.message, 'error'); }
  }
  async function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) { toast('File vượt quá 10 MB. Hãy chia thành file nhỏ hơn.', true); return; }
    const current = ++revision; $('#csv-search').value = ''; resetTable(); fileBuffer = null; source = ''; sourceName = file.name;
    $('#csv-file-name').textContent = file.name; $('#csv-file-meta').textContent = (file.size / 1024).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' KB · Bấm để chọn file khác';
    status('Đang đọc ' + file.name + '…');
    try { const buffer = await file.arrayBuffer(); if (current !== revision) return; fileBuffer = buffer; reparse(); }
    catch { if (current === revision) status('Không mở được file. Hãy chọn lại hoặc dán nội dung CSV.', 'error'); }
  }
  function setText(text, name) {
    if (new Blob([text]).size > MAX_CSV_BYTES) { toast('Nội dung vượt quá 10 MB.', true); return; }
    revision++; $('#csv-search').value = ''; fileBuffer = null; source = text; sourceName = name; encodingLabel = '';
    $('#csv-file-name').textContent = name; $('#csv-file-meta').textContent = 'Nội dung dạng văn bản · Bấm để mở file CSV'; parse();
  }
  $('#csv-open').onclick = $('#csv-dropzone').onclick = () => { $('#csv-file').value = ''; $('#csv-file').click(); };
  $('#csv-file').onchange = event => loadFile(event.target.files[0]);
  for (const name of ['dragenter', 'dragover']) $('#csv-dropzone').addEventListener(name, event => { event.preventDefault(); $('#csv-dropzone').classList.add('drag-over'); });
  for (const name of ['dragleave', 'drop']) $('#csv-dropzone').addEventListener(name, event => {
    event.preventDefault(); $('#csv-dropzone').classList.remove('drag-over');
    if (name === 'drop') { if (event.dataTransfer.files.length !== 1) toast('Hãy chọn một file CSV mỗi lần.', true); else loadFile(event.dataTransfer.files[0]); }
  });
  $('#csv-read-paste').onclick = () => setText($('#csv-paste').value, 'Nội dung đã dán');
  $('#csv-sample').onclick = () => {
    $('#csv-delimiter').value = 'auto'; $('#csv-header').checked = true;
    setText('Mã bài hát,Tên bài hát,Độ khó,Điểm,Đang mở,Ghi chú\r\n001,Dancing Road,Dễ,100,true,"Bài hát mở đầu, dễ làm quen"\r\n002,Tăng tốc,Vừa,250,true,"Có phần thưởng ""đặc biệt"""\r\n003,Thử thách,Khó,500,false,"Ghi chú nhiều dòng:\nKiểm tra tốc độ và màu sắc"\r\n9007199254740993123,Về đích,Khó,1000,true,Giữ nguyên ID dài', 'Ví dụ Dancing Road.csv');
  };
  $('#csv-clear').onclick = () => { revision++; clearTimeout(searchTimer); fileBuffer = null; source = ''; sourceName = ''; encodingLabel = ''; $('#csv-file').value = ''; $('#csv-paste').value = ''; $('#csv-search').value = ''; $('#csv-file-name').textContent = 'Kéo thả file CSV vào đây'; $('#csv-file-meta').textContent = 'Hoặc bấm để chọn file .csv / .tsv · Tối đa 10 MB'; resetTable(); status('Sẵn sàng. Chọn file CSV hoặc dùng ví dụ để bắt đầu.'); };
  for (const id of ['csv-delimiter', 'csv-encoding', 'csv-header', 'csv-skip-empty']) $('#' + id).onchange = reparse;
  $('#csv-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(filter, 180); };
  $('#csv-page-size').onchange = () => { page = 0; render(); };
  $('#csv-prev').onclick = () => { page--; render(); }; $('#csv-next').onclick = () => { page++; render(); };
  $('#csv-cell-close').onclick = () => cellDialog.close(); $('#csv-cell-copy').onclick = () => copy(cellValue);
  $('#csv-expand').onclick = () => {
    if (expandDialog.open) { expandDialog.close(); return; }
    marker = document.createComment('CSV panel position'); panel.before(marker); expandDialog.querySelector('.csv-expanded-content').append(panel);
    $('#csv-expand').setAttribute('aria-expanded', 'true'); $('#csv-expand span').textContent = 'Thu nhỏ bảng'; $('#csv-expand use').setAttribute('href', '#i-restore');
    document.body.classList.add('csv-expanded'); expandDialog.showModal(); $('#csv-expand').focus({ preventScroll: true });
  };
  expandDialog.addEventListener('close', () => {
    if (cellDialog.open) cellDialog.close();
    if (marker) marker.replaceWith(panel); marker = null;
    $('#csv-expand').setAttribute('aria-expanded', 'false'); $('#csv-expand span').textContent = 'Phóng to bảng'; $('#csv-expand use').setAttribute('href', '#i-expand');
    document.body.classList.remove('csv-expanded'); $('#csv-expand').focus({ preventScroll: true });
  });
  for (const dialog of [cellDialog, expandDialog]) dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  window.addEventListener('hashchange', () => { if (cellDialog.open) cellDialog.close(); closeExpanded(); });
}
