// Law School Rankings: the Insights page (2026-10-25, the owner: "who is publishing where (do top law schools only
// publish with top law journals)" and "co-authorship used to happen less and today it is happening more").
// Question 1 is computed in the browser from data/data.json (the rankings' own data: current faculty's articles);
// question 2 from data/insights.json (build_data.py: every collected piece by year, kind of journal and number of
// authors) and, for the spread across schools, data.json again. Drawn with d3 (scales, axes, shapes).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const pct = (x, d) => (x == null || !isFinite(x) ? '–' : (100 * x).toFixed(d == null ? 0 : d) + '%');
  const pct1 = (x) => (x == null || !isFinite(x) ? '–' : (x < 0.1 ? (100 * x).toFixed(1) : (100 * x).toFixed(0)) + '%');
  const num = (n) => Number(n).toLocaleString('en-US');
  const rankNum = (label) => { const m = /\d+/.exec(label == null ? '' : String(label)); return m ? +m[0] : null; };
  const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };

  // groups of schools (and of flagship reviews, by their school's rank). The rankings page uses 1–3, 4–25, 26–50,
  // 51+; here the "top 14" is split out because that is how legal academia talks about the top.
  const BANDS = [
    { label: 'Top 14', short: 'T14', lo: 1, hi: 14 },
    { label: '15–25', short: '15–25', lo: 15, hi: 25 },
    { label: '26–50', short: '26–50', lo: 26, hi: 50 },
    { label: '51–100', short: '51–100', lo: 51, hi: 100 },
    { label: '101 & below, unranked', short: '101+', lo: 101, hi: Infinity },
  ];
  const bandOf = (r) => (r == null || r <= 0 ? 4 : BANDS.findIndex((b) => r >= b.lo && r <= b.hi));
  const SRC_LABEL = { usnews: 'U.S. News', peer: 'peer rank' };

  let DATA, META, INS;
  const st = { from: 0, to: 0, src: 'usnews', skipShort: true, band: 0, school: null, journal: null, matrix: 'row',
               measure: '2', articles: true, panel: false };
  let W1 = null;   // question 1's aggregates for the current filters

  ////////////////////////////////////////////////////////////////////////// tooltip (hover, focus and tap)

  const tip = $('tip');
  function showTip(evt, build) {
    tip.replaceChildren();
    build(tip);
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    const x = evt.clientX, y = evt.clientY;
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (left < 8) left = 8;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  const hideTip = () => { tip.hidden = true; };
  window.addEventListener('scroll', hideTip, { passive: true });
  const tipLine = (t, label, value, color) => {
    const row = el('div', { class: 'row' });
    if (color) { const i = el('i'); i.style.background = color; row.appendChild(i); }
    row.appendChild(el('span', null, label + ' '));
    row.appendChild(el('b', null, value));
    t.appendChild(row);
  };

  ////////////////////////////////////////////////////////////////////////// data

  function schoolRank(s) {
    const row = DATA.schools[s];
    return row[1] ? rankNum(st.src === 'peer' ? row[3] : row[2]) : null;
  }
  function journalRanks() {
    return (DATA.journal_ranks && DATA.journal_ranks[st.src]) || (DATA.journal_ranks && DATA.journal_ranks.usnews) || DATA.journals.map((j) => j[2]);
  }
  // 0..4 flagship review by its school's band, 5 online editions & other general journals, 6 specialty journals
  function journalColumn(ji, jr) {
    const j = DATA.journals[ji];
    if (j[3] && j[3].length) return 6;          // specialty (two General journals W&L also lists under a subject count here)
    const r = j[2] == null ? null : (DATA.host_ranks ? jr[ji] : j[2]);
    if (r == null) return 6;
    if (r < 0) return 5;
    return bandOf(r);
  }

  // every (school, journal) pair with its number of articles in the window; an article counts once per school
  function computeWhere() {
    const P = DATA.papers, C = DATA.credits, S = DATA.schools, people = DATA.people;
    const NJ = DATA.journals.length, NS = S.length;
    const jr = journalRanks();
    const col = DATA.journals.map((j, ji) => journalColumn(ji, jr));
    const sRank = S.map((s, i) => schoolRank(i));
    const pair = new Map();
    const seen = new Set();
    for (let i = 0; i < C.paper.length; i++) {
      const p = C.paper[i];
      const y = P.year[p];
      if (y < st.from || y > st.to || (st.skipShort && P.minor[p])) continue;
      const schools = people[C.person[i]][1];
      for (let k = 0; k < schools.length; k++) {
        const s = schools[k];
        if (!S[s][1]) continue;
        const key = p * NS + s;
        if (seen.has(key)) continue;
        seen.add(key);
        const e = s * NJ + P.journal[p];
        pair.set(e, (pair.get(e) || 0) + 1);
      }
    }
    const M = BANDS.map(() => [0, 0, 0, 0, 0, 0, 0]);
    const edges = [];
    const school = new Map();     // s -> {n (flagship), all, cols[7], journals Map}
    const journal = new Map();    // ji -> {n, bands[5], schools Map}
    pair.forEach((n, e) => {
      const s = Math.floor(e / NJ), ji = e % NJ;
      const b = bandOf(sRank[s]), c = col[ji];
      M[b][c] += n;
      let so = school.get(s);
      if (!so) { so = { n: 0, all: 0, cols: [0, 0, 0, 0, 0, 0, 0], journals: new Map(), ranks: [] }; school.set(s, so); }
      so.all += n;
      so.cols[c] += n;
      if (c <= 4) {
        so.n += n;
        so.journals.set(ji, n);
        if (jr[ji] > 0) so.ranks.push([jr[ji], n]);
        edges.push({ s: s, j: ji, n: n, b: b });
        let jo = journal.get(ji);
        if (!jo) { jo = { n: 0, bands: [0, 0, 0, 0, 0], schools: new Map() }; journal.set(ji, jo); }
        jo.n += n;
        jo.bands[b] += n;
        jo.schools.set(s, n);
      }
    });
    school.forEach((so) => { so.median = weightedMedian(so.ranks); });
    // positions: US schools in rank order (ties by name), unranked at the end; a review sits at its school's rank
    const us = S.map((s, i) => i).filter((i) => S[i][1]);
    us.sort((a, b) => ((sRank[a] || 1e9) - (sRank[b] || 1e9)) || S[a][0].localeCompare(S[b][0]));
    const pos = new Map(us.map((s, k) => [s, k]));
    const ranked = us.filter((s) => sRank[s]);
    const atRank = new Map();
    ranked.forEach((s) => { const r = sRank[s]; if (!atRank.has(r)) atRank.set(r, []); atRank.get(r).push(pos.get(s)); });
    const rankKeys = Array.from(atRank.keys()).sort((a, b) => a - b);
    const rankPos = (r) => {
      if (!(r > 0)) return ranked.length + (us.length - ranked.length) / 2;
      if (atRank.has(r)) { const v = atRank.get(r); return d3.mean(v); }
      const k = d3.bisectLeft(rankKeys, r);           // a rank no school holds under this source: the next one down
      const near = rankKeys[Math.min(k, rankKeys.length - 1)];
      return d3.mean(atRank.get(near));
    };
    const jPos = new Map();
    journal.forEach((v, ji) => jPos.set(ji, rankPos(jr[ji])));
    return { M: M, edges: edges, school: school, journal: journal, sRank: sRank, jr: jr, us: us, pos: pos,
             nRanked: ranked.length, jPos: jPos, rankPos: rankPos };
  }

  function weightedMedian(pairs) {
    if (!pairs.length) return null;
    const v = pairs.slice().sort((a, b) => a[0] - b[0]);
    const half = d3.sum(v, (d) => d[1]) / 2;
    let acc = 0;
    for (const [r, n] of v) { acc += n; if (acc >= half) return r; }
    return v[v.length - 1][0];
  }

  ////////////////////////////////////////////////////////////////////////// question 1: tiles and lede

  function renderWhereText() {
    const M = W1.M;
    const flag = (row) => d3.sum(row.slice(0, 5));
    const colSum = (c) => d3.sum(M, (r) => r[c]);
    const a = M[0][0] / flag(M[0]);
    const b = M[3][0] / flag(M[3]);
    const c = colSum(0) ? (M[0][0]) / colSum(0) : null;
    const outside = colSum(0) ? (M[2][0] + M[3][0] + M[4][0]) / colSum(0) : null;
    const t = $('whereTiles');
    t.replaceChildren();
    const tile = (v, l) => {
      const d = el('div', { class: 'ins-tile' });
      d.appendChild(el('div', { class: 'v' }, v));
      d.appendChild(el('div', { class: 'l' }, l));
      t.appendChild(d);
    };
    const yrs = st.from + '–' + st.to;
    tile(pct(a), 'of top-14 faculty\'s flagship-review articles appeared in top-14 law reviews (' + yrs + ')');
    tile(pct(c), 'of the law-faculty articles in top-14 reviews were by top-14 faculty');
    tile(pct(outside), 'of them were by faculty from schools ranked below 25');
    const lede = $('whereLede');
    lede.replaceChildren();
    const ratio = b > 0 ? a / b : null;
    lede.append(a >= 0.5 ? 'Largely, yes. ' : 'Not only, but far more than anyone else. ');
    lede.append('From ' + st.from + ' to ' + st.to + ', faculty at the top 14 schools placed ');
    lede.appendChild(el('b', null, pct(a)));
    lede.append(' of their flagship-review articles in top-14 reviews' + (ratio ? ', ' + ratio.toFixed(1) + ' times the share for faculty at schools ranked 51–100 (' + pct(b) + ')' : '') + '. The top reviews are not closed, though: ');
    lede.appendChild(el('b', null, pct(outside)));
    lede.append(' of their law-faculty articles came from schools ranked below 25.');
  }

  ////////////////////////////////////////////////////////////////////////// question 1: the network

  function renderNetwork() {
    const box = $('network');
    const W = box.clientWidth;
    const wide = W >= 700;
    const H = Math.round(wide ? 640 : Math.max(520, Math.min(680, W * 1.55)));
    const mL = wide ? 168 : 40, mR = wide ? 236 : 40, mT = 34, mB = 14;
    const xL = mL, xR = W - mR;
    const n = W1.us.length;
    const y = d3.scaleLinear().domain([-0.5, n - 0.5]).range([mT, H - mB]);
    const svg = d3.select('#netSvg').attr('width', W).attr('height', H).attr('viewBox', [0, 0, W, H].join(' '));
    svg.selectAll(':scope > g').remove();
    const canvas = $('netCanvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr; canvas.height = H * dpr;
    box.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const sY = (s) => y(W1.pos.get(s));
    const jY = (ji) => y(W1.jPos.get(ji));
    const curve = (y1, y2) => { const xm = (xL + xR) / 2; return [xL, y1, xm, y1, xm, y2, xR, y2]; };
    const sel = st.school, selJ = st.journal, band = st.band;
    const isHi = (e) => (sel != null ? e.s === sel : selJ != null ? e.j === selJ : band >= 0 ? e.b === band : false);
    const anyHi = sel != null || selJ != null || band >= 0;

    // band shading across the plot, so a flat line reads as "stays at its level"
    const g0 = svg.append('g');
    BANDS.forEach((b, k) => {
      const members = W1.us.filter((s) => bandOf(W1.sRank[s]) === k);
      if (!members.length) return;
      const y0 = y(W1.pos.get(members[0]) - 0.5), y1 = y(W1.pos.get(members[members.length - 1]) + 0.5);
      if (k % 2 === 0) { ctx.fillStyle = '#f6f6f3'; ctx.fillRect(xL, y0, xR - xL, y1 - y0); }   // under the lines (the svg sits on top)
      const lab = g0.append('text').attr('class', 'axis-label halo').attr('y', (y0 + y1) / 2).attr('dy', '0.32em').attr('opacity', sel != null || selJ != null ? 0.35 : 1);
      if (wide) lab.attr('x', xL - 30).attr('text-anchor', 'end').text(b.label);
      else lab.attr('x', (xL + xR) / 2).attr('text-anchor', 'middle').attr('opacity', 0.9).text(b.short);
    });

    // every line on the canvas: the rest in gray first, the highlighted group on top
    const draw = (e, color, alpha, wScale) => {
      const c = curve(sY(e.s), jY(e.j));
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.min(9, 0.35 + wScale * Math.sqrt(e.n));
      ctx.beginPath();
      ctx.moveTo(c[0], c[1]);
      ctx.bezierCurveTo(c[2], c[3], c[4], c[5], c[6], c[7]);
      ctx.stroke();
    };
    const accent = css('--accent') || '#2a78d6';
    const rest = [], hi = [];
    W1.edges.forEach((e) => (isHi(e) ? hi : rest).push(e));
    rest.forEach((e) => draw(e, anyHi ? '#a3a29a' : accent, anyHi ? 0.035 : 0.06, 0.3));
    hi.sort((a, b) => a.n - b.n);
    const single = sel != null || selJ != null;
    hi.forEach((e) => draw(e, accent, single ? 0.6 : 0.12, single ? 0.85 : 0.4));
    ctx.globalAlpha = 1;

    // axes: a rule each side, rank ticks, the nodes
    const g = svg.append('g');
    [xL, xR].forEach((x) => g.append('line').attr('x1', x).attr('x2', x).attr('y1', mT - 4).attr('y2', H - mB).attr('stroke', css('--axis')));
    g.append('text').attr('class', 'axis-label').attr('x', xL).attr('y', 12).attr('text-anchor', wide ? 'end' : 'start').attr('font-weight', 600).attr('fill', css('--ink-2')).text('Law schools');
    g.append('text').attr('class', 'axis-label').attr('x', xR).attr('y', 12).attr('text-anchor', wide ? 'start' : 'end').attr('font-weight', 600).attr('fill', css('--ink-2')).text('Flagship law reviews');
    g.append('text').attr('class', 'axis-label').attr('x', xL).attr('y', 25).attr('text-anchor', wide ? 'end' : 'start').text('by ' + SRC_LABEL[st.src] + ' rank');
    g.append('text').attr('class', 'axis-label').attr('x', xR).attr('y', 25).attr('text-anchor', wide ? 'start' : 'end').text('by their school\'s rank');
    const ticks = [1, 14, 25, 50, 100, 150].filter((r) => r <= (W1.sRank[W1.us[W1.nRanked - 1]] || 0));
    ticks.forEach((r) => {
      const yy = y(W1.rankPos(r));
      [[xL, -1], [xR, 1]].forEach(([x, side]) => {
        g.append('line').attr('x1', x).attr('x2', x + side * 4).attr('y1', yy).attr('y2', yy).attr('stroke', css('--axis'));
        g.append('text').attr('class', 'axis-label').attr('x', x + side * 7).attr('y', yy).attr('dy', '0.32em')
          .attr('text-anchor', side < 0 ? 'end' : 'start').text(r);
      });
    });
    if (W1.us.length > W1.nRanked) {
      const yy = y(W1.rankPos(0));
      [[xL, -1], [xR, 1]].forEach(([x, side]) => g.append('text').attr('class', 'axis-label').attr('x', x + side * 7).attr('y', yy)
        .attr('dy', '0.32em').attr('text-anchor', side < 0 ? 'end' : 'start').text('NR'));
    }
    const rScale = d3.scaleSqrt().domain([0, d3.max(Array.from(W1.school.values()), (d) => d.n) || 1]).range([0, wide ? 5 : 4]);
    const jScale = d3.scaleSqrt().domain([0, d3.max(Array.from(W1.journal.values()), (d) => d.n) || 1]).range([0, wide ? 5 : 4]);
    const nodeFill = (on) => (on ? css('--ink') : '#8a8a84');
    W1.school.forEach((v, s) => {
      if (!v.n) return;
      const on = sel === s || (sel == null && selJ != null && W1.journal.get(selJ) && W1.journal.get(selJ).schools.has(s)) || (sel == null && selJ == null && band >= 0 && bandOf(W1.sRank[s]) === band);
      g.append('circle').attr('cx', xL).attr('cy', sY(s)).attr('r', 1 + rScale(v.n)).attr('fill', nodeFill(on)).attr('stroke', '#fff').attr('stroke-width', 1);
    });
    W1.journal.forEach((v, ji) => {
      const on = selJ === ji || (selJ == null && sel != null && W1.school.get(sel) && W1.school.get(sel).journals.has(ji));
      g.append('circle').attr('cx', xR).attr('cy', jY(ji)).attr('r', 1 + jScale(v.n)).attr('fill', nodeFill(on)).attr('stroke', '#fff').attr('stroke-width', 1);
    });

    // labels for one school or one review (wide screens; phones read them in the panel below)
    if (wide && sel != null && W1.school.get(sel)) {
      g.append('text').attr('class', 'direct').attr('x', xL - 28).attr('y', sY(sel)).attr('dy', '0.32em').attr('text-anchor', 'end')
        .text(shortName(DATA.schools[sel][0], 24));
      const top = Array.from(W1.school.get(sel).journals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
      placeLabels(top.map(([ji, c]) => ({ y: jY(ji), text: shortName(DATA.journals[ji][0], 30) + ' · ' + c })), mT, H - mB)
        .forEach((l) => {
          g.append('text').attr('class', 'direct').attr('x', xR + 28).attr('y', l.y).attr('dy', '0.32em').text(l.text);
          g.append('line').attr('x1', xR + 6).attr('x2', xR + 24).attr('y1', l.y0).attr('y2', l.y).attr('stroke', css('--axis'));
        });
    }
    if (wide && selJ != null && W1.journal.get(selJ)) {
      g.append('text').attr('class', 'direct').attr('x', xR + 28).attr('y', jY(selJ)).attr('dy', '0.32em').text(shortName(DATA.journals[selJ][0], 30));
      const top = Array.from(W1.journal.get(selJ).schools.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
      placeLabels(top.map(([s, c]) => ({ y: sY(s), text: shortName(DATA.schools[s][0], 22) + ' · ' + c })), mT, H - mB)
        .forEach((l) => {
          g.append('text').attr('class', 'direct').attr('x', xL - 28).attr('y', l.y).attr('dy', '0.32em').attr('text-anchor', 'end').text(l.text);
          g.append('line').attr('x1', xL - 6).attr('x2', xL - 24).attr('y1', l.y0).attr('y2', l.y).attr('stroke', css('--axis'));
        });
    }

    // hit layer: the nearest school (left half) or review (right half) to the pointer
    const schools = W1.us.filter((s) => W1.school.get(s) && W1.school.get(s).n);
    const reviews = Array.from(W1.journal.keys());
    const nearest = (evt) => {
      const [px, py] = d3.pointer(evt, svg.node());
      const left = px < (xL + xR) / 2;
      const list = left ? schools : reviews;
      const yOf = left ? sY : jY;
      let best = null, d = Infinity;
      list.forEach((k) => { const dd = Math.abs(yOf(k) - py); if (dd < d || (dd === d && best != null && (left ? W1.school.get(k).n > W1.school.get(best).n : W1.journal.get(k).n > W1.journal.get(best).n))) { d = dd; best = k; } });
      return d <= 14 ? { left: left, k: best } : null;
    };
    const hit = svg.append('rect').attr('x', 0).attr('y', mT - 6).attr('width', W).attr('height', H - mT + 6).attr('fill', 'transparent').style('cursor', 'pointer');
    hit.on('pointermove', (evt) => {
      const h = nearest(evt);
      if (!h) return hideTip();
      showTip(evt, (t) => (h.left ? schoolTip(t, h.k) : journalTip(t, h.k)));
    }).on('pointerleave', hideTip).on('click', (evt) => {
      const h = nearest(evt);
      if (!h) { setSelection(null, null); return; }
      if (h.left) setSelection(st.school === h.k ? null : h.k, null);
      else setSelection(null, st.journal === h.k ? null : h.k);
    });
  }

  function placeLabels(items, lo, hi) {
    // labels at their points, nudged apart to 13px, with a leader line when moved
    const v = items.map((d) => ({ y0: d.y, y: d.y, text: d.text })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < v.length; i++) if (v[i].y - v[i - 1].y < 13) v[i].y = v[i - 1].y + 13;
    const over = v.length ? v[v.length - 1].y - hi : 0;
    if (over > 0) v.forEach((d) => { d.y -= over; });
    for (let i = v.length - 2; i >= 0; i--) if (v[i + 1].y - v[i].y < 13) v[i].y = v[i + 1].y - 13;
    if (v.length && v[0].y < lo) { const s = lo - v[0].y; v.forEach((d) => { d.y += s; }); }
    return v;
  }

  function shortName(s, n) {
    s = s.replace(/^The /, '').replace(/University/g, 'Univ.').replace(/ Law Review$/, ' L. Rev.').replace(/ Law Journal$/, ' L.J.');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function rankLabel(s) {
    const r = W1.sRank[s];
    return r ? SRC_LABEL[st.src] + ' ' + (st.src === 'peer' ? DATA.schools[s][3] : DATA.schools[s][2]) : 'unranked';
  }
  function schoolTip(t, s) {
    const v = W1.school.get(s);
    t.appendChild(el('div', { class: 'tt' }, DATA.schools[s][0]));
    t.appendChild(el('div', null, rankLabel(s)));
    tipLine(t, 'Flagship-review articles', num(v.n));
    tipLine(t, 'In top-14 reviews', pct(v.cols[0] / (v.n || 1)));
    if (v.median) tipLine(t, 'Median review rank', String(v.median));
  }
  function journalTip(t, ji) {
    const v = W1.journal.get(ji);
    t.appendChild(el('div', { class: 'tt' }, DATA.journals[ji][0]));
    const r = W1.jr[ji];
    t.appendChild(el('div', null, r > 0 ? 'school ranked ' + r + ' (' + SRC_LABEL[st.src] + ')' : 'school unranked'));
    tipLine(t, 'Articles by U.S. law faculty', num(v.n));
    tipLine(t, 'By top-14 faculty', pct(v.bands[0] / (v.n || 1)));
  }

  function renderNetDetail() {
    const d = $('netDetail');
    d.replaceChildren();
    const yrs = st.from + '–' + st.to;
    const list = (pairs, name) => {
      const ol = el('ol');
      pairs.forEach(([k, c]) => { const li = el('li'); li.append(name(k) + ' '); li.appendChild(el('span', { class: 'n' }, '(' + num(c) + ')')); ol.appendChild(li); });
      return ol;
    };
    const bandShares = (cols, total) => BANDS.map((b, k) => b.short + ' ' + pct(cols[k] / (total || 1))).join(' · ');
    if (st.school != null) {
      const v = W1.school.get(st.school);
      const p = el('div');
      p.appendChild(el('b', null, DATA.schools[st.school][0]));
      if (!v || !v.n) { p.append(' (' + rankLabel(st.school) + '): no flagship-review articles in ' + yrs + '.'); d.appendChild(p); return; }
      p.append(' (' + rankLabel(st.school) + '): ' + num(v.n) + ' flagship-review articles, ' + yrs + '. In reviews of schools ranked ' + bandShares(v.cols, v.n) + '.' + (v.median ? ' Median review rank ' + v.median + '.' : ''));
      d.appendChild(p);
      d.appendChild(el('div', { style: 'margin-top:6px' }, 'Most often in:'));
      d.appendChild(list(Array.from(v.journals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6), (ji) => DATA.journals[ji][0]));
      return;
    }
    if (st.journal != null) {
      const v = W1.journal.get(st.journal);
      const p = el('div');
      p.appendChild(el('b', null, DATA.journals[st.journal][0]));
      if (!v) { p.append(': no articles by U.S. law faculty in ' + yrs + '.'); d.appendChild(p); return; }
      p.append(': ' + num(v.n) + ' articles by U.S. law faculty, ' + yrs + '. By faculty at schools ranked ' + bandShares(v.bands, v.n) + '.');
      d.appendChild(p);
      d.appendChild(el('div', { style: 'margin-top:6px' }, 'Most frequent schools:'));
      d.appendChild(list(Array.from(v.schools.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6), (s) => DATA.schools[s][0]));
      return;
    }
    const rows = st.band >= 0 ? [W1.M[st.band]] : W1.M;
    const cols = [0, 1, 2, 3, 4].map((c) => d3.sum(rows, (r) => r[c]));
    const total = d3.sum(cols);
    const p = el('div');
    p.appendChild(el('b', null, st.band >= 0 ? 'Faculty at schools ranked ' + BANDS[st.band].label.toLowerCase() : 'All U.S. law faculty'));
    p.append(': ' + num(total) + ' flagship-review articles, ' + yrs + '. In reviews of schools ranked ' + bandShares(cols, total) + '.');
    d.appendChild(p);
    d.appendChild(el('div', { class: 'text-muted', style: 'margin-top:4px;font-size:13px' }, 'Tap a school on the left or a review on the right, or pick one above, to follow its lines.'));
  }

  function setSelection(s, j) {
    st.school = s;
    st.journal = j;
    $('netSchool').value = s == null ? '' : String(s);
    $('coSchool').value = s == null ? '' : String(s);
    $('netJournal').value = j == null ? '' : String(j);
    renderNetwork();
    renderNetDetail();
    renderScatter();
    renderViolin();
  }

  ////////////////////////////////////////////////////////////////////////// question 1: the matrix

  const RAMP = ['#f3f8fe', '#cde2fb', '#9ec5f4', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'];
  const GRAYS = ['#f7f7f5', '#e6e5df', '#cfcec6', '#b3b2a9', '#8f8e86'];
  function renderMatrix() {
    const M = W1.M;
    const byRow = st.matrix === 'row';
    const rowSum = M.map((r) => d3.sum(r));
    const colSum = [0, 1, 2, 3, 4, 5, 6].map((c) => d3.sum(M, (r) => r[c]));
    const share = (r, c) => (byRow ? M[r][c] / (rowSum[r] || 1) : M[r][c] / (colSum[c] || 1));
    // flagship cells on the blue ramp, the two "other" columns on a gray one (each scaled to its own block), so the
    // specialty journals' large share does not wash out the flagship block, which is the question
    let max = 0, maxOther = 0;
    M.forEach((row, r) => row.forEach((v, c) => { if (c < 5) max = Math.max(max, share(r, c)); else maxOther = Math.max(maxOther, share(r, c)); }));
    const blue = d3.scaleSequential(d3.interpolateRgbBasis(RAMP)).domain([0, max || 1]);
    const gray = d3.scaleSequential(d3.interpolateRgbBasis(GRAYS)).domain([0, maxOther || 1]);
    const color = (v, c) => (c < 5 ? blue(v) : gray(v));
    const narrow = $('figMatrix').clientWidth < 560;
    const heads = BANDS.map((b) => (narrow ? b.short : b.label === 'Top 14' ? 'Top 14' : b.label.replace('101 & below, unranked', '101+ & unranked')))
      .concat([narrow ? 'Online' : 'Online & other general', narrow ? 'Spec.' : 'Specialty journals']);
    $('matrixTitle').textContent = byRow ? 'Where each group of schools publishes' : 'Who writes for each group of journals';
    $('matrixNote').textContent = (byRow
      ? 'Each row is a group of law schools; across it, the share of its faculty\'s articles in each group of journals (rows add to 100%).'
      : 'Each column is a group of journals; down it, the share of its articles by U.S. law faculty that came from each group of schools (columns add to 100%).') +
      ' Flagship reviews are grouped by their school\'s ' + SRC_LABEL[st.src] + ' rank; ' + st.from + '–' + st.to + '.';
    const t = $('matrix');
    t.replaceChildren();
    const thead = el('thead');
    const h1 = el('tr');
    h1.appendChild(el('th', { class: 'corner', rowspan: 2 }, narrow ? 'Authors' : 'Authors\' school'));
    const fl = el('th', { colspan: 5 }, narrow ? 'Flagship reviews, by school rank' : 'Flagship law reviews, by their school\'s rank');
    fl.style.borderBottom = '1px solid ' + css('--axis');
    h1.appendChild(fl);
    h1.appendChild(el('th', { colspan: 2 }, narrow ? 'Other' : 'Other journals'));
    h1.appendChild(el('th', { rowspan: 2 }, byRow ? (narrow ? 'n' : 'Articles') : ''));
    thead.appendChild(h1);
    const h2 = el('tr');
    heads.forEach((h) => h2.appendChild(el('th', { scope: 'col' }, h)));
    thead.appendChild(h2);
    t.appendChild(thead);
    const tb = el('tbody');
    M.forEach((row, r) => {
      const tr = el('tr');
      tr.appendChild(el('th', { class: 'row', scope: 'row' }, narrow ? BANDS[r].short : BANDS[r].label));
      row.forEach((v, c) => {
        const s = share(r, c);
        const td = el('td', { tabindex: 0 }, pct(s));
        const bg = color(s, c);
        td.style.background = bg;
        td.style.color = d3.hsl(bg).l < 0.55 ? '#fff' : css('--ink');
        if (r === c && c < 5) td.style.boxShadow = 'inset 0 0 0 1.5px ' + css('--ink');
        const show = (evt) => showTip(evt, (tt) => {
          tt.appendChild(el('div', { class: 'tv' }, pct(s, 1)));
          tt.appendChild(el('div', null, byRow
            ? 'of articles by faculty at schools ranked ' + BANDS[r].label.toLowerCase() + ' appeared in ' + heads[c].toLowerCase() + (c < 5 ? ' flagship reviews' : '')
            : 'of the articles by U.S. law faculty in ' + (c < 5 ? BANDS[c].label.toLowerCase() + ' flagship reviews' : heads[c].toLowerCase()) + ' were by faculty at schools ranked ' + BANDS[r].label.toLowerCase()));
          tt.appendChild(el('div', { class: 'text-muted' }, num(v) + ' of ' + num(byRow ? rowSum[r] : colSum[c]) + ' articles'));
        });
        td.addEventListener('pointermove', show);
        td.addEventListener('pointerleave', hideTip);
        td.addEventListener('focus', (e) => { const b = td.getBoundingClientRect(); show({ clientX: b.right, clientY: b.top }); });
        td.addEventListener('blur', hideTip);
        tr.appendChild(td);
      });
      tr.appendChild(el('td', { class: 'total' }, byRow ? num(rowSum[r]) : ''));
      tb.appendChild(tr);
    });
    if (!byRow) {
      const tr = el('tr');
      tr.appendChild(el('th', { class: 'row', scope: 'row' }, narrow ? 'n' : 'Articles'));
      colSum.forEach((v) => tr.appendChild(el('td', { class: 'total' }, num(v))));
      tr.appendChild(el('td', { class: 'total' }));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
  }

  ////////////////////////////////////////////////////////////////////////// question 1: rank vs rank

  function renderScatter() {
    const box = $('scatter');
    const W = box.clientWidth;
    const wide = W >= 700;
    const H = wide ? 460 : Math.round(Math.max(320, W * 0.95));
    const m = { l: 46, r: 16, t: 30, b: 42 };
    const pts = [];
    W1.school.forEach((v, s) => { if (W1.sRank[s] && v.median && v.n >= 10) pts.push({ s: s, x: W1.sRank[s], y: v.median, n: v.n, t14: v.cols[0] / v.n }); });
    const maxR = Math.max(d3.max(pts, (d) => Math.max(d.x, d.y)) || 200, 50);
    const top = Math.ceil(maxR / 20) * 20;      // ranks start at 1: ticks 1, 20, 40, ...
    const x = d3.scaleLinear().domain([1, top]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([1, top]).range([m.t, H - m.b]);
    const tv = [1].concat(d3.range(wide ? 20 : 40, top + 1, wide ? 20 : 40));
    box.replaceChildren();
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('viewBox', [0, 0, W, H].join(' '))
      .attr('role', 'img').attr('aria-label', 'Each school\'s rank against the median rank of the flagship reviews its faculty publish in');
    svg.append('g').attr('transform', 'translate(0,' + (H - m.b) + ')').call(d3.axisBottom(x).tickValues(tv).tickSize(-(H - m.t - m.b)).tickPadding(6))
      .call((g) => g.select('.domain').remove());
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).tickValues(tv).tickSize(-(W - m.l - m.r)).tickPadding(6))
      .call((g) => g.select('.domain').remove());
    svg.append('text').attr('class', 'axis-label').attr('x', W - m.r).attr('y', H - 6).attr('text-anchor', 'end').text('School\'s ' + SRC_LABEL[st.src] + ' rank →');
    svg.append('text').attr('class', 'axis-label').attr('x', 4).attr('y', 12).text('↑ Median rank of the reviews its faculty publish in (1 = top)');
    const lo = Math.max(x.domain()[0], y.domain()[0]), hi = Math.min(x.domain()[1], y.domain()[1]);
    svg.append('line').attr('x1', x(lo)).attr('y1', y(lo)).attr('x2', x(hi)).attr('y2', y(hi)).attr('stroke', css('--ink-2')).attr('stroke-opacity', 0.45);
    svg.append('text').attr('class', 'axis-label').attr('transform', 'translate(' + x(hi * 0.8) + ',' + y(hi * 0.8) + ') rotate(' + (Math.atan2(y(hi) - y(lo), x(hi) - x(lo)) * 180 / Math.PI) + ')')
      .attr('dy', '-0.5em').attr('text-anchor', 'middle').text('own level');
    svg.append('text').attr('class', 'axis-label').attr('x', W - m.r - 6).attr('y', m.t + 30).attr('text-anchor', 'end').attr('font-style', 'italic').text('publishing up');
    svg.append('text').attr('class', 'axis-label').attr('x', m.l + 10).attr('y', H - m.b - 10).attr('font-style', 'italic').text('publishing down');
    const accent = css('--accent');
    svg.append('g').selectAll('circle').data(pts.filter((d) => d.s !== st.school)).join('circle')
      .attr('cx', (d) => x(d.x)).attr('cy', (d) => y(d.y)).attr('r', wide ? 4.5 : 4).attr('fill', accent).attr('fill-opacity', st.school != null ? 0.35 : 0.8)
      .attr('stroke', '#fff').attr('stroke-width', 1.5);
    const me = pts.find((d) => d.s === st.school);
    if (me) {
      svg.append('circle').attr('cx', x(me.x)).attr('cy', y(me.y)).attr('r', 6.5).attr('fill', css('--ink')).attr('stroke', '#fff').attr('stroke-width', 2);
      const right = x(me.x) < W * 0.6;
      svg.append('text').attr('class', 'direct').attr('x', x(me.x) + (right ? 10 : -10)).attr('y', y(me.y)).attr('dy', '0.32em')
        .attr('text-anchor', right ? 'start' : 'end').text(shortName(DATA.schools[me.s][0], 28));
    }
    const delaunay = d3.Delaunay.from(pts, (d) => x(d.x), (d) => y(d.y));
    const ring = svg.append('circle').attr('r', 8).attr('fill', 'none').attr('stroke', css('--ink')).attr('stroke-width', 1.5).style('display', 'none');
    const pick = (evt) => {
      const [px, py] = d3.pointer(evt, svg.node());
      const i = delaunay.find(px, py);
      if (i == null || i < 0) return null;
      const d = pts[i];
      return Math.hypot(x(d.x) - px, y(d.y) - py) <= 28 ? d : null;
    };
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', (evt) => {
        const d = pick(evt);
        if (!d) { ring.style('display', 'none'); return hideTip(); }
        ring.style('display', null).attr('cx', x(d.x)).attr('cy', y(d.y));
        showTip(evt, (t) => {
          t.appendChild(el('div', { class: 'tt' }, DATA.schools[d.s][0]));
          tipLine(t, 'School rank', String(d.x));
          tipLine(t, 'Median review rank', String(d.y));
          tipLine(t, 'Flagship-review articles', num(d.n));
          tipLine(t, 'In top-14 reviews', pct(d.t14));
        });
      })
      .on('pointerleave', () => { ring.style('display', 'none'); hideTip(); })
      .on('click', (evt) => { const d = pick(evt); setSelection(d && d.s !== st.school ? d.s : null, null); });
  }

  ////////////////////////////////////////////////////////////////////////// question 2: series from insights.json

  const KIND_LABEL = { flagship: 'Flagship law reviews', specialty: 'Specialty journals', online: 'Online editions & other general' };
  const lastFull = () => Math.min(new Date().getFullYear() - 1, INS.years[INS.years.length - 1]);
  const variant = () => (st.panel ? 'panel_' : '') + (st.articles ? 'articles' : 'all');
  // [pieces, one, two, three, four+, authors] for kinds over years [a, b]
  function sumRows(kinds, a, b) {
    const out = [0, 0, 0, 0, 0, 0];
    const v = INS[variant()];
    INS.years.forEach((yr, i) => {
      if (yr < a || yr > b) return;
      kinds.forEach((k) => { const r = v[k][i]; for (let c = 0; c < 6; c++) out[c] += r[c]; });
    });
    return out;
  }
  const measureOf = (r, m) => (!r[0] ? null : m === '3' ? (r[3] + r[4]) / r[0] : m === 'mean' ? r[5] / r[0] : (r[2] + r[3] + r[4]) / r[0]);
  const ALL = ['flagship', 'online', 'specialty'];

  function renderCoText() {
    const end = lastFull();
    const early = sumRows(ALL, 1950, 1959), late = sumRows(ALL, end - 4, end), mid = sumRows(ALL, 1950, 1999), y2k = sumRows(ALL, 1996, 2000);
    const t = $('coTiles');
    t.replaceChildren();
    const tile = (a, b, l, f) => {
      const d = el('div', { class: 'ins-tile' });
      const v = el('div', { class: 'v' });
      v.append(f(a));
      v.appendChild(el('span', { class: 'arrow' }, '→'));
      v.append(f(b));
      d.appendChild(v);
      d.appendChild(el('div', { class: 'l' }, l));
      t.appendChild(d);
    };
    const span = '1950s → ' + (end - 4) + '–' + String(end).slice(2);
    tile(measureOf(early, '2'), measureOf(late, '2'), 'of articles had two or more authors (' + span + ')', pct);
    tile(measureOf(early, '3'), measureOf(late, '3'), 'had three or more', pct1);
    tile(measureOf(early, 'mean'), measureOf(late, 'mean'), 'authors per article, on average', (x) => x.toFixed(2));
    const f = measureOf(sumRows(['flagship'], end - 4, end), '2'), s = measureOf(sumRows(['specialty'], end - 4, end), '2');
    const ratio = measureOf(late, '2') / measureOf(y2k, '2');
    const word = ratio >= 1.85 ? 'roughly doubled' : ratio >= 1.45 ? 'risen by more than half' : ratio >= 1.15 ? 'risen' : 'barely moved';
    const lede = $('coLede');
    lede.replaceChildren();
    lede.append(ratio >= 1.15 ? 'Yes, and the rise is recent. ' : 'Not much. ');
    lede.append('From 1950 to 1999, about ');
    lede.appendChild(el('b', null, pct(measureOf(mid, '2'))));
    lede.append(' of articles in the journals collected here had more than one author. Since the late 1990s that share has ' + word + ', to ');
    lede.appendChild(el('b', null, pct(measureOf(late, '2'))));
    lede.append(' in ' + (end - 4) + '–' + end + ': ' + pct(s) + ' in specialty journals and ' + pct(f) + ' in flagship law reviews.');
    $('cPanelNote').textContent = '(' + INS.panel.journals + ' journals publishing since ' + INS.panel.since + ')';
  }

  function renderTrend() {
    const box = $('trend');
    const W = box.clientWidth;
    const wide = W >= 700;
    const H = wide ? 380 : 300;
    const m = { l: 44, r: wide ? 150 : 44, t: 12, b: 30 };
    const end = lastFull();
    const yrs = INS.years.map((y, i) => [y, i]).filter(([y]) => y >= 1950 && y <= end);
    const kinds = ['flagship', 'specialty'];
    const color = { flagship: css('--flagship'), specialty: css('--specialty') };
    const v = INS[variant()];
    const series = kinds.map((k) => ({ k: k, pts: yrs.map(([y, i]) => ({ y: y, v: measureOf(v[k][i], st.measure), n: v[k][i][0] })).filter((d) => d.v != null && d.n >= 20) }));
    const x = d3.scaleLinear().domain([1950, end]).range([m.l, W - m.r]);
    const vmax = d3.max(series, (s) => d3.max(s.pts, (d) => d.v)) || 1;
    const y = d3.scaleLinear().domain(st.measure === 'mean' ? [1, Math.max(1.1, vmax)] : [0, vmax]).nice().range([H - m.b, m.t]);
    const fmt = st.measure === 'mean' ? (d) => d.toFixed(2) : (d) => (100 * d).toFixed(st.measure === '3' && vmax < 0.1 ? 0 : 0) + '%';
    $('trendTitle').textContent = st.measure === 'mean' ? 'Authors per article' : st.measure === '3' ? 'Share of articles with three or more authors' : 'Share of articles with more than one author';
    const lg = $('trendLegend');
    lg.replaceChildren();
    kinds.forEach((k) => { const s = el('span'); const i = el('i'); i.style.background = color[k]; s.appendChild(i); s.append(KIND_LABEL[k]); lg.appendChild(s); });
    box.replaceChildren();
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('viewBox', [0, 0, W, H].join(' '))
      .attr('role', 'img').attr('aria-label', $('trendTitle').textContent + ', by year, flagship law reviews and specialty journals');
    svg.append('g').attr('transform', 'translate(0,' + (H - m.b) + ')').call(d3.axisBottom(x).ticks(wide ? 8 : 4).tickFormat(d3.format('d')).tickSizeOuter(0))
      .call((g) => g.select('.domain').attr('stroke', css('--axis'))).call((g) => g.selectAll('.tick line').attr('stroke', css('--axis')));
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat(fmt).tickSize(-(W - m.l - m.r)).tickPadding(6))
      .call((g) => g.select('.domain').remove());
    const line = d3.line().x((d) => x(d.y)).y((d) => y(d.v)).curve(d3.curveMonotoneX);
    series.forEach((s) => {
      svg.append('path').datum(s.pts).attr('d', line).attr('fill', 'none').attr('stroke', color[s.k]).attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    });
    // end labels: series name and last value on wide screens, the value alone on phones (the legend names them)
    const ends = series.filter((s) => s.pts.length).map((s) => ({ k: s.k, d: s.pts[s.pts.length - 1] }));
    const placed = placeLabels(ends.map((e) => ({ y: y(e.d.v), text: (wide ? KIND_LABEL[e.k].replace(' law reviews', '') + ' ' : '') + fmt(e.d.v), k: e.k })), m.t, H - m.b);
    ends.forEach((e) => svg.append('circle').attr('cx', x(e.d.y)).attr('cy', y(e.d.v)).attr('r', 4).attr('fill', color[e.k]).attr('stroke', '#fff').attr('stroke-width', 2));
    placed.forEach((l) => svg.append('text').attr('class', 'direct').attr('x', W - m.r + 8).attr('y', l.y).attr('dy', '0.32em').text(l.text));
    // crosshair: snaps to the nearest year, one readout for both series
    const cross = svg.append('line').attr('y1', m.t).attr('y2', H - m.b).attr('stroke', css('--ink-2')).attr('stroke-opacity', 0.5).style('display', 'none');
    const dots = series.map((s) => svg.append('circle').attr('r', 4.5).attr('fill', color[s.k]).attr('stroke', '#fff').attr('stroke-width', 2).style('display', 'none'));
    const move = (evt) => {
      const [px] = d3.pointer(evt, svg.node());
      const yr = Math.max(1950, Math.min(end, Math.round(x.invert(px))));
      cross.style('display', null).attr('x1', x(yr)).attr('x2', x(yr));
      series.forEach((s, k) => { const d = s.pts.find((p) => p.y === yr); dots[k].style('display', d ? null : 'none'); if (d) dots[k].attr('cx', x(yr)).attr('cy', y(d.v)); });
      showTip(evt, (t) => {
        t.appendChild(el('div', { class: 'tt' }, String(yr)));
        series.forEach((s) => { const d = s.pts.find((p) => p.y === yr); if (d) tipLine(t, KIND_LABEL[s.k], fmt(d.v) + ' of ' + num(d.n), color[s.k]); });
      });
    };
    svg.append('rect').attr('x', m.l).attr('y', m.t).attr('width', W - m.l - m.r).attr('height', H - m.t - m.b).attr('fill', 'transparent')
      .on('pointermove', move).on('pointerdown', move)
      .on('pointerleave', () => { cross.style('display', 'none'); dots.forEach((d) => d.style('display', 'none')); hideTip(); });

    // the table behind the chart
    const tbl = el('table');
    const hr = el('tr');
    ['Year', 'Flagship: pieces', 'Flagship', 'Specialty: pieces', 'Specialty'].forEach((h) => hr.appendChild(el('th', null, h)));
    tbl.appendChild(el('thead')).appendChild(hr);
    const tb = el('tbody');
    yrs.slice().reverse().forEach(([yr, i]) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, String(yr)));
      kinds.forEach((k) => { const r = v[k][i]; tr.appendChild(el('td', null, num(r[0]))); const mv = measureOf(r, st.measure); tr.appendChild(el('td', null, mv == null ? '–' : fmt(mv))); });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    $('trendTable').replaceChildren(tbl);
  }

  function renderTeams() {
    const box = $('teams');
    const W = box.clientWidth;
    const wide = W >= 700;
    const end = lastFull();
    const decades = d3.range(1950, end + 1, 10).map((d) => ({ label: d + 's', a: d, b: Math.min(d + 9, end) }));
    decades.forEach((d) => {
      const r = sumRows(ALL, d.a, d.b);
      d.co = r[2] + r[3] + r[4];
      d.parts = [r[2], r[3], r[4]].map((c) => c / (d.co || 1));
    });
    const colors = [css('--seq-1'), css('--seq-2'), css('--seq-3')];
    const names = ['2 authors', '3 authors', '4 or more'];
    const lg = $('teamsLegend');
    lg.replaceChildren();
    names.forEach((nm, k) => { const s = el('span'); const i = el('i', { class: 'box' }); i.style.background = colors[k]; s.appendChild(i); s.append(nm); lg.appendChild(s); });
    const bar = 22, gap = 12;
    const m = { l: 52, r: wide ? 120 : 8, t: 6, b: 6 };
    const H = m.t + decades.length * (bar + gap) + m.b + (wide ? 0 : decades.length * 12);
    const x = d3.scaleLinear().domain([0, 1]).range([m.l, W - m.r]);
    box.replaceChildren();
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('viewBox', [0, 0, W, H].join(' '))
      .attr('role', 'img').attr('aria-label', 'Co-authored articles by number of authors, by decade');
    const rowH = bar + gap + (wide ? 0 : 12);
    decades.forEach((d, k) => {
      const y0 = m.t + k * rowH;
      svg.append('text').attr('class', 'axis-label').attr('x', m.l - 8).attr('y', y0 + bar / 2).attr('dy', '0.32em').attr('text-anchor', 'end')
        .attr('fill', css('--ink-2')).text(d.label === (Math.floor(end / 10) * 10) + 's' && d.b < d.a + 9 ? d.a + '–' + String(d.b).slice(2) : d.label);
      let acc = 0;
      d.parts.forEach((p, i) => {
        const x0 = x(acc), x1 = x(acc + p);
        acc += p;
        const w = Math.max(0, x1 - x0 - (i < 2 ? 2 : 0));   // a 2px gap between segments
        if (w <= 0) return;
        const rect = svg.append('rect').attr('x', x0).attr('y', y0).attr('width', w).attr('height', bar).attr('fill', colors[i])
          .attr('rx', i === 2 || (i === 1 && d.parts[2] === 0) ? 4 : 0).attr('tabindex', 0);
        const label = pct(p);
        if (w > label.length * 7.5 + 10) {
          svg.append('text').attr('x', x0 + w / 2).attr('y', y0 + bar / 2).attr('dy', '0.32em').attr('text-anchor', 'middle')
            .attr('font-size', 12).attr('font-weight', 600).attr('fill', i === 0 ? css('--ink') : '#fff').attr('pointer-events', 'none').text(label);
        }
        const show = (evt) => showTip(evt, (t) => {
          t.appendChild(el('div', { class: 'tv' }, pct(p, 1)));
          t.appendChild(el('div', null, 'of co-authored articles in the ' + d.label + ' had ' + names[i].replace('4 or more', 'four or more authors')));
          t.appendChild(el('div', { class: 'text-muted' }, num(Math.round(p * d.co)) + ' of ' + num(d.co)));
        });
        rect.on('pointermove', show).on('pointerdown', show).on('pointerleave', hideTip)
          .on('focus', (evt) => { const b = evt.target.getBoundingClientRect(); show({ clientX: b.right, clientY: b.top }); }).on('blur', hideTip);
      });
      const note = num(d.co) + ' co-authored';
      if (wide) svg.append('text').attr('class', 'axis-label').attr('x', W - m.r + 8).attr('y', y0 + bar / 2).attr('dy', '0.32em').text(note);
      else svg.append('text').attr('class', 'axis-label').attr('x', m.l).attr('y', y0 + bar + 11).attr('font-size', 10.5).text(note);
    });
  }

  ////////////////////////////////////////////////////////////////////////// question 2: the spread across schools

  function renderViolin() {
    const box = $('violin');
    const W = box.clientWidth;
    const wide = W >= 700;
    const H = wide ? 400 : 320;
    const m = { l: 44, r: 10, t: 14, b: 34 };
    const end = lastFull();
    const periods = d3.range(1980, end + 1, 5).map((a) => ({ a: a, b: a + 4 >= end - 1 ? end : a + 4 }))
      .filter((p, i, all) => !(i > 0 && all[i - 1].b === end));
    periods.forEach((p) => { p.label = p.a + '–' + String(p.b).slice(2); });
    const P = DATA.papers, C = DATA.credits, S = DATA.schools, people = DATA.people;
    const panel = st.panel && INS.panel.names ? new Set(INS.panel.names) : null;
    const jName = DATA.journals.map((j) => j[0]);
    const per = periods.map(() => new Map());   // school -> [articles, co-authored]
    const seen = new Set();
    const NS = S.length;
    for (let i = 0; i < C.paper.length; i++) {
      const p = C.paper[i];
      const yr = P.year[p];
      if (yr < 1980 || yr > end || (st.articles && P.minor[p])) continue;
      if (panel && !panel.has(jName[P.journal[p]])) continue;
      let k = 0;
      while (k < periods.length && yr > periods[k].b) k++;
      if (k >= periods.length) continue;
      const schools = people[C.person[i]][1];
      for (let j = 0; j < schools.length; j++) {
        const s = schools[j];
        if (!S[s][1]) continue;
        const key = p * NS + s;
        if (seen.has(key)) continue;
        seen.add(key);
        const v = per[k].get(s) || [0, 0];
        v[0] += 1;
        if (P.authors[p] >= 2) v[1] += 1;
        per[k].set(s, v);
      }
    }
    periods.forEach((p, k) => {
      p.vals = [];
      p.bySchool = new Map();
      per[k].forEach((v, s) => { if (v[0] >= 15) { p.vals.push(v[1] / v[0]); p.bySchool.set(s, v); } });
      p.vals.sort((a, b) => a - b);
      p.q = p.vals.length ? [d3.quantileSorted(p.vals, 0.25), d3.quantileSorted(p.vals, 0.5), d3.quantileSorted(p.vals, 0.75)] : null;
    });
    const top = Math.min(1, Math.max(0.4, (d3.max(periods, (p) => p.vals[p.vals.length - 1] || 0) || 0.4) + 0.02));   // every school fits
    const x = d3.scaleBand().domain(periods.map((p) => p.label)).range([m.l, W - m.r]).paddingInner(0.18).paddingOuter(0.05);
    const y = d3.scaleLinear().domain([0, top]).range([H - m.b, m.t]).nice();
    const grid = d3.range(0, y.domain()[1] + 1e-9, 0.01);
    const bw = 0.035;
    const kde = (vals) => grid.map((g) => [g, d3.mean(vals, (v) => Math.exp(-0.5 * ((g - v) / bw) ** 2)) / (bw * Math.sqrt(2 * Math.PI))]);
    periods.forEach((p) => { p.dens = p.vals.length >= 5 ? kde(p.vals) : null; });
    const dmax = d3.max(periods, (p) => (p.dens ? d3.max(p.dens, (d) => d[1]) : 0)) || 1;
    const half = x.bandwidth() / 2;
    const wv = d3.scaleLinear().domain([0, dmax]).range([0, half]);
    box.replaceChildren();
    const svg = d3.select(box).append('svg').attr('width', W).attr('height', H).attr('viewBox', [0, 0, W, H].join(' '))
      .attr('role', 'img').attr('aria-label', 'Spread across law schools of the share of their faculty\'s articles that were co-authored, by period');
    svg.append('g').attr('transform', 'translate(' + m.l + ',0)').call(d3.axisLeft(y).ticks(5).tickFormat((d) => (100 * d).toFixed(0) + '%').tickSize(-(W - m.l - m.r)).tickPadding(6))
      .call((g) => g.select('.domain').remove());
    svg.append('g').attr('transform', 'translate(0,' + (H - m.b) + ')').call(d3.axisBottom(x).tickSize(0).tickPadding(8))
      .call((g) => g.select('.domain').attr('stroke', css('--axis')))
      .call((g) => { if (!wide) g.selectAll('.tick text').text((d, i) => (i % 2 === 0 || i === periods.length - 1 ? d.slice(0, 4) : '')); });
    const accent = css('--accent');
    periods.forEach((p) => {
      const cx = x(p.label) + half;
      if (p.dens) {
        const area = d3.area().curve(d3.curveBasis).y((d) => y(d[0])).x0((d) => cx - wv(d[1])).x1((d) => cx + wv(d[1]));
        const lo = p.vals[0], hi = p.vals[p.vals.length - 1];
        const clip = p.dens.filter((d) => d[0] >= lo - bw && d[0] <= hi + bw);
        svg.append('path').datum(clip).attr('d', area).attr('fill', accent).attr('fill-opacity', 0.16).attr('stroke', accent).attr('stroke-width', 1.5);
      }
      if (p.q) {
        svg.append('line').attr('x1', cx).attr('x2', cx).attr('y1', y(p.q[0])).attr('y2', y(p.q[2])).attr('stroke', css('--ink')).attr('stroke-width', 4).attr('stroke-linecap', 'round');
        svg.append('circle').attr('cx', cx).attr('cy', y(p.q[1])).attr('r', 4).attr('fill', '#fff').attr('stroke', css('--ink')).attr('stroke-width', 1.5);
      }
    });
    // one school followed across the periods
    if (st.school != null) {
      const pts = periods.map((p) => { const v = p.bySchool.get(st.school); return v ? { x: x(p.label) + half, y: y(v[1] / v[0]), v: v, p: p } : null; }).filter(Boolean);
      if (pts.length) {
        svg.append('path').attr('d', d3.line().x((d) => d.x).y((d) => d.y)(pts)).attr('fill', 'none').attr('stroke', css('--ink')).attr('stroke-width', 1.5).attr('stroke-opacity', 0.75);
        pts.forEach((d) => svg.append('circle').attr('cx', d.x).attr('cy', d.y).attr('r', 4.5).attr('fill', css('--specialty')).attr('stroke', '#fff').attr('stroke-width', 2));
        const last = pts[pts.length - 1];
        svg.append('text').attr('class', 'direct').attr('x', last.x - 8).attr('y', last.y - 12).attr('text-anchor', 'end').text(shortName(DATA.schools[st.school][0], 26));
      }
    }
    // hover: the whole column of a period
    periods.forEach((p) => {
      const show = (evt) => showTip(evt, (t) => {
        t.appendChild(el('div', { class: 'tt' }, p.label));
        if (!p.q) { t.appendChild(el('div', null, 'Too few schools with 15+ articles')); return; }
        tipLine(t, 'Middle school', pct(p.q[1]));
        tipLine(t, 'Middle half', pct(p.q[0]) + '–' + pct(p.q[2]));
        tipLine(t, 'Schools', num(p.vals.length));
        if (st.school != null) {
          const v = p.bySchool.get(st.school);
          tipLine(t, shortName(DATA.schools[st.school][0], 22), v ? pct(v[1] / v[0]) + ' of ' + v[0] : 'under 15 articles', css('--specialty'));
        }
      });
      svg.append('rect').attr('x', x(p.label)).attr('y', m.t).attr('width', x.bandwidth()).attr('height', H - m.t - m.b).attr('fill', 'transparent')
        .on('pointermove', show).on('pointerdown', show).on('pointerleave', hideTip);
    });
  }

  ////////////////////////////////////////////////////////////////////////// controls

  function renderWhere() {
    W1 = computeWhere();
    renderWhereText();
    renderNetwork();
    renderNetDetail();
    renderMatrix();
    renderScatter();
  }
  function renderCo() {
    renderCoText();
    renderTrend();
    renderTeams();
    renderViolin();
  }

  function fillSchoolSelect(id) {
    const s = $(id);
    const keep = s.value;
    s.replaceChildren(new Option('— none —', ''));
    const us = DATA.schools.map((x, i) => i).filter((i) => DATA.schools[i][1]);
    us.sort((a, b) => ((schoolRank(a) || 1e9) - (schoolRank(b) || 1e9)) || DATA.schools[a][0].localeCompare(DATA.schools[b][0]));
    us.forEach((i) => s.add(new Option((schoolRank(i) ? schoolRank(i) + ' · ' : 'NR · ') + DATA.schools[i][0], String(i))));
    s.value = keep;
  }
  function fillJournalSelect() {
    const s = $('netJournal');
    const keep = s.value;
    s.replaceChildren(new Option('— none —', ''));
    const jr = journalRanks();
    const ids = DATA.journals.map((j, i) => i).filter((i) => journalColumn(i, jr) <= 4);
    ids.sort((a, b) => ((jr[a] || 1e9) - (jr[b] || 1e9)) || DATA.journals[a][0].localeCompare(DATA.journals[b][0]));
    ids.forEach((i) => s.add(new Option((jr[i] > 0 ? jr[i] + ' · ' : 'NR · ') + DATA.journals[i][0], String(i))));
    s.value = keep;
  }

  function setup() {
    const maxY = Math.min(new Date().getFullYear(), META.years.max);
    st.to = maxY;
    st.from = maxY - 10;
    for (let y = maxY; y >= Math.max(META.years.min, 1950); y--) { $('wFrom').add(new Option(y, y)); $('wTo').add(new Option(y, y)); }
    $('wFrom').value = st.from;
    $('wTo').value = st.to;
    (DATA.rank_sources || [['usnews', 'U.S. News overall rank']]).forEach((s) => $('wSrc').add(new Option(s[0] === 'peer' ? 'U.S. News peer reputation (TaxProf)' : 'U.S. News overall', s[0])));
    $('wSrc').value = st.src;
    const yearChange = () => {
      let a = +$('wFrom').value, b = +$('wTo').value;
      if (a > b) { const t = a; a = b; b = t; $('wFrom').value = a; $('wTo').value = b; }
      st.from = a; st.to = b;
      renderWhere();
    };
    $('wFrom').addEventListener('change', yearChange);
    $('wTo').addEventListener('change', yearChange);
    $('wSrc').addEventListener('change', () => { st.src = $('wSrc').value; fillSchoolSelect('netSchool'); fillSchoolSelect('coSchool'); fillJournalSelect(); renderWhere(); });
    $('wShort').addEventListener('change', () => { st.skipShort = $('wShort').checked; renderWhere(); });

    const chips = $('netChips');
    [['All schools', -1]].concat(BANDS.map((b, k) => [b.label === 'Top 14' ? 'Top 14' : b.label.replace('101 & below, unranked', '101+ & unranked'), k])).forEach(([label, k]) => {
      const c = el('button', { type: 'button', class: 'ins-chip', role: 'radio', 'aria-checked': String(k === st.band) }, label);
      c.addEventListener('click', () => {
        st.band = k;
        chips.querySelectorAll('.ins-chip').forEach((x) => x.setAttribute('aria-checked', 'false'));
        c.setAttribute('aria-checked', 'true');
        setSelection(null, null);
      });
      chips.appendChild(c);
    });
    fillSchoolSelect('netSchool');
    fillSchoolSelect('coSchool');
    fillJournalSelect();
    $('netSchool').addEventListener('change', () => setSelection($('netSchool').value === '' ? null : +$('netSchool').value, null));
    $('coSchool').addEventListener('change', () => setSelection($('coSchool').value === '' ? null : +$('coSchool').value, null));
    $('netJournal').addEventListener('change', () => setSelection(null, $('netJournal').value === '' ? null : +$('netJournal').value));

    document.querySelectorAll('#figMatrix .ins-seg button').forEach((b) => b.addEventListener('click', () => {
      st.matrix = b.dataset.view;
      document.querySelectorAll('#figMatrix .ins-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderMatrix();
    }));
    document.querySelectorAll('#trendMeasure button').forEach((b) => b.addEventListener('click', () => {
      st.measure = b.dataset.m;
      document.querySelectorAll('#trendMeasure button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderTrend();
    }));
    $('cArticles').addEventListener('change', () => { st.articles = $('cArticles').checked; renderCo(); });
    $('cPanel').addEventListener('change', () => { st.panel = $('cPanel').checked; renderCo(); });

    $('mPieces').textContent = num(INS.pieces);
    $('mPanel').textContent = num(INS.panel.journals);

    let lastW = 0, timer = null;
    new ResizeObserver(() => {
      const w = document.querySelector('.ins-section').clientWidth;
      if (Math.abs(w - lastW) < 2) return;
      lastW = w;
      clearTimeout(timer);
      timer = setTimeout(() => { hideTip(); renderNetwork(); renderMatrix(); renderScatter(); renderTrend(); renderTeams(); renderViolin(); }, 120);
    }).observe(document.body);
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('svg, .ins-matrix')) hideTip(); });
  }

  Promise.all(['data/data.json', 'data/meta.json', 'data/insights.json'].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(u + ': ' + r.status);
    return r.json();
  }))).then(([data, meta, ins]) => {
    DATA = data; META = meta; INS = ins;
    LSR.stampMasthead(meta);
    $('footer').innerHTML = LSR.siteFooter(meta);
    $('loading').remove();
    document.querySelectorAll('.ins-section').forEach((s) => { s.hidden = false; });
    setup();
    renderWhere();
    renderCo();
    if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
  }).catch((e) => {
    $('loading').textContent = 'The data could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
