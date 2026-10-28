const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let petWindow = null;
let windowStartPos = null;
let isDragging = false;
let eyeTrackInterval = null;
let learningTogglePauseHandler = null;
let learningIpcRegistered = false;

// --- Wandering state ---
let wanderState = 'idle'; // 'idle' | 'walking' | 'paused' | 'stopped'
let wanderTarget = null;
let wanderTimer = null;
let wanderPaused = false; // externally paused (e.g. chat open)

function create() {
  const display = screen.getPrimaryDisplay();
  const screenW = display.workArea.width;
  const dockY = getDockY();
  const savedPos = store.get('petPosition');
  const x = Math.round(screenW / 2) - 90; // center of screen
  const y = Math.round(display.workArea.height / 2); // middle of screen for testing
  console.log('Pet window position:', { x, y, screenW, dockY });

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

  // ⌥-click on the pet → toggle learning pause (only from the pet window's own renderer)
  if (!learningIpcRegistered) {
    learningIpcRegistered = true;
    ipcMain.on('learning:toggle-pause', (event) => {
      if (!petWindow || petWindow.isDestroyed() || event.sender !== petWindow.webContents) return;
      if (learningTogglePauseHandler) learningTogglePauseHandler();
    });
  }

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
  return dockTop - 170; // whole window above the dock: Mysthi's paws reach the window's bottom edge
}

function pickWanderTarget() {
  const { width } = getScreenBounds();
  const [cx] = petWindow.getPosition();
  const dockY = getDockY();

  const windowW = 180;
  // Sometimes pick a target beyond the screen edge so the duck wraps around
  const willWrap = Math.random() < 0.3; // 30% chance to walk off-screen

  let targetX;
  if (willWrap) {
    // Pick a target past the edge — duck will walk off and wrap
    if (cx < width / 2) {
      targetX = -windowW - 50; // walk off left
    } else {
      targetX = width + windowW + 50; // walk off right
    }
  } else {
    // Normal: pick a random X on the dock
    const margin = 20;
    const maxX = width - 200;
    do {
      targetX = margin + Math.random() * (maxX - margin);
    } while (Math.abs(targetX - cx) < 150);
  }

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
  stuckFrames = 0;

  // Tell renderer we're walking
  if (petWindow && !petWindow.isDestroyed()) {
    // Determine direction for walk animation
    const [cx, cy] = petWindow.getPosition();
    const goingRight = wanderTarget.x > cx;
    petWindow.webContents.send('pet:wander', { action: 'walk', direction: goingRight ? 'right' : 'left' });
  }

  animateToTarget();
}

let isWrapping = false; // true while duck is off-screen doing a wrap
let stuckFrames = 0;     // frames in a row where setPosition didn't move the window

// Tell the renderer to sit down whenever a walk ends for any reason other than arriving
function sendStop() {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:wander', { action: 'stop' });
  }
}

// macOS may refuse to push a window further off-screen; returns true once we've been pinned for a while
function isPinned(prevX) {
  const [actualX] = petWindow.getPosition();
  stuckFrames = actualX === prevX ? stuckFrames + 1 : 0;
  return stuckFrames > 10;
}

function startWrap(direction) {
  const { width: sW } = getScreenBounds();
  isWrapping = true;
  stuckFrames = 0;
  wanderTarget._wrapDir = direction; // 1 = walking right, enters from the left
  petWindow.setPosition(direction === 1 ? -180 - 40 : sW + 40, getDockY());
  petWindow.webContents.send('pet:wander', { action: 'walk', direction: direction === 1 ? 'right' : 'left' });
}

function animateToTarget() {
  if (!petWindow || petWindow.isDestroyed() || !wanderTarget || wanderPaused || isDragging) {
    if (wanderState === 'walking') sendStop();
    wanderState = 'idle';
    isWrapping = false;
    return;
  }

  const [cx, cy] = petWindow.getPosition();
  const dockY = getDockY();
  const { width: sW } = getScreenBounds();
  const windowW = 180;

  // If wrapping, just keep moving in same direction until we're well on screen
  if (isWrapping) {
    const speed = 1.4; // a calm cat stroll; mysthi.js times her steps to this
    const direction = wanderTarget._wrapDir; // 1 = right, -1 = left
    let newX = Math.round(cx + direction * speed);
    petWindow.setPosition(newX, dockY);

    // Only consider "on screen" once the duck is fully visible (not just peeking)
    const fullyOnScreen = newX > 20 && newX < sW - windowW - 20;
    if (fullyOnScreen || isPinned(cx)) {
      // Wrapped! Now pick a real on-screen target to walk to
      isWrapping = false;
      const margin = 100;
      wanderTarget = {
        x: Math.round(margin + Math.random() * (sW - margin * 2)),
        y: dockY,
      };
    }

    setTimeout(() => animateToTarget(), 33);
    return;
  }

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
  const speed = 1.4; // a calm cat stroll; mysthi.js times her steps to this
  const direction = dx > 0 ? 1 : -1;
  let newX = Math.round(cx + direction * speed);

  // Walked fully off an edge → reappear from the other side
  if (newX >= sW + 10) {
    startWrap(1);
  } else if (newX <= -windowW - 10) {
    startWrap(-1);
  } else {
    petWindow.setPosition(newX, dockY);
    if (isPinned(cx)) {
      // Pinned against an edge: wrap if that's where she was heading, otherwise call this spot the destination
      stuckFrames = 0;
      const nearEdge = direction === -1 ? cx < 60 : cx > sW - windowW - 60;
      if (nearEdge) startWrap(direction);
      else wanderTarget.x = cx;
    }
  }

  // ~30fps movement
  setTimeout(() => animateToTarget(), 33);
}

function stopWandering() {
  if (wanderState === 'walking') sendStop();
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
    const cy = wy + 90;  // Mysthi's eyes in the 170px tall window (she sits at the bottom)
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

function onLearningTogglePause(handler) {
  learningTogglePauseHandler = handler;
}

function getWindow() {
  return petWindow;
}

function sendState(stateData) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send('pet:state', stateData);
  }
}

module.exports = { create, getWindow, sendState, pauseFollowing, resumeFollowing, onLearningTogglePause };
