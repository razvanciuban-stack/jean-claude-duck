const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { pointAt, edgeRange, route, toLocal, spans } = require('./perimeter');

const store = new Store();

const SIZE = 180;          // square window, so Mysthi can turn onto walls and the ceiling inside it
const SPEED = 1.4;         // px per frame — a calm cat stroll; mysthi.js times her steps to this
const FRAME_MS = 33;       // ~30 fps movement
const FLOOR_NUDGE = 10;    // px lower on the floor, so her paws sit right on the dock edge
// Where she walks: only along the bottom of the screen (floor-to-floor routes never turn up a wall)
const EDGE_WEIGHTS = [['floor', 1]];

let petWindow = null;
let windowStartPos = null;
let isDragging = false;
let eyeTrackInterval = null;
let learningTogglePauseHandler = null;
let learningIpcRegistered = false;

// --- Wandering state: a position on the loop around the screen edge ---
let wanderState = 'idle'; // 'idle' | 'walking' | 'paused' | 'stopped'
let wanderTimer = null;
let wanderPaused = false;  // externally paused
let loopS = 0;             // distance along the loop (see perimeter.js)
let walk = null;           // { dir, remaining } while walking
let currentEdge = 'floor';

// Work area of the display she is on (excludes the menu bar and the dock)
function bounds() {
  if (!petWindow || petWindow.isDestroyed()) return screen.getPrimaryDisplay().workArea;
  const [x, y] = petWindow.getPosition();
  return screen.getDisplayNearestPoint({ x: x + SIZE / 2, y: y + SIZE / 2 }).workArea;
}

function send(channel, payload) {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send(channel, payload);
}

// Put the window at loop distance s and turn her onto the right edge
function placeAt(s) {
  const p = pointAt(bounds(), s, SIZE);
  loopS = s;
  petWindow.setPosition(Math.round(p.x), Math.round(p.y) + (p.edge === 'floor' ? FLOOR_NUDGE : 0));
  if (p.edge !== currentEdge) {
    currentEdge = p.edge;
    send('pet:edge', { edge: currentEdge });
  }
}

function create() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = store.get('petLoopS');
  const floorW = spans(area, SIZE).W;
  const start = Number.isFinite(saved) && saved >= 0 && saved < floorW ? saved : floorW / 2; // on the floor
  const p = pointAt(area, start, SIZE);
  console.log('Pet window position:', { x: Math.round(p.x), y: Math.round(p.y), edge: p.edge });

  petWindow = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    x: Math.round(p.x),
    y: Math.round(p.y) + (p.edge === 'floor' ? FLOOR_NUDGE : 0),
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

  loopS = start;
  currentEdge = p.edge;
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  petWindow.loadFile(path.join(__dirname, '..', 'renderer', 'pet', 'index.html'));
  petWindow.webContents.on('did-finish-load', () => send('pet:edge', { edge: currentEdge }));

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
  ipcMain.on('slime:drag-start', () => {
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
    // Land on the floor of that screen, straight below where she was dropped
    const [x] = petWindow.getPosition();
    const area = bounds();
    placeAt(Math.min(Math.max(x - area.x, 0), spans(area, SIZE).W - 1));
    store.set('petLoopS', loopS);
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

// ===== WANDERING: around the screen edge, climbing walls and crossing the ceiling =====

function pickEdge() {
  let r = Math.random();
  for (const [edge, weight] of EDGE_WEIGHTS) {
    if ((r -= weight) <= 0) return edge;
  }
  return 'floor';
}

// A spot somewhere along an edge (weighted-random unless given), not hugging a corner, and worth walking to
function pickTarget(area, edge) {
  for (let tries = 0; tries < 20; tries++) {
    const [start, end] = edgeRange(area, edge || pickEdge(), SIZE);
    const margin = Math.min(40, (end - start) / 4);
    const target = start + margin + Math.random() * (end - start - 2 * margin);
    const r = route(area, loopS, target, SIZE);
    if (r.distance >= 120) return r;
  }
  return route(area, loopS, loopS + 200, SIZE);
}

function scheduleNextWander() {
  if (wanderPaused || isDragging) return;
  if (wanderTimer) clearTimeout(wanderTimer);

  // A cat mostly stays put on the floor (30-90 s); clinging to a wall or the ceiling she soon heads down (5-15 s)
  const delay = currentEdge === 'floor' ? 30000 + Math.random() * 60000 : 5000 + Math.random() * 10000;
  wanderTimer = setTimeout(() => {
    if (wanderPaused || isDragging || !petWindow || petWindow.isDestroyed()) return;
    startWalking();
  }, delay);
}

function startWalking() {
  if (!petWindow || petWindow.isDestroyed() || wanderPaused || isDragging) return;
  // Off the floor, the next stroll always brings her back down
  const { dir, distance } = pickTarget(bounds(), currentEdge === 'floor' ? null : 'floor');
  walk = { dir, remaining: distance };
  wanderState = 'walking';
  // Counter-clockwise round the loop is always "forward to her right" in her own frame
  send('pet:wander', { action: 'walk', direction: dir > 0 ? 'right' : 'left', edge: currentEdge });
  step();
}

// Tell the renderer to sit down whenever a walk ends for any reason other than arriving
function sendStop() {
  send('pet:wander', { action: 'stop' });
}

function step() {
  if (!petWindow || petWindow.isDestroyed() || !walk || wanderPaused || isDragging) {
    if (wanderState === 'walking') sendStop();
    wanderState = 'idle';
    walk = null;
    return;
  }

  const advance = Math.min(SPEED, walk.remaining);
  placeAt(loopS + walk.dir * advance);
  walk.remaining -= advance;

  if (walk.remaining <= 0) {
    walk = null;
    wanderState = 'paused';
    store.set('petLoopS', loopS);
    const arrivalAnims = ['arrive-bounce', 'arrive-spin', 'arrive-settle', 'arrive-splits'];
    send('pet:wander', { action: arrivalAnims[Math.floor(Math.random() * arrivalAnims.length)] });
    scheduleNextWander();
    return;
  }

  setTimeout(step, FRAME_MS);
}

function stopWandering() {
  if (wanderState === 'walking') sendStop();
  wanderState = 'stopped';
  walk = null;
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

    const cx = wx + SIZE / 2;  // her eyes sit near the middle of the square window on every edge
    const cy = wy + SIZE / 2;
    const dx = cursor.x - cx;
    const dy = cursor.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 30) {
      send('cursor:near', {});
    } else {
      // Turn the screen direction into her own frame, so she looks the right way on walls and the ceiling
      const local = toLocal(currentEdge, dx > 20 ? 1 : dx < -20 ? -1 : 0, dy > 20 ? 1 : dy < -20 ? -1 : 0);
      send('cursor:direction', { dx: local.dx, dy: local.dy, dist });
    }
  }, 50);
}

function pauseFollowing() {
  wanderPaused = true;
  stopWandering();
  sendStop();
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
  send('pet:state', stateData);
}

module.exports = { create, getWindow, sendState, pauseFollowing, resumeFollowing, onLearningTogglePause };
