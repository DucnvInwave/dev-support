import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import {createRequire} from 'node:module';
const {desktopPaths,selectPort,isAppURL,isExternalURL}=createRequire(import.meta.url)('../desktop/runtime.cjs');
test('Electron paths preserve existing Windows data and isolate profile overrides',()=>{
 const normal=desktopPaths({env:{LOCALAPPDATA:'C:/Users/test/AppData/Local'},platform:'win32',userData:'C:/Users/test/AppData/Roaming/Devkit'});
 assert.equal(normal.data,path.resolve('C:/Users/test/AppData/Local/Devkit/data'));
 assert.equal(normal.profile,path.resolve('C:/Users/test/AppData/Roaming/Devkit'));
 const custom=desktopPaths({env:{DEVKIT_DESKTOP_HOME:'./custom-home',DEVKIT_DATA_DIR:'./custom-data',DEVKIT_ELECTRON_PROFILE:'./custom-profile'},platform:'darwin',userData:'./default'});
 assert.deepEqual(custom,{home:path.resolve('custom-home'),data:path.resolve('custom-data'),profile:path.resolve('custom-profile')});
});
test('Electron navigation accepts only its own origin and supported external links',()=>{
 const origin='http://127.0.0.1:3210';
 assert.equal(isAppURL(origin+'/#json',origin),true);
 for(const value of ['http://127.0.0.1:3211','https://example.com','file:///app','javascript:alert(1)']) assert.equal(isAppURL(value,origin),false);
 for(const value of ['https://console.firebase.google.com','http://localhost:3210']) assert.equal(isExternalURL(value),true);
 for(const value of ['file:///secret','javascript:alert(1)','http://example.com','https://user:pass@example.com','devkit:run']) assert.equal(isExternalURL(value),false);
});
test('Electron chooses another port without stopping the current listener',async()=>{
 const listener=net.createServer(socket=>socket.end('alive'));
 await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
 try { const occupied=listener.address().port; const selected=await selectPort(occupied); assert.notEqual(selected,occupied); assert.equal(listener.listening,true); } finally {await new Promise(resolve=>listener.close(resolve));}
});
