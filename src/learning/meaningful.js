// meaningful.js — what is worth learning from: steps with real names, tasks long enough to teach, useful facts

const MIN_LESSON_STEPS = 3; // a "lesson" of one or two clicks teaches nothing

const filled = (v) => typeof v === 'string' && v.trim() !== '';

// A step counts if we know what was done to what: a named control or menu item, a shortcut, typed text or a command.
// Clicks on unnamed elements (an app that exposes only "AXScrollArea", say) don't, even with a screenshot description.
function isMeaningful(step) {
  if (!step) return false;
  if (step.action === 'shortcut') return filled(step.keys);
  if (step.action === 'type' || step.action === 'command') return filled(step.value);
  const t = step.target || {};
  return filled(t.title) || filled(t.description) || (Array.isArray(t.menuPath) && t.menuPath.some(filled));
}

// Accessibility jargon from her own recordings is not knowledge about the user
const JARGON = /\bAX[A-Z][A-Za-z]*\b|\baccessibility\b|\bUI elements?\b|\bstep ids?\b/i;
// "Uses the application named 'Claude'." — true, but says nothing
const BARE_APP = /^(the user )?uses? (the )?(app|application)( named| called)? ['"]?[^'"]{1,40}['"]?\.?$/i;

function isUsefulFact(f) {
  if (!f || typeof f.fact !== 'string' || typeof f.topic !== 'string') return false;
  const text = f.fact.trim();
  if (text.length < 12) return false;
  return !JARGON.test(text) && !JARGON.test(f.topic) && !BARE_APP.test(text);
}

module.exports = { MIN_LESSON_STEPS, isMeaningful, isUsefulFact };
