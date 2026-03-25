const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let petWindow = null;
let windowStartPos = null;
let isDragging = false;
let eyeTrackInterval = null;

// --- Wandering state ---
let wanderState = 'idle'; // 'idle' | 'walking' | 'paused' | 'stopped'
let wanderTarget = null;
let wanderTimer = null;
let wanderPaused = false; // externally paused (e.g. chat open)

function create() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const dockY = screenH - 170; // sit on the dock
  const savedPos = store.get('petPosition');
  const x = savedPos?.x ?? screenW - 200;
  const y = dockY; // always on the dock

  petWindow = new BrowserWindow({
    width: 180,
    height: 170,
    x,
    y,
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

  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pet', 'index.html'));

  // Hit-test toggling
  ipcMain.on('slime:hit-test', (event, { hit }) => {
    if (!petWindow) return;
    if (hit) {
      petWindow.setIgnoreMouseEvents(false);
    } else {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  // Drag handling
  ipcMain.on('slime:drag-start', (event, { screenX, screenY }) => {
    if (!petWindow) return;
    isDragging = true;
    stopWandering();
    const [wx, wy] = petWindow.getPosition();
    windowStartPos = { x: wx, y: wy };
    petWindow.setIgnoreMouseEvents(false);
  });

  ipcMain.on('slime:drag-move', (event, { deltaX, deltaY }) => {
    if (!petWindow || !windowStartPos) return;
    petWindow.setPosition(windowStartPos.x + deltaX, windowStartPos.y + deltaY);
  });

  ipcMain.on('slime:drag-end', () => {
    if (!petWindow) return;
    isDragging = false;
    windowStartPos = null;
    const [x] = petWindow.getPosition();
    const dockY = getDockY();
    petWindow.setPosition(x, dockY); // snap back to dock
    store.set('petPosition', { x, y: dockY });
    // Resume wandering after drag, wait a bit
    setTimeout(() => {
      if (!wanderPaused) scheduleNextWander();
    }, 3000);
  });

  // --- Eye tracking ---
  startEyeTracking();

  // --- Start wandering after entrance ---
  setTimeout(() => {
    scheduleNextWander();
  }, 5000);

  return petWindow;
}

// ===== WANDERING SYSTEM =====

function getScreenBounds() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return { width, height };
}

function getDockY() {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  // workArea.y + workArea.height = top of the dock
  // Window is 170px tall, duck sprite is at bottom 120px of window
  // Place so duck's feet sit exactly on top of dock
  const dockTop = workArea.y + workArea.height;
  return dockTop - 160; // 10px lower, feet on dock
}

function pickWanderTarget() {
  const { width } = getScreenBounds();
  const [cx] = petWindow.getPosition();
  const dockY = getDockY();

  const margin = 20;
  const maxX = width - 200;

  // Pick a random X position along the dock, far enough from current
  let targetX;
  do {
    targetX = margin + Math.random() * (maxX - margin);
  } while (Math.abs(targetX - cx) < 150);

  return { x: Math.round(targetX), y: dockY };
}

function scheduleNextWander() {
  if (wanderPaused || isDragging) return;

  // Wait 4-12 seconds before next move
  const delay = 4000 + Math.random() * 8000;
  wanderTimer = setTimeout(() => {
    if (wanderPaused || isDragging || !petWindow || petWindow.isDestroyed()) return;
    startWalking();
  }, delay);
}

function startWalking() {
  if (!petWindow || petWindow.isDestroyed() || wanderPaused || isDragging) return;

  wanderTarget = pickWanderTarget();
  wanderState = 'walking';

  // Tell renderer we're walking
  if (petWindow && !petWindow.isDestroyed()) {
    // Determine direction for walk animation
    const [cx, cy] = petWindow.getPosition();
    const goingRight = wanderTarget.x > cx;
    petWindow.webContents.send('pet:wander', { action: 'walk', direction: goingRight ? 'right' : 'left' });
  }

  animateToTarget();
}

function animateToTarget() {
  if (!petWindow || petWindow.isDestroyed() || !wanderTarget || wanderPaused || isDragging) {
    wanderState = 'idle';
    return;
  }

  const [cx, cy] = petWindow.getPosition();
  const dockY = getDockY();
  const dx = wanderTarget.x - cx;
  const dist = Math.abs(dx);

  if (dist < 5) {
    // Arrived! Pause here on the dock
    petWindow.setPosition(Math.round(wanderTarget.x), dockY);
    store.set('petPosition', { x: Math.round(wanderTarget.x), y: dockY });
    wanderState = 'paused';
    wanderTarget = null;

    // Tell renderer we stopped — do an arrival animation
    const arrivalAnims = ['arrive-bounce', 'arrive-spin', 'arrive-settle', 'arrive-splits'];
    const pick = arrivalAnims[Math.floor(Math.random() * arrivalAnims.length)];
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:wander', { action: pick });
    }

    // Schedule next wander
    scheduleNextWander();
    return;
  }

  // Move horizontally only along the dock
  const speed = 2.5;
  const direction = dx > 0 ? 1 : -1;
  const { width: sW } = getScreenBounds();
  const minX = 10, maxX = sW - 190;
  let newX = Math.round(cx + direction * speed);

  // Edge detection — turn around at screen edges
  if (newX <= minX || newX >= maxX) {
    newX = Math.max(minX, Math.min(maxX, newX));
    petWindow.setPosition(newX, dockY);

    // Pick new target in opposite direction
    const goingRight = newX <= minX;
    wanderTarget = {
      x: Math.round(goingRight ? (maxX * 0.3 + Math.random() * maxX * 0.5) : (minX + Math.random() * maxX * 0.4)),
      y: dockY,
    };
    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send('pet:wander', { action: 'walk', direction: goingRight ? 'right' : 'left' });
    }
  } else {
    petWindow.setPosition(newX, dockY);
  }

  // ~30fps movement
  setTimeout(() => animateToTarget(), 33);
}

function stopWandering() {
  wanderState = 'stopped';
  wanderTarget = null;
  if (wanderTimer) {
    clearTimeout(wanderTimer);
    wanderTimer = null;
  }
}

// ===== EYE TRACKING =====

function startEyeTracking() {
  if (eyeTrackInterval) clearInterval(eyeTrackInterval);

  eyeTrackInterval = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || isDragging) return;

    const cursor = screen.getCursorScreenPoint();
    const [wx, wy] = petWindow.getPosition();

    const cx = wx + 90;  // center of 180px wide window
    const cy = wy + 110; // center of duck in 170px tall window (duck at bottom)
    const dx = cursor.x - cx;
    const dy = cursor.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 30) {
      petWindow.webContents.send('cursor:near', {});
    } else {
      petWindow.webContents.send('cursor:direction', {
        dx: dx > 20 ? 1 : dx < -20 ? -1 : 0,
        dy: dy > 20 ? 1 : dy < -20 ? -1 : 0,
        dist,
      });
    }
  }, 50);
}

function pauseFollowing() {
  wanderPaused = true;
  stopWandering();
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:wander', { action: 'stop' });
  }
}

function resumeFollowing() {
  wanderPaused = false;
  setTimeout(() => scheduleNextWander(), 2000);
}

function getWindow() {
  return petWindow;
}

function sendState(stateData) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:state', stateData);
  }
}

module.exports = { create, getWindow, sendState, pauseFollowing, resumeFollowing };
