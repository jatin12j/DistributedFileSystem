// frontend/js/logger.js
// Activity log panel — newest entries appear at top

const Logger = {
  maxEntries: 150,

  log(msg, type = 'info') {
    const panel = document.getElementById('log-panel');
    if (!panel) return;

    const ts  = new Date().toLocaleTimeString('en-US', { hour12: false });
    const el  = document.createElement('div');
    el.className = `log-entry log-${type}`;

    const tsSpan  = document.createElement('span');
    tsSpan.className = 'log-ts';
    tsSpan.textContent = ts;

    const msgSpan = document.createElement('span');
    msgSpan.textContent = ' ' + msg;

    el.appendChild(tsSpan);
    el.appendChild(msgSpan);

    // Slide-in animation
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    panel.insertBefore(el, panel.firstChild);
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      el.style.opacity    = '1';
      el.style.transform  = 'translateY(0)';
    });

    // Trim old entries
    while (panel.children.length > this.maxEntries) {
      panel.removeChild(panel.lastChild);
    }
  },

  info   (msg) { this.log(msg, 'info');    },
  success(msg) { this.log(msg, 'success'); },
  warn   (msg) { this.log(msg, 'warn');    },
  error  (msg) { this.log(msg, 'error');   },

  clear() {
    const panel = document.getElementById('log-panel');
    if (panel) panel.innerHTML = '';
  },
};
