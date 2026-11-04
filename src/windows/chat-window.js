// chat-window.js — Mysthi's chat: a normal, locked-down window (sandboxed, no Node, narrow preload bridge)
const { BrowserWindow } = require('electron');
const path = require('path');

let chatWindow = null;

function open() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }

  chatWindow = new BrowserWindow({
    width: 400,
    height: 580,
    minWidth: 320,
    minHeight: 400,
    title: 'Mysthi',
    backgroundColor: '#f7f5f1',
    show: false,
    alwaysOnTop: true, // stays above your other windows, like Mysthi herself
    webPreferences: {
      preload: path.join(__dirname, '..', 'renderer', 'chat', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Above normal windows, also on every Space and next to full-screen apps
  chatWindow.setAlwaysOnTop(true, 'floating');
  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Nothing in a reply may navigate the window or open new ones
  chatWindow.webContents.on('will-navigate', (e) => e.preventDefault());
  chatWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  chatWindow.loadFile(path.join(__dirname, '..', 'renderer', 'chat', 'index.html'));
  chatWindow.once('ready-to-show', () => chatWindow.show());
  chatWindow.on('closed', () => { chatWindow = null; });
  return chatWindow;
}

// Only the chat page itself may use the chat calls
function isChatSender(sender) {
  return !!(chatWindow && !chatWindow.isDestroyed() && sender === chatWindow.webContents);
}

module.exports = { open, isChatSender };
