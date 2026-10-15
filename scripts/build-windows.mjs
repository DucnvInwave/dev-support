import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile, copyFile, stat, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { commandEnvironment } from '../server/tools.mjs';

const exec = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Build on Windows x64 with Node.js 22 or newer.');
if (Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('The packaged runtime requires Node.js 22 or newer.');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version)) throw new Error('Invalid package version.');
const env = commandEnvironment();
const windows = env[Object.keys(env).find(k => k.toLowerCase() === 'systemroot')] || 'C:/Windows';
const csc = path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
await access(csc);
const buildDir = path.join(root, '.build', 'windows', randomUUID());
const staging = path.join(buildDir, 'payload');
const outputDir = path.join(root, 'dist');
await mkdir(staging, { recursive: true });
await mkdir(outputDir, { recursive: true });
const files = [
  'package.json', 'server/index.mjs', 'server/tools.mjs',
  'public/index.html', 'public/styles.css', 'public/app.js',
  'public/json-tools.js', 'public/json-ui.js', 'public/csv-tools.js', 'public/csv-ui.js', 'public/favicon.svg'
];
for (const file of files) {
  const destination = path.join(staging, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, file), destination);
}
await copyFile(process.execPath, path.join(staging, 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
await copyFile(nodeLicense, path.join(staging, 'LICENSE-Node.txt'));
await writeFile(path.join(staging, 'DEVKIT-NOTICE.txt'),
  'Devkit ' + pkg.version + '\r\nContains the unmodified Node.js runtime ' + process.version +
  '. See LICENSE-Node.txt.\r\nADB, Firebase CLI, Android SDK Tools and Java are separate tools.\r\n');

const zip = path.join(buildDir, 'payload.zip');
await exec('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', path.join(root, 'scripts/windows/package-assets.ps1'),
  '-Source', staging, '-Destination', zip, '-IconPath', path.join(buildDir, 'devkit.ico')
], { cwd: root, env, windowsHide: true, maxBuffer: 1024 * 1024 });
const hash = createHash('sha256').update(await readFile(zip)).digest('hex');
const template = await readFile(path.join(root, 'scripts/windows/Launcher.cs'), 'utf8');
const source = template.replaceAll('__PAYLOAD_HASH__', hash).replaceAll('__APP_VERSION__', pkg.version).replaceAll('__ASSEMBLY_VERSION__', pkg.version.split('-')[0] + '.0');
const generated = path.join(buildDir, 'Launcher.cs');
await writeFile(generated, source, 'utf8');
const output = path.join(outputDir, 'Devkit-' + pkg.version + '-win-x64.exe');
const references = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll'];
await exec(csc, [
  '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001',
  '/out:' + output,
  '/win32icon:' + path.join(buildDir, 'devkit.ico'),
  '/win32manifest:' + path.join(root, 'scripts/windows/app.manifest'),
  '/resource:' + zip + ',Devkit.Payload.zip',
  ...references.map(name => '/reference:' + name), generated
], { cwd: root, env, windowsHide: true, maxBuffer: 1024 * 1024 });
const digest = createHash('sha256').update(await readFile(output)).digest('hex');
await writeFile(output + '.sha256', digest + '  ' + path.basename(output) + '\n');
await writeFile(path.join(outputDir, 'README-Windows.txt'), (await readFile(path.join(root, 'scripts/windows/README-Windows.txt'), 'utf8')).replaceAll('__APP_VERSION__', pkg.version));
console.log('Built ' + output);
console.log('Size: ' + ((await stat(output)).size / 1024 / 1024).toFixed(1) + ' MB');
console.log('SHA256: ' + digest);
console.log('Run the exe to open Devkit. No separate Node.js installation is needed.');
