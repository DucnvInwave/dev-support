import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeJSON, findJSONBracketPair, highlightJSONRange } from '../public/json-tools.js';

test('colors keys, strings, numbers, booleans and null without changing their ranges', () => {
  const source = '{"game":"Dancing Road","id":9007199254740993123,"active":true,"note":null}';
  const { tokens } = tokenizeJSON(source);
  const values = type => tokens.filter(t => t.type === type).map(t => source.slice(t.start, t.end));
  assert.deepEqual(values('key'), ['"game"', '"id"', '"active"', '"note"']);
  assert.deepEqual(values('number'), ['9007199254740993123']);
  assert.deepEqual(values('boolean'), ['true']); assert.deepEqual(values('null'), ['null']);
  assert.deepEqual(values('string'), ['"Dancing Road"']);
});
test('matches bracket types at each level and ignores escaped quotes and brackets inside strings', () => {
  const source = '{"items":[{"text":"[ \\\" }"}]}';
  const { tokens } = tokenizeJSON(source);
  const brackets = tokens.filter(t => t.type === 'bracket');
  assert.deepEqual(brackets.map(t => t.depth), [0, 1, 2, 2, 1, 0]);
  for (const token of brackets) {
    assert.equal(tokens[token.pair].pair, tokens.indexOf(token));
    assert.deepEqual(findJSONBracketPair(tokens, token.start + 1), [tokens.indexOf(token), token.pair]);
  }
  assert.deepEqual(findJSONBracketPair(tokens, source.indexOf('text') + 2), []);
});
test('recovers incomplete JSON, flags unpaired brackets and counts empty and final lines', () => {
  const source = '{\n  "name": "unfinished\n  "x": 1\n';
  const { tokens, lines } = tokenizeJSON(source);
  assert.equal(lines.length, 4);
  assert.equal(tokens[0].type, 'invalid-bracket');
  assert.ok(tokens.some(t => t.type === 'invalid'));
  assert.ok(tokens.some(t => t.type === 'key' && source.slice(t.start, t.end) === '"x"'));
  assert.equal(tokenizeJSON('[}').tokens[1].type, 'invalid-bracket');
});
test('HTML highlight safely encodes user text and preserves Unicode, whitespace and original data', () => {
  const source = '{\n  "text": "<img src=x onerror=alert(1)> & \\" 🎵",\n  "list": [true, false]\n}';
  const { tokens } = tokenizeJSON(source);
  const html = highlightJSONRange(source, tokens, 0, source.length);
  assert.doesNotMatch(html, /<img|onerror="/);
  assert.match(html, /&lt;img/); assert.match(html, /json-indent-guide/);
  const decoded = html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[entity]));
  assert.equal(decoded, source);
});
test('renders a scrolled range with matching-bracket decoration and bounds DOM size on minified data', () => {
  const source = '{\n  "a": [1, 2]\n}';
  const { tokens, lines } = tokenizeJSON(source);
  const pair = findJSONBracketPair(tokens, source.indexOf('['));
  const html = highlightJSONRange(source, tokens, lines[1], lines[2], pair);
  assert.equal((html.match(/json-bracket-active/g) || []).length, 2);
  assert.doesNotMatch(html, /&lt;|undefined/);
  const large = '[' + '0,'.repeat(20000) + '0]';
  const painted = highlightJSONRange(large, tokenizeJSON(large).tokens, 0, large.length);
  assert.ok((painted.match(/json-token /g) || []).length <= 12000);
  assert.equal(painted.replace(/<[^>]*>/g, ''), large);
});
