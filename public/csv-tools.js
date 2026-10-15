export const MAX_CSV_BYTES = 10 * 1024 * 1024;
const delimiters = [',', ';', '\t', '|'];
function stripPreamble(source) {
  source = source.replace(/^\ufeff/, '');
  const directive = /^sep=([,;\t|])(?:\r\n|\r|\n|$)/i.exec(source);
  return { text: directive ? source.slice(directive[0].length) : source, directive: directive?.[1], line: directive ? 2 : 1 };
}
export function detectCSVDelimiter(source) {
  const preamble = stripPreamble(source);
  if (preamble.directive) return preamble.directive;
  const text = preamble.text;
  const samples = []; let counts = [0, 0, 0, 0], quoted = false, touched = false;
  for (let i = 0; i < Math.min(text.length, 256 * 1024) && samples.length < 30; i++) {
    const char = text[i];
    if (char === '"') { touched = true; if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && (char === '\r' || char === '\n')) {
      if (touched) samples.push(counts); counts = [0, 0, 0, 0]; touched = false;
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (!quoted) { const index = delimiters.indexOf(char); if (index >= 0) counts[index]++; if (char.trim()) touched = true; }
  }
  if (touched && !quoted) samples.push(counts);
  let best = ',', score = -1;
  for (let column = 0; column < delimiters.length; column++) {
    const frequency = new Map();
    for (const sample of samples) if (sample[column]) frequency.set(sample[column], (frequency.get(sample[column]) || 0) + 1);
    for (const [count, matches] of frequency) {
      const rank = matches / Math.max(1, samples.length) * 100 + Math.min(count, 50);
      if (rank > score) { best = delimiters[column]; score = rank; }
    }
  }
  return best;
}
export function decodeCSVBuffer(buffer, encoding = 'auto') {
  const bytes = new Uint8Array(buffer);
  let detected = encoding;
  if (encoding === 'auto') detected = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  try { return { text: new TextDecoder(detected, { fatal: true }).decode(bytes), encoding: detected }; }
  catch { throw new Error('Không đọc được ký tự với encoding đã chọn. Hãy thử UTF-16 hoặc Windows-1252 / Windows-1258.'); }
}
export function parseCSV(source, { delimiter = 'auto', skipEmptyLines = true, maxRows = 100000, maxColumns = 1000, maxCells = 1000000 } = {}) {
  if (delimiter === 'auto') delimiter = detectCSVDelimiter(source);
  if (!delimiters.includes(delimiter)) throw new Error('Dấu phân cách không được hỗ trợ.');
  const preamble = stripPreamble(source), text = preamble.text;
  const rows = []; let row = [], field = '', state = 'start', line = preamble.line, recordLine = line, touched = false, cells = 0;
  const fail = message => { throw new Error('Dòng ' + line + ', cột dữ liệu ' + (row.length + 1) + ': ' + message); };
  function pushField() {
    row.push(field); field = ''; state = 'start';
    if (row.length > maxColumns) fail('Số cột vượt quá ' + maxColumns + '. Hãy chia nhỏ file.');
  }
  function pushRow() {
    pushField();
    if (!skipEmptyLines || touched || row.some(value => value.trim())) {
      cells += row.length;
      if (rows.length >= maxRows || cells > maxCells) fail('Dữ liệu vượt giới hạn ' + maxRows.toLocaleString('vi-VN') + ' dòng hoặc ' + maxCells.toLocaleString('vi-VN') + ' ô. Hãy chia nhỏ file.');
      rows.push({ values: row, line: recordLine });
    }
    row = []; touched = false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else state = 'closed'; }
      else { field += char; if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) line++; }
      continue;
    }
    if (char === delimiter) { touched = true; pushField(); continue; }
    if (char === '\r' || char === '\n') {
      pushRow(); if (char === '\r' && text[i + 1] === '\n') i++; line++; recordLine = line; continue;
    }
    if (state === 'closed') { if (char === ' ' || char === '\t') continue; fail('Có ký tự thừa sau dấu ngoặc kép đóng.'); }
    if (char === '"') {
      if (state !== 'start') fail('Dấu ngoặc kép cần nằm ở đầu ô; dấu ngoặc kép trong nội dung phải viết thành hai dấu liên tiếp.');
      state = 'quoted'; touched = true;
    } else { field += char; state = 'unquoted'; if (char.trim()) touched = true; }
  }
  if (state === 'quoted') fail('Ô dữ liệu chưa có dấu ngoặc kép đóng.');
  if (text.length && (row.length || field.length || state !== 'start' || touched)) pushRow();
  return { rows, delimiter, directive: !!preamble.directive };
}
export function buildCSVTable(records, hasHeader = true) {
  const width = records.reduce((max, row) => Math.max(max, row.values.length), 0);
  const header = hasHeader ? records[0]?.values || [] : [];
  const headers = Array.from({ length: width }, (_, index) => header[index] || 'Cột ' + (index + 1));
  const data = (hasHeader ? records.slice(1) : records).map((record, index) => ({ ...record, index: index + 1 }));
  const expected = hasHeader ? header.length : records[0]?.values.length || 0;
  return { headers, data, unevenRows: data.filter(row => row.values.length !== expected).length };
}
export function normalizeCSVSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLocaleLowerCase('vi');
}
