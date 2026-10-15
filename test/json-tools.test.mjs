import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJSONDocument, formatJSONDocument, editJSONDocument } from '../public/json-tools.js';
const format = (source, options) => formatJSONDocument(parseJSONDocument(source).node, options);

test('formats nested objects, arrays and primitive roots with common indentation', () => {
  const source = '{"z":[true,null,{"name":"Dancing Road"}],"a":{}}';
  for (const indent of ['  ', '    ', '\t', '']) {
    const result = format(source, { indent });
    assert.deepEqual(JSON.parse(result), JSON.parse(source));
    if (indent) assert.ok(result.includes('\n' + indent + '"z"'));
    else assert.equal(result, source);
  }
  for (const source of ['false', 'null', '123', '"hello"', '[]', '{}']) assert.equal(format(source), source);
});
test('preserves long numbers, numeric spelling, duplicate keys and special property names', () => {
  const source = '{"id":9007199254740993123,"tiny":1.2000e-30,"zero":-0,"a":1,"a":2,"__proto__":{"safe":true},"10":10,"2":2}';
  assert.equal(format(source, { indent: '' }), source);
  assert.equal(parseJSONDocument(source).stats.duplicates, 1);
});
test('sorts names at all levels without changing array order', () => {
  assert.equal(format('{"z":[{"z":1,"a":2},3,2,1],"a":0}', { indent: '', sortKeys: true }), '{"a":0,"z":[{"a":2,"z":1},3,2,1]}');
});
test('escapes Unicode including emoji and uses Windows newlines', () => {
  const source = '{"tên":"Việt 🎵\\n","x":"\\u0000\\\"\\\\"}';
  const result = format(source, { escapeUnicode: true, newline: '\r\n' });
  assert.equal(/[^\x00-\x7f]/.test(result), false);
  assert.equal(/(?<!\r)\n/.test(result), false);
  assert.deepEqual(JSON.parse(result), JSON.parse(source));
});
test('accepts UTF-8 BOM and reports a useful error location', () => {
  assert.equal(format('\ufeff{"a":1}', { indent: '' }), '{"a":1}');
  assert.throws(() => parseJSONDocument('{\n  "a": 1,\n}'), error => error.line === 3 && error.column === 1);
});
test('rejects malformed JSON, comments, invalid strings and extra content', () => {
  for (const source of ['', '{', '[1,]', '{"a":}', "{'a':1}", '{"a" 1}', '01', '1.', 'NaN', 'undefined', '{}{}', 'true false', '// comment\n{}', '"a\nb"', '"\\q"', '"\\u001"']) {
    assert.throws(() => parseJSONDocument(source), SyntaxError, source);
  }
});
test('limits nesting and handles large flat lists without changing the data', () => {
  assert.throws(() => parseJSONDocument('['.repeat(130) + '0' + ']'.repeat(130)), /128/);
  const source = JSON.stringify(Array.from({ length: 10000 }, (_, i) => ({ id: i, active: i % 2 === 0 })));
  assert.equal(format(source, { indent: '' }), source);
});

test('edits a duplicate member by position while preserving large numbers and special keys', () => {
  const source = '{"id":9007199254740993123,"a":1,"a":2,"__proto__":{"safe":true}}';
  assert.equal(editJSONDocument(source, [2], '9007199254740993999', 'a', { indent: '' }), '{"id":9007199254740993123,"a":1,"a":9007199254740993999,"__proto__":{"safe":true}}');
  assert.equal(editJSONDocument(source, [3, 0], 'false', undefined, { indent: '' }), '{"id":9007199254740993123,"a":1,"a":2,"__proto__":{"safe":false}}');
  const renamed = editJSONDocument(source, [1], '"Tiếng Việt"', 'new"key', { indent: '' });
  assert.equal(parseJSONDocument(renamed).node.children[1].key, 'new"key');
  assert.equal(parseJSONDocument(renamed).node.children[1].node.value, 'Tiếng Việt');
});
test('edits nested arrays, containers and root values without changing sibling order', () => {
  const source = '{"items":[{"x":1},2,3],"other":1.2000e-30}';
  assert.equal(editJSONDocument(source, [0, 0], '{"nested":[false,null]}', undefined, { indent: '' }), '{"items":[{"nested":[false,null]},2,3],"other":1.2000e-30}');
  assert.equal(editJSONDocument(source, [], 'false'), 'false');
  assert.equal(editJSONDocument(source, [0, 1], '""', undefined, { indent: '' }), '{"items":[{"x":1},"",3],"other":1.2000e-30}');
  assert.equal(editJSONDocument('{"z":0,"a":1}', [0], 'true', undefined, { sortKeys: true, indent: '' }), '{"a":1,"z":true}');
});
test('rejects invalid edits and excessive combined depth without changing the source', () => {
  const source = '{"items":[1,2]}';
  for (const path of [[2], [0, 9], [-1], [0.5], [0, 0, 0]]) assert.throws(() => editJSONDocument(source, path, 'null'));
  assert.throws(() => editJSONDocument(source, [0], '{broken}'), SyntaxError);
  assert.throws(() => editJSONDocument(source, [0], '['.repeat(128) + '0' + ']'.repeat(128)), /128/);
  assert.equal(source, '{"items":[1,2]}');
});
