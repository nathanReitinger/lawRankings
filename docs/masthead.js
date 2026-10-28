// Law School Rankings: the masthead line (version, data timestamp) and the footer, shared by every page
(function () {
  'use strict';
  const MAINTAINER_EMAIL = 'nathan.reitinger@law.northwestern.edu';   // the owner asked for an email button (2026-10-24)
  const REPO = 'https://github.com/nathanReitinger/lawRankings';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const utc = (t) => t.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  // "Volume 2.1.0" on the left; on the right, small and quiet, the build's short hash (2026-10-26, the owner: "not a
  // timestamp but a smaller-tech-looking build hash ... small ... not super obvious. just like a little extra
  // information"): seven hex characters of the data's and the site's fingerprints (build_data.build_hash)
  const shortHash = (m) => m.build_hash || String(m.digest || '').slice(0, 7);
  function stampMasthead(m) {
    document.getElementById('mhVolume').textContent = m.version;
    const st = document.getElementById('mhStamp');
    const h = shortHash(m);
    st.textContent = h ? 'build ' + h : '';
    st.title = 'Build ' + h + (m.data_updated ? ' · data last changed ' + utc(new Date(m.data_updated * 1000)) : '') +
      (m.digest ? ' · data ' + String(m.digest).slice(0, 7) : '') + (m.site_digest ? ' · site ' + String(m.site_digest).slice(0, 7) : '');
  }

  function siteFooter(m) {
    const t = m.data_updated ? new Date(m.data_updated * 1000) : null;
    return '<p>Volume ' + esc(m.version) + (t ? ' · data updated ' + esc(t.toISOString().slice(0, 10)) : '') +
      (shortHash(m) ? ' · <span class="build-hash">build ' + esc(shortHash(m)) + '</span>' : '') +
      ' · <a href="history.html">version history</a> · <a href="faq.html">about &amp; method</a> · <a href="insights.html">insights</a> · <a href="taxonomy.html">subject areas</a></p>' +
      '<div class="foot-actions">' +
      '<a class="btn-line" href="mailto:' + MAINTAINER_EMAIL + '?subject=' + encodeURIComponent('Law School Rankings: I noticed a flaw') + '">Notice a flaw? Email Nathan</a>' +
      '<a class="btn-line" href="' + REPO + '/tree/main/faculty" target="_blank" rel="noopener">Faculty list</a>' +
      '<a class="btn-line" href="' + REPO + '/edit/main/faculty/edits.csv" target="_blank" rel="noopener">Add or fix a faculty member (pull request)</a>' +
      '</div>' +
      '<p>Created and maintained by <a href="https://www.law.northwestern.edu/faculty/profiles/NathanReitinger/">Nathan Reitinger</a> · Northwestern Pritzker School of Law</p>' +
      '<p class="text-muted">Modeled on <a href="https://csrankings.org/">CSrankings</a>.</p>';
  }

  // ---- the number-crunching spinner (2026-10-25, the owner: "add in a spinner for crunching numbers. make it fun. have
  // a series of dots that move around in an interesting way that seems always changing. blur rest of page, have dots
  // show in center of page"). The page blurs behind a veil; in the middle, fourteen dots glide from one formation to
  // the next (a ring, a figure eight, a rose, a spiral, orbiting pairs, a wave, a Lissajous knot, a swarm), in a
  // shuffled order with drifting colours, comet trails and faint threads between close neighbours, so it never looks
  // the same twice. LSR.crunch.show(text) / hide() around a load; LSR.crunch.run(fn, text) for a recompute (the veil is
  // painted before fn runs). With reduced motion the dots only turn slowly, without trails.
  const crunch = (function () {
    const N = 14, SIZE = 220;
    const COLORS = ['#1c5cab', '#ff7f00', '#0b0b0b', '#2a78d6', '#d64545', '#2e9e6b', '#7a4fd6', '#e0a800'];
    const QUIPS = ['Crunching numbers', 'Counting footnotes', 'Splitting co-author credit', 'Taking geometric means',
      'Sorting the law reviews', 'Weighing the specialty journals', 'Tallying the faculty', 'Shepardizing the math',
      'Consulting the W&L tables', 'Carrying the one'];
    let veil, canvas, ctx, label, raf = 0, shownAt = 0, depth = 0, hideTimer = 0, quipTimer = 0, quip = 0;
    let t0 = 0, order = [], step = 0, from = 0, to = 1, phaseStart = 0;
    const still = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seeds = Array.from({ length: N }, (_, i) => ({ a: 0.6 + Math.random() * 1.4, b: 0.6 + Math.random() * 1.4, p: Math.random() * 6.283, r: 3.2 + (i % 4) * 0.9 }));
    // each formation: dot i of n at time t -> a point in the unit square [-1, 1]^2
    const TAU = Math.PI * 2;
    const FORMS = [
      (i, n, t) => { const a = TAU * i / n + t * 0.7, r = 0.72 + 0.1 * Math.sin(3 * t + i); return [r * Math.cos(a), r * Math.sin(a)]; },          // breathing ring
      (i, n, t) => { const a = TAU * i / n + t * 0.55; return [0.85 * Math.cos(a), 0.85 * Math.sin(a) * Math.cos(a)]; },                          // figure eight
      (i, n, t) => { const a = TAU * i / n + t * 0.35, r = 0.85 * Math.cos(3 * a + t * 0.4); return [r * Math.cos(a), r * Math.sin(a)]; },          // three-petal rose
      (i, n, t) => { const f = i / (n - 1), r = 0.12 + 0.78 * f, a = 4.4 * Math.PI * f + t * (1.6 - r); return [r * Math.cos(a), r * Math.sin(a)]; }, // spiral galaxy
      (i, n, t) => { const k = Math.floor(i / 2), m = Math.ceil(n / 2), a = TAU * k / m + t * 0.5, s = i % 2 ? 1 : -1, b = t * 2.6 + k;         // orbiting pairs
        return [0.62 * Math.cos(a) + s * 0.16 * Math.cos(b), 0.62 * Math.sin(a) + s * 0.16 * Math.sin(b)]; },
      (i, n, t) => { const x = -0.88 + 1.76 * i / (n - 1); return [x, 0.42 * Math.sin(TAU * 0.8 * x + t * 2.2) * Math.cos(t * 0.6)]; },            // travelling wave
      (i, n, t) => { const a = TAU * i / n + t * 0.4; return [0.85 * Math.sin(3 * a + t * 0.3), 0.85 * Math.sin(2 * a)]; },                         // Lissajous knot
      (i, n, t) => { const d = seeds[i]; return [0.8 * Math.sin(d.a * t + d.p) * Math.cos(d.b * 0.7 * t), 0.8 * Math.cos(d.b * t + d.p * 1.3) * Math.sin(d.a * 0.5 * t + 1)]; }, // swarm
    ];
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const mix = (a, b, k) => {
      const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
      const c = (sh) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
      return 'rgb(' + c(16) + ',' + c(8) + ',' + c(0) + ')';
    };
    const shuffle = () => { order = FORMS.map((_, i) => i).sort(() => Math.random() - 0.5); };

    function build() {
      veil = document.createElement('div');
      veil.className = 'crunch';
      veil.setAttribute('role', 'status');
      veil.setAttribute('aria-live', 'polite');
      canvas = document.createElement('canvas');
      canvas.className = 'crunch-dots';
      canvas.setAttribute('aria-hidden', 'true');
      label = document.createElement('p');
      label.className = 'crunch-label';
      veil.appendChild(canvas);
      veil.appendChild(label);
      document.body.appendChild(veil);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = canvas.height = SIZE * dpr;
      canvas.style.width = canvas.style.height = SIZE + 'px';
      ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    }

    function frame(now) {
      const calm = still();
      const t = Math.max(0, now - t0) / 1000 * (calm ? 0.15 : 1);   // (the first frame's time can come before show's)
      const HOLD = 2.4, MORPH = 1.2;
      let k = 0;
      if (!calm) {
        const el = Math.max(0, now - phaseStart) / 1000;
        if (el > HOLD + MORPH) {                       // next formation; a new shuffle once all have been shown
          from = to; step++;
          if (step >= order.length) { const last = order[order.length - 1]; shuffle(); if (order[0] === last) order.push(order.shift()); step = 0; }
          to = order[step]; phaseStart = now;
        } else if (el > HOLD) k = ease((el - HOLD) / MORPH);
      }
      const spin = t * 0.08, cs = Math.cos(spin), sn = Math.sin(spin);
      const R = SIZE * 0.4, C = SIZE / 2;
      if (calm) ctx.clearRect(0, 0, SIZE, SIZE);
      else {                                          // fade the last frames into trails
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.24)';
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.globalCompositeOperation = 'source-over';
      }
      const pts = [];
      for (let i = 0; i < N; i++) {
        const a = FORMS[calm ? 0 : from](i, N, t), b = FORMS[calm ? 0 : to](i, N, t);
        const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
        pts.push([C + R * (x * cs - y * sn), C + R * (x * sn + y * cs)]);
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < N; i++) {                   // threads between close neighbours
        for (let j = i + 1; j < N; j++) {
          const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
          if (d < 46) { ctx.strokeStyle = 'rgba(28,92,171,' + (0.22 * (1 - d / 46)).toFixed(3) + ')'; ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[j][0], pts[j][1]); ctx.stroke(); }
        }
      }
      const drift = t * 0.25;
      for (let i = 0; i < N; i++) {
        const k0 = (i + Math.floor(drift)) % COLORS.length;
        const c0 = COLORS[k0], c1 = COLORS[(k0 + 1) % COLORS.length];
        ctx.fillStyle = mix(c0, c1, drift % 1);
        ctx.beginPath();
        ctx.arc(pts[i][0], pts[i][1], seeds[i].r * (1 + 0.25 * Math.sin(t * 3 + i)), 0, TAU);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }

    function show(text) {
      depth++;
      clearTimeout(hideTimer);
      if (!veil) build();
      label.textContent = (text || QUIPS[0]) + '…';
      if (veil.classList.contains('on')) return;
      shownAt = performance.now();
      t0 = phaseStart = shownAt;
      shuffle(); step = 0; from = order[0]; to = order[1] !== undefined ? order[1] : order[0]; step = 1;
      ctx.clearRect(0, 0, SIZE, SIZE);
      veil.classList.add('on');
      document.body.setAttribute('aria-busy', 'true');
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
      quip = Math.floor(Math.random() * QUIPS.length);
      clearInterval(quipTimer);
      quipTimer = setInterval(() => { quip = (quip + 1) % QUIPS.length; label.textContent = QUIPS[quip] + '…'; }, 1600);
    }

    // hidden once every show() has its hide(), and not before it has been seen for a moment (no flicker)
    function hide(minMs) {
      depth = Math.max(0, depth - 1);
      if (depth || !veil) return;
      const wait = Math.max(0, (minMs == null ? 450 : minMs) - (performance.now() - shownAt));
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (depth) return;
        veil.classList.remove('on');
        document.body.removeAttribute('aria-busy');
        clearInterval(quipTimer);
        setTimeout(() => { if (!veil.classList.contains('on')) cancelAnimationFrame(raf); }, 300);
      }, wait);
    }

    // a recompute: the veil first (two frames, so it is painted), then the work; several calls before the veil is up
    // run the work once, with the newest fn
    let pending = null;
    function run(fn, text) {
      const first = !pending;
      pending = fn;
      if (!first) return;
      show(text || 'Crunching numbers');
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        const work = pending;
        pending = null;
        try { work(); } finally { hide(380); }
      };
      // after the next paint; a timer too, since a tab in the background gets no animation frames
      requestAnimationFrame(() => setTimeout(go, 0));
      setTimeout(go, 80);
    }
    return { show: show, hide: hide, run: run };
  })();

  // ---- (2026-10-26, the owner: "use lazy loading so that the main ranking shows first") data.json holds what the ranking
  // needs, packed (build_data.split_for_site): unpack() turns it back into the arrays the pages read (papers.year,
  // .minor, .authors indexed by paper id; people as [name, schools, null, homepage, areas, fields, total], the last four
  // empty until people.json is in). people() fetches people.json once, fills them in and resolves.
  function unpack(d) {
    const P = d.papers;
    if (P.years) {
      const year = new Int16Array(P.n);
      let at = 0;
      P.years[1].forEach((n, k) => { year.fill(P.years[0] + k, at, at + n); at += n; });
      P.year = year;
    }
    if (P.minor_ids) { const m = new Uint8Array(P.n); P.minor_ids.forEach((i) => { m[i] = 1; }); P.minor = m; }
    if (P.authors_not_1) { const a = new Uint16Array(P.n).fill(1); P.authors_not_1.forEach(([i, n]) => { a[i] = n; }); P.authors = a; }
    const C = d.credits;
    if (C.who) {                      // in paper order: each paper's credited people, one each unless C.more says more
      const k = new Uint16Array(P.n).fill(1);
      (C.more || []).forEach(([p, n]) => { k[p] = n; });
      const paper = new Int32Array(C.who.length);
      let at = 0;
      for (let p = 0; p < P.n; p++) for (let j = 0; j < k[p]; j++) paper[at++] = p;
      C.paper = paper;
      C.person = Int32Array.from(C.who);
    }
    d.people = d.people.map((p) => (p.length > 2 ? p : [p[0], p[1], null, '', [], [], 0]));
    return d;
  }
  let peopleLoad = null;
  function people(d) {
    if (!peopleLoad) {
      peopleLoad = fetch('data/people.json').then((r) => (r.ok ? r.json() : [])).then((rows) => {
        rows.forEach((x, i) => { const p = d.people[i]; if (p && x) { p[3] = x[0] || ''; p[4] = x[1] || []; p[5] = x[2] || []; p[6] = x[3] || 0; } });
        d.peopleLoaded = true;
        return d;
      }).catch(() => d);
    }
    return peopleLoad;
  }

  // ---- the logo gallery (2026-10-26, the owner: "allow a vote procedure on the logo. a user can vote on their favoriate
  // logo and then we'll keep that one for them. and allow a click-button to change logo with a pop-up of all logos to
  // view"). A small "change logo" button by the build hash opens every masthead, drawn live in its own face; a click
  // previews one on the page, "Vote for this one" keeps it for this visitor (localStorage lsr.mastPin, which the
  // <head> script reads before anything is drawn), and "Surprise me" goes back to a new one each visit. The votes stay
  // in each visitor's browser: a static site has nowhere to count them.
  const FAMILY = (n) => (n <= 10 ? 'Classic' : n <= 15 ? 'Minimal' : n <= 20 ? 'Glass' : n <= 25 ? 'Color' : 'Interactive');
  const PIN = 'lsr.mastPin';
  const pinned = () => { try { return +(localStorage.getItem(PIN) || 0); } catch (e) { return 0; } };
  let gallery = null, fontsAll = false, opener = null;

  function applyMast(n) {
    document.documentElement.setAttribute('data-mast', n);
    const M = window.LSR_MAST || {};
    const f = (M.fonts || [])[n - 1];
    if (f && !fontsAll) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + f + '&display=swap';
      document.head.appendChild(l);
    }
    pixelSync();
  }

  function loadAllFonts() {
    if (fontsAll) return;
    fontsAll = true;
    const fam = ((window.LSR_MAST || {}).fonts || []).filter(Boolean);
    if (!fam.length) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + fam.join('&family=') + '&display=swap';
    document.head.appendChild(l);
  }

  function buildGallery() {
    const head = document.querySelector('.lsr-mast');
    const N = (window.LSR_MAST || {}).n || 25;
    gallery = document.createElement('div');
    gallery.className = 'mast-gallery';
    gallery.setAttribute('role', 'dialog');
    gallery.setAttribute('aria-modal', 'true');
    gallery.setAttribute('aria-labelledby', 'mastGalleryTitle');
    gallery.innerHTML = '<div class="mast-panel"><div class="mast-top"><div><h2 id="mastGalleryTitle">Pick a masthead</h2>' +
      '<p>Click one to see it on the page. <b>Vote for your favorite</b> and it stays for you on this browser; or let a new one come each visit.</p></div>' +
      '<button type="button" class="mast-x" aria-label="Close">&times;</button></div><div class="mast-grid"></div>' +
      '<div class="mast-bottom"><button type="button" class="mast-shuffle">Surprise me again: a new one each visit</button></div></div>';
    const grid = gallery.querySelector('.mast-grid');
    for (let n = 1; n <= N; n++) {
      const card = document.createElement('div');
      card.className = 'mast-card';
      card.dataset.n = n;
      const wrap = document.createElement('div');
      wrap.className = 'lsr-mast-wrap mast-preview';
      wrap.setAttribute('data-mast', n);
      if (head) {
        const c = head.cloneNode(true);
        c.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
        c.querySelectorAll('.lsr-foot, .mast-pick').forEach((x) => x.remove());
        c.querySelectorAll('.px-canvas').forEach((x) => x.remove());          // a copy of the page's dots, not the card's own
        c.querySelectorAll('.px-on').forEach((x) => x.classList.remove('px-on'));
        c.querySelectorAll('a').forEach((x) => { x.removeAttribute('href'); x.setAttribute('tabindex', '-1'); });
        wrap.appendChild(c);
      }
      const bar = document.createElement('div');
      bar.className = 'mast-bar';
      bar.innerHTML = '<span class="mast-no">No. ' + n + ' · ' + FAMILY(n) + '</span>' +
        '<button type="button" class="mast-see">See it</button><button type="button" class="mast-vote">Vote for this one</button>';
      card.appendChild(wrap);
      card.appendChild(bar);
      grid.appendChild(card);
    }
    gallery.addEventListener('click', (e) => {
      if (e.target === gallery || e.target.closest('.mast-x')) { closeGallery(); return; }
      if (e.target.closest('.mast-shuffle')) {
        try { localStorage.removeItem(PIN); } catch (err) { /* private mode */ }
        markCards(); closeGallery(); return;
      }
      const card = e.target.closest('.mast-card');
      if (!card) return;
      const n = +card.dataset.n;
      if (e.target.closest('.mast-vote')) {
        try { localStorage.setItem(PIN, String(n)); } catch (err) { /* private mode: it applies for this page only */ }
        applyMast(n); markCards(); return;
      }
      applyMast(n); markCards();
    });
    gallery.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGallery(); });
    document.body.appendChild(gallery);
  }

  function markCards() {
    const now = +document.documentElement.getAttribute('data-mast');
    const fav = pinned();
    gallery.querySelectorAll('.mast-card').forEach((c) => {
      const n = +c.dataset.n;
      c.classList.toggle('is-now', n === now);
      c.classList.toggle('is-fav', n === fav);
      const v = c.querySelector('.mast-vote');
      v.textContent = n === fav ? '★ Your favorite' : 'Vote for this one';
      v.setAttribute('aria-pressed', String(n === fav));
    });
  }

  function openGallery(btn) {
    opener = btn || null;
    loadAllFonts();
    if (!gallery) buildGallery();
    markCards();
    gallery.classList.add('on');
    document.documentElement.classList.add('mast-open');
    pixelSync();
    const cur = gallery.querySelector('.mast-card.is-now');
    (gallery.querySelector('.mast-x')).focus();
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function closeGallery() {
    gallery.classList.remove('on');
    document.documentElement.classList.remove('mast-open');
    pixelSync();
    if (opener) opener.focus();
  }

  function addPicker() {
    const line = document.querySelector('.lsr-issue');
    if (!line || line.querySelector('.mast-pick')) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mast-pick';
    b.title = 'See every masthead and vote for your favorite';
    b.textContent = 'change logo';
    b.addEventListener('click', () => openGallery(b));
    const stamp = line.querySelector('.lsr-stamp');
    const box = document.createElement('span');
    box.className = 'lsr-right';
    if (stamp) { line.insertBefore(box, stamp); box.appendChild(stamp); }
    else line.appendChild(box);
    box.appendChild(b);
  }
  // each letter of the wordmark in its own span (--i: its place), for the masthead variants that bring letters in one
  // by one (style.css); the words' own spans (.w1-.w3) stay, and the link keeps the name for screen readers
  function splitLetters() {
    const a = document.querySelector('.lsr-mast .lsr-mark > a');
    if (!a || a.dataset.split) return;
    a.dataset.split = '1';
    a.setAttribute('aria-label', a.textContent.replace(/\s+/g, ' ').trim());
    let i = 0;
    const walk = (node) => [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const frag = document.createDocumentFragment();
        [...c.textContent].forEach((ch) => {
          const sp = document.createElement('span');
          sp.className = 'ch';
          sp.setAttribute('aria-hidden', 'true');
          sp.style.setProperty('--i', i++);
          sp.textContent = ch;
          frag.appendChild(sp);
        });
        c.replaceWith(frag);
      } else if (c.nodeType === 1) walk(c);
    });
    walk(a);
  }
  // ---- 26. "pixel" (2026-10-28, the owner: "do one logo with a pixelated mover that changes motion based on mouse
  // movement (small dots)"): the wordmark set in a pixel face and drawn as small dots on a canvas over the (invisible,
  // still clickable and readable) link. The dots fly in and settle, shimmer a little, and the pointer's movement pushes
  // the dots near it along its own direction and speed; they spring back and redden while out of place. No motion under
  // prefers-reduced-motion; the loop sleeps when everything is still or the mark is off screen.
  const PX_ON = (mark) => { const w = mark.closest('.lsr-mast-wrap'); return !!w && (w.classList.contains('mast-preview') ? w.getAttribute('data-mast') === '26' : document.documentElement.getAttribute('data-mast') === '26'); };
  const pxMarks = new Map();
  const still = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  function pixelMark(mark) {
    const a = mark.querySelector('a');
    const canvas = document.createElement('canvas');
    canvas.className = 'px-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    mark.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let dots = [], W = 0, H = 0, bleed = 0, step = 3, r = 1, ink = '#0b2545', hot = '#c8102e', raf = 0, visible = true, alive = true;
    const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0 };
    let t0 = performance.now(), lastMove = 0;
    function build() {
      const box = mark.getBoundingClientRect();
      if (!box.width) return;
      const cs = getComputedStyle(mark);
      const size = parseFloat(cs.fontSize);
      bleed = Math.round(size * 0.7);
      W = Math.ceil(box.width) + 2 * bleed; H = Math.ceil(box.height) + 2 * bleed;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      canvas.style.left = -bleed - (parseFloat(cs.borderLeftWidth) || 0) + 'px';
      canvas.style.top = -bleed - (parseFloat(cs.borderTopWidth) || 0) + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ink = cs.color || ink;
      // the letters where the link sets them, drawn off screen in the same face, then sampled on a grid of small dots
      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      const o = off.getContext('2d');
      const font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + size + 'px ' + cs.fontFamily;
      o.font = font; o.fillStyle = '#000'; o.textBaseline = 'alphabetic';
      const asc = o.measureText('A').fontBoundingBoxAscent || size * 0.8;
      const chars = a.querySelectorAll('.ch');
      const at = (el, ch) => { const q = el.getBoundingClientRect(); o.fillText(ch, q.left - box.left + bleed, q.top - box.top + bleed + asc); };
      if (chars.length) chars.forEach((c) => { if (c.textContent.trim()) at(c, c.textContent); });
      else at(a, a.textContent);
      step = Math.max(2.5, size / 15);
      r = Math.max(0.9, step * 0.4);
      const img = o.getImageData(0, 0, W, H).data;
      const old = dots;
      dots = [];
      for (let y = step / 2; y < H; y += step) {
        for (let x = step / 2; x < W; x += step) {
          if (img[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 110) {
            const k = dots.length, from = old[k];
            // first time: from a scatter around the mark; after a resize: from where the dot was
            const sx = from ? from.x : x + (Math.random() - 0.5) * W * 0.6, sy = from ? from.y : y + (Math.random() - 0.5) * H * 1.4;
            dots.push({ hx: x, hy: y, x: still() ? x : sx, y: still() ? y : sy, vx: 0, vy: 0, ph: (x * 0.11 + y * 0.07) });
          }
        }
      }
      mark.classList.add('px-on');
      draw(performance.now());
      wake();
    }
    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      const calm = [], moved = [];
      dots.forEach((d) => { (Math.abs(d.x - d.hx) + Math.abs(d.y - d.hy) > step * 0.9 ? moved : calm).push(d); });
      [[calm, ink], [moved, hot]].forEach(([set, col]) => {
        if (!set.length) return;
        ctx.fillStyle = col;
        ctx.beginPath();
        set.forEach((d) => { ctx.moveTo(d.x + r, d.y); ctx.arc(d.x, d.y, r, 0, 6.2832); });
        ctx.fill();
      });
    }
    function tick(now) {
      raf = 0;
      if (!alive) return;
      const t = (now - t0) / 1000, R = step * 14, R2 = R * R, sp = Math.hypot(ptr.vx, ptr.vy);
      let energy = 0;
      dots.forEach((d) => {
        // a slow travelling shimmer: each dot's home sways a fraction of a dot
        const sw = still() ? 0 : Math.sin(t * 1.6 + d.ph) * step * 0.14;
        let ax = (d.hx - d.x) * 0.055, ay = (d.hy + sw - d.y) * 0.055;
        const dx = d.x - ptr.x, dy = d.y - ptr.y, dd = dx * dx + dy * dy;
        if (dd < R2 && sp > 0.05) {
          const dist = Math.sqrt(dd) || 1, f = (1 - dist / R) * (1 - dist / R);
          // carried along the pointer's own motion, and pushed aside in proportion to its speed
          ax += ptr.vx * f * 0.16 + (dx / dist) * f * Math.min(sp, 40) * 0.09;
          ay += ptr.vy * f * 0.16 + (dy / dist) * f * Math.min(sp, 40) * 0.09;
        }
        d.vx = (d.vx + ax) * 0.84; d.vy = (d.vy + ay) * 0.84;
        d.x += d.vx; d.y += d.vy;
        energy += Math.abs(d.vx) + Math.abs(d.vy) + Math.abs(d.x - d.hx) * 0.02;
      });
      ptr.vx *= 0.8; ptr.vy *= 0.8;
      draw(now);
      // sleep when settled and the pointer is still (the shimmer alone keeps it going only while on screen and recent)
      const idle = now - lastMove > 6000 && energy / Math.max(1, dots.length) < 0.02;
      if (visible && !document.hidden && !(still() && energy / Math.max(1, dots.length) < 0.01) && !idle) raf = requestAnimationFrame(tick);
    }
    function wake() { if (!raf && alive && visible && !document.hidden && dots.length) raf = requestAnimationFrame(tick); }
    function onMove(e) {
      if (still() || !dots.length) return;
      const q = canvas.getBoundingClientRect();
      const x = e.clientX - q.left, y = e.clientY - q.top;
      if (x < -60 || y < -60 || x > q.width + 60 || y > q.height + 60) { ptr.x = ptr.y = -1e4; return; }
      const now = performance.now();
      if (ptr.x > -1e3 && now - ptr.t < 100) { ptr.vx = (x - ptr.x) * 0.6 + ptr.vx * 0.4; ptr.vy = (y - ptr.y) * 0.6 + ptr.vy * 0.4; }
      ptr.x = x; ptr.y = y; ptr.t = now; lastMove = now;
      wake();
    }
    window.addEventListener('pointermove', onMove, { passive: true });
    const ro = new ResizeObserver(() => { if (alive) build(); });
    ro.observe(mark);
    const io = new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); if (visible) { lastMove = performance.now(); wake(); } });
    io.observe(mark);
    const onVis = () => { if (!document.hidden) { lastMove = performance.now(); wake(); } };
    document.addEventListener('visibilitychange', onVis);
    const face = getComputedStyle(mark).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    (document.fonts && document.fonts.load ? document.fonts.load('700 32px "' + face + '"').catch(() => null) : Promise.resolve())
      .then(() => { lastMove = performance.now(); if (alive) build(); });
    return {
      destroy() {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', onMove);
        document.removeEventListener('visibilitychange', onVis);
        ro.disconnect(); io.disconnect();
        canvas.remove(); mark.classList.remove('px-on');
      },
    };
  }
  // start or stop the dots wherever variant 26 is showing: the page's masthead and, while the gallery is open, its card
  function pixelSync() {
    const marks = [...document.querySelectorAll('.lsr-mast-wrap .lsr-mark')].filter((m) => PX_ON(m) && (!m.closest('.mast-gallery') || m.closest('.mast-gallery.on')));
    pxMarks.forEach((inst, m) => { if (!marks.includes(m)) { inst.destroy(); pxMarks.delete(m); } });
    marks.forEach((m) => { if (!pxMarks.has(m)) pxMarks.set(m, pixelMark(m)); });
  }

  const ready = () => { splitLetters(); addPicker(); pixelSync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();

  window.LSR = { stampMasthead: stampMasthead, siteFooter: siteFooter, email: MAINTAINER_EMAIL, repo: REPO, crunch: crunch,
    openLogos: openGallery,
    unpack: unpack, people: people };
})();
