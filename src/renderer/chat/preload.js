// preload.js — the only bridge between the chat page and the app: three narrow calls, no Node access
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mysthi', {
  // Resolves { ok: true, reply } or { ok: false, error }
  send: (text) => ipcRenderer.invoke('chat:send', String(text)),
  history: () => ipcRenderer.invoke('chat:history'),
  clear: () => ipcRenderer.invoke('chat:clear'),
  // Pieces of the reply as they arrive
  onToken: (callback) => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.on('chat:token', (_event, piece) => callback(String(piece)));
  },
});
