// preload.js — the only bridge between Mysthi's window and the app. Her page has no Node access;
// it can send and hear only the messages listed here.
const { contextBridge, ipcRenderer } = require('electron');

// Page → app
const SEND = new Set([
  'slime:hit-test', 'slime:drag-start', 'slime:drag-move', 'slime:drag-end', 'slime:interaction',
  'pet:context-menu', 'pet:open-chat', 'learning:toggle-pause',
]);
// App → page
const RECEIVE = new Set([
  'cursor:direction', 'cursor:near', 'pet:state', 'pet:edge', 'pet:learning', 'pet:reaction', 'pet:wander',
]);

// Plain copies only: nothing from Electron's event object reaches the page
const listen = (method) => (channel, callback) => {
  if (!RECEIVE.has(channel) || typeof callback !== 'function') return;
  ipcRenderer[method](channel, (_event, data) => callback(null, data));
};

contextBridge.exposeInMainWorld('pet', {
  send: (channel, data) => { if (SEND.has(channel)) ipcRenderer.send(channel, data); },
  on: listen('on'),
  once: listen('once'),
});
