const test = require('node:test');
const assert = require('node:assert');
const { pointAt, nearestS, edgeRange, route, toLocal, spans } = require('../src/windows/perimeter');

// A 1000×600 work area starting below a 25px menu bar; the window is 180px square
const B = { x: 0, y: 25, width: 1000, height: 600 };
const SIZE = 180;
const { W, H, P } = spans(B, SIZE); // W = 820, H = 420

test('corners of the loop land exactly in the work area corners', () => {
  assert.deepStrictEqual(pointAt(B, 0, SIZE), { x: 0, y: 445, edge: 'floor' });
  assert.deepStrictEqual(pointAt(B, W, SIZE), { x: 820, y: 445, edge: 'right' });
  assert.deepStrictEqual(pointAt(B, W + H, SIZE), { x: 820, y: 25, edge: 'ceiling' });
  assert.deepStrictEqual(pointAt(B, 2 * W + H, SIZE), { x: 0, y: 25, edge: 'left' });
  assert.deepStrictEqual(pointAt(B, P, SIZE), pointAt(B, 0, SIZE));
});

test('every point of the loop keeps the window fully inside the work area', () => {
  for (let s = -50; s < P + 50; s += 7) {
    const p = pointAt(B, s, SIZE);
    assert.ok(p.x >= B.x && p.x + SIZE <= B.x + B.width, `x out at s=${s}`);
    assert.ok(p.y >= B.y && p.y + SIZE <= B.y + B.height, `y out at s=${s}`);
  }
});

test('nearestS snaps a dropped window onto the closest edge', () => {
  assert.strictEqual(pointAt(B, nearestS(B, 400, 430, SIZE), SIZE).edge, 'floor');
  assert.strictEqual(pointAt(B, nearestS(B, 810, 200, SIZE), SIZE).edge, 'right');
  assert.strictEqual(pointAt(B, nearestS(B, 400, 30, SIZE), SIZE).edge, 'ceiling');
  assert.strictEqual(pointAt(B, nearestS(B, -40, 200, SIZE), SIZE).edge, 'left'); // dragged off-screen
  const s = nearestS(B, 400, 445, SIZE);
  assert.deepStrictEqual(pointAt(B, s, SIZE), { x: 400, y: 445, edge: 'floor' });
});

test('edgeRange covers the loop without gaps', () => {
  assert.deepStrictEqual(edgeRange(B, 'floor', SIZE), [0, W]);
  assert.deepStrictEqual(edgeRange(B, 'left', SIZE), [2 * W + H, P]);
});

test('route takes the shorter way round', () => {
  assert.deepStrictEqual(route(B, 100, 300, SIZE), { dir: 1, distance: 200 });
  assert.deepStrictEqual(route(B, 100, P - 100, SIZE), { dir: -1, distance: 200 });
});

test('toLocal turns screen directions into her frame on each edge', () => {
  assert.deepStrictEqual(toLocal('floor', 1, 0), { dx: 1, dy: 0 });
  // On the right wall her "up" points left across the screen
  assert.deepStrictEqual(toLocal('right', -1, 0), { dx: 0, dy: -1 });
  // On the ceiling everything is flipped
  assert.deepStrictEqual(toLocal('ceiling', 1, 1), { dx: -1, dy: -1 });
  // On the left wall her "up" points right
  assert.deepStrictEqual(toLocal('left', 1, 0), { dx: 0, dy: -1 });
});
