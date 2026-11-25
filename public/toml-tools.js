// Dependency-free TOML 1.0 parser used to validate config files before saving.
// Runs in the browser (live validation) and on the server (final check before writing).
export const MAX_TOML_BYTES = 5 * 1024 * 1024;

const BARE_KEY = /[A-Za-z0-9_-]/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const OFFSET = /^(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?\d)*)$/;
const PREFIXED = /^(?:0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|0b[01](?:_?[01])*)$/;
const FLOAT = /^[+-]?(?:0|[1-9](?:_?\d)*)(?:\.\d(?:_?\d)*)?(?:[eE][+-]?\d(?:_?\d)*)?$/;

export function parseTOML(source) {
  let position = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const root = Object.create(null);
  // Table metadata decides which redefinitions TOML allows.
  const headerTables = new Set(), dottedTables = new Set(), frozen = new Set(), tableArrays = new Set();
  let current = root, keys = 0, tables = 0;

  function fail(message, at = position) {
    const lines = source.slice(0, at).split('\n');
    const error = new SyntaxError(message);
    error.line = lines.length; error.column = lines.at(-1).replace(/\r$/, '').length + 1; error.position = at;
    throw error;
  }
  const peek = (offset = 0) => source[position + offset];
  const isTable = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof TomlDate);
  function spaces() { while (peek() === ' ' || peek() === '\t') position++; }
  function comment() {
    if (peek() !== '#') return;
    while (position < source.length && peek() !== '\n') {
      const code = source.charCodeAt(position);
      if ((code < 32 && code !== 9 && !(code === 13 && peek(1) === '\n')) || code === 127) fail('Chú thích chứa ký tự điều khiển không hợp lệ.');
      position++;
    }
  }
  function newline() {
    if (peek() === '\n') { position++; return true; }
    if (peek() === '\r') { if (peek(1) !== '\n') fail('Ký tự \\r phải đi kèm \\n (CRLF).'); position += 2; return true; }
    return false;
  }
  function endOfLine(what) {
    spaces(); comment();
    if (position < source.length && !newline()) fail(`Sau ${what} chỉ được có chú thích (#) hoặc xuống dòng.`);
  }
  function blankAndComments() { // inside arrays: whitespace, newlines and comments
    for (;;) { spaces(); comment(); if (!newline()) return; }
  }

  function escapeSequence() {
    const char = source[position++];
    const simple = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' }[char];
    if (simple !== undefined) return simple;
    if (char === 'u' || char === 'U') {
      const length = char === 'u' ? 4 : 8, hex = source.slice(position, position + length);
      if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(hex)) fail(`Escape "\\${char}" cần đúng ${length} ký tự thập lục phân. Nếu đây là đường dẫn Windows, hãy viết "\\\\" hoặc dùng chuỗi '...' (literal).`, position - 2);
      const code = parseInt(hex, 16);
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail('Mã Unicode trong escape không hợp lệ.', position - 2);
      position += length; return String.fromCodePoint(code);
    }
    fail(`Escape "\\${char ?? ''}" không hợp lệ trong chuỗi. Dùng "\\\\" cho dấu gạch chéo ngược hoặc chuỗi '...' (literal).`, position - 2);
  }
  function badControl(code, multiline) {
    return (code < 32 && code !== 9 && !(multiline && (code === 10 || code === 13))) || code === 127;
  }
  function basicString(multiline) {
    const start = position; position += multiline ? 3 : 1;
    if (multiline) newline();
    let value = '';
    for (;;) {
      if (position >= source.length) fail(multiline ? 'Chuỗi """ chưa được đóng.' : 'Chuỗi chưa có dấu ngoặc kép đóng.', start);
      const char = peek();
      if (multiline && source.startsWith('"""', position)) {
        let extra = 0; while (extra < 2 && peek(3 + extra) === '"') extra++;
        value += '"'.repeat(extra); position += 3 + extra; return value;
      }
      if (!multiline && char === '"') { position++; return value; }
      const code = source.charCodeAt(position);
      if (!multiline && (code === 10 || code === 13)) fail('Chuỗi một dòng không được xuống dòng. Dùng """ cho chuỗi nhiều dòng.', start);
      if (badControl(code, multiline)) fail('Chuỗi chứa ký tự điều khiển không hợp lệ.');
      if (code === 13 && peek(1) !== '\n') fail('Ký tự \\r phải đi kèm \\n (CRLF).');
      if (char === '\\') {
        position++;
        if (multiline) { // line-ending backslash trims following whitespace
          let look = position; while (source[look] === ' ' || source[look] === '\t') look++;
          if (source[look] === '\n' || (source[look] === '\r' && source[look + 1] === '\n')) {
            position = look; while (/[ \t\r\n]/.test(peek() || '')) position++; continue;
          }
        }
        value += escapeSequence(); continue;
      }
      value += char; position++;
    }
  }
  function literalString(multiline) {
    const start = position; position += multiline ? 3 : 1;
    if (multiline) newline();
    let value = '';
    for (;;) {
      if (position >= source.length) fail(multiline ? "Chuỗi ''' chưa được đóng." : 'Chuỗi chưa có dấu nháy đơn đóng.', start);
      if (multiline && source.startsWith("'''", position)) {
        let extra = 0; while (extra < 2 && peek(3 + extra) === "'") extra++;
        value += "'".repeat(extra); position += 3 + extra; return value;
      }
      if (!multiline && peek() === "'") { position++; return value; }
      const code = source.charCodeAt(position);
      if (!multiline && (code === 10 || code === 13)) fail("Chuỗi '...' một dòng không được xuống dòng.", start);
      if (badControl(code, multiline)) fail('Chuỗi chứa ký tự điều khiển không hợp lệ.');
      value += peek(); position++;
    }
  }

  function key() {
    const parts = [];
    for (;;) {
      spaces();
      const start = position;
      if (peek() === '"') { if (source.startsWith('"""', position)) fail('Tên khóa không được dùng chuỗi nhiều dòng.'); parts.push(basicString(false)); }
      else if (peek() === "'") { if (source.startsWith("'''", position)) fail('Tên khóa không được dùng chuỗi nhiều dòng.'); parts.push(literalString(false)); }
      else {
        while (position < source.length && BARE_KEY.test(peek())) position++;
        if (position === start) fail(peek() === undefined || peek() === '\n' || peek() === '\r' ? 'Thiếu tên khóa.' : `Ký tự "${peek()}" không hợp lệ trong tên khóa. Hãy đặt tên khóa trong dấu ngoặc kép.`);
        parts.push(source.slice(start, position));
      }
      spaces();
      if (peek() !== '.') return parts;
      position++;
    }
  }

  function scalarToken() {
    const start = position;
    while (position < source.length && !/[\s,\]\}#]/.test(peek())) position++;
    let token = source.slice(start, position);
    // A date and time may be separated by a single space.
    if (DATE.test(token) && peek() === ' ' && /\d/.test(peek(1) || '')) {
      const save = position; position++;
      while (position < source.length && !/[\s,\]\}#]/.test(peek())) position++;
      const candidate = `${token} ${source.slice(save + 1, position)}`;
      if (dateTime(candidate.replace(' ', 'T'))) token = candidate; else position = save;
    }
    if (!token) fail(peek() === undefined || peek() === '\n' || peek() === '\r' ? 'Thiếu giá trị sau dấu "=".' : `Giá trị bắt đầu bằng "${peek()}" không hợp lệ.`, start);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (/^[+-]?(?:inf|nan)$/.test(token)) return token.endsWith('inf') ? (token[0] === '-' ? -Infinity : Infinity) : NaN;
    if (INTEGER.test(token)) return Number(token.replaceAll('_', ''));
    if (PREFIXED.test(token)) return Number(token.replaceAll('_', ''));
    if (FLOAT.test(token)) return Number(token.replaceAll('_', ''));
    const date = dateTime(token.replace(' ', 'T'));
    if (date) return date;
    if (/^(?:True|False|TRUE|FALSE|yes|no|on|off|null|none|nil)$/i.test(token)) fail(`"${token}" không phải giá trị TOML. Dùng true/false (chữ thường), hoặc đặt văn bản trong dấu ngoặc kép.`, start);
    if (/^[+-]?\d/.test(token)) fail(`Số hoặc ngày giờ "${token}" không đúng định dạng TOML.`, start);
    fail(`Giá trị "${token}" chưa đặt trong dấu ngoặc kép. Văn bản phải viết dạng "${token}".`, start);
  }
  function dateTime(token) {
    const [datePart, timeAndZone] = token.split(/[Tt]/);
    if (timeAndZone === undefined) {
      const time = TIME.exec(token);
      if (time) return validTime(time) ? new TomlDate(token) : null;
    }
    const date = DATE.exec(datePart);
    if (!date) return null;
    const [, year, month, day] = date.map(Number);
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (!days || day < 1 || day > days) return null;
    if (timeAndZone === undefined) return new TomlDate(token);
    const match = /^(\d{2}:\d{2}:\d{2}(?:\.\d+)?)(.*)$/.exec(timeAndZone);
    if (!match || !validTime(TIME.exec(match[1]))) return null;
    if (match[2]) { const offset = OFFSET.exec(match[2]); if (!offset || (offset[1] && (+offset[1] > 23 || +offset[2] > 59))) return null; }
    return new TomlDate(token);
  }
  const validTime = match => !!match && +match[1] < 24 && +match[2] < 60 && +match[3] <= 60;

  function value() {
    const char = peek();
    if (char === '"') return basicString(source.startsWith('"""', position));
    if (char === "'") return literalString(source.startsWith("'''", position));
    if (char === '[') return array();
    if (char === '{') return inlineTable();
    return scalarToken();
  }
  function array() {
    const start = position++; const items = [];
    for (;;) {
      blankAndComments();
      if (peek() === ']') { position++; break; }
      if (position >= source.length) fail('Mảng chưa có dấu "]" đóng.', start);
      items.push(value());
      blankAndComments();
      if (peek() === ',') { position++; continue; }
      if (peek() === ']') { position++; break; }
      fail(position >= source.length ? 'Mảng chưa có dấu "]" đóng.' : 'Các phần tử trong mảng cần cách nhau bằng dấu phẩy.');
    }
    frozen.add(items); return items;
  }
  function inlineTable() {
    const start = position++; const table = Object.create(null);
    spaces();
    if (peek() === '}') { position++; frozen.add(table); return table; }
    for (;;) {
      spaces();
      if (peek() === '\n' || peek() === '\r' || position >= source.length) fail('Bảng inline { ... } phải nằm trên một dòng và có dấu "}" đóng.', start);
      if (peek() === '}') fail('Không được có dấu phẩy thừa trước "}" trong bảng inline.');
      spaces(); assign(table, position, true);
      spaces();
      if (peek() === ',') { position++; continue; }
      if (peek() === '}') { position++; break; }
      fail('Bảng inline cần dấu phẩy giữa các cặp khóa và "}" ở cuối, trên cùng một dòng.');
    }
    freeze(table); return table;
  }
  function freeze(table) {
    frozen.add(table);
    for (const item of Object.values(table)) if (isTable(item)) freeze(item);
  }
  function assign(table, at, inline = false) {
    const parts = key();
    let target = table;
    for (const part of parts.slice(0, -1)) {
      if (!(part in target)) { target[part] = Object.create(null); dottedTables.add(target[part]); tables++; }
      else if (!isTable(target[part]) || frozen.has(target[part]) || headerTables.has(target[part]) || !dottedTables.has(target[part])) fail(`Khóa "${part}" đã được định nghĩa trước đó, không thể mở rộng bằng khóa có dấu chấm.`, at);
      target = target[part];
    }
    const last = parts.at(-1);
    if (last in target) fail(`Khóa "${parts.join('.')}" bị khai báo trùng.`, at);
    if (peek() !== '=') fail(`Thiếu dấu "=" sau khóa "${parts.join('.')}".`);
    position++; spaces();
    target[last] = value(); keys++;
    if (!inline && isTable(target[last])) freeze(target[last]);
  }

  function header() {
    const start = position;
    const isArray = source.startsWith('[[', position);
    position += isArray ? 2 : 1;
    const parts = key();
    if (isArray ? !source.startsWith(']]', position) : peek() !== ']') fail(isArray ? 'Tiêu đề mảng bảng cần đóng bằng "]]".' : 'Tiêu đề bảng cần đóng bằng "]".');
    position += isArray ? 2 : 1;
    const name = parts.join('.');
    let target = root;
    for (const part of parts.slice(0, -1)) {
      if (!(part in target)) { target[part] = Object.create(null); tables++; }
      let next = target[part];
      if (Array.isArray(next)) { if (!tableArrays.has(next)) fail(`"${part}" là một mảng giá trị, không thể dùng làm bảng.`, start); next = next.at(-1); }
      if (!isTable(next) || frozen.has(next)) fail(`"${part}" đã là một giá trị, không thể dùng làm bảng [${name}].`, start);
      target = next;
    }
    const last = parts.at(-1);
    if (isArray) {
      if (!(last in target)) { target[last] = []; tableArrays.add(target[last]); }
      else if (!Array.isArray(target[last]) || !tableArrays.has(target[last])) fail(`[[${name}]] trùng tên với một khóa hoặc bảng đã có.`, start);
      const table = Object.create(null); target[last].push(table); tables++; current = table;
    } else {
      if (!(last in target)) { target[last] = Object.create(null); tables++; }
      else if (!isTable(target[last]) || headerTables.has(target[last]) || dottedTables.has(target[last]) || frozen.has(target[last])) fail(`Bảng [${name}] bị khai báo trùng hoặc trùng với một khóa đã có.`, start);
      current = target[last];
    }
    headerTables.add(current);
    endOfLine(`tiêu đề bảng [${name}]`);
  }

  while (position < source.length) {
    spaces();
    if (newline()) continue;
    if (peek() === '#') { comment(); continue; }
    if (position >= source.length) break;
    if (peek() === '[') { header(); continue; }
    assign(current, position);
    endOfLine('giá trị');
  }
  return { value: root, stats: { keys, tables } };
}

