// chat.js — the chat page. Everything from the model or a note is shown with textContent, never as HTML.
const list = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const keepBtn = document.getElementById('keep');
const clearBtn = document.getElementById('clear');
const status = document.getElementById('status');
const mode = document.getElementById('mode');
const modeText = document.getElementById('mode-text');
const modeCancel = document.getElementById('mode-cancel');
let busy = false;
let correcting = null; // { path, title } while you write the right version of a note

function scrollDown() { list.scrollTop = list.scrollHeight; }

function showEmpty() {
  list.textContent = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Miaw! Ask me anything — in English or Română. Say “remember …” or “ține minte …” and I’ll keep it as a note. I only talk; I never click or type for you.';
  list.appendChild(p);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function bubble(role, text) {
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  const b = el('div', `msg ${role}`, text);
  list.appendChild(b);
  scrollDown();
  return b;
}

function thinkingBubble() {
  const b = bubble('assistant', '');
  const dots = el('span', 'dots');
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
  b.appendChild(dots);
  return b;
}

const isMine = (s) => s && s.source === 'user-explicit' && /^memory\/[^/]+\.md$/.test(s.path);

// Chips for the notes an answer used, placed right after its bubble. Grouped by where each note came from,
// as the app knows it: what you told her, and what she noticed on your screen (which may be wrong).
function showSources(after, sources) {
  if (!sources || !sources.length) return;
  const row = el('div', 'sources');
  const told = sources.filter((s) => s && s.source === 'user-explicit');
  const seen = sources.filter((s) => s && s.source !== 'user-explicit');
  for (const [label, group] of [['You told me:', told], ['I noticed:', seen]]) {
    if (!group.length) continue;
    row.appendChild(el('span', 'label', label));
    addChips(row, group);
  }
  after.after(row);
  scrollDown();
}

function addChips(row, sources) {
  for (const s of sources) {
    const chip = el('span', isMine(s) ? 'chip mine' : 'chip');
    const open = el('button', 'open', s.title || s.path);
    open.title = `Open ${s.path}`;
    open.addEventListener('click', async () => {
      const r = await window.mysthi.open(s.path);
      if (!r.ok) bubble('note', `${s.path}: ${r.error}`);
    });
    chip.appendChild(open);
    if (isMine(s)) {
      const fix = el('button', 'act', 'Correct');
      fix.title = 'Write the right version of this note';
      fix.addEventListener('click', () => startCorrecting(s));
      const del = el('button', 'act', 'Delete');
      del.title = 'Move this note to Mysthi’s trash';
      del.addEventListener('click', () => confirmDelete(row, s));
      chip.append(fix, del);
    }
    row.appendChild(chip);
  }
}

function startCorrecting(s) {
  correcting = { path: s.path, title: s.title || s.path };
  modeText.textContent = `Correcting “${correcting.title}” — write the right version and press Send.`;
  mode.hidden = false;
  keepBtn.hidden = true;
  input.placeholder = 'The right version…';
  input.focus();
}

function stopCorrecting() {
  correcting = null;
  mode.hidden = true;
  keepBtn.hidden = false;
  input.placeholder = 'Talk to Mysthi… (start with “remember” to save a note)';
}

// Asked here in the window (no pop-up): delete, and optionally forget the messages about it
function confirmDelete(row, s) {
  if (row.nextSibling && row.nextSibling.classList && row.nextSibling.classList.contains('confirm')) return;
  const box = el('div', 'confirm');
  box.appendChild(el('div', '', `Delete “${s.title || s.path}”? It moves to Mysthi’s trash (mysthi/.trash) and she stops using it.`));
  const label = el('label');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = true;
  label.append(check, document.createTextNode('Also remove our chat messages about it'));
  const buttons = el('div', 'row');
  const yes = el('button', 'danger', 'Delete');
  const no = el('button', '', 'Cancel');
  buttons.append(yes, no);
  box.append(label, buttons);
  row.after(box);
  scrollDown();
  no.addEventListener('click', () => box.remove());
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    const r = await window.mysthi.remove(s.path, check.checked);
    box.remove();
    if (!r.ok) { bubble('error', r.error); return; }
    if (r.dropped) await renderHistory();
    bubble('note', r.message);
    if (correcting && correcting.path === s.path) stopCorrecting();
  });
}

function setBusy(on) {
  busy = on;
  sendBtn.disabled = on || !input.value.trim();
  keepBtn.disabled = sendBtn.disabled;
  status.textContent = on ? 'thinking…' : '';
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

async function send(remember = false) {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  autosize();

  if (correcting) {
    const target = correcting;
    bubble('user', `Correction: ${text}`);
    setBusy(true);
    const r = await window.mysthi.correct(target.path, text);
    setBusy(false);
    if (r.ok) {
      stopCorrecting();
      showSources(bubble('assistant', r.reply), r.sources);
    } else {
      bubble('error', r.error);
    }
    input.focus();
    return;
  }

  bubble('user', text);
  const reply = thinkingBubble();
  let got = '';
  window.mysthi.onToken((piece) => {
    got += piece;
    reply.textContent = got; // replaces the dots with the text as it arrives
    scrollDown();
  });
  setBusy(true);
  // No words yet after a few seconds: her model is probably finishing a note-making request first
  const slow = setTimeout(() => { if (!got) status.textContent = 'her model is busy — probably finishing notes. Hang on…'; }, 8000);
  const result = await window.mysthi.send(text, remember === true);
  clearTimeout(slow);
  setBusy(false);
  if (result.ok) {
    reply.textContent = result.reply || got || '…';
    showSources(reply, result.sources);
  } else {
    if (!got) reply.remove();
    bubble('error', result.error);
  }
  input.focus();
}

async function renderHistory() {
  const past = await window.mysthi.history();
  list.textContent = '';
  if (!past.length) { showEmpty(); return; }
  for (const m of past) {
    const b = bubble(m.role === 'user' ? 'user' : 'assistant', m.content);
    if (m.role !== 'user') showSources(b, m.sources);
  }
}

input.addEventListener('input', () => { autosize(); sendBtn.disabled = busy || !input.value.trim(); keepBtn.disabled = sendBtn.disabled; });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  if (e.key === 'Escape' && correcting) stopCorrecting();
});
sendBtn.addEventListener('click', () => send());
keepBtn.addEventListener('click', () => send(true));
modeCancel.addEventListener('click', () => { stopCorrecting(); input.focus(); });
clearBtn.addEventListener('click', async () => {
  if (busy) return;
  await window.mysthi.clear();
  stopCorrecting();
  showEmpty();
  bubble('note', 'Conversation cleared. Your notes in mysthi/ are kept — delete a note from its chip, or in Obsidian.');
  input.focus();
});

(async () => {
  await renderHistory();
  input.focus();
})();
