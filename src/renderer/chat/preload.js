// preload.js — the only bridge between the chat page and the app: three narrow calls (plus the reply stream), no Node access
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mysthi', {
  // Resolves { ok: true, reply } or { ok: false, error }
  // remember: true saves the whole message as a note (the Remember button)
  send: (text, remember = false) => ipcRenderer.invoke('chat:send', String(text), { remember: remember === true }),
  history: () => ipcRenderer.invoke('chat:history'),
  clear: () => ipcRenderer.invoke('chat:clear'),
  // Pieces of the reply as they arrive
  onToken: (callback) => {
    ipcRenderer.removeAllListeners('chat:token');
    ipcRenderer.on('chat:token', (_event, piece) => callback(String(piece)));
  },
});
