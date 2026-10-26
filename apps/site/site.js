(() => {
  const d = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const status = d.getElementById('status');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Copy buttons: label, colour and a polite announcement all change together.
  for (const b of d.querySelectorAll('[data-copy]')) {
    const target = d.getElementById(b.dataset.copy);
    let timer;
    const say = (label, state, note) => {
      clearTimeout(timer);
      b.textContent = label;
      if (label === 'Copy') {
        const s = d.createElement('span');
        s.className = 'sr';
        s.textContent = ' install commands';
        b.append(s);
      }
      if (state) b.dataset.state = state;
      else delete b.dataset.state;
      if (status) status.textContent = note;
      timer = setTimeout(() => {
        b.textContent = 'Copy';
        delete b.dataset.state;
        if (status) status.textContent = '';
      }, 1800);
    };
    const text = () => {
      const lines = target.querySelectorAll('.line');
      if (!lines.length) return target.textContent.trim();
      return [...lines].map((l) => l.textContent.replace(/^\$ /, '')).join('\n');
    };
    const legacy = () => {
      const t = d.createElement('textarea');
      t.value = text();
      t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;opacity:0';
      d.body.append(t);
      t.select();
      let ok = false;
      try {
        ok = d.execCommand('copy');
      } catch {}
      t.remove();
      return ok;
    };
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text());
        say('Copied', 'copied', 'Commands copied to the clipboard.');
      } catch {
        if (legacy()) say('Copied', 'copied', 'Commands copied to the clipboard.');
        else say('Select text', '', 'Copy failed. Select the commands and copy them.');
      }
    });
  }

  // Reveal on scroll, only when the script flagged <html> and motion is welcome.
  const rv = d.querySelectorAll('.rv');
  if (reduce || !('IntersectionObserver' in window)) {
    for (const e of rv) e.classList.add('in');
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' },
    );
    for (const e of rv) io.observe(e);
  }

  // Terminal demo.
  const term = d.getElementById('term');
  if (!term) return;
  const lines = [...term.querySelectorAll('.l')];
  const replay = d.getElementById('replay');
  const cur = d.createElement('span');
  cur.className = 'cur';
  cur.setAttribute('aria-hidden', 'true');
  let run = 0;

  const reset = () => {
    for (const l of lines) {
      l.classList.remove('on');
      if (l.dataset.type) l.textContent = l.dataset.type;
    }
  };
  // Typed line: written text, the cursor, then the unwritten rest as an
  // invisible ghost. The line is always its final height.
  const typed = (l) => {
    const full = l.dataset.type;
    const t = d.createTextNode('');
    const ghost = d.createElement('span');
    ghost.className = 'ghost';
    ghost.textContent = full;
    l.textContent = '';
    l.append(t, cur, ghost);
    l.classList.add('on');
    return { full, t, ghost };
  };

  if (reduce) {
    for (const l of lines) l.classList.add('on');
    if (replay) replay.hidden = true;
    return;
  }

  // Idle: a caret waits where the first command will appear.
  const idle = () => {
    reset();
    typed(lines[0]).t.data = '';
  };
  idle();

  async function play() {
    const id = ++run;
    started = true;
    if (replay) replay.disabled = true;
    reset();
    for (const l of lines) {
      if (id !== run) return;
      if (l.dataset.type) {
        const { full, t, ghost } = typed(l);
        for (let i = 0; i < full.length; i++) {
          if (id !== run) return;
          t.data = full.slice(0, i + 1);
          ghost.textContent = full.slice(i + 1);
          await wait(26 + Math.random() * 30);
        }
        ghost.remove();
        await wait(450);
      } else {
        l.classList.add('on');
        l.append(cur);
        await wait(Number(l.dataset.delay || 420));
      }
    }
    if (id === run && replay) replay.disabled = false;
  }

  let started = false;
  const io = new IntersectionObserver(
    (es) => {
      if (es[0].isIntersecting && !started) {
        started = true;
        io.disconnect();
        play();
      }
    },
    { threshold: 0.4 },
  );
  io.observe(term);
  replay?.addEventListener('click', play);
})();
