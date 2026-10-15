const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('devkitDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('devkit:info'),
  choosePath: kind => ipcRenderer.invoke('devkit:choose-path', kind),
  showDataFolder: () => ipcRenderer.invoke('devkit:show-data')
}));
