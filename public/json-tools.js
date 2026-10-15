// A small lossless JSON parser: number tokens and duplicate object members are preserved.
export const MAX_JSON_BYTES = 5 * 1024 * 1024;
export function parseJSONDocument(source) {
  let position = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let duplicates = 0, values = 0, objects = 0, arrays = 0, depth = 0;
  function fail(message) {
    const lines = source.slice(0, position).split('\n');
    const error = new SyntaxError(message);
    error.line = lines.length; error.column = lines.at(-1).length + 1; error.position = position;
    throw error;
  }
  function whitespace() { while (/[\x20\t\r\n]/.test(source[position] || '\0')) position++; }
  function string() {
    const start = position++;
    while (position < source.length) {
      const char = source[position++];
      if (char === '"') {
        try { return JSON.parse(source.slice(start, position)); }
        catch { fail('Chuỗi có ký tự hoặc dấu gạch chéo không hợp lệ.'); }
      }
      if (char.charCodeAt(0) < 32) { position--; fail('Ký tự xuống dòng hoặc điều khiển phải được viết bằng escape trong chuỗi.'); }
      if (char === '\\') {
        const escaped = source[position++];
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(position, position + 4))) fail('Mã Unicode cần đủ 4 ký tự thập lục phân.');
          position += 4;
        } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail('Ký tự escape trong chuỗi không hợp lệ.');
      }
    }
    fail('Chuỗi chưa có dấu ngoặc kép đóng.');
  }
  function value(level) {
    whitespace();
    if (level > 128) fail('Dữ liệu lồng quá 128 cấp. Hãy chia thành các file nhỏ hơn.');
    depth = Math.max(depth, level); values++;
    const char = source[position];
    if (char === '"') return { type: 'string', value: string() };
    if (char === '{' || char === '[') {
      const object = char === '{', end = object ? '}' : ']';
      object ? objects++ : arrays++;
      position++; whitespace();
      const children = [], keys = new Set();
      if (source[position] === end) { position++; return { type: object ? 'object' : 'array', children }; }
      while (position < source.length) {
        let key;
        if (object) {
          if (source[position] !== '"') fail('Tên trường cần nằm trong dấu ngoặc kép.');
          key = string(); whitespace();
          if (source[position++] !== ':') { position--; fail('Thiếu dấu hai chấm sau tên trường.'); }
          if (keys.has(key)) duplicates++;
          keys.add(key);
        }
        children.push(object ? { key, node: value(level + 1) } : value(level + 1));
        whitespace();
        if (source[position] === end) { position++; return { type: object ? 'object' : 'array', children }; }
        if (source[position] !== ',') fail('Thiếu dấu phẩy hoặc dấu ngoặc đóng.');
        position++; whitespace();
        if (source[position] === end) fail('JSON không cho phép dấu phẩy cuối danh sách.');
      }
      fail('Thiếu dấu ngoặc đóng.');
    }
    for (const [literal, type, data] of [['true', 'boolean', true], ['false', 'boolean', false], ['null', 'null', null]]) {
      if (source.startsWith(literal, position)) { position += literal.length; return { type, value: data }; }
    }
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(position));
    if (number) { position += number[0].length; return { type: 'number', value: number[0] }; }
    fail(position >= source.length ? 'Thiếu giá trị JSON.' : 'Giá trị không hợp lệ. Dùng chuỗi, số, true, false, null, đối tượng hoặc danh sách.');
  }
  const node = value(0); whitespace();
  if (position !== source.length) fail('Có ký tự thừa sau giá trị JSON.');
  return { node, stats: { values, objects, arrays, depth, duplicates } };
}
export function formatJSONDocument(node, { indent = '  ', sortKeys = false, escapeUnicode = false, newline = '\n' } = {}) {
  const quote = text => {
    const encoded = JSON.stringify(text);
    return escapeUnicode ? encoded.replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')) : encoded;
  };
  function print(current, level) {
    if (current.type === 'string') return quote(current.value);
    if (current.type === 'number') return current.value;
    if (current.type === 'boolean' || current.type === 'null') return String(current.value);
    const object = current.type === 'object', start = object ? '{' : '[', end = object ? '}' : ']';
    const children = object && sortKeys ? [...current.children].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : current.children;
    if (!children.length) return start + end;
    const parts = children.map(child => (object ? quote(child.key) + ':' + (indent ? ' ' : '') + print(child.node, level + 1) : print(child, level + 1)));
    return indent ? start + newline + parts.map(part => indent.repeat(level + 1) + part).join(',' + newline) + newline + indent.repeat(level) + end : start + parts.join(',') + end;
  }
  return print(node, 0);
}

