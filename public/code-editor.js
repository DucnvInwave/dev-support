import { tokenizeJSON, findJSONBracketPair, highlightJSONRange } from './json-tools.js';

const escapeHTML = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

// Keep a native textarea for editing/IME/undo and paint only visible lines behind it.
// Layers (back to front): search marks, syntax colours, transparent textarea.
export function createCodeEditor(textarea, { tokenize = tokenizeJSON, marks = () => null, errorLine = () => 0 } = {}) {
  const shell = document.createElement('div'); shell.className = 'json-code';
  const gutter = document.createElement('div'); gutter.className = 'json-line-numbers'; gutter.setAttribute('aria-hidden', 'true');
  const numbers = document.createElement('div'); gutter.append(numbers);
  const viewport = document.createElement('div'); viewport.className = 'json-code-viewport';
  const markLayer = document.createElement('pre'); markLayer.className = 'json-code-paint code-mark-layer'; markLayer.setAttribute('aria-hidden', 'true');
  const markContent = document.createElement('code'); markContent.className = 'json-code-content'; markLayer.append(markContent);
  const paint = document.createElement('pre'); paint.className = 'json-code-paint'; paint.setAttribute('aria-hidden', 'true');
  const content = document.createElement('code'); content.className = 'json-code-content'; paint.append(content);
  textarea.before(shell); shell.append(gutter, viewport); viewport.append(markLayer, paint, textarea);
  textarea.setAttribute('wrap', 'off');
  let source = null, tokens = [], lines = [0], pending = 0, indentSize = 2;
  function renderMarks(start, end) {
    const state = marks();
    if (!state?.ranges?.length) { markContent.textContent = ''; return; }
    const { ranges, active = -1 } = state, html = [];
    let low = 0, high = ranges.length;
    while (low < high) { const middle = (low + high) >> 1; if (ranges[middle][1] <= start) low = middle + 1; else high = middle; }
    let cursor = start;
    for (let index = low; index < ranges.length && ranges[index][0] < end; index++) {
      const from = Math.max(start, ranges[index][0]), to = Math.min(end, ranges[index][1]);
      if (from > cursor) html.push(escapeHTML(source.slice(cursor, from)));
      html.push(`<mark class="code-search-hit${index === active ? ' active' : ''}">${escapeHTML(source.slice(from, to))}</mark>`);
      cursor = to;
    }
    if (cursor < end) html.push(escapeHTML(source.slice(cursor, end)));
    markContent.innerHTML = html.join('');
  }
  function render() {
    pending = 0;
    if (!textarea.clientHeight || !textarea.clientWidth) return;
    const style = getComputedStyle(textarea), lineHeight = parseFloat(style.lineHeight);
    const first = Math.max(0, Math.floor(textarea.scrollTop / lineHeight) - 2);
    const last = Math.min(lines.length, first + Math.ceil(textarea.clientHeight / lineHeight) + 5);
    const start = lines[first] ?? source.length, end = lines[last] ?? source.length;
    const active = document.activeElement === textarea && textarea.selectionStart === textarea.selectionEnd ? findJSONBracketPair(tokens, textarea.selectionStart) : [];
    content.innerHTML = highlightJSONRange(source, tokens, start, end, active, indentSize);
    renderMarks(start, end);
    const transform = 'translate(' + -textarea.scrollLeft + 'px,' + (first * lineHeight - textarea.scrollTop) + 'px)';
    content.style.transform = markContent.style.transform = transform;
    for (const layer of [paint, markLayer]) { layer.style.width = textarea.clientWidth + 'px'; layer.style.height = textarea.clientHeight + 'px'; }
    const bad = errorLine();
    numbers.innerHTML = Array.from({ length: last - first }, (_, index) => first + index + 1).map(line => line === bad ? `<span class="code-error-line">${line}</span>` : line).join('\n');
    numbers.style.transform = 'translateY(' + (first * lineHeight - textarea.scrollTop) + 'px)';
  }
  function schedule() { if (!pending) pending = requestAnimationFrame(render); }
  function refresh() {
    if (source !== textarea.value) {
      source = textarea.value;
      ({ tokens, lines } = tokenize(source));
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
  return {
    shell,
    refresh,
    setTokenizer(next) { tokenize = next; source = null; refresh(); },
    lineStarts: () => lines
  };
}