// Lenient tokenizer for syntax colouring. Never throws: broken input still gets
// coloured, with unknown text marked "invalid". Tokens share the JSON token shape.
export function tokenizeTOML(source) {
  const tokens = [], lines = [0], stack = [];
  for (let index = source.indexOf('\n'); index >= 0; index = source.indexOf('\n', index + 1)) lines.push(index + 1);
  let position = 0, expectKey = true, lineStart = true;
  const add = (start, end, type, depth = stack.length) => { const token = { start, end, type, depth, pair: -1 }; tokens.push(token); return token; };
  const inInline = () => stack.length && source[tokens[stack.at(-1)].start] === '{';
  function stringEnd(start) {
    const quote = source[start], triple = source.startsWith(quote.repeat(3), start);
    let at = start + (triple ? 3 : 1);
    while (at < source.length) {
      if (triple && source.startsWith(quote.repeat(3), at)) { at += 3; for (let extra = 0; extra < 2 && source[at] === quote; extra++) at++; return [at, true]; }
      const char = source[at];
      if (!triple && (char === '\n' || char === '\r')) return [at, false];
      if (!triple && char === quote) return [at + 1, true];
      at += quote === '"' && char === '\\' && source[at + 1] !== '\n' ? 2 : 1;
    }
    return [source.length, false];
  }
  function open(start, length) { add(start, start + length, 'bracket'); stack.push(tokens.length - 1); }
  function close(start, length, char) {
    const openIndex = stack.at(-1), opener = tokens[openIndex];
    const matched = opener && source[opener.start] === (char === '}' ? '{' : '[');
    const token = add(start, start + length, matched ? 'bracket' : 'invalid-bracket', matched ? opener.depth : stack.length);
    if (matched) { stack.pop(); token.pair = openIndex; opener.pair = tokens.length - 1; }
  }
  while (position < source.length) {
    const char = source[position], start = position;
    if (char === '\n') { position++; lineStart = true; if (!stack.length) expectKey = true; continue; }
    if (/\s/.test(char)) { position++; continue; }
    if (char === '#') { while (position < source.length && source[position] !== '\n') position++; add(start, position, 'comment'); continue; }
    if (char === '[' && expectKey && lineStart && !stack.length) { // [table] or [[array of tables]]
      const double = source[position + 1] === '[';
      const end = source.indexOf(double ? ']]' : ']', position), eol = source.indexOf('\n', position);
      const limit = end >= 0 && (eol < 0 || end < eol) ? end : -1;
      const opener = add(start, start + (double ? 2 : 1), limit >= 0 ? 'bracket' : 'invalid-bracket', 0);
      position = opener.end;
      const nameEnd = limit >= 0 ? limit : eol >= 0 ? eol : source.length;
      if (nameEnd > position) add(position, nameEnd, 'table');
      position = nameEnd;
      if (limit >= 0) { const closer = add(position, position + (double ? 2 : 1), 'bracket', 0); closer.pair = tokens.indexOf(opener); opener.pair = tokens.length - 1; position = closer.end; }
      lineStart = false; continue;
    }
    lineStart = false;
    if (char === '"' || char === "'") {
      const [end, closed] = stringEnd(position);
      let next = end; while (source[next] === ' ' || source[next] === '\t') next++;
      add(start, end, !closed ? 'invalid' : expectKey && (source[next] === '=' || source[next] === '.') ? 'key' : 'string');
      position = end; continue;
    }
    if (expectKey && /[A-Za-z0-9_-]/.test(char)) {
      while (position < source.length && /[A-Za-z0-9_-]/.test(source[position])) position++;
      add(start, position, 'key'); continue;
    }
    if (char === '=') { add(start, ++position, 'punctuation'); expectKey = false; continue; }
    if (char === '.' && expectKey) { add(start, ++position, 'punctuation'); continue; }
    if (char === ',') { add(start, ++position, 'punctuation'); expectKey = inInline(); continue; }
    if (char === '[') { open(start, 1); position++; expectKey = false; continue; }
    if (char === '{') { open(start, 1); position++; expectKey = true; continue; }
    if (char === ']' || char === '}') { close(start, 1, char); position++; expectKey = !stack.length ? false : inInline(); continue; }
    while (position < source.length && !/[\s,\]\}#=]/.test(source[position])) position++;
    // Allow "1979-05-27 07:32:00" with a space separator.
    if (/^\d{4}-\d{2}-\d{2}$/.test(source.slice(start, position)) && source[position] === ' ' && /\d{2}:/.test(source.slice(position + 1, position + 4))) {
      position++; while (position < source.length && !/[\s,\]\}#]/.test(source[position])) position++;
    }
    if (position === start) position++;
    const raw = source.slice(start, position);
    add(start, position, raw === 'true' || raw === 'false' ? 'boolean'
      : /^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}:\d{2}/.test(raw) ? 'datetime'
      : INTEGER.test(raw) || PREFIXED.test(raw) || FLOAT.test(raw) || /^[+-]?(?:inf|nan)$/.test(raw) ? 'number' : 'invalid');
  }
  for (const index of stack) tokens[index].type = 'invalid-bracket';
  return { tokens, lines };
}

export class TomlDate { constructor(text) { this.text = text; } toJSON() { return this.text; } }
