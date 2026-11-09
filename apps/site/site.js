(() => {
  const d = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const status = d.getElementById('status');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- Copy button: label, colour and a polite announcement change together.
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
    const text = () =>
      [...target.querySelectorAll('.line')].map((l) => l.textContent.replace(/^\$ /, '')).join('\n');
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

  // ---- Entrances: once, as each part scrolls in.
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
      { threshold: 0.01, rootMargin: '0px 0px -4% 0px' },
    );
    for (const e of rv) io.observe(e);
  }

  // ---- Pinned story: the stage follows whichever statement is in view.
  const stage = d.getElementById('stage');
  const steps = [...d.querySelectorAll('.how-steps li')];
  if (stage && steps.length && 'IntersectionObserver' in window) {
    const set = (n) => {
      stage.dataset.state = n;
      for (const s of steps) s.classList.toggle('on', s.dataset.step === n);
    };
    set('1');
    const so = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) set(e.target.dataset.step);
      },
      { rootMargin: '-40% 0px -40% 0px' },
    );
    for (const s of steps) so.observe(s);
  }

  // ---- Hero: a sample task plays back, then waits for the visitor's yes or no.
  const demo = d.getElementById('demo');
  if (!demo) return;
  const seq = [...demo.querySelectorAll('[data-seq]')];
  const ask = d.getElementById('ask');
  const result = d.getElementById('result');
  const approve = d.getElementById('approve');
  const decline = d.getElementById('decline');
  const replay = d.getElementById('replay');
  const card = ask.querySelector('.card');
  const mark = ask.querySelector('.tx');
  let run = 0;
  let decided = false;

  const resetDemo = () => {
    decided = false;
    for (const s of seq) s.classList.remove('shown');
    ask.className = 'step wait';
    ask.dataset.seq = '';
    mark.innerHTML = '<b>Write file</b> <span class="dim">waiting for your OK</span>';
    card.hidden = false;
    result.textContent = '';
  };

  const play = async () => {
    const me = ++run;
    resetDemo();
    if (reduce) {
      for (const s of seq) s.classList.add('shown');
      return;
    }
    await wait(700);
    for (const s of seq) {
      if (me !== run) return;
      s.classList.add('shown');
      await wait(s === seq[seq.length - 2] ? 650 : 520);
    }
  };

  const decide = (yes) => {
    if (decided) return;
    decided = true;
    card.hidden = true;
    ask.classList.remove('wait');
    if (yes) {
      ask.classList.add('done');
      mark.innerHTML = '<b>Write file</b> reply.md <span class="dim">you approved</span>';
      result.textContent =
        'Draft saved to reply.md. Northwind is $1,240 cheaper over twelve months. Nothing has been sent.';
    } else {
      ask.classList.add('done');
      mark.innerHTML = '<b>Write file</b> <span class="dim">you declined, nothing was written</span>';
      result.textContent = 'Understood. reply.md was not written. What should change?';
    }
    if (status) status.textContent = result.textContent;
  };

  approve.addEventListener('click', () => decide(true));
  decline.addEventListener('click', () => decide(false));
  replay.addEventListener('click', play);
  d.addEventListener('keydown', (e) => {
    if (decided || !demo.matches(':hover, :focus-within')) return;
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      decide(true);
    }
    if (e.key === 'Escape') decide(false);
  });

  // Start when the hero is on screen, which is at load.
  if ('IntersectionObserver' in window) {
    const ho = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        ho.disconnect();
        play();
      }
    });
    ho.observe(demo);
  } else play();
})();
