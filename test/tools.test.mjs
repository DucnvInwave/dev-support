import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validPackage, validSerial, validAppId, debugArgs, parseDevices, execute, firebaseInvocation, validateZip, commandEnvironment, sdkCandidates, inspectJava } from '../server/tools.mjs';

test('Windows commands receive required environment defaults without changing configured values', () => {
  const source = { SystemRoot: 'D:\\Windows', USERPROFILE: 'C:\\Users\\test', APPDATA: 'D:\\custom-profile' };
  const result = commandEnvironment(source, 'win32');
  assert.equal(result.SystemDrive, 'D:');
  assert.equal(result.ComSpec, 'D:\\Windows\\System32\\cmd.exe');
  assert.equal(result.ProgramData, 'D:\\ProgramData');
  assert.equal(result.ALLUSERSPROFILE, 'D:\\ProgramData');
  assert.equal(result.APPDATA, 'D:\\custom-profile');
  assert.equal(result.LOCALAPPDATA, 'C:\\Users\\test\\AppData\\Local');
  assert.equal(source.SystemDrive, undefined);
  assert.deepEqual(commandEnvironment(source, 'linux'), source);
});

test('debug enables the exact package on the selected device', () => {
  assert.deepEqual(debugArgs('192.168.1.20:5555', 'com.company.game', true), ['-s', '192.168.1.20:5555', 'shell', 'setprop', 'debug.firebase.analytics.app', 'com.company.game']);
});
test('debug disables with .none. and does not require a package', () => {
  assert.deepEqual(debugArgs('phone-123', undefined, false), ['-s', 'phone-123', 'shell', 'setprop', 'debug.firebase.analytics.app', '.none.']);
});
test('command parameters reject shell syntax, whitespace and option injection', () => {
  for (const value of ['com.game;whoami', 'com.game && exit', 'com.game\nexit', 'com.game$(whoami)', '.none.', 'onepart']) assert.equal(validPackage(value), false, value);
  for (const value of ['-s another', ';whoami', 'device\nexit', '']) assert.equal(validSerial(value), false, value);
  assert.throws(() => debugArgs('a;cmd', 'com.company.game', true));
  assert.throws(() => debugArgs('phone', 'com.game;cmd', true));
  assert.equal(validPackage('com.Company.game_2'), true);
});
test('only Android Firebase App IDs are accepted', () => {
  assert.equal(validAppId('1:528923424982:android:46195f809d709f94'), true);
  for (const value of ['--help', '1:123:ios:abc', '1:123:android:abc --help', '']) assert.equal(validAppId(value), false);
});
test('ADB device discovery distinguishes authorized, unauthorized and offline devices', () => {
  const result = parseDevices('* daemon started successfully\r\nList of devices attached\r\nphone123 device product:test model:Pixel_8 device:husky transport_id:1\r\nphone456 unauthorized transport_id:2\r\n192.168.0.1:5555 offline\r\n');
  assert.deepEqual(result, [
    { serial: 'phone123', state: 'device', model: 'Pixel 8' },
    { serial: 'phone456', state: 'unauthorized', model: 'phone456' },
    { serial: '192.168.0.1:5555', state: 'offline', model: '192.168.0.1:5555' }
  ]);
});
test('process runner captures stdout and stderr and preserves failure exit codes', async () => {
  let streamed = '';
  const result = await execute(process.execPath, ['-e', 'process.stdout.write("stdout\\n");process.stderr.write("stderr\\n");process.exitCode=7'], { onOutput: text => { streamed += text; } });
  assert.equal(result.code, 7); assert.match(result.output, /stdout/); assert.match(result.output, /stderr/); assert.equal(streamed, result.output);
});
test('process runner preserves spaces and shell characters as literal arguments', async () => {
  const value = 'C:/folder with spaces/symbols & build.zip';
  const result = await execute(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', value]);
  assert.equal(result.output, value); assert.equal(result.code, 0);
});
test('streamed Vietnamese output preserves UTF-8 characters across chunk boundaries', async () => {
  const value = 'Đã mở Android Monitor.';
  const result = await execute(process.execPath, ['-e', `const bytes=Buffer.from(${JSON.stringify(value)});let i=0;const timer=setInterval(()=>{if(i<bytes.length)process.stdout.write(bytes.subarray(i,++i));else clearInterval(timer)},2)`]);
  assert.equal(result.output, value);
});
test('process runner reports a missing executable', async () => {
  await assert.rejects(execute('devkit-definitely-nonexistent-executable', []), /ENOENT/);
});
test('process runner terminates commands exceeding their timeout', async () => {
  await assert.rejects(execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 100 }), /thời gian chờ/);
});
test('symbols CLI keeps paths with spaces as a single argument', async () => {
  const cli = await firebaseInvocation('/firebase.js', '1:123:android:abc', 'C:/build symbols/symbols.zip');
  assert.equal(cli.file, process.execPath);
  assert.deepEqual(cli.args, ['/firebase.js', 'crashlytics:symbols:upload', '--app=1:123:android:abc', 'C:/build symbols/symbols.zip', '--non-interactive', '--debug']);
  await assert.rejects(firebaseInvocation('/firebase.js', 'bad-app', 'x.zip'), /không hợp lệ/);
});
test('ZIP validation rejects renamed files, empty files and invalid ZIP signatures', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'devkit-zip-test-'));
  try {
    for (const [name, data, valid] of [['valid.zip', Buffer.from('504b03040000', 'hex'), true], ['empty-archive.zip', Buffer.from('504b05060000', 'hex'), true], ['renamed.zip', Buffer.from('plain text'), false], ['empty.zip', Buffer.alloc(0), false], ['bad-signature.zip', Buffer.from('504b03060000', 'hex'), false]]) {
      const file = path.join(dir, name); await writeFile(file, data);
      if (valid) await validateZip(file); else await assert.rejects(validateZip(file));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('macOS SDK discovery includes Android Studio defaults and respects explicit SDK paths', () => {
  assert.deepEqual(sdkCandidates({}, {}, 'darwin', '/Users/test'), ['/Users/test/Library/Android/sdk']);
  assert.deepEqual(sdkCandidates({ sdkRoot: '/custom/sdk' }, { ANDROID_HOME: '/env/sdk', ANDROID_SDK_ROOT: '/env/sdk' }, 'darwin', '/Users/test'), ['/custom/sdk', '/env/sdk', '/Users/test/Library/Android/sdk']);
  assert.deepEqual(sdkCandidates({}, { LOCALAPPDATA: 'C:/Users/test/AppData/Local' }, 'win32', ''), [path.win32.join('C:/Users/test/AppData/Local', 'Android', 'Sdk')]);
});
test('extensionless Firebase Node scripts use bundled Node without Node on PATH', { skip: process.platform === 'win32' }, async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'firebase mac fixture '));
  try {
    const file = path.join(temp, 'firebase');
    await writeFile(file, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));');
    const invocation = await firebaseInvocation(file, '1:123:android:abc', '/build with spaces/symbols.zip');
    assert.equal(invocation.file, process.execPath);
    assert.equal(invocation.args[0], await realpath(file));
    const result = await execute(invocation.file, invocation.args, { env: { ...process.env, PATH: '/usr/bin:/bin' } });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.output), ['crashlytics:symbols:upload', '--app=1:123:android:abc', '/build with spaces/symbols.zip', '--non-interactive', '--debug']);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('Java preflight reports missing Java and preserves Java stderr', async () => {
 const missing=await inspectJava({env:{PATH:''},run:async()=>{throw Object.assign(new Error('spawn java ENOENT'),{code:'ENOENT'})}});
 assert.equal(missing.ready,false);assert.match(missing.message,/Chưa tìm thấy Java/);assert.match(missing.message,/JDK 17/);
 const broken=await inspectJava({env:{PATH:''},run:async()=>({code:1,output:'UnsupportedClassVersionError: Java is too old'})});
 assert.equal(broken.ready,false);assert.match(broken.message,/UnsupportedClassVersionError/);
 const installed=await inspectJava({env:{PATH:''},run:async(file,args)=>{assert.equal(file,'java');assert.deepEqual(args,['-version']);return {code:0,output:'openjdk version \"17.0.12\"'};}});
 assert.equal(installed.ready,true);assert.match(installed.message,/17.0.12/);
});

test('Java from JAVA_HOME is passed to Firebase through PATH', async () => {
 const home=await mkdtemp(path.join(tmpdir(),'devkit java home '));
 try {
  await mkdir(path.join(home,'bin'));
  const binary=path.join(home,'bin',process.platform==='win32'?'java.exe':'java');await writeFile(binary,'fixture');
  const probe=await inspectJava({env:{JAVA_HOME:home,Path:'original-path'},run:async(file,args,options)=>{
   assert.equal(file,binary);assert.equal(options.env.Path,path.join(home,'bin')+path.delimiter+'original-path');
   return {code:0,output:'openjdk version 17'};
  }});
  assert.equal(probe.ready,true);assert.equal(probe.env.Path,path.join(home,'bin')+path.delimiter+'original-path');
 } finally {await rm(home,{recursive:true,force:true});}
});
