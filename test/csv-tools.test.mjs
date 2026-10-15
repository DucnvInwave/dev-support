import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, detectCSVDelimiter, decodeCSVBuffer, buildCSVTable, normalizeCSVSearch } from '../public/csv-tools.js';
const values = (source, options) => parseCSV(source, options).rows.map(row => row.values);

test('reads UTF-8 CSV and keeps leading zeros, long IDs and formula text intact', () => {
  assert.deepEqual(values('\ufeffid,name,value\r\n001,Đường nhảy,9007199254740993123\r\n002,Text,=SUM(A1:A2)\r\n'), [['id','name','value'],['001','Đường nhảy','9007199254740993123'],['002','Text','=SUM(A1:A2)']]);
});
test('reads quoted separators, escaped quotes, empty fields and multiline cells with physical line references', () => {
  const parsed = parseCSV('a,b,c\r\n"hello, world","say ""hi""",\r\n"line 1\r\nline 2",x,y\r\nlast,z,q');
  assert.deepEqual(parsed.rows[1].values, ['hello, world','say "hi"','']);
  assert.equal(parsed.rows[2].values[0], 'line 1\r\nline 2');
  assert.deepEqual(parsed.rows.map(row => row.line), [1,2,3,5]);
});
test('detects popular delimiters while ignoring delimiters inside quoted fields', () => {
  for (const delimiter of [',',';','\t','|']) {
    const text = ['a','b','c'].join(delimiter) + '\n' + ['"hello,;| world"','2','3'].join(delimiter);
    assert.equal(detectCSVDelimiter(text), delimiter);
    assert.equal(parseCSV(text).rows[1].values.length, 3);
  }
  assert.equal(detectCSVDelimiter('single\ncolumn'), ',');
});
test('supports Excel sep directive and lets an explicit delimiter override detection', () => {
  assert.deepEqual(values('sep=;\r\na;b\r\n1;2'), [['a','b'],['1','2']]);
  assert.equal(parseCSV('sep=;\na;b\n1;2').rows[0].line, 2);
  assert.deepEqual(values('a;b\n1;2', { delimiter: ',' }), [['a;b'],['1;2']]);
});
test('skips blank records while retaining explicit empty quoted cells and empty columns', () => {
  assert.deepEqual(values('\n \r\n""\n,\n\n'), [[''],['','']]);
  assert.deepEqual(values('\n\n', { skipEmptyLines: false }), [[''],['']]);
  assert.deepEqual(values(''), []);
  assert.deepEqual(values('a,b,'), [['a','b','']]);
  assert.deepEqual(values('  a , b '), [['  a ',' b ']]);
});
test('reports malformed quoting and enforces size limits without silently truncating', () => {
  assert.throws(() => parseCSV('a,b\n"unterminated'), /Dòng 2/);
  assert.throws(() => parseCSV('a,b\n"a"x,b'), /ký tự thừa/);
  assert.throws(() => parseCSV('a,b\nhel"lo,x'), /ngoặc kép/);
  assert.throws(() => parseCSV('a\nb', { maxRows: 1 }), /giới hạn/);
  assert.throws(() => parseCSV('a,b', { maxColumns: 1 }), /Số cột/);
  assert.throws(() => parseCSV('a,b', { maxCells: 1 }), /giới hạn/);
});
test('preserves uneven rows and handles files with and without headers', () => {
  const parsed = parseCSV('name,score\nA,10\nB\nC,30,extra');
  const model = buildCSVTable(parsed.rows);
  assert.deepEqual(model.headers, ['name','score','Cột 3']);
  assert.equal(model.unevenRows, 2); assert.deepEqual(model.data[2].values, ['C','30','extra']);
  assert.equal(buildCSVTable(parsed.rows, false).data.length, 4);
  assert.deepEqual(buildCSVTable([]), { headers: [], data: [], unevenRows: 0 });
  assert.equal(buildCSVTable(parseCSV('title').rows).data.length, 0);
});
test('decodes UTF-8, UTF-16 BOMs and legacy Windows text without guessing broken UTF-8', () => {
  assert.equal(decodeCSVBuffer(new TextEncoder().encode('Tên,Điểm')).text, 'Tên,Điểm');
  const le = Uint8Array.from([255,254,65,0,44,0,66,0]);
  const be = Uint8Array.from([254,255,0,65,0,44,0,66]);
  assert.equal(decodeCSVBuffer(le).text, 'A,B'); assert.equal(decodeCSVBuffer(be).encoding, 'utf-16be');
  assert.throws(() => decodeCSVBuffer(Uint8Array.from([0xe9])), /encoding/);
  assert.equal(decodeCSVBuffer(Uint8Array.from([0xe9]), 'windows-1252').text, 'é');
});
test('normalizes Vietnamese search and parses a large table', () => {
  assert.equal(normalizeCSVSearch('ĐƯỜNG NhẢy'), 'duong nhay');
  const source = 'id,name\n' + Array.from({length: 20000}, (_, index) => index + ',Level ' + index).join('\n');
  const table = buildCSVTable(parseCSV(source).rows);
  assert.equal(table.data.length, 20000); assert.equal(table.data.at(-1).values[0], '19999');
});
