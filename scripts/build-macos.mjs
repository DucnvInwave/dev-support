import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile, chmod, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) throw new Error('Build on macOS using a native arm64 or x64 Node.js runtime.');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Build with Node.js 22 or newer.');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(pkg.version)) throw new Error('Invalid version.');
const output = path.join(root, 'dist');
const build = path.join(root, '.build', 'macos', randomUUID());
const release = path.join(build, 'download');
const app = path.join(release, 'Devkit.app');
const contents = path.join(app, 'Contents');
const resources = path.join(contents, 'Resources');
const payload = path.join(resources, 'app');
const runtime = path.join(resources, 'runtime');
await Promise.all([mkdir(path.join(contents, 'MacOS'), { recursive: true }), mkdir(runtime, { recursive: true }), mkdir(output, { recursive: true })]);
// Explicit allowlist: no local settings, credentials, symbols or npm modules.
const files = ['package.json', 'server/index.mjs', 'server/tools.mjs', 'public/index.html', 'public/styles.css', 'public/app.js', 'public/json-tools.js', 'public/json-ui.js', 'public/csv-tools.js', 'public/csv-ui.js', 'public/favicon.svg'];
for (const file of files) {
  const destination = path.join(payload, file); await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, file), destination);
}
await copyFile(path.join(root, 'scripts/macos/desktop.mjs'), path.join(payload, 'desktop.mjs'));
const node = path.join(runtime, 'node');
await copyFile(process.execPath, node); await chmod(node, 0o755);
const licenseCandidates = [path.join(path.dirname(process.execPath), 'LICENSE'), path.resolve(process.execPath, '../../LICENSE'), path.resolve(process.execPath, '../../share/doc/node/LICENSE')];
let license;
for (const candidate of licenseCandidates) { try { await access(candidate); license = candidate; break; } catch {} }
if (!license) throw new Error('Node LICENSE not found beside this Node installation. Use the official Node.js distribution (actions/setup-node).');
await copyFile(license, path.join(runtime, 'LICENSE-Node.txt'));
await writeFile(path.join(resources, 'DEVKIT-NOTICE.txt'), 'Devkit ' + pkg.version + '\nBundled Node.js ' + process.version + '. See runtime/LICENSE-Node.txt.\nADB, Firebase CLI, legacy Android SDK Tools and Java are separate tools.\n');
const plist = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n' +
  '<key>CFBundleIdentifier</key><string>local.devkit.desktop</string>\n<key>CFBundleName</key><string>Devkit</string>\n<key>CFBundleDisplayName</key><string>Devkit</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleExecutable</key><string>Devkit</string>\n<key>CFBundleShortVersionString</key><string>' + pkg.version + '</string>\n<key>CFBundleVersion</key><string>' + pkg.version + '</string>\n<key>LSMinimumSystemVersion</key><string>13.0</string>\n<key>NSHighResolutionCapable</key><true/>\n</dict></plist>\n';
await writeFile(path.join(contents, 'Info.plist'), plist);
const generated = path.join(build, 'main.swift');
await writeFile(generated, (await readFile(path.join(root, 'scripts/macos/Launcher.swift'), 'utf8')).replaceAll('__APP_VERSION__', pkg.version));
const architecture = process.arch === 'x64' ? 'x86_64' : 'arm64';
await exec('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', architecture + '-apple-macosx13.0', '-framework', 'Cocoa', generated, '-o', path.join(contents, 'MacOS/Devkit')], { maxBuffer: 4 * 1024 * 1024 });
await exec('/usr/bin/plutil', ['-lint', path.join(contents, 'Info.plist')]);
// Ad-hoc signing makes the bundle valid locally; distribution notarization is separate.
await exec('/usr/bin/codesign', ['--force', '--sign', '-', node]);
await exec('/usr/bin/codesign', ['--force', '--sign', '-', app]);
await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
await writeFile(path.join(release, 'README-macOS.txt'), (await readFile(path.join(root, 'scripts/macos/README-macOS.txt'), 'utf8')).replaceAll('__APP_VERSION__', pkg.version).replaceAll('__ARCH__', process.arch));
const zip = path.join(output, 'Devkit-' + pkg.version + '-macos-' + process.arch + '.zip');
await exec('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', release, zip]);
await writeFile(zip + '.sha256', createHash('sha256').update(await readFile(zip)).digest('hex') + '  ' + path.basename(zip) + '\n');
console.log('Built ' + zip + '\nExtract ZIP, move Devkit.app to Applications, then open it.');
