(() => {
  const d = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  d.documentElement.classList.add('js');

  for (const b of d.querySelectorAll('[data-copy]')) {
    b.addEventListener('click', async () => {
      const text = d.getElementById(b.dataset.copy).textContent.replace(/^\$ /gm, '').trim();
      try {
        await navigator.clipboard.writeText(text);
        b.textContent = 'Copied';
      } catch {
        b.textContent = 'Select text';
      }
      setTimeout(() => {
        b.textContent = 'Copy';
      }, 1800);
    });
  }

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
      { threshold: 0.12 },
    );
    for (const e of rv) io.observe(e);
  }

  const term = d.getElementById('term');
  if (!term) return;
  const lines = [...term.querySelectorAll('.l')];
  const replay = d.getElementById('replay');
  const cur = d.createElement('span');
  cur.className = 'cur';
  cur.setAttribute('aria-hidden', 'true');
  let run = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function play() {
    const id = ++run;
    for (const l of lines) l.classList.remove('on');
    for (const l of lines) {
      if (id !== run) return;
      const full = l.dataset.type;
      l.classList.add('on');
      if (full) {
        l.textContent = '';
        l.append(cur);
        for (const ch of full) {
          if (id !== run) return;
          cur.before(ch);
          await wait(24 + Math.random() * 30);
        }
        await wait(450);
      } else {
        await wait(Number(l.dataset.delay || 420));
      }
    }
    if (id === run) term.append(cur);
  }

  if (reduce) {
    for (const l of lines) {
      l.classList.add('on');
      if (l.dataset.type) l.textContent = l.dataset.type;
    }
    if (replay) replay.hidden = true;
  } else {
    let started = false;
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && !started) {
        started = true;
        play();
      }
    });
    io.observe(term);
    replay?.addEventListener('click', play);
  }
})();
