import test from 'node:test';
import assert from 'node:assert/strict';
import {execute,stopCommands} from '../server/tools.mjs';
test('backend shutdown stops the CLI it started', {timeout:10000}, async()=>{
 let ready; const started=new Promise(resolve=>{ready=resolve});
 const running=execute(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{timeout:8000,onOutput:text=>{if(text.includes('ready'))ready()}});
 try {await started;await stopCommands(); const result=await running;assert.notEqual(result.code,0);} finally {await stopCommands();}
});
