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
  // show in center of page"; 2026-10-29: "spinner dots should be like claude code GUI spinner. and they should be
  // black. they can be larger with more interacting parts, but must be profesional looking"). The page blurs behind a
  // veil; in the middle, a black asterisk (about 40 CSS px at full bloom) breathes in Claude Code's rhythm (· ✢ ✳ ✶ ✻ ✽
  // and back), spending most of its time as a small asterisk: eight solid tapered petals, each a teardrop fine at the
  // hub and round at the tip, the four main ones longer; they open, fold back, and the star turns an eighth while it is
  // small. The part that interacts: a pulse runs out along one pair of opposite petals, swelling their tips, and hands on
  // to the next pair. (2026-10-29: no dotted spokes and no ring of faint dots; at full bloom those read as a snowflake
  // in a dial.) Black only (#0b0b0b), drawn at the screen's pixel ratio so it stays crisp. LSR.crunch.show(text) /
  // hide() around a load; LSR.crunch.run(fn, text) for a recompute (the veil is painted before fn runs). With reduced
  // motion: a still asterisk, only its opacity pulses.
  const crunch = (function () {
    const SIZE = 56, R = 19, ARMS = 8, R0 = 2.2, CYCLE = 1.8, HOP = 0.45, INK = '11,11,11';
    const QUIPS = ['Crunching numbers', 'Counting footnotes', 'Splitting co-author credit', 'Taking geometric means',
      'Sorting the law reviews', 'Weighing the specialty journals', 'Tallying the faculty', 'Shepardizing the math',
      'Consulting the W&L tables', 'Carrying the one'];
    let veil, canvas, ctx, label, raf = 0, shownAt = 0, depth = 0, hideTimer = 0, quipTimer = 0, quip = 0;
    let t0 = 0, dpr = 0;
    const still = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const TAU = Math.PI * 2, STEP = TAU / ARMS;
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    const ink = (a) => 'rgba(' + INK + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
    // the backing store follows the screen's pixel ratio (also after a zoom), so the petals stay sharp
    function fit() {
      const d = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      if (d === dpr) return;
      dpr = d;
      canvas.width = canvas.height = Math.round(SIZE * d);
      ctx.setTransform(canvas.width / SIZE, 0, 0, canvas.width / SIZE, 0, 0);
    }
    // the shape at time t (s): how far out the main and the in-between petals reach (0..1 of R) and the turn (rad).
    // One CYCLE breathes · ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢ ·, with a short bloom: the opening is squared, so most of the cycle is
    // spent small (✢ ✳ ✶); the eighth of a turn happens around the small end
    function shape(t) {
      const u = t / CYCLE, c = 0.5 - 0.5 * Math.cos(TAU * u), g = c * c;
      const w = u + 0.5, n = Math.floor(w);
      return { main: 0.42 + 0.58 * smooth(g), side: 0.28 + 0.5 * smooth((g - 0.1) / 0.9), turn: -Math.PI / 2 + (n + ease(w - n)) * STEP, g: g };
    }
    // one petal: a teardrop from a fine point near the hub to a round tip (two circles joined by their outer tangents)
    function petal(C, angle, reach, main, swell) {
      const L = Math.max(R0 + 3, reach * R), rt = (main ? 2.5 : 2.0) * (0.3 + 0.7 * reach) * (1 + 0.3 * swell), rh = 0.45;   // (fine tips while small: no blob)
      const tip = L - rt, D = Math.max(0.01, tip - R0);
      const b = Math.asin(Math.min(0.95, (rt - rh) / D)), half = Math.PI / 2 + b;
      const hx = C + R0 * Math.cos(angle), hy = C + R0 * Math.sin(angle);
      const tx = C + tip * Math.cos(angle), ty = C + tip * Math.sin(angle);
      ctx.beginPath();
      ctx.arc(tx, ty, rt, angle - half, angle + half);
      ctx.arc(hx, hy, rh, angle + half, angle - half + TAU);
      ctx.closePath();
      ctx.fill();
    }
    function draw(t, calm) {
      const C = SIZE / 2;
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.fillStyle = ink(1);
      if (calm) {                                      // a still asterisk; only the opacity breathes, slowly
        ctx.globalAlpha = 0.8 + 0.2 * (0.5 + 0.5 * Math.cos(TAU * t / 2.8));
        for (let k = 0; k < ARMS; k++) petal(C, -Math.PI / 2 + k * STEP, k % 2 ? 0.62 : 0.85, k % 2 === 0, 0);
        ctx.beginPath(); ctx.arc(C, C, 1.9, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      const s = shape(t);
      // the pulse: out along petals k and k + 4, then on to the next pair (clockwise, the way the star turns)
      const v = t / HOP, hop = Math.floor(v), at = v - hop, live = hop % (ARMS / 2), lift = Math.sin(Math.PI * at);
      for (let k = 0; k < ARMS; k++) {
        const on = k % (ARMS / 2) === live;
        petal(C, s.turn + k * STEP, (k % 2 ? s.side : s.main) * (on ? 1 + 0.06 * lift : 1), k % 2 === 0, on ? lift : 0);
      }
      ctx.beginPath(); ctx.arc(C, C, 1.7 + 0.5 * (1 - s.g), 0, TAU); ctx.fill();
    }

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
      canvas.style.width = canvas.style.height = SIZE + 'px';
      ctx = canvas.getContext('2d');
      fit();
    }

    function frame(now) {
      fit();
      draw(Math.max(0, now - t0) / 1000, still());   // (the first frame's time can come before show's)
      raf = requestAnimationFrame(frame);
    }

    function show(text) {
      depth++;
      clearTimeout(hideTimer);
      if (!veil) build();
      label.textContent = (text || QUIPS[0]) + '…';
      if (veil.classList.contains('on')) return;
      shownAt = performance.now();
      t0 = shownAt;
      fit();
      draw(0, still());
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
  const FAMILY = (n) => (n <= 10 ? 'Classic' : n <= 15 ? 'Type' : n <= 20 ? 'Light' : n <= 25 ? 'Ink' : 'Interactive');
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
    reactSync();
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
        c.querySelectorAll('.px-canvas, .sv-layer').forEach((x) => x.remove());   // a copy of the page's dots or outlines, not the card's own
        c.querySelectorAll('.px-on, .sv-on').forEach((x) => x.classList.remove('px-on', 'sv-on'));
        c.querySelectorAll('.lsr-mark').forEach(reactClean);                // not the page's pointer state (11-25)
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
    reactSync();
    pixelSync();
    const cur = gallery.querySelector('.mast-card.is-now');
    (gallery.querySelector('.mast-x')).focus();
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function closeGallery() {
    gallery.classList.remove('on');
    document.documentElement.classList.remove('mast-open');
    reactSync();
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
  // each letter of the wordmark in its own span (--i: its place; data-c: the letter itself, which variant 12 swaps for
  // passing characters and puts back), for the masthead variants that move, weigh or light letters one by one
  // (style.css; the pointer layer below); the words' own spans (.w1-.w3) stay, and the link keeps the name for screen
  // readers
  function splitLetters() {
    const a = document.querySelector('.lsr-mast .lsr-mark > a');
    if (!a || a.dataset.split) return;
    a.dataset.split = '1';
    a.setAttribute('aria-label', a.textContent.replace(/\s+/g, ' ').trim());
    a.dataset.text = a.textContent.replace(/\s+/g, ' ').trim();          // for the variants that draw a copy of the words
    let i = 0;
    const walk = (node) => [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const frag = document.createDocumentFragment();
        [...c.textContent].forEach((ch) => {
          const sp = document.createElement('span');
          sp.className = 'ch';
          sp.setAttribute('aria-hidden', 'true');
          sp.style.setProperty('--i', i);
          sp.dataset.c = ch;
          i++;
          sp.textContent = ch;
          frag.appendChild(sp);
        });
        c.replaceWith(frag);
      } else if (c.nodeType === 1) walk(c);
    });
    walk(a);
    a.querySelectorAll('.w1, .w2, .w3').forEach((w) => { w.dataset.text = w.textContent; });   // (23 draws copies of each word)
  }
  // ---- 26. "pixel" (2026-10-28, the owner: "do one logo with a pixelated mover that changes motion based on mouse
  // movement (small dots)"; then: "the dots should be more like they are on https://www.paper2audio.com"; 2026-10-29: the
  // dots looked grainy, with stray dots): the wordmark set in Silkscreen and drawn as a dot matrix on a canvas over the
  // (invisible, still clickable and readable) link. Silkscreen is built on a square grid (a pixel is an eighth of the
  // em), so each of its pixels becomes one round dot on one lattice whose pitch is a whole number of device pixels:
  // every dot the same size and the same black, falling the same way on the screen's pixels (no grain), nothing
  // between the letters. On load the dots print in from left to right. The pointer is a lens over the lattice, as on
  // paper2audio: near it the faint lattice of the paper shows (only in the letters' band, fading out before its edges),
  // the letters' dots swell and lean away from it, and its movement carries them a little along its own direction;
  // they spring back onto the grid. No motion under prefers-reduced-motion; the loop stops whenever nothing moves.
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
    let dots = [], W = 0, H = 0, s = 3, r = 1, R = 60, dpr = 1, ink = '17,17,22', raf = 0, visible = true, alive = true, born = 0;
    let sq = false;                                            // a small pitch (2-3 device px): whole device-pixel squares, not discs
    // (2026-10-29) the dots are built only from the real pixel face: document.fonts.load() can resolve before the Google
    // stylesheet has registered it, and a build from the fallback face then flew its dots into the real letters. Until
    // the face is in (or for 3 s at most), the link shows its own text.
    const face = getComputedStyle(mark).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    let gaveUp = false, waitT = 0, waited = 0;
    const faceIn = () => { try { return [...document.fonts].some((f) => f.family.replace(/["']/g, '').trim() === face && f.status === 'loaded'); } catch (e) { return true; } };
    function waitFace() {
      if (waitT || !alive) return;
      waitT = setTimeout(() => { waitT = 0; waited += 150; if (waited >= 3000) gaveUp = true; build(); }, 150);
    }
    let band = [0, 0, 0, 0];                                   // the lattice's rows and columns (CSS px): x0, x1, y0, y1
    const ptr = { x: -1e4, y: -1e4, vx: 0, vy: 0, t: 0, on: false, pa: 0 };
    // one dot for each pixel of the face, on one lattice whose pitch is a whole number of device pixels (so every dot
    // falls the same way on the screen's pixels: no grain), the letters set at exactly eight lattice pitches to the em
    function build() {
      if (!alive) return;
      if (!gaveUp && !faceIn()) { waitFace(); return; }
      const box = mark.getBoundingClientRect();
      if (!box.width) return;
      const cs = getComputedStyle(mark), lb = a.getBoundingClientRect();
      dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const size = parseFloat(cs.fontSize);
      let pd = Math.max(2, Math.round(size * dpr / 8));                // the pitch, device px
      s = pd / dpr; r = s * 0.39; R = s * 16;
      const bx = Math.ceil(s * 10), by = Math.ceil(s * 4);
      W = Math.ceil(box.width) + 2 * bx; H = Math.ceil(box.height) + 2 * by;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      canvas.style.left = -bx - (parseFloat(cs.borderLeftWidth) || 0) + 'px';
      canvas.style.top = -by - (parseFloat(cs.borderTopWidth) || 0) + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(cs.color);
      if (m) ink = m[1] + ',' + m[2] + ',' + m[3];
      // the letters drawn once at 8 pitches to the em in device pixels, each advance a whole number of pitches, then read
      // one pitch at a time at the middle of each cell
      const off = document.createElement('canvas');
      const o = off.getContext('2d');
      o.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + 8 * pd + 'px ' + cs.fontFamily;
      const text = (a.dataset.text || a.textContent).replace(/\s+/g, ' ').trim();
      const wrap = mark.closest('.lsr-mast-wrap'), room = (wrap ? wrap.clientWidth : box.width) - 8;
      let adv = [], cols = 0;
      for (;;) {                                                        // (a smaller pitch if rounding up made it wider than the link)
        o.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + 8 * pd + 'px ' + cs.fontFamily;
        adv = [...text].map((ch) => Math.max(1, Math.round(o.measureText(ch).width / pd)));   // in pitches
        cols = adv.reduce((x, y) => x + y, 0) - 1;                      // (the last letter's right bearing)
        if (pd <= 2 || cols * pd / dpr <= room) break;                    // (within the masthead's column)
        pd--;
      }
      const oldS = s;
      s = pd / dpr; r = s * 0.39; R = s * 16; sq = pd <= 3;
      const mt = o.measureText(text);
      const up = Math.ceil(mt.actualBoundingBoxAscent / pd), down = Math.ceil(mt.actualBoundingBoxDescent / pd), rows = up + down;
      off.width = (cols + 2) * pd; off.height = (rows + 2) * pd;
      o.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + 8 * pd + 'px ' + cs.fontFamily;
      o.fillStyle = '#000'; o.textBaseline = 'alphabetic';
      let cx = pd;
      [...text].forEach((ch, i) => { o.fillText(ch, cx, (up + 1) * pd); cx += adv[i] * pd; });
      const img = o.getImageData(0, 0, off.width, off.height).data;
      // where the lattice sits on the canvas: centred on the link, on the device-pixel grid
      const gx = Math.round((bx + lb.left - box.left + (lb.width - cols * s) / 2) * dpr) / dpr;
      const gy = Math.round((by + lb.top - box.top + (lb.height - rows * s) / 2) * dpr) / dpr;
      band = [gx - 6 * s, gx + (cols + 6) * s, gy - 3 * s, gy + (rows + 3) * s];
      const old = dots, next = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const sx = Math.floor((i + 1.5) * pd), sy = Math.floor((j + 1.5) * pd);
          if (img[(sy * off.width + sx) * 4 + 3] < 128) continue;
          const hx = gx + (i + 0.5) * s, hy = gy + (j + 0.5) * s;
          next.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, g: 1, at: i / (cols || 1) });
        }
      }
      // a dot keeps its place in flight only when it is the same dot (same letters, same pitch); a new set of letters
      // starts at home and prints in once more
      if (!still() && old.length === next.length && oldS === s) next.forEach((d, k) => { d.x = old[k].x; d.y = old[k].y; d.vx = old[k].vx; d.vy = old[k].vy; d.g = old[k].g; });
      else if (old.length && old.length !== next.length) born = 0;
      dots = next;
      mark.classList.add('px-on');
      if (!born) born = still() ? -1e9 : performance.now();
      draw(performance.now());
      wake();
    }
    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      const intro = Math.max(0, (now - born) / 1000);
      // the paper's lattice, only around the pointer and only in the band of the letters: faint dots on the same
      // lattice, fading in steps with distance (a few flat greys, not a gradient)
      if (ptr.pa > 0.01) {
        const R2 = R * 0.6;
        const x1 = Math.max(band[0], ptr.x - R2), x2 = Math.min(band[1], ptr.x + R2), y1 = Math.max(band[2], ptr.y - R2), y2 = Math.min(band[3], ptr.y + R2);
        const bins = [[], [], [], [], [], []];
        const ox = band[0] + 6 * s, oy = band[2] + 3 * s, Rv = (band[3] - band[2]) / 2;   // the letters' lattice origin; the band's half height
        for (let gy = oy + (Math.ceil((y1 - oy) / s - 0.5) + 0.5) * s; gy < y2; gy += s) {
          for (let gx = ox + (Math.ceil((x1 - ox) / s - 0.5) + 0.5) * s; gx < x2; gx += s) {
            const q = Math.min(1 - Math.hypot(gx - ptr.x, gy - ptr.y) / R2, 1 - Math.abs(gy - (band[2] + Rv)) / Rv);   // (fading out before the band's edges)
            if (q <= 0) continue;
            bins[Math.min(5, Math.floor(q * 6))].push(gx, gy);
          }
        }
        bins.forEach((pts, i) => {
          if (!pts.length) return;
          ctx.fillStyle = 'rgba(' + ink + ',' + (0.08 * (i + 0.5) / 6 * ptr.pa).toFixed(3) + ')';
          ctx.beginPath();
          const rr = r * 0.62;
          if (sq) { const q = 1 / dpr; for (let j = 0; j < pts.length; j += 2) ctx.rect(Math.round((pts[j] - q / 2) * dpr) / dpr, Math.round((pts[j + 1] - q / 2) * dpr) / dpr, q, q); }
          else for (let j = 0; j < pts.length; j += 2) { ctx.moveTo(pts[j] + rr, pts[j + 1]); ctx.arc(pts[j], pts[j + 1], rr, 0, 6.2832); }
          ctx.fill();
        });
      }
      ctx.fillStyle = 'rgb(' + ink + ')';
      ctx.beginPath();
      // at a pitch of 2 or 3 device px a disc would be all antialiasing (grey letters at 1x): whole device-pixel squares
      // instead, the full pitch at 2 (solid pixel letters), two of three at 3 (a crisp dot grid)
      const sqw = sq ? Math.max(1, Math.round(s * dpr) - (Math.round(s * dpr) > 2 ? 1 : 0)) : 0;
      dots.forEach((d) => {
        const g = Math.min(1, Math.max(0, (intro - d.at * 0.7) / 0.22));      // printed in, left to right
        if (g <= 0) return;
        if (sq) {
          const w = Math.max(1, Math.round(sqw * g * d.g)) / dpr;
          ctx.rect(Math.round((d.x - w / 2) * dpr) / dpr, Math.round((d.y - w / 2) * dpr) / dpr, w, w);
          return;
        }
        const rr = r * g * d.g;
        ctx.moveTo(d.x + rr, d.y); ctx.arc(d.x, d.y, rr, 0, 6.2832);
      });
      ctx.fill();
    }
    function tick(now) {
      raf = 0;
      if (!alive) return;
      ptr.pa += ((ptr.on ? 1 : 0) - ptr.pa) * (ptr.on ? 0.15 : 0.08);
      if (Math.abs(ptr.pa - (ptr.on ? 1 : 0)) < 0.004) ptr.pa = ptr.on ? 1 : 0;
      const sp = Math.min(30, Math.hypot(ptr.vx, ptr.vy));
      let moving = ptr.pa > 0 || (now - born) / 1000 < 1.0;
      dots.forEach((d) => {
        let tx = d.hx, ty = d.hy, tg = 1;
        if (ptr.pa > 0) {
          const dx = d.hx - ptr.x, dy = d.hy - ptr.y, dist = Math.hypot(dx, dy) || 1;
          if (dist < R) {
            const f = (1 - dist / R) * (1 - dist / R) * ptr.pa;
            tx += (dx / dist) * f * s * 0.4; ty += (dy / dist) * f * s * 0.4;   // the lens: the dots lean away, a little
            tg = 1 + 0.12 * f;                                                   // and swell, a little (the letters stay legible)
            d.vx += Math.max(-0.3, Math.min(0.3, ptr.vx * f * 0.01)); d.vy += Math.max(-0.3, Math.min(0.3, ptr.vy * f * 0.01));   // the pointer's movement nudges them
          }
        }
        d.vx = (d.vx + (tx - d.x) * 0.16) * 0.72; d.vy = (d.vy + (ty - d.y) * 0.16) * 0.72;
        d.x += d.vx; d.y += d.vy;
        d.g += (tg - d.g) * 0.25;
        if (Math.abs(d.x - tx) < 0.02 && Math.abs(d.y - ty) < 0.02 && Math.abs(d.vx) + Math.abs(d.vy) < 0.02) { d.x = tx; d.y = ty; d.vx = d.vy = 0; }
        else moving = true;
        if (Math.abs(d.g - tg) < 0.003) d.g = tg; else moving = true;
      });
      ptr.vx *= 0.7; ptr.vy *= 0.7;
      if (sp > 0.05) moving = true;
      draw(now);
      if (moving && visible && !document.hidden && !still()) raf = requestAnimationFrame(tick);
    }
    function wake() {
      if (alive && dots.length && Math.min(3, Math.max(1, window.devicePixelRatio || 1)) !== dpr) { build(); return; }   // (a zoom or another screen)
      if (!raf && alive && visible && !document.hidden && !still() && dots.length) raf = requestAnimationFrame(tick);
    }
    // the screen's pixel ratio can change with no resize (browser zoom of a capped mark, a window moved to a Retina
    // screen): rebuild on the lattice of the new device pixels
    let dprMQ = null;
    const onDpr = () => { if (!alive) return; armDpr(); build(); };
    function armDpr() {
      if (dprMQ) dprMQ.removeEventListener('change', onDpr);
      try { dprMQ = window.matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)'); dprMQ.addEventListener('change', onDpr); } catch (e) { dprMQ = null; }
    }
    armDpr();
    function onMove(e) {
      if (still() || !dots.length) return;
      const q = canvas.getBoundingClientRect();
      const x = e.clientX - q.left, y = e.clientY - q.top;
      const inside = x > -20 && y > -20 && x < q.width + 20 && y < q.height + 20;
      if (!inside) { if (ptr.on) { ptr.on = false; wake(); } return; }
      const now = performance.now();
      if (ptr.on && now - ptr.t < 100) { ptr.vx = (x - ptr.x) * 0.6 + ptr.vx * 0.4; ptr.vy = (y - ptr.y) * 0.6 + ptr.vy * 0.4; }
      ptr.x = x; ptr.y = y; ptr.t = now; ptr.on = true;
      wake();
    }
    // a finger: the touch events keep coming while the page scrolls under it (pointer events stop), all passive
    function onTouch(e) { const t = e.touches && e.touches[0]; if (t) onMove({ clientX: t.clientX, clientY: t.clientY }); else { ptr.on = false; wake(); } }
    function onAway(e) { if (e.type === 'pointerout' ? !e.relatedTarget : e.pointerType === 'touch') { ptr.on = false; wake(); } }
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((t) => window.addEventListener(t, onTouch, { passive: true }));
    ['pointerup', 'pointercancel', 'pointerout'].forEach((t) => window.addEventListener(t, onAway, { passive: true }));
    const ro = new ResizeObserver(() => { if (alive) build(); });
    ro.observe(mark);
    const io = new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); if (visible) wake(); });
    io.observe(mark);
    const onVis = () => { if (!document.hidden) wake(); };
    document.addEventListener('visibilitychange', onVis);
    (document.fonts && document.fonts.load ? document.fonts.load('700 32px "' + face + '"').catch(() => null) : Promise.resolve())
      .then(() => { if (alive) build(); });
    const onFonts = () => { if (alive) build(); };                    // (the face can arrive after the first load() resolves)
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', onFonts);
    return {
      destroy() {
        alive = false;
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', onFonts);
        if (dprMQ) dprMQ.removeEventListener('change', onDpr);
        clearTimeout(waitT);
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerdown', onMove);
        ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((t) => window.removeEventListener(t, onTouch));
        ['pointerup', 'pointercancel', 'pointerout'].forEach((t) => window.removeEventListener(t, onAway));
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
    strokeSync();
  }

  // ---- 20. drawn outlines (freefrontend "CSS Text Handwriting Animation" and "Animated Text": SVG text with
  // stroke-dasharray and stroke-dashoffset): the wordmark as SVG <text>, each letter where the page set it, over the
  // (transparent, still clickable and readable) link. On load a hairline draws every contour at once, then the ink
  // fills in. The pointer sends a short accent dash running round every contour as it moves (the dash offset is the
  // pointer's x; style.css). Without SVG or JavaScript the link shows its own letters.
  const svMarks = new Map();
  const SV_ON = (mark) => { const w = mark.closest('.lsr-mast-wrap'); return !!w && (w.classList.contains('mast-preview') ? w.getAttribute('data-mast') === '20' : document.documentElement.getAttribute('data-mast') === '20'); };
  function strokeMark(mark) {
    const a = mark.querySelector('a'), NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sv-layer');
    svg.setAttribute('aria-hidden', 'true');
    const ink = document.createElementNS(NS, 'text'), run = document.createElementNS(NS, 'text');
    ink.setAttribute('class', 'sv-ink'); run.setAttribute('class', 'sv-run');
    svg.appendChild(ink); svg.appendChild(run);
    mark.appendChild(svg);
    let alive = true;
    function build() {
      const box = mark.getBoundingClientRect();
      if (!box.width || !alive) return;
      const cs = getComputedStyle(a), ms = getComputedStyle(mark), fs = parseFloat(cs.fontSize);
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      a.appendChild(probe);
      const base = probe.getBoundingClientRect().top - box.top;
      probe.remove();
      const up = cs.textTransform === 'uppercase', xs = [];
      let text = '';
      a.querySelectorAll('.ch').forEach((c) => { const q = c.getBoundingClientRect(); xs.push((q.left - box.left).toFixed(2)); text += up ? c.dataset.c.toUpperCase() : c.dataset.c; });
      svg.setAttribute('width', box.width); svg.setAttribute('height', box.height);
      svg.setAttribute('viewBox', '0 0 ' + box.width.toFixed(2) + ' ' + box.height.toFixed(2));
      svg.style.left = -(parseFloat(ms.borderLeftWidth) || 0) + 'px';
      svg.style.top = -(parseFloat(ms.borderTopWidth) || 0) + 'px';
      [ink, run].forEach((t) => {
        t.textContent = text;
        t.setAttribute('x', xs.join(' '));
        t.setAttribute('y', base.toFixed(2));
        t.style.fontFamily = cs.fontFamily; t.style.fontWeight = cs.fontWeight; t.style.fontSize = fs + 'px';
      });
      svg.style.setProperty('--sl', Math.round(fs * 12) + 'px');            // longer than any one contour
      svg.style.setProperty('--sw', Math.max(1, fs * 0.03).toFixed(2) + 'px');
      svg.style.setProperty('--sd', (fs * 0.16).toFixed(1) + 'px ' + (fs * 0.62).toFixed(1) + 'px');
      mark.classList.add('sv-on');
    }
    const ro = new ResizeObserver(build);
    ro.observe(mark);
    const face = getComputedStyle(mark).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    (document.fonts && document.fonts.load ? document.fonts.load('32px "' + face + '"').catch(() => null) : Promise.resolve()).then(build);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', build);
    return {
      destroy() {
        alive = false;
        ro.disconnect();
        if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', build);
        svg.remove(); mark.classList.remove('sv-on');
      },
    };
  }
  function strokeSync() {
    const marks = [...document.querySelectorAll('.lsr-mast-wrap .lsr-mark')].filter((m) => SV_ON(m) && (!m.closest('.mast-gallery') || m.closest('.mast-gallery.on')));
    svMarks.forEach((inst, m) => { if (!marks.includes(m)) { inst.destroy(); svMarks.delete(m); } });
    marks.forEach((m) => { if (!svMarks.has(m)) svMarks.set(m, strokeMark(m)); });
  }

  // ---- 11-25 answer the pointer (2026-10-29, the owner: "improve the titles again. use a bunch of reactive titles from
  // the two css links i shared. i want the title to feel professional but futuristic"; then: "the new title logos do
  // not look like they should"). Each of the fifteen copies one method from prismic.io/blog/css-text-animations or
  // freefrontend.com/css-text-animations (style.css says which); this one small layer feeds them all. It follows a mouse
  // or pen anywhere on the page, or a finger on a touch screen (every listener passive, so a drag still scrolls the
  // page), and writes a few CSS custom properties that each variant's CSS turns into its effect:
  //   on the mark: --pa, how present the pointer is (0-1, eased in and out); --mx/--my, the pointer from the link's top
  //   left, and --ux/--uy, from the mark's (px); --u, the pointer across the link (0-1);
  //   on each letter (.ch), for the variants with a radius r (em): --d, its closeness to the pointer (0-1); --dx/--dy,
  //   where it sits from the pointer (-1 to 1, in radii).
  // And for single variants: 12 (cell) --cx/--cw, the character cell the pointer is over, for its block cursor; 13
  // (roll) rolls a letter over as the pointer crosses it (data-r); 15 (gap) parts the line at the word space nearest
  // the pointer, never inside a word: --gx on the mark is that space, and each letter's --dx is its side (-1 or 1);
  // 23 (words) replays a word's two-pass wipe as the pointer comes onto it (data-k on .w1-.w3); 17 (sweep) runs its
  // lens once across the name on load, as if a pointer passed (prismic 35 swings its spotlight on its own).
  // Frames run only while something is changing, and only for marks on screen (the page's while the gallery is shut,
  // and the gallery's cards while it is open); a pointer moving elsewhere on the page wakes nothing; nothing runs under
  // prefers-reduced-motion, where each mark keeps its resting state.
  const REACT = {
    11: { r: 2.1, fixw: true }, 12: { cell: true }, 13: { r: 0.75, hot: 'roll' }, 14: { words: true, ww: true }, 15: { r: 2.4 },
    16: {}, 17: { sweep: true }, 18: { r: 9 }, 19: {}, 20: {},
    21: { r: 1.8 }, 22: {}, 23: { words: true }, 24: { r: 1.9, fixw: true }, 25: { words: true },
  };
  const MARK_VARS = ['--pa', '--mx', '--my', '--ux', '--uy', '--u', '--gx', '--cx', '--cw'], CH_VARS = ['--d', '--dx', '--dy', '--w'];
  const reacting = new Map();
  const pointer = { x: 0, y: 0, on: false };
  let reactRaf = 0, reactListening = false;
  const mastOf = (mark) => { const w = mark.closest('.lsr-mast-wrap'); return w ? +(w.classList.contains('mast-preview') ? w.getAttribute('data-mast') : document.documentElement.getAttribute('data-mast')) : 0; };
  const reactIO = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => {
    const st = reacting.get(e.target);
    if (st) { st.seen = e.isIntersecting; if (st.seen) reactWake(); }
  })) : null;
  const reactRO = 'ResizeObserver' in window ? new ResizeObserver((es) => es.forEach((e) => { const st = reacting.get(e.target); if (st) reactMeasure(st); })) : null;

  // a mark back at rest: no pointer properties, every letter its own (a gallery card is a copy of the page's mark)
  function reactClean(mark) {
    MARK_VARS.forEach((k) => mark.style.removeProperty(k));
    if (!mark.getAttribute('style')) mark.removeAttribute('style');
    mark.removeAttribute('data-hotw'); mark.removeAttribute('data-fw'); mark.removeAttribute('data-ww');
    const la = mark.querySelector('a');
    if (la) { la.style.removeProperty('--aw'); if (!la.getAttribute('style')) la.removeAttribute('style'); }
    mark.querySelectorAll('[data-hot]').forEach((w) => w.removeAttribute('data-hot'));
    mark.querySelectorAll('.mx-probe').forEach((x) => x.remove());
    mark.querySelectorAll('.ch').forEach((c) => {
      CH_VARS.forEach((k) => c.style.removeProperty(k));
      if (!c.getAttribute('style')) c.removeAttribute('style');
      c.removeAttribute('data-r');
    });
    mark.querySelectorAll('[data-k]').forEach((w) => w.removeAttribute('data-k'));
  }
  // where each letter sits at home (its centre, from the mark's top left), the link's corner and width, and for the
  // variants that need them the word spaces (15), the character cells (12) and the words (23)
  function reactMeasure(st) {
    const m = st.mark, cs = getComputedStyle(m);
    st.fs = parseFloat(cs.fontSize) || 16;
    // 11, 24: each letter's cell, as wide as the letter at its resting weight; 14: the name's width, as it is at rest. Measured on a hidden copy (so the letters' own animation is not restarted and the pointer's state does not
    // count), in em, so a heavier letter or the wider word takes the others' room and nothing outside the name moves
    if (st.cfg.fixw || st.cfg.ww) {
      const probe = st.a.cloneNode(true);
      probe.className = 'mx-probe'; probe.removeAttribute('href'); probe.setAttribute('aria-hidden', 'true');
      m.appendChild(probe);
      const ws = st.cfg.fixw ? [...probe.querySelectorAll('.ch')].map((c) => c.getBoundingClientRect().width) : [];
      const aw = st.cfg.ww ? probe.getBoundingClientRect().width : 0;
      probe.remove();
      if (st.cfg.fixw) { st.chars.forEach((c, i) => { if (ws[i]) c.style.setProperty('--w', (ws[i] / st.fs).toFixed(4) + 'em'); }); m.setAttribute('data-fw', ''); }
      if (st.cfg.ww && aw) { st.a.style.setProperty('--aw', (aw / st.fs).toFixed(4) + 'em'); m.setAttribute('data-ww', ''); }
    }
    m.classList.add('mx-measure');
    const box = m.getBoundingClientRect(), lb = st.a.getBoundingClientRect(), ls = parseFloat(cs.letterSpacing) || 0;
    st.lx = lb.left - box.left; st.ly = lb.top - box.top; st.lw = lb.width || 1;
    st.gaps = []; st.cells = [];
    st.home = st.chars.map((c) => {
      const q = c.getBoundingClientRect(), mid = (q.left + q.right) / 2 - box.left, blank = !(c.dataset.c || '').trim();
      if (st.cfg.gap && blank) st.gaps.push(mid);
      if (st.cfg.cell) st.cells.push([q.left - box.left, Math.max(1, q.width - ls)]);
      return [mid, (q.top + q.bottom) / 2 - box.top];
    });
    st.words = st.cfg.words ? [...st.a.querySelectorAll('.w1, .w2, .w3')].map((w) => { const q = w.getBoundingClientRect(); return [q.left - box.left, q.right - box.left - ls, w]; }) : [];
    m.classList.remove('mx-measure');
    st.box = null;
    reactWake();
  }
  function reactMark(mark, n) {
    reactClean(mark);
    const chars = [...mark.querySelectorAll('.ch')], zero = () => chars.map(() => 0);
    const st = { mark, a: mark.querySelector('a'), n, cfg: REACT[n], chars, home: [], gaps: [], cells: [], words: [], fs: 16, lx: 0, ly: 0, lw: 1,
      seen: true, box: null, rest: false, cell: -1, word: -1, sweep: REACT[n].sweep ? performance.now() + 350 : 0,
      pa: 0, ux: 0, uy: 0, gx: 0, d: zero(), dx: zero(), dy: zero(), hot: chars.map(() => false), rolled: zero(),
      wm: {}, wc: chars.map(() => ({})) };
    reacting.set(mark, st);
    reactMeasure(st);
    if (reactIO) reactIO.observe(mark);
    if (reactRO) reactRO.observe(mark);
    return st;
  }
  function reactDrop(st) {
    reacting.delete(st.mark);
    if (reactIO) reactIO.unobserve(st.mark);
    if (reactRO) reactRO.unobserve(st.mark);
    reactClean(st.mark);
  }
  // the pointer has reached letter i: 13 rolls it over (once per crossing)
  function reactHot(st, i, now) {
    const c = st.chars[i];
    if (!(c.dataset.c || '').trim()) return;
    if (now - st.rolled[i] > 700) { st.rolled[i] = now; c.setAttribute('data-r', c.getAttribute('data-r') === 'a' ? 'b' : 'a'); }
  }
  const setv = (el, memo, k, v) => { if (memo[k] !== v) { memo[k] = v; el.style.setProperty(k, v); } };
  // one frame for one mark (its box read beforehand); true while anything is still on its way
  function reactStep(st, box, now) {
    const cfg = st.cfg, fs = st.fs;
    let px = pointer.x - box.left, py = pointer.y - box.top, busy = false, show = false;
    const pad = fs * 0.6;
    const near = pointer.on && box.width > 0 && px > -pad && py > -pad && px < box.width + pad && py < box.height + pad;
    const ease = (cur, to, k, eps) => { if (Math.abs(to - cur) <= eps) return to; busy = true; return cur + (to - cur) * k; };
    if (st.sweep) {                                  // 17's sweep on load: a pointer of its own, left to right
      const t = (now - st.sweep) / 1900;
      if (near || t >= 1 || !box.width) st.sweep = 0;
      else {
        busy = true;
        if (t > 0) { const e = t * t * (3 - 2 * t); px = st.lx + (-0.04 + 1.08 * e) * st.lw; py = st.ly + fs * 0.5; show = t < 0.82; }
      }
    }
    if (near || show) {
      if (st.pa < 0.01) { st.ux = px; st.uy = py; }  // arriving: start where the pointer is
      st.ux = ease(st.ux, px, 0.3, 0.1); st.uy = ease(st.uy, py, 0.3, 0.1);
    }
    st.pa = ease(st.pa, near || show ? 1 : 0, near || show ? 0.12 : 0.07, 0.002);
    setv(st.mark, st.wm, '--pa', st.pa.toFixed(3));
    if (st.pa > 0) {
      setv(st.mark, st.wm, '--ux', st.ux.toFixed(1) + 'px'); setv(st.mark, st.wm, '--uy', st.uy.toFixed(1) + 'px');
      setv(st.mark, st.wm, '--mx', (st.ux - st.lx).toFixed(1) + 'px'); setv(st.mark, st.wm, '--my', (st.uy - st.ly).toFixed(1) + 'px');
      setv(st.mark, st.wm, '--u', Math.max(0, Math.min(1, (st.ux - st.lx) / st.lw)).toFixed(3));
    }
    // 12: the cell under the pointer (it jumps from cell to cell, as a terminal's cursor does)
    if (cfg.cell && near && st.cells.length) {
      let k = 0;
      st.cells.forEach((c, i) => { if (Math.abs(c[0] + c[1] / 2 - st.ux) < Math.abs(st.cells[k][0] + st.cells[k][1] / 2 - st.ux)) k = i; });
      if (k !== st.cell) { st.cell = k; setv(st.mark, st.wm, '--cx', (st.cells[k][0] - st.lx).toFixed(1) + 'px'); setv(st.mark, st.wm, '--cw', st.cells[k][1].toFixed(1) + 'px'); }
    }
    // 23: the word the pointer has come onto replays its wipe
    if (cfg.words) {
      let k = -1;
      if (near) st.words.forEach((w, i) => { if (st.ux >= w[0] - fs * 0.15 && st.ux <= w[1] + fs * 0.15) k = i; });
      if (k !== st.word) {
        if (st.word >= 0 && st.words[st.word]) st.words[st.word][2].removeAttribute('data-hot');
        st.word = k;
        if (k >= 0) { const w = st.words[k][2]; w.setAttribute('data-k', w.getAttribute('data-k') === 'a' ? 'b' : 'a'); w.setAttribute('data-hot', ''); st.mark.setAttribute('data-hotw', ''); }
        else st.mark.removeAttribute('data-hotw');
      }
    }
    // 15: the line parts at the word space nearest the pointer, which glides to the other space as the pointer moves on
    let ox = st.ux;
    if (cfg.gap && st.gaps.length) {
      let g = st.gaps[0];
      st.gaps.forEach((x) => { if (Math.abs(x - st.ux) < Math.abs(g - st.ux)) g = x; });
      if (near) { if (st.pa < 0.05) st.gx = g; st.gx = ease(st.gx, g, 0.25, 0.1); }
      ox = st.gx;
      if (st.pa > 0) setv(st.mark, st.wm, '--gx', (st.gx - st.lx).toFixed(1) + 'px');
    }
    if (cfg.r) {
      const R = cfg.r * fs;
      st.chars.forEach((c, i) => {
        const h = st.home[i];
        if (!h) return;
        let to = 0;
        if (near) {
          const ex = h[0] - ox, ey = h[1] - st.uy, q = Math.max(0, 1 - Math.hypot(ex, ey) / R);
          to = q * q * (3 - 2 * q);
          st.dx[i] = cfg.gap ? ease(st.dx[i], ex < 0 ? -1 : 1, 0.25, 0.002) : Math.max(-1, Math.min(1, ex / R));
          st.dy[i] = Math.max(-1, Math.min(1, ey / R));
          if (cfg.hot && to > 0.55 && !st.hot[i]) { st.hot[i] = true; reactHot(st, i, now); }
          else if (to < 0.25) st.hot[i] = false;
        } else st.hot[i] = false;
        st.d[i] = ease(st.d[i], to, near ? 0.3 : 0.1, 0.002);
        setv(c, st.wc[i], '--d', st.d[i].toFixed(3));
        if (st.d[i] > 0 || st.pa > 0) { setv(c, st.wc[i], '--dx', st.dx[i].toFixed(3)); setv(c, st.wc[i], '--dy', st.dy[i].toFixed(3)); }
      });
    }
    return busy;
  }
  function reactTick(now) {
    reactRaf = 0;
    const live = [];
    reacting.forEach((st) => { if (st.seen && st.home.length) live.push(st); });
    const boxes = live.map((st) => st.mark.getBoundingClientRect());     // every read first, then the writes
    let busy = false;
    live.forEach((st, k) => { const b = reactStep(st, boxes[k], now); st.box = boxes[k]; st.rest = !b && st.pa === 0; if (b) busy = true; });
    if (busy) reactRaf = requestAnimationFrame(reactTick);
  }
  function reactWake() { if (!reactRaf && reacting.size && !document.hidden) reactRaf = requestAnimationFrame(reactTick); }
  // a pointer moving elsewhere on the page wakes nothing: only a mark on screen that is still settling, or that the
  // pointer is near (its box from the last frame, with a wide margin; a scroll or resize drops the boxes)
  function reactWanted() {
    for (const st of reacting.values()) {
      if (!st.seen) continue;
      const b = st.box, pad = st.fs * 1.5;
      if (!st.rest || !b) return true;
      if (pointer.on && pointer.x > b.left - pad && pointer.x < b.right + pad && pointer.y > b.top - pad && pointer.y < b.bottom + pad) return true;
    }
    return false;
  }
  function reactStale() {
    reacting.forEach((st) => { st.box = null; });
    if (pointer.on && reactWanted()) reactWake();
  }
  function reactPointer(e) {
    if (e.pointerType === 'touch') return;          // fingers come through the touch events, which keep firing while the page scrolls
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = true;
    if (reactWanted()) reactWake();
  }
  function reactTouch(e) {
    const t = e.touches && e.touches[0];
    if (t) { pointer.x = t.clientX; pointer.y = t.clientY; pointer.on = true; } else pointer.on = false;
    if (reactWanted()) reactWake();
  }
  function reactAway() { pointer.on = false; reactWake(); }
  function reactListen() {
    if (reactListening) return;
    reactListening = true;
    const o = { passive: true };
    window.addEventListener('pointermove', reactPointer, o);
    window.addEventListener('pointerdown', reactPointer, o);
    window.addEventListener('pointerout', (e) => { if (!e.relatedTarget && e.pointerType !== 'touch') reactAway(); }, o);
    window.addEventListener('blur', reactAway, o);
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((t) => window.addEventListener(t, reactTouch, o));
    window.addEventListener('scroll', reactStale, { passive: true, capture: true });   // the page's, or the gallery's
    window.addEventListener('resize', reactStale, o);
    document.addEventListener('visibilitychange', reactWake);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => reacting.forEach(reactMeasure));
  }
  // start or stop the layer wherever 11-25 are showing: the page's masthead while the gallery is shut (open, its panel
  // covers the page's mark, which still counts as on screen) and the gallery's cards while it is open
  function reactSync() {
    const want = new Map();
    if (!still()) {
      const open = document.documentElement.classList.contains('mast-open');
      document.querySelectorAll('.lsr-mast-wrap .lsr-mark').forEach((m) => {
        const n = mastOf(m), g = m.closest('.mast-gallery');
        if (REACT[n] && (g ? g.classList.contains('on') : !open)) want.set(m, n);
      });
    }
    reacting.forEach((st, m) => { if (want.get(m) !== st.n) reactDrop(st); });
    want.forEach((n, m) => { if (!reacting.has(m)) reactMark(m, n); });
    if (want.size) reactListen();
  }
  try { window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', reactSync); } catch (e) { /* an old browser: the setting at load holds */ }

  const ready = () => { splitLetters(); addPicker(); reactSync(); pixelSync(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();

  window.LSR = { stampMasthead: stampMasthead, siteFooter: siteFooter, email: MAINTAINER_EMAIL, repo: REPO, crunch: crunch,
    openLogos: openGallery,
    unpack: unpack, people: people };
})();
