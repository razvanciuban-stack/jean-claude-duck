const { ipcRenderer } = require('electron');

let isTyping = false;

function typewriter(element, text, speed = 25) {
  return new Promise((resolve) => {
    isTyping = true;
    element.textContent = '';

    if (!text || text.length === 0) {
      element.textContent = '...';
      isTyping = false;
      resolve();
      return;
    }

    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) {
        element.textContent = text.substring(0, i + 1);
        i++;
      } else {
        clearInterval(interval);
        isTyping = false;
        resolve();
      }
    }, speed);
  });
}

function init() {
  const input = document.getElementById('chat-input');
  const responseEl = document.getElementById('response-text');
  const bubble = document.getElementById('bubble');

  // Add close button
  const closeBtn = document.createElement('div');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'position:absolute;top:6px;right:10px;cursor:pointer;font-size:14px;color:#888;z-index:10;';
  closeBtn.addEventListener('click', () => ipcRenderer.send('chat:dismiss'));
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#fff');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#888');
  bubble.style.position = 'relative';
  bubble.appendChild(closeBtn);

  input.focus();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      ipcRenderer.send('chat:dismiss');
      return;
    }
    if (e.key === 'Enter' && input.value.trim()) {
      const message = input.value.trim();
      input.value = '';
      responseEl.textContent = '💭 thinking...';
      ipcRenderer.send('chat:send', { message });
    }
  });

  bubble.addEventListener('click', () => input.focus());

  ipcRenderer.on('chat:response', async (event, { text }) => {
    await typewriter(responseEl, text);
    input.focus();
  });

  ipcRenderer.on('chat:error', async (event, { error }) => {
    await typewriter(responseEl, error);
    input.focus();
  });
}
