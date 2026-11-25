import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, stat, readdir, copyFile } from 'node:fs/promises';
import { parseJSONDocument } from '../public/json-tools.js';
import { parseTOML } from '../public/toml-tools.js';

export const MAX_CONFIG_BYTES = 5 * 1024 * 1024;
const BACKUPS_KEPT = 10;

// Paths are resolved per machine from the current user's home directory, so the
// same build works for any account on Windows and macOS. CLAUDE_CONFIG_DIR and
// CODEX_HOME are honoured the same way the CLIs honour them.
export function configFiles({ env = process.env, home = os.homedir() } = {}) {
  const claudeDir = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
  const codexDir = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex');
  return [
    { id: 'claude-json', group: 'Claude', name: '.claude.json', format: 'json', description: 'Trạng thái, MCP servers và cấu hình theo từng project của Claude Code.', path: env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, '.claude.json') : path.join(home, '.claude.json') },
    { id: 'claude-settings', group: 'Claude', name: 'settings.json', format: 'json', description: 'Cài đặt người dùng: model, permissions, hooks, env, statusLine…', path: path.join(claudeDir, 'settings.json') },
    { id: 'codex-config', group: 'Codex', name: 'config.toml', format: 'toml', description: 'Cấu hình Codex CLI: model, provider, sandbox, MCP servers…', path: path.join(codexDir, 'config.toml') },
    { id: 'codex-auth', group: 'Codex', name: 'auth.json', format: 'json', sensitive: true, description: 'Thông tin đăng nhập Codex (API key / token). Không chia sẻ nội dung file này.', path: path.join(codexDir, 'auth.json') }
  ];
}

export function validateConfig(format, content) {
  if (typeof content !== 'string') return { ok: false, error: { message: 'Nội dung không hợp lệ.' } };
  if (Buffer.byteLength(content) > MAX_CONFIG_BYTES) return { ok: false, error: { message: 'File vượt quá giới hạn 5 MB.' } };
  try {
    if (format === 'json') {
      const result = parseJSONDocument(content);
      const warnings = result.stats.duplicates ? [`Có ${result.stats.duplicates} khóa bị trùng; chỉ giá trị cuối cùng được dùng.`] : [];
      if (result.node.type !== 'object') warnings.push('Nội dung gốc nên là một object { ... }.');
      return { ok: true, warnings };
    }
    parseTOML(content);
    return { ok: true, warnings: [] };
  } catch (error) {
    return { ok: false, error: { message: error.message, line: error.line, column: error.column } };
  }
}

const describe = async file => {
  try { const info = await stat(file.path); return { ...file, exists: info.isFile(), size: info.size, mtimeMs: info.mtimeMs }; }
  catch { return { ...file, exists: false, size: 0, mtimeMs: null }; }
};
export const listConfigFiles = options => Promise.all(configFiles(options).map(describe));
function findFile(id, options) {
  const file = configFiles(options).find(item => item.id === id);
  if (!file) throw new Error('File cấu hình không hợp lệ.');
  return file;
}

export async function readConfigFile(id, options) {
  const file = await describe(findFile(id, options));
  if (!file.exists) return { ...file, content: '' };
  if (file.size > MAX_CONFIG_BYTES) throw new Error('File vượt quá giới hạn 5 MB, không thể mở trong Devkit.');
  let content = await readFile(file.path, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  return { ...file, content };
}

export class ConfigConflictError extends Error {}

export async function saveConfigFile({ id, content, expectedMtimeMs, force = false }, { backupDir, ...options }) {
  const file = await describe(findFile(id, options));
  const check = validateConfig(file.format, content);
  if (!check.ok) {
    const where = check.error.line ? ` (dòng ${check.error.line}, cột ${check.error.column})` : '';
    throw new Error(`Sai định dạng ${file.format.toUpperCase()}${where}: ${check.error.message} File chưa được lưu.`);
  }
  // Claude Code and Codex rewrite these files while running; never silently
  // overwrite a newer version than the one shown in the editor.
  if (!force && (file.mtimeMs ?? null) !== (expectedMtimeMs ?? null)) {
    throw new ConfigConflictError(file.exists ? 'File đã bị thay đổi bên ngoài (có thể do Claude/Codex đang chạy) sau khi bạn mở. Tải lại để xem bản mới, hoặc chọn ghi đè.' : 'File đã bị xóa bên ngoài sau khi bạn mở.');
  }
  let backup = null, mode;
  if (file.exists) {
    mode = (await stat(file.path)).mode & 0o777;
    const folder = path.join(backupDir, id);
    await mkdir(folder, { recursive: true });
    backup = path.join(folder, `${new Date().toISOString().replace(/[:.]/g, '-')}-${file.name.replace(/^\./, '')}`);
    await copyFile(file.path, backup);
    const old = (await readdir(folder)).sort().reverse().slice(BACKUPS_KEPT);
    await Promise.all(old.map(name => rm(path.join(folder, name), { force: true })));
  }
  await mkdir(path.dirname(file.path), { recursive: true });
  const temp = path.join(path.dirname(file.path), `.${path.basename(file.path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temp, content, { encoding: 'utf8', mode: mode ?? (file.sensitive ? 0o600 : 0o644), flag: 'wx' });
    try { await rename(temp, file.path); }
    catch (error) {
      // Windows refuses to replace a file another process holds open; fall back to an in-place write.
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      await writeFile(file.path, content, 'utf8');
    }
  } finally { await rm(temp, { force: true }); }
  return { ...(await describe(file)), backup, warnings: check.warnings };
}

export async function latestBackup(id, { backupDir, ...options }) {
  findFile(id, options);
  const folder = path.join(backupDir, id);
  const names = await readdir(folder).catch(() => []);
  const name = names.sort().at(-1);
  if (!name) throw new Error('Chưa có bản sao lưu nào cho file này. Bản sao lưu được tạo mỗi lần bạn lưu trong Devkit.');
  return { name, content: await readFile(path.join(folder, name), 'utf8') };
}
