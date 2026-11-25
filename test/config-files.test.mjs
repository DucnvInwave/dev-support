import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configFiles, listConfigFiles, readConfigFile, saveConfigFile, latestBackup, validateConfig, ConfigConflictError } from '../server/config-files.mjs';
import { parseTOML } from '../public/toml-tools.js';

const fail = source => { try { parseTOML(source); return null; } catch (error) { return error; } };

test('TOML parser accepts common Codex config syntax', () => {
  const source = [
    '# Codex config', 'model = "gpt-5"', "model_reasoning_effort = 'high'", 'approval_policy = "on-request"',
    'disable = false', 'timeout = 1_000', 'ratio = 0.5e-3', 'hex = 0xDEAD_beef', 'when = 1979-05-27 07:32:00Z', 'day = 1979-05-27',
    'path = \'C:\\Users\\me\'', 'multi = """', 'line one \\', '   continues"""', 'list = [', '  "a", # note', '  "b",', ']',
    '[projects."d:\\\\dev"]', 'trust_level = "trusted"',
    '[mcp_servers.docs]', 'command = "npx"', 'args = ["-y", "server"]', 'env = { "API_KEY" = "x", nested.deep = 1 }',
    '[[profiles.list]]', 'name = "one"', '[[profiles.list]]', 'name = "two"', '[profiles.list.extra]', 'ok = true',
    '[fruit]', 'apple.color = "red"', '[fruit.apple.texture]', 'smooth = true'
  ].join('\r\n');
  const { value } = parseTOML(source);
  assert.equal(value.model, 'gpt-5');
  assert.equal(value.timeout, 1000);
  assert.equal(value.hex, 0xdeadbeef);
  assert.equal(value.path, 'C:\\Users\\me');
  assert.equal(value.multi, 'line one continues');
  assert.deepEqual(value.list, ['a', 'b']);
  assert.equal(value.projects['d:\\dev'].trust_level, 'trusted');
  assert.equal(value.mcp_servers.docs.env.nested.deep, 1);
  assert.equal(value.profiles.list.length, 2);
  assert.equal(value.profiles.list[1].extra.ok, true);
  assert.equal(value.fruit.apple.texture.smooth, true);
});

test('TOML parser reports common mistakes with line and column', () => {
  const cases = [
    ['model = gpt-5', 1, 9, /dấu ngoặc kép/],
    ['a = 1\nb = True', 2, 5, /true\/false/],
    ['a = 1\na = 2', 2, 1, /trùng/],
    ['[a]\nx = 1\n[a]', 3, 1, /trùng/],
    ['p = "C:\\Users"', 1, 8, /Escape/],
    ['s = "abc', 1, 5, /đóng/],
    ['t = { a = 1, }', 1, 14, /phẩy thừa/],
    ['t = { a = 1,\n b = 2 }', 1, 5, /một dòng/],
    ['list = [1 2]', 1, 11, /dấu phẩy/],
    ['[x] y = 1', 1, 5, /tiêu đề bảng/],
    ['key value', 1, 5, /=/],
    ['e = { a = 1 }\n[e.b]', 2, 1, /đã là một giá trị/],
    ['a.b = 1\n[a.b]', 2, 1, /trùng/],
    ['d = 2023-02-30', 1, 5, /ngày giờ/]
  ];
  for (const [source, line, column, message] of cases) {
    const error = fail(source);
    assert.ok(error, `expected an error for ${JSON.stringify(source)}`);
    assert.deepEqual([error.line, error.column], [line, column], `${JSON.stringify(source)}: ${error.message}`);
    assert.match(error.message, message);
  }
});

test('config paths follow the current user home and CLI overrides on Windows and macOS', () => {
  const win = configFiles({ home: 'C:\\Users\\alice', env: {} });
  assert.deepEqual(win.map(file => file.path), [
    path.join('C:\\Users\\alice', '.claude.json'), path.join('C:\\Users\\alice', '.claude', 'settings.json'),
    path.join('C:\\Users\\alice', '.codex', 'config.toml'), path.join('C:\\Users\\alice', '.codex', 'auth.json')
  ]);
  const mac = configFiles({ home: '/Users/bob', env: {} });
  assert.equal(mac[0].path, path.join('/Users/bob', '.claude.json'));
  assert.equal(mac[2].path, path.join('/Users/bob', '.codex', 'config.toml'));
  const custom = configFiles({ home: '/Users/bob', env: { CLAUDE_CONFIG_DIR: '/cfg/claude', CODEX_HOME: '/cfg/codex' } });
  assert.equal(custom[0].path, path.resolve('/cfg/claude', '.claude.json'));
  assert.equal(custom[1].path, path.resolve('/cfg/claude', 'settings.json'));
  assert.equal(custom[3].path, path.resolve('/cfg/codex', 'auth.json'));
});

test('validateConfig flags invalid JSON and TOML', () => {
  assert.equal(validateConfig('json', '{"a":1,}').ok, false);
  assert.equal(validateConfig('json', '{"a":1}').ok, true);
  assert.match(validateConfig('json', '{"a":1,"a":2}').warnings[0], /trùng/);
  assert.equal(validateConfig('toml', '').ok, true);
  assert.deepEqual(validateConfig('toml', 'x = yes').error.line, 1);
});

