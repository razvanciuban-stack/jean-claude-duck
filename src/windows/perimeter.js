// perimeter.js — Mysthi's path around the inside edge of a screen
//
// The pet window (a square of `size` px) travels along the inside of a display's work area.
// A position on that loop is a distance `s`, measured counter-clockwise from the bottom-left corner:
//   floor   — along the bottom, left → right
//   right   — up the right wall, bottom → top
//   ceiling — along the top, right → left
//   left    — down the left wall, top → bottom
// Each edge has the rotation (CSS degrees) that puts her paws against it.

const EDGE_ANGLE = { floor: 0, right: -90, ceiling: 180, left: 90 };

function spans(bounds, size) {
  const W = Math.max(1, bounds.width - size);
  const H = Math.max(1, bounds.height - size);
  return { W, H, P: 2 * W + 2 * H };
}

const wrap = (s, P) => ((s % P) + P) % P;

// Window top-left position and edge for loop distance s
function pointAt(bounds, s, size) {
  const { W, H, P } = spans(bounds, size);
  const left = bounds.x, top = bounds.y, right = left + W, bottom = top + H;
  const d = wrap(s, P);
  if (d < W) return { x: left + d, y: bottom, edge: 'floor' };
  if (d < W + H) return { x: right, y: bottom - (d - W), edge: 'right' };
  if (d < 2 * W + H) return { x: right - (d - W - H), y: top, edge: 'ceiling' };
  return { x: left, y: top + (d - 2 * W - H), edge: 'left' };
}

// Loop distance of the point on the path closest to window position (x, y)
function nearestS(bounds, x, y, size) {
  const { W, H } = spans(bounds, size);
  const cx = Math.min(Math.max(x - bounds.x, 0), W);
  const cy = Math.min(Math.max(y - bounds.y, 0), H);
  const candidates = [
    { dist: H - cy, s: cx },                    // floor
    { dist: W - cx, s: W + (H - cy) },          // right wall
    { dist: cy, s: W + H + (W - cx) },          // ceiling
    { dist: cx, s: 2 * W + H + cy },            // left wall
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0].s;
}

// Distance range [start, end) of one edge on the loop
function edgeRange(bounds, edge, size) {
  const { W, H } = spans(bounds, size);
  switch (edge) {
    case 'floor': return [0, W];
    case 'right': return [W, W + H];
    case 'ceiling': return [W + H, 2 * W + H];
    default: return [2 * W + H, 2 * W + 2 * H];
  }
}

// Shortest way round from s to target: { dir: +1 counter-clockwise | -1 clockwise, distance }
function route(bounds, s, target, size) {
  const { P } = spans(bounds, size);
  const ccw = wrap(target - s, P);
  return ccw <= P / 2 ? { dir: 1, distance: ccw } : { dir: -1, distance: P - ccw };
}

// Turn a screen-space vector into her own frame of reference on an edge (for eye tracking)
function toLocal(edge, dx, dy) {
  const phi = (-EDGE_ANGLE[edge] * Math.PI) / 180;
  const c = Math.round(Math.cos(phi)), s = Math.round(Math.sin(phi));
  return { dx: dx * c - dy * s + 0, dy: dx * s + dy * c + 0 }; // + 0 turns -0 into 0
}

module.exports = { EDGE_ANGLE, spans, pointAt, nearestS, edgeRange, route, toLocal };
