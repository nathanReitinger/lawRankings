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

  window.LSR = { stampMasthead: stampMasthead, siteFooter: siteFooter, email: MAINTAINER_EMAIL, repo: REPO, crunch: crunch };
})();