test('reads, validates, backs up and saves config files without clobbering external changes', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'devkit-config-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const home = path.join(temp, 'home'), backupDir = path.join(temp, 'backups'), options = { home, env: {} };
  await mkdir(path.join(home, '.codex'), { recursive: true });
  await writeFile(path.join(home, '.codex', 'config.toml'), '\ufeffmodel = "gpt-5"\n');

  const list = await listConfigFiles(options);
  assert.deepEqual(list.map(file => [file.id, file.exists]), [['claude-json', false], ['claude-settings', false], ['codex-config', true], ['codex-auth', false]]);
  const file = await readConfigFile('codex-config', options);
  assert.equal(file.content, 'model = "gpt-5"\n', 'BOM is stripped');
  await assert.rejects(readConfigFile('../../etc/passwd', options), /không hợp lệ/);

  await assert.rejects(saveConfigFile({ id: 'codex-config', content: 'model = gpt', expectedMtimeMs: file.mtimeMs }, { ...options, backupDir }), /Sai định dạng TOML \(dòng 1, cột 9\)/);
  assert.equal(await readFile(file.path, 'utf8'), '\ufeffmodel = "gpt-5"\n', 'invalid content is never written');

  const saved = await saveConfigFile({ id: 'codex-config', content: 'model = "Tiếng Việt"\n', expectedMtimeMs: file.mtimeMs }, { ...options, backupDir });
  assert.equal(await readFile(file.path, 'utf8'), 'model = "Tiếng Việt"\n');
  assert.equal((await latestBackup('codex-config', { ...options, backupDir })).content, '\ufeffmodel = "gpt-5"\n');
  assert.deepEqual((await readdir(path.dirname(file.path))).sort(), ['config.toml'], 'temp files are cleaned up');

  await utimes(file.path, new Date(), new Date(Date.now() + 5000));
  await assert.rejects(saveConfigFile({ id: 'codex-config', content: 'model = "o3"\n', expectedMtimeMs: saved.mtimeMs }, { ...options, backupDir }), ConfigConflictError);
  await saveConfigFile({ id: 'codex-config', content: 'model = "o3"\n', expectedMtimeMs: saved.mtimeMs, force: true }, { ...options, backupDir });
  assert.equal(await readFile(file.path, 'utf8'), 'model = "o3"\n');

  const created = await saveConfigFile({ id: 'claude-settings', content: '{\n  "model": "opus"\n}\n', expectedMtimeMs: null }, { ...options, backupDir });
  assert.equal(created.exists, true);
  assert.equal(created.backup, null);
  assert.equal(await readFile(path.join(home, '.claude', 'settings.json'), 'utf8'), '{\n  "model": "opus"\n}\n');
  await assert.rejects(latestBackup('claude-settings', { ...options, backupDir }), /Chưa có bản sao lưu/);

  for (let i = 0; i < 12; i++) {
    const current = await readConfigFile('codex-config', options);
    await saveConfigFile({ id: 'codex-config', content: `n = ${i}\n`, expectedMtimeMs: current.mtimeMs }, { ...options, backupDir });
  }
  assert.equal((await readdir(path.join(backupDir, 'codex-config'))).length, 10, 'only the latest backups are kept');
});

test('TOML tokenizer colours tables, keys, values, comments and paired brackets', async () => {
  const { tokenizeTOML } = await import('../public/toml-tools.js');
  const source = '# top\n[mcp_servers.docs]\ncommand = "npx" # run\nargs = ["-y", [1, 2]]\nenv = { "A" = true, b.c = 1979-05-27 07:32:00Z }\ntext = """\nmulti\n"""\nbad = nope\n[[list]]\n';
  const { tokens, lines } = tokenizeTOML(source);
  const typeOf = text => tokens.find(token => source.slice(token.start, token.end) === text)?.type;
  assert.equal(typeOf('# top'), 'comment');
  assert.equal(typeOf('# run'), 'comment');
  assert.equal(typeOf('mcp_servers.docs'), 'table');
  assert.equal(typeOf('list'), 'table');
  assert.equal(typeOf('command'), 'key');
  assert.equal(typeOf('"npx"'), 'string');
  assert.equal(typeOf('"A"'), 'key');
  assert.equal(typeOf('b'), 'key');
  assert.equal(typeOf('true'), 'boolean');
  assert.equal(typeOf('1979-05-27 07:32:00Z'), 'datetime');
  assert.equal(typeOf('2'), 'number');
  assert.equal(typeOf('"""\nmulti\n"""'), 'string');
  assert.equal(typeOf('nope'), 'invalid');
  assert.equal(lines.length, source.split('\n').length);
  const brackets = tokens.filter(token => token.type === 'bracket' && source[token.start] === '[' && token.start > source.indexOf('args'));
  assert.equal(brackets[1].depth, 1, 'nested array bracket is one level deeper');
  for (const token of tokens.filter(token => token.type === 'bracket')) assert.ok(token.pair >= 0, `bracket at ${token.start} is paired`);
  for (let i = 1; i < tokens.length; i++) assert.ok(tokens[i].start >= tokens[i - 1].end, 'tokens are ordered and non-overlapping');
  assert.ok(tokenizeTOML('a = [1, 2').tokens.some(token => token.type === 'invalid-bracket'), 'unclosed bracket is flagged');
});

test('findMatches returns case-(in)sensitive ranges with special characters escaped', async () => {
  const { findMatches } = await import('../public/config-ui.js');
  const text = 'Model = "a.b"\nmodel = "A.B"\n[model]';
  assert.deepEqual(findMatches(text, 'model'), [[0, 5], [14, 19], [29, 34]]);
  assert.deepEqual(findMatches(text, 'model', true), [[14, 19], [29, 34]]);
  assert.deepEqual(findMatches(text, 'a.b'), [[9, 12], [23, 26]]);
  assert.deepEqual(findMatches(text, '[model]'), [[28, 35]]);
  assert.deepEqual(findMatches(text, ''), []);
  assert.equal(findMatches('x'.repeat(50), 'x', false, 10).length, 10);
});
