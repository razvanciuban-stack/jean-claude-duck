// slime.js — pixel-art RUBBER DUCK (classic bath duck shape)

function createSlimeSVG() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '120');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.style.imageRendering = 'pixelated';
  svg.style.shapeRendering = 'crispEdges';

  const px = (x, y, w, h, fill) => {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x); rect.setAttribute('y', y);
    rect.setAttribute('width', w); rect.setAttribute('height', h);
    rect.setAttribute('fill', fill);
    rect.classList.add('body');
    svg.appendChild(rect);
  };

  // === BODY (chubby, sits low) ===
  // Main yellow body
  px(3, 7, 10, 1, '#fbbf24');   // row 7
  px(2, 8, 12, 1, '#fbbf24');   // row 8
  px(1, 9, 13, 1, '#fbbf24');   // row 9
  px(1, 10, 13, 1, '#fbbf24');  // row 10
  px(1, 11, 13, 1, '#fbbf24');  // row 11
  px(2, 12, 12, 1, '#fbbf24');  // row 12
  px(3, 13, 10, 1, '#fbbf24');  // row 13
  px(4, 14, 8, 1, '#f59e0b');   // row 14 (bottom, darker)

  // Belly highlight (lighter center)
  px(4, 10, 7, 1, '#fcd34d');
  px(4, 11, 7, 1, '#fde68a');
  px(5, 12, 5, 1, '#fcd34d');

  // Body shadow (right and bottom edges)
  px(13, 9, 1, 3, '#d97706');
  px(12, 12, 2, 1, '#e5a20c');

  // === HEAD (round, top-left area) ===
  px(4, 2, 4, 1, '#fbbf24');    // row 2
  px(3, 3, 6, 1, '#fbbf24');    // row 3
  px(3, 4, 6, 1, '#fbbf24');    // row 4
  px(3, 5, 6, 1, '#fbbf24');    // row 5
  px(4, 6, 5, 1, '#fbbf24');    // row 6 (neck connects to body)

  // Head highlight (top sheen)
  px(5, 2, 2, 1, '#fde68a');
  px(4, 3, 2, 1, '#fcd34d');

  // === BEAK (red/orange, pointing left) ===
  px(1, 4, 2, 1, '#ef4444');    // top beak
  px(0, 5, 3, 1, '#dc2626');    // middle beak (widest)
  px(1, 6, 2, 1, '#ef4444');    // bottom beak

  // === TAIL (little point up on the right) ===
  px(12, 6, 2, 1, '#fbbf24');   // tail base
  px(13, 5, 1, 1, '#fbbf24');   // tail tip
  px(13, 4, 1, 1, '#f59e0b');   // tail top (slightly darker)

  // === WING (subtle line on body) ===
  px(4, 9, 6, 1, '#f59e0b');
  px(3, 10, 1, 2, '#e5a20c');
  px(10, 9, 1, 2, '#e5a20c');

  // (headband removed)

  // Eyes group
  const eyesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  eyesGroup.id = 'eyes';
  svg.appendChild(eyesGroup);

  // Mouth group (beak animations)
  const mouthGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  mouthGroup.id = 'mouth';
  svg.appendChild(mouthGroup);

  return svg;
}

// Eye with cursor tracking — single eye on duck head (right side visible)
function setEyesWithDirection(svg, type, dx, dy) {
  const g = svg.querySelector('#eyes');
  g.innerHTML = '';

  const px = (x, y, w, h, fill = '#1a1a2e') => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill);
    g.appendChild(r);
  };

  const ox = dx || 0;
  const oy = dy || 0;

  // Duck eye — side profile, centered on head (head spans cols 3-8, rows 2-5)
  // Eye sits at (6,3) — right-center of the head
  const ex = 6, ey = 3;
  switch (type) {
    case 'open':
      px(ex, ey, 2, 2, '#ffffff');  // eye white
      px(ex + Math.max(0, ox), ey + Math.max(0, oy), 1, 1); // pupil
      break;
    case 'half':
      px(ex, ey + 1, 2, 1, '#ffffff');
      px(ex + Math.max(0, ox), ey + 1, 1, 1);
      break;
    case 'wide':
      px(ex - 1, ey, 3, 3, '#ffffff');
      px(ex + ox, ey + 1 + oy, 1, 1);
      break;
    case 'blink':
      px(ex, ey + 1, 2, 1);
      break;
    case 'squish':
      px(ex, ey + 1, 2, 1);
      px(ex, ey, 1, 1); px(ex + 1, ey, 1, 1);
      break;
    case 'hearts':
      px(ex - 1, ey, 1, 1, '#ff6b6b'); px(ex + 1, ey, 1, 1, '#ff6b6b');
      px(ex - 1, ey + 1, 3, 1, '#ff6b6b');
      px(ex, ey + 2, 1, 1, '#ff6b6b');
      break;
    case 'stars':
      px(ex, ey + 1, 1, 1, '#ffd700');
      px(ex + 1, ey, 1, 1, '#ffd700');
      px(ex + 1, ey + 2, 1, 1, '#ffd700');
      px(ex - 1, ey + 1, 1, 1, '#ffd700');
      break;
    default:
      px(ex, ey, 2, 2, '#ffffff');
      px(ex, ey, 1, 1);
  }
}

function setEyes(svg, type) {
  setEyesWithDirection(svg, type, 0, 0);
}

function setMouth(svg, type) {
  const g = svg.querySelector('#mouth');
  g.innerHTML = '';
  const px = (x, y, w, h, fill = '#1a1a2e') => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill);
    g.appendChild(r);
  };
  // Beak is the mouth — animate the beak gap
  switch (type) {
    case 'grin':
      break; // beak closed, default look
    case 'small-o':
      px(1, 5, 1, 1, '#7c2d12'); // slight beak opening
      break;
    case 'wavy':
      px(0, 5, 1, 1, '#7c2d12');
      px(1, 6, 1, 1, '#7c2d12');
      break;
    case 'talking':
      px(0, 5, 2, 1, '#7c2d12'); // beak open
      px(1, 6, 2, 1, '#991b1b');
      break;
    case 'big-smile':
      px(0, 5, 3, 1, '#7c2d12');
      px(0, 6, 2, 1, '#991b1b');
      break;
    case 'tongue':
      px(1, 6, 1, 1, '#7c2d12');
      px(0, 7, 1, 1, '#ff6b6b'); // tongue out
      break;
    default:
      break;
  }
}

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
