// states.js — runs in MAIN PROCESS only. Renderer receives results via IPC.

function evaluate({ battery, charging, hour, isTalking, hasError, isIdle }) {
  if (isTalking) return 'talking';
  if ((battery < 20 && !charging) || hasError) return 'worried';
  if (hour >= 22 || hour <= 5) return 'sleepy';
  if (isIdle) return 'idle';
  return 'happy';
}

// Returns SVG attributes for the given state
function getExpression(state) {
  switch (state) {
    case 'happy':
      return { eyes: 'open', mouth: 'grin', animation: 'bounce' };
    case 'sleepy':
      return { eyes: 'half', mouth: 'small-o', animation: 'float' };
    case 'worried':
      return { eyes: 'wide', mouth: 'wavy', animation: 'shake' };
    case 'talking':
      return { eyes: 'open', mouth: 'talking', animation: 'bounce-fast' };
    case 'idle':
      return { eyes: 'blink', mouth: 'grin', animation: 'bob' };
    default:
      return { eyes: 'open', mouth: 'grin', animation: 'bounce' };
  }
}

module.exports = { evaluate, getExpression };
