const { contextBridge, ipcRenderer } = require('electron');
const subscribe = channel => callback => {
  const listener = (_, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('devkitDesktop', Object.freeze({
  getInfo: () => ipcRenderer.invoke('devkit:info'),
  choosePath: kind => ipcRenderer.invoke('devkit:choose-path', kind),
  showDataFolder: () => ipcRenderer.invoke('devkit:show-data'),
  checkUpdate: () => ipcRenderer.invoke('devkit:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('devkit:update-download'),
  installUpdate: () => ipcRenderer.invoke('devkit:update-install'),
  openRelease: url => ipcRenderer.invoke('devkit:open-release', url),
  onUpdateProgress: subscribe('devkit:update-progress'),
  onUpdateMenu: subscribe('devkit:update-menu')
}));
