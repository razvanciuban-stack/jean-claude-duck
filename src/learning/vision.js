// vision.js — throttled, capped queue that gets screenshots described by a local vision model
// One describe in flight at a time, >= minIntervalMs between starts; screenshots live in memory only.
const { chat } = require('../services/ollama');
const { redact } = require('./redact');
const { VISION_MODEL, VISION_QUEUE_CAP, VISION_MIN_INTERVAL_MS, VISION_TIMEOUT_MS, LEARNING_NUM_CTX } = require('./config');

const DESCRIBE_PROMPT = 'Two screenshots: before and after one user action (or only after). In one sentence, describe what the user just did and what changed. Name the app and the UI element. Do not repeat any passwords, keys or numbers you can read.';

function defaultDescribe(prevJpeg, jpeg) {
  const images = prevJpeg ? [prevJpeg, jpeg] : [jpeg];
  return chat({
    model: VISION_MODEL,
    think: false,
    messages: [{ role: 'user', content: DESCRIBE_PROMPT, images }],
    options: { num_predict: 60, num_ctx: LEARNING_NUM_CTX },
    timeoutMs: VISION_TIMEOUT_MS,
  });
}

function createVisionQueue({
  describe = defaultDescribe,
  onDescription,
  cap = VISION_QUEUE_CAP,
  minIntervalMs = VISION_MIN_INTERVAL_MS,
} = {}) {
  let items = [];      // [{ stepId, jpeg }] waiting
  let prev = null;     // last jpeg described/attempted — the next item's "before"
  let inFlight = false;
  let waiting = false; // min-interval gap since last start
  let timer = null;
  let stopped = false;

  function size() {
    return stopped ? 0 : items.length + (inFlight ? 1 : 0);
  }

  function pump() {
    if (stopped || inFlight || waiting || items.length === 0) return;
    const { stepId, jpeg } = items.shift();
    const before = prev;
    prev = jpeg;
    inFlight = true;
    waiting = true;
    timer = setTimeout(() => {
      timer = null;
      waiting = false;
      pump();
    }, minIntervalMs);
    if (timer && typeof timer.unref === 'function') timer.unref();

    new Promise((resolve) => resolve(describe(before, jpeg)))
      .then((text) => {
        if (stopped) return;
        onDescription(stepId, redact(String(text == null ? '' : text)).text);
      })
      .catch(() => { console.error('vision: describe failed'); })
      .then(() => {
        inFlight = false;
        pump();
      });
  }

  function push(stepId, jpeg) {
    if (stopped) return;
    items.push({ stepId, jpeg });
    while (size() > cap && items.length > 0) items.shift(); // drop oldest, releasing its jpeg
    pump();
  }

  function stop() {
    stopped = true;
    items = [];
    prev = null;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { push, size, stop };
}

module.exports = { createVisionQueue, defaultDescribe, DESCRIBE_PROMPT };
