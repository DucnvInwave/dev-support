import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
await mkdir(path.join(root,'.build'),{recursive:true});
const home = await mkdtemp(path.join(root,'.build/electron-smoke-'));
const data = path.join(home,'data'); await mkdir(data);
const settings = {sdkRoot:'',adbPath:path.join(home,'missing-adb'),firebasePath:'',appId:'1:528923424982:android:46195f809d709f94'};
await writeFile(path.join(data,'settings.json'),JSON.stringify(settings,null,2));
await writeFile(path.join(data,'history.json'),'[]');
const packaged = process.argv.indexOf('--packaged');
const executable = packaged >= 0 ? path.resolve(process.argv[packaged+1]) : (await import('electron')).default;
const args = packaged >= 0 ? ['--smoke-test'] : ['.','--smoke-test'];
const env = {...process.env,DEVKIT_SMOKE_TEST:'1',DEVKIT_DESKTOP_HOME:home,DEVKIT_DATA_DIR:data,DEVKIT_ELECTRON_PROFILE:path.join(home,'profile')};
delete env.ELECTRON_RUN_AS_NODE;
console.log('Smoke test data: ' + home);
const child = spawn(executable,args,{cwd:packaged >= 0 ? path.dirname(executable) : root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let output=''; child.stdout.on('data',chunk=>{output+=chunk}); child.stderr.on('data',chunk=>{output+=chunk});
const timer=setTimeout(()=>child.kill(),90000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)}).finally(()=>clearTimeout(timer));
let report; try{report=JSON.parse(await readFile(path.join(home,'electron-smoke.json'),'utf8'))}catch{throw new Error('Missing Electron smoke report. '+output)}
assert.equal(code,0,output+'\n'+JSON.stringify(report)); assert.equal(report.ok,true,JSON.stringify(report));
assert.deepEqual(JSON.parse(await readFile(path.join(data,'settings.json'),'utf8')),settings);
assert.deepEqual(JSON.parse(await readFile(path.join(data,'history.json'),'utf8')),[]);
let reachable=false;try{await fetch(report.url+'/api/health',{signal:AbortSignal.timeout(1500)});reachable=true}catch{}
assert.equal(reachable,false,'Backend must stop when Electron exits');
console.log(JSON.stringify({...report,shutdownVerified:true,dataPreserved:true},null,2));
