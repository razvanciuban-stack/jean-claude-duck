const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, safeStorage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const petWindowManager = require('./src/windows/pet-window');
const chatWindowManager = require('./src/windows/chat-window');
const claude = require('./src/services/claude');
const systemInfo = require('./src/services/system-info');
const activityMonitor = require('./src/services/activity-monitor');
const { buildSystemPrompt } = require('./src/services/personality');
const { evaluate, getExpression } = require('./src/services/states');
const notificationMonitor = require('./src/services/notification-monitor');
const { ensureQuackSound, playQuack } = require('./src/services/sound');

const store = new Store();
let tray = null;
let isTalking = false;
let hasError = false;
let setupWindow = null;
let chatIsOpen = false;

// --- API Key helpers ---
function getApiKey() {
  const encrypted = store.get('apiKey');
  if (!encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

function saveApiKey(key) {
  const encrypted = safeStorage.encryptString(key).toString('base64');
  store.set('apiKey', encrypted);
}

// --- Setup window ---
function showSetup() {
  setupWindow = new BrowserWindow({
    width: 400,
    height: 250,
    frame: true,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  setupWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'setup', 'index.html'));
}

// --- State management ---
function updateSlimeState() {
  const info = systemInfo.getInfo();
  const state = evaluate({
    battery: info.battery,
    charging: info.charging,
    hour: info.hour,
    isTalking,
    hasError,
    isIdle: systemInfo.isIdle(),
  });
  const expression = getExpression(state);
  petWindowManager.sendState({ state, ...expression });
}

// --- App lifecycle ---
app.whenReady().then(() => {
  claude.init(); // no API key needed in hardcoded mode
  ensureQuackSound();
  startApp();
});

function startApp() {
  systemInfo.startPolling();
  systemInfo.onChange(() => updateSlimeState());

  // Create pet window
  petWindowManager.create();
  updateSlimeState();

  // Show initial greeting after a short delay
  setTimeout(() => {
    const petWin = petWindowManager.getWindow();
    if (petWin) {
      chatWindowManager.create(petWin);
      chatWindowManager.sendResponse("Quack! I'm Jean Claude Duck! Click me to chat.");
    }
  }, 1500);

  // --- Activity Monitor → Reaction Bubbles ---
  activityMonitor.start();
  activityMonitor.on('reaction', ({ text }) => {
    if (chatIsOpen) return; // don't show reactions while chat is open
    const petWin = petWindowManager.getWindow();
    if (petWin && !petWin.isDestroyed()) {
      petWin.webContents.send('pet:reaction', { text });
    }
  });

  // --- Notification Monitor → Quack ---
  notificationMonitor.start();
  notificationMonitor.on('notification', () => {
    playQuack();

    const petWin = petWindowManager.getWindow();
    if (petWin && !petWin.isDestroyed()) {
      // Show a quack reaction bubble
      const quackReactions = ['🔔 quack!', '📬 notification!', '🦆 quack quack!', '📣 someone pinged you!'];
      const text = quackReactions[Math.floor(Math.random() * quackReactions.length)];
      petWin.webContents.send('pet:reaction', { text });

      // Surprised animation — wide eyes + shake
      petWin.webContents.send('pet:state', { state: 'surprised', eyes: 'O O', mouth: '!' });
      setTimeout(() => {
        updateSlimeState(); // restore normal state after 2 seconds
      }, 2000);
    }
  });

  // Tray
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkoBAwUqifAacBjP8ZGP4zMDAwMjAwMDEQAYYmF4wmA0YTEoGxkJqJiTgXDIIwGE0GAAA+HAkRm5K/wgAAAABJRU5ErkJggg=='
  );
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        const win = petWindowManager.getWindow();
        if (win) win.isVisible() ? win.hide() : win.show();
      },
    },
    { type: 'separator' },
    { label: 'About', click: () => {
      const { dialog } = require('electron');
      dialog.showMessageBox({ title: 'Jean Claude Duck', message: 'Jean Claude Duck v0.1.0\nA pixel-art desktop pet.' });
    }},
    { label: 'Quit', click: () => app.quit() },
  ]));

  // Global shortcut
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    const win = petWindowManager.getWindow();
    if (win) win.isVisible() ? win.hide() : win.show();
  });

  // IPC: slime click → open chat (pause following so bubble stays aligned)
  ipcMain.on('slime:click', () => {
    const petWin = petWindowManager.getWindow();
    if (petWin) {
      chatIsOpen = true;
      petWindowManager.pauseFollowing();
      chatWindowManager.create(petWin);
    }
  });

  // IPC: track interactions for idle detection
  ipcMain.on('slime:interaction', () => {
    systemInfo.recordInteraction();
    updateSlimeState();
  });

  // IPC: chat message → Ollama
  ipcMain.on('chat:send', async (event, { message }) => {
    systemInfo.recordInteraction();
    isTalking = true;
    chatWindowManager.setWaiting(true);
    updateSlimeState();

    const systemPrompt = buildSystemPrompt(systemInfo.getInfo());
    const result = await claude.sendMessage(message, systemPrompt);

    isTalking = false;

    if (result.error) {
      hasError = true;
      updateSlimeState();
      chatWindowManager.sendError(result.error);
      setTimeout(() => { hasError = false; updateSlimeState(); }, 5000);
    } else {
      hasError = false;
      updateSlimeState();
      chatWindowManager.sendResponse(result.text);
    }
  });

  // IPC: chat dismiss — resume following cursor
  ipcMain.on('chat:dismiss', () => {
    chatIsOpen = false;
    chatWindowManager.close();
    petWindowManager.resumeFollowing();
  });
}

// --- Setup IPC ---
ipcMain.on('setup:validate', async (event, { apiKey }) => {
  const result = await claude.validateKey(apiKey);
  if (result.valid) {
    saveApiKey(apiKey);
    claude.init(apiKey);
    if (setupWindow) {
      setupWindow.close();
      setupWindow = null;
    }
    startApp();
  } else {
    event.reply('setup:error', { error: "That key didn't work — double-check and try again." });
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  activityMonitor.stop();
  notificationMonitor.stop();
});

app.on('window-all-closed', () => {
  // Don't quit — tray keeps it alive
});
