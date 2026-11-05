// mysthi.js — Mysthi, a flat black-silhouette cat: drawing, eyes, mouth, blinking and walk cycle

const NS = 'http://www.w3.org/2000/svg';
const LINE = '#4a4a4a'; // thin dark-grey cuts that separate legs from body on any desktop
const SIT_SCALE = 0.78; // sitting drawing, shrunk around her paws
const WALK_SCALE = 1.15; // walking drawing, grown around her paws: a little lower than sitting, like a real cat

const SIT_POSE = `
  <g class="tail">
    <path d="M66 226 C 26 228, 14 200, 24 176 C 30 160, 22 150, 14 156" fill="none" stroke="#111" stroke-width="13" stroke-linecap="round"/>
  </g>
  <g class="body">
    <path d="M74 104 C 66 136, 56 176, 52 210 C 50 224, 58 230, 70 230 L 130 230 C 142 230, 150 224, 148 210 C 144 176, 134 136, 126 104 Z" fill="#111"/>
    <path d="M62 222 C 64 200, 72 186, 84 180 M138 222 C 136 200, 128 186, 116 180" fill="none" stroke="${LINE}" stroke-width="2" stroke-linecap="round"/>
    <path d="M85 150 C 84 175, 84 205, 83 222 Q 83 231 91 231 Q 99 231 98 222 C 98 205, 99 175, 99 150 Z" fill="#111" stroke="${LINE}" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M101 150 C 101 175, 102 205, 102 222 Q 101 231 109 231 Q 117 231 117 222 C 116 205, 116 175, 115 150 Z" fill="#111" stroke="${LINE}" stroke-width="2.2" stroke-linejoin="round"/>
    <ellipse cx="100" cy="146" rx="22" ry="16" fill="#111"/>
  </g>
  <g class="head">
    <g class="ear left"><path d="M58 70 L 64 22 L 94 50 Z" fill="#111" stroke="#111" stroke-width="8" stroke-linejoin="round"/></g>
    <g class="ear right"><path d="M106 50 L 136 22 L 142 70 Z" fill="#111" stroke="#111" stroke-width="8" stroke-linejoin="round"/></g>
    <ellipse cx="100" cy="80" rx="50" ry="40" fill="#111"/>
    <g class="whiskers left"><path d="M62 92 L 26 84 M62 97 L 24 99 M63 102 L 30 112" stroke="#8a8a8a" stroke-width="1.6" stroke-linecap="round"/></g>
    <g class="whiskers right"><path d="M138 92 L 174 84 M138 97 L 176 99 M137 102 L 170 112" stroke="#8a8a8a" stroke-width="1.6" stroke-linecap="round"/></g>
    <g class="eye" data-cx="80" data-cy="76"></g>
    <g class="eye" data-cx="120" data-cy="76"></g>
    <g class="mouth"></g>
  </g>
`;

// Side-on walk, facing right, drawn like a real walking-cat silhouette: level back, deep chest, strong haunch,
// head carried forward at back height on a short neck (one almond eye, pointed ears), tail sweeping low behind
// and curling up at the tip. Legs are tapered shapes (thick at the body, slim at the paw) that merge into it.
const WALK_POSE = `
  <g class="far-legs"></g>
  <g class="walk-body">
    <g class="walk-tail">
      <path class="tail-line" d="M76 148 C 54 154, 40 170, 34 188 C 30 200, 24 207, 16 205 C 9 203, 7 196, 12 191" fill="none" stroke="none"/>
      <path class="tail-shape" fill="#111" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>
    </g>
    <path d="M72 150 C 70 138, 80 130, 94 131 C 108 132, 118 140, 128 140 C 138 140, 146 132, 156 134 C 166 136, 172 148, 170 160 C 168 170, 160 176, 150 176 C 136 176, 124 166, 112 165 C 102 164, 96 170, 88 172 C 78 174, 72 164, 72 150 Z" fill="#111"/>
    <path d="M74 146 C 82 134, 100 136, 106 148 C 110 160, 104 174, 94 178 C 84 181, 76 173, 73 163 Z" fill="#111"/>
    <path d="M150 138 C 162 132, 176 132, 188 136 L 194 156 C 184 164, 172 168, 162 170 Z" fill="#111"/>
    <g class="walk-head"><g transform="translate(192 141) scale(1.05) translate(-184 -137)">
      <path d="M166 128 L 170 102 L 182 124 Z" fill="#111" stroke="#111" stroke-width="3" stroke-linejoin="round"/>
      <path d="M180 126 L 191 104 L 194 130 Z" fill="#111" stroke="#111" stroke-width="3" stroke-linejoin="round"/>
      <path d="M184 124 L 190 111 L 191 127 Z" fill="#3a3a3a"/>
      <path d="M160 140 C 160 126, 174 120, 186 123 C 195 125, 202 132, 207 139 C 209 144, 204 148, 196 150 C 184 153, 168 152, 162 146 Z" fill="#111"/>
      <path d="M184 133 C 189 129, 196 130, 199 136 C 197 141, 190 143, 185 140 C 183 138, 182 135, 184 133 Z" fill="#fff"/>
      <circle cx="194" cy="136" r="3.2" fill="#111"/>
      <path d="M198 145 L 220 141 M197 148 L 221 151" stroke="#8a8a8a" stroke-width="1.2" stroke-linecap="round"/>
    </g></g>
  </g>
  <g class="near-legs"></g>
`;