// Token ranges refer to the original text; highlighting never rewrites JSON data.
export function tokenizeJSON(source) {
  const tokens = [], lines = [0], stack = [];
  let position = 0;
  function add(start, end, type, depth = stack.length) {
    const token = { start, end, type, depth, pair: -1 };
    tokens.push(token); return token;
  }
  while (position < source.length) {
    const char = source[position], start = position;
    if (char === '\n') { lines.push(++position); continue; }
    if (/\s/.test(char)) { position++; continue; }
    if (char === '"') {
      position++;
      let closed = false;
      while (position < source.length) {
        const current = source[position];
        if (current === '\n' || current === '\r') break;
        position++;
        if (current === '\\') {
          // Do not skip a literal newline while recovering from an unfinished string.
          if (position < source.length && source[position] !== '\n' && source[position] !== '\r') position++;
        } else if (current === '"') { closed = true; break; }
      }
      let next = position;
      while (/\s/.test(source[next] || '\0')) next++;
      add(start, position, !closed ? 'invalid' : source[next] === ':' ? 'key' : 'string');
      continue;
    }
    if (char === '{' || char === '[') {
      add(start, ++position, 'bracket'); stack.push(tokens.length - 1); continue;
    }
    if (char === '}' || char === ']') {
      const openIndex = stack.at(-1), open = tokens[openIndex];
      const matched = open && source[open.start] === (char === '}' ? '{' : '[');
      const close = add(start, ++position, matched ? 'bracket' : 'invalid-bracket', matched ? open.depth : stack.length);
      if (matched) { stack.pop(); close.pair = openIndex; open.pair = tokens.length - 1; }
      continue;
    }
    if (char === ':' || char === ',') { add(start, ++position, 'punctuation'); continue; }
    if (char === '-' || /[0-9]/.test(char)) {
      position++;
      while (/[0-9eE+.\-]/.test(source[position] || '\0')) position++;
      const raw = source.slice(start, position);
      add(start, position, /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw) ? 'number' : 'invalid');
      continue;
    }
    while (position < source.length && !/[\s{}\[\],:"]/.test(source[position])) position++;
    if (position === start) position++;
    const raw = source.slice(start, position);
    add(start, position, raw === 'true' || raw === 'false' ? 'boolean' : raw === 'null' ? 'null' : 'invalid');
  }
  for (const index of stack) tokens[index].type = 'invalid-bracket';
  return { tokens, lines };
}
export function findJSONBracketPair(tokens, caret) {
  // A bracket immediately before the caret takes precedence, as in common editors.
  for (const position of [caret - 1, caret]) {
    let low = 0, high = tokens.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1, token = tokens[middle];
      if (position < token.start) high = middle - 1;
      else if (position >= token.end) low = middle + 1;
      else {
        if (token.type === 'bracket' && token.pair >= 0) return [middle, token.pair];
        break;
      }
    }
  }
  return [];
}

export function highlightJSONRange(source, tokens, start, end, active = [], indentSize = 2) {
  const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function plain(text, offset) {
    const parts = []; let cursor = 0;
    const pattern = /(^|\n)([ \t]+)/g;
    for (const match of text.matchAll(pattern)) {
      if (match.index === 0 && !match[1] && offset > 0 && source[offset - 1] !== '\n') continue;
      const from = match.index + match[1].length;
      parts.push(escape(text.slice(cursor, from)));
      const whitespace = match[2]; let depth = 0, index = 0;
      while (index < whitespace.length) {
        const length = whitespace[index] === '\t' ? 1 : Math.min(indentSize, /^ +/.exec(whitespace.slice(index))[0].length);
        parts.push('<span class="json-indent-guide json-depth-' + (depth++ % 6) + '">' + whitespace.slice(index, index + length) + '</span>');
        index += length;
      }
      cursor = from + whitespace.length;
    }
    parts.push(escape(text.slice(cursor))); return parts.join('');
  }
  let low = 0, high = tokens.length;
  while (low < high) { const middle = (low + high) >> 1; if (tokens[middle].end <= start) low = middle + 1; else high = middle; }
  const html = [], selected = new Set(active);
  let cursor = start, painted = 0;
  // Bound DOM complexity for a minified line containing hundreds of thousands of values.
  for (let index = low; index < tokens.length && tokens[index].start < end && painted < 12000; index++, painted++) {
    const token = tokens[index], from = Math.max(start, token.start), to = Math.min(end, token.end);
    if (from > cursor) html.push(plain(source.slice(cursor, from), cursor));
    const bracket = token.type === 'bracket' || token.type === 'invalid-bracket';
    const classes = 'json-token json-token-' + token.type + (bracket ? ' json-depth-' + token.depth % 6 : '') + (selected.has(index) ? ' json-bracket-active' : '');
    html.push('<span class="' + classes + '">' + escape(source.slice(from, to)) + '</span>');
    cursor = to;
  }
  if (cursor < end) html.push(plain(source.slice(cursor, end), cursor));
  return html.join('');
}
