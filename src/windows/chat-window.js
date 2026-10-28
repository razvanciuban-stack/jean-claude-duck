const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

let chatWindow = null;
let waitingForResponse = false;

function create(petWindow) {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return chatWindow;
  }

  const [petX, petY] = petWindow.getPosition();
  const display = screen.getDisplayNearestPoint({ x: petX, y: petY });
  const { y: displayY } = display.workArea;

  // Position above pet, or below if near top edge
  const bubbleWidth = 300;
  const bubbleHeight = 250;
  const nearTop = petY - displayY < 270;
  const bx = petX + 90 - bubbleWidth / 2;
  // Above: overlap the pet window's empty top so the bubble's tail sits just over Mysthi's ears
  const by = nearTop ? petY + 180 : petY - bubbleHeight + 40;

  chatWindow = new BrowserWindow({
    width: bubbleWidth,
    height: bubbleHeight,
    x: Math.round(bx),
    y: Math.round(by),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  chatWindow.loadFile(path.join(__dirname, '..', 'renderer', 'chat', 'index.html'));

  // Chat stays open — user closes with ✕ or Escape only

  chatWindow.on('closed', () => {
    chatWindow = null;
    waitingForResponse = false;
  });

  return chatWindow;
}

function getWindow() {
  return chatWindow;
}

function setWaiting(val) {
  waitingForResponse = val;
}

function sendResponse(text) {
  waitingForResponse = false;
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('chat:response', { text });
    // Re-focus the window so user can keep typing
    chatWindow.focus();
  }
}

function sendError(error) {
  waitingForResponse = false;
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.webContents.send('chat:error', { error });
    chatWindow.focus();
  }
}

function close() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
    chatWindow = null;
  }
  waitingForResponse = false;
}

module.exports = { create, getWindow, sendResponse, sendError, close, setWaiting };
