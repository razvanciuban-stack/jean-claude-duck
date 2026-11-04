// chat.js — the chat page. Everything from the model is shown with textContent, never as HTML.
const list = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const clearBtn = document.getElementById('clear');
const status = document.getElementById('status');
let busy = false;

function scrollDown() { list.scrollTop = list.scrollHeight; }

function showEmpty() {
  list.textContent = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'Miaw! Ask me anything — in English or Română. I only talk; I never click or type for you.';
  list.appendChild(p);
}

function bubble(role, text) {
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  list.appendChild(el);
  scrollDown();
  return el;
}

function thinkingBubble() {
  const el = bubble('assistant', '');
  const dots = document.createElement('span');
  dots.className = 'dots';
  for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('i'));
  el.appendChild(dots);
  return el;
}

function setBusy(on) {
  busy = on;
  sendBtn.disabled = on || !input.value.trim();
  status.textContent = on ? 'thinking…' : '';
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

async function send() {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  autosize();
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
  const result = await window.mysthi.send(text);
  clearTimeout(slow);
  setBusy(false);
  if (result.ok) {
    reply.textContent = result.reply || got || '…';
  } else {
    if (!got) reply.remove();
    bubble('error', result.error);
  }
  input.focus();
}

input.addEventListener('input', () => { autosize(); sendBtn.disabled = busy || !input.value.trim(); });
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
sendBtn.addEventListener('click', send);
clearBtn.addEventListener('click', async () => {
  if (busy) return;
  await window.mysthi.clear();
  showEmpty();
  input.focus();
});

(async () => {
  const past = await window.mysthi.history();
  if (!past.length) showEmpty();
  else past.forEach((m) => bubble(m.role === 'user' ? 'user' : 'assistant', m.content));
  input.focus();
})();