function el(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function createMysthiSVG() {
  const svg = el('svg', { viewBox: '0 0 210 240', width: '105', height: '120' });
  svg.style.overflow = 'visible';
  svg.dataset.eyes = 'open';

  // The front-on drawing is larger than the side-on walk; shrink it around her paws so both poses match
  const sit = el('g', { class: 'pose sit', transform: `translate(100 231) scale(${SIT_SCALE}) translate(-100 -231)` }, svg);
  sit.innerHTML = SIT_POSE;
  for (const eye of sit.querySelectorAll('.eye')) {
    const cx = +eye.dataset.cx, cy = +eye.dataset.cy;
    const lid = el('g', { class: 'lid' }, eye);
    el('circle', { cx, cy, r: 17, fill: '#fff' }, lid);
    el('circle', { class: 'pupil', cx, cy, r: 6.5, fill: '#111' }, lid);
    el('g', { class: 'fx' }, eye);
  }

  // Outer group: flipped by CSS when she walks left. Inner group: the walk drawing is smaller than the sitting
  // one, so it is scaled up around her paws to a similar height (the window has room for the longer body).
  const walkOuter = el('g', { class: 'pose walk' }, svg);
  const walk = el('g', { transform: `translate(105 ${229}) scale(${WALK_SCALE}) translate(-105 -229)` }, walkOuter);
  walk.innerHTML = WALK_POSE;
  svg._walk = createWalkCycle(walk);

  startBlinking(svg);
  return svg;
}

// --- Eyes ---

const HEART = (cx, cy) => `M${cx} ${cy + 6} C ${cx - 10} ${cy - 2}, ${cx - 6} ${cy - 10}, ${cx} ${cy - 4} C ${cx + 6} ${cy - 10}, ${cx + 10} ${cy - 2}, ${cx} ${cy + 6} Z`;
const STAR = (cx, cy) => {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 3.5 : 8, a = Math.PI / 5 * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
};

// type: open | half | wide | blink | closed | squish | hearts | stars; dx, dy in -1..1 toward the cursor
function setEyesWithDirection(svg, type, dx, dy) {
  svg.dataset.eyes = type;
  const tracks = type === 'open' || type === 'half' || type === 'wide' || type === 'blink';
  const ox = tracks ? (dx || 0) * 6 : 0;
  const oy = tracks ? (dy || 0) * 5 : 0;

  for (const eye of svg.querySelectorAll('.sit .eye')) {
    const cx = +eye.dataset.cx, cy = +eye.dataset.cy;
    eye.querySelector('.pupil').style.transform = `translate(${ox}px, ${oy}px)`;
    const fx = eye.querySelector('.fx');
    fx.innerHTML = '';
    if (type === 'closed') {
      el('path', { d: `M${cx - 12} ${cy} Q ${cx} ${cy + 8} ${cx + 12} ${cy}`, fill: 'none', stroke: '#fff', 'stroke-width': 3.5, 'stroke-linecap': 'round' }, fx);
    } else if (type === 'squish') {
      el('path', { d: `M${cx - 11} ${cy + 3} L ${cx} ${cy - 6} L ${cx + 11} ${cy + 3}`, fill: 'none', stroke: '#fff', 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, fx);
    } else if (type === 'hearts') {
      el('circle', { cx, cy, r: 17, fill: '#fff' }, fx);
      el('path', { d: HEART(cx, cy), fill: '#ff6b8b' }, fx);
    } else if (type === 'stars') {
      el('circle', { cx, cy, r: 17, fill: '#fff' }, fx);
      el('polygon', { points: STAR(cx, cy), fill: '#f5b70a' }, fx);
    }
  }
}

function setEyes(svg, type) {
  setEyesWithDirection(svg, type, 0, 0);
}

// Quick natural blinks while the eyes are open; never while closed or mid-effect
function startBlinking(svg) {
  const blinkable = new Set(['open', 'wide', 'blink', 'half']);
  (function next() {
    setTimeout(() => {
      if (blinkable.has(svg.dataset.eyes)) {
        svg.classList.add('blinking');
        setTimeout(() => svg.classList.remove('blinking'), 170);
      }
      next();
    }, 2500 + Math.random() * 4500);
  })();
}

// --- Mouth (small white marks under the eyes; no mouth is the resting look) ---

function setMouth(svg, type) {
  const g = svg.querySelector('.sit .mouth');
  g.innerHTML = '';
  const stroke = { fill: 'none', stroke: '#fff', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  switch (type) {
    case 'small-o':
      el('circle', { cx: 100, cy: 104, r: 3, fill: '#fff' }, g);
      break;
    case 'talking':
      el('ellipse', { cx: 100, cy: 104, rx: 4, ry: 5, fill: '#fff' }, g);
      break;
    case 'big-smile':
      el('path', { d: 'M92 101 Q 96 107 100 102 Q 104 107 108 101', ...stroke }, g);
      break;
    case 'wavy':
      el('path', { d: 'M92 105 Q 96 101 100 105 Q 104 109 108 105', ...stroke }, g);
      break;
    case 'tongue':
      el('path', { d: 'M93 101 Q 96 105 100 101 Q 104 105 107 101', ...stroke }, g);
      el('ellipse', { cx: 100, cy: 108, rx: 3.5, ry: 4.5, fill: '#ff8fa3' }, g);
      break;
    default:
      break; // 'grin' and anything else: calm, no mouth
  }
}

// --- Body animations on the container (CSS classes in index.html) ---

function setAnimation(container, type) {
  const isSquishing = container.classList.contains('squish');
  container.className = '';
  if (isSquishing) container.classList.add('squish');
  container.classList.add(`anim-${type}`);
}

function squish(container) {
  container.classList.add('squish');
  setTimeout(() => container.classList.remove('squish'), 300);
}

// One-shot flourish on the drawing itself: ear-twitch | tail-flick | whisker-twitch
function playFlourish(svg, name, ms = 900) {
  svg.classList.add(name);
  setTimeout(() => svg.classList.remove(name), ms);
}

// --- Side-on walk: four two-segment legs solved with simple IK, cat walk order (hind, front, other hind, other front) ---
// Front legs bend at the wrist (joint forward); hind legs bend at the hock (joint backward), like a real cat.

const GROUND = 229, STRIDE = 42, LIFT = 12, STANCE = 0.6;
const STEPS_PER_SECOND = 2.1; // matches the window's stroll speed so paws barely slide

function createWalkCycle(walk) {
  const legSpecs = [
    { hip: 92, hipY: 170, off: 0.0, near: true, front: false },
    { hip: 154, hipY: 170, off: 0.25, near: true, front: true },
    { hip: 100, hipY: 168, off: 0.5, near: false, front: false },
    { hip: 161, hipY: 168, off: 0.75, near: false, front: true },
  ].map((l) => ({
    ...l,
    upper: l.front ? 29 : 32, lower: l.front ? 28 : 30, bend: l.front ? 1 : -1,
    widths: l.front ? [12, 6.5, 5.5] : [16, 7, 5.5], // at the body, at the joint, at the paw
  }));
  const legs = legSpecs.map((l) => {
    const colour = l.near ? '#111' : '#333';
    const g = el('g', {}, walk.querySelector(l.near ? '.near-legs' : '.far-legs'));
    // Thicker at the top, thinner at the paw: two strokes
    // One tapered shape per leg; a thin outline in the same colour rounds the joints
    const shape = el('path', { fill: colour, stroke: colour, 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
    const paw = el('ellipse', { rx: 6, ry: 3.4, fill: colour }, g);
    return { ...l, shape, paw };
  });
  const body = walk.querySelector('.walk-body');
  const head = walk.querySelector('.walk-head');
  const tail = walk.querySelector('.walk-tail');

  const ease = (s) => s * s * (3 - 2 * s);
  const footAt = (l, t) => {
    if (t < STANCE) return { x: l.hip + STRIDE / 2 - STRIDE * (t / STANCE), y: GROUND };
    const s = (t - STANCE) / (1 - STANCE);
    return { x: l.hip - STRIDE / 2 + STRIDE * ease(s), y: GROUND - Math.sin(Math.PI * s) * LIFT };
  };
  // Joint between hip and paw; bend +1 puts it in front of the line (wrist), -1 behind it (hock)
  const joint = (l, hx, hy, fx, fy) => {
    const dx = fx - hx, dy = fy - hy;
    const d = Math.min(Math.hypot(dx, dy), l.upper + l.lower - 0.5);
    const a = (l.upper * l.upper - l.lower * l.lower + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l.upper * l.upper - a * a));
    const ux = dx / d, uy = dy / d;
    return { x: hx + ux * a - l.bend * uy * h, y: hy + uy * a + l.bend * ux * h };
  };

  // Outline of a leg through points p0 (body) → p1 (joint) → p2 (paw), widths w at each point
  const legOutline = (pts, w) => {
    const side = (sign) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      return { x: p.x - (dy / len) * (w[i] / 2) * sign, y: p.y + (dx / len) * (w[i] / 2) * sign };
    });
    const left = side(1), right = side(-1).reverse();
    return 'M' + [...left, ...right].map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L') + ' Z';
  };

  // Tail: one shape tapering from the body to a rounded tip, built along its centre line
  const tailLine = walk.querySelector('.tail-line');
  const tailShape = walk.querySelector('.tail-shape');
  try {
    const total = tailLine.getTotalLength();
    const pts = [], widths = [];
    for (let i = 0; i <= 28; i++) {
      const p = tailLine.getPointAtLength((total * i) / 28);
      pts.push({ x: p.x, y: p.y });
      widths.push(10 - 6 * (i / 28));
    }
    tailShape.setAttribute('d', legOutline(pts, widths));
    el('circle', { cx: pts[pts.length - 1].x, cy: pts[pts.length - 1].y, r: 2, fill: '#111' }, tailShape.parentNode);
  } catch { tailLine.setAttribute('stroke', '#111'); tailLine.setAttribute('stroke-width', '6'); tailLine.setAttribute('stroke-linecap', 'round'); }

  let phase = 0, raf = null, last = 0;
  function draw() {
    // Shoulders and hips rise a little as each leg passes under them; the head stays almost level
    const bob = Math.sin(phase * Math.PI * 4) * 1.4;
    body.setAttribute('transform', `translate(0 ${bob.toFixed(2)})`);
    head.setAttribute('transform', `translate(0 ${(-bob * 0.6).toFixed(2)})`);
    tail.setAttribute('transform', `rotate(${(Math.sin(phase * Math.PI * 2) * 5).toFixed(2)} 76 148)`);
    for (const l of legs) {
      const t = ((phase + l.off) % 1 + 1) % 1;
      const f = footAt(l, t), hy = l.hipY + bob;
      const fy = f.y - 4;
      const k = joint(l, l.hip, hy, f.x, fy);
      l.shape.setAttribute('d', legOutline([{ x: l.hip, y: hy }, k, { x: f.x, y: fy }], l.widths));
      l.paw.setAttribute('cx', (f.x + 3).toFixed(1));
      l.paw.setAttribute('cy', (f.y - 2.5).toFixed(1));
    }
  }
  function frame(now) {
    phase += Math.min(0.05, (now - last) / 1000) * STEPS_PER_SECOND;
    last = now;
    draw();
    raf = requestAnimationFrame(frame);
  }
  draw();

  return {
    start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } },
    // For previews: draw one moment of the cycle
    pose(p) { phase = p; draw(); },
  };
}

// pose: 'sit' (front-on), 'walk' (side-on, facing `direction`, legs moving)
// or 'cling' (side-on, paws still — how she rests on a wall or the ceiling; keeps her facing)
function setPose(svg, pose, direction = 'right') {
  svg.classList.toggle('walking', pose === 'walk' || pose === 'cling');
  if (pose === 'walk') svg.classList.toggle('facing-left', direction === 'left');
  if (pose === 'sit') svg.classList.remove('facing-left');
  if (pose === 'walk') svg._walk.start();
  else svg._walk.stop();
}
