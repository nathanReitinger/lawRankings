// Law School Rankings: the Insights page, section 5 "How equal is publishing?" (2026-10-29, the owner: "i want to know
// about equality in publishing", from his own Lorenz curves and Gini coefficients of where flagship-review articles
// come from, for slices of the reviews by rank: the reviews of the schools ranked 1, 1-3, 1-14, 1-50, 1-100, and every
// flagship review). His 2023 chart (lorenz.html) took the Gini of the ranks of the authors' schools; here each curve
// runs over the U.S. law schools themselves, every one of them, those with no articles included: the share of the
// schools, fewest articles first, against the share of the articles they have. Computed in the browser from
// data/data.json (the rankings' own data: current faculty's articles, each author at the U.S. law school where they
// teach now); insights.js hands the data over (window.LSR_INS, event 'lsr-insights-data') and the figures are computed
// and drawn once the section comes into view, as in connections.js.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n).toLocaleString('en-US');
  const pct = (x) => (x == null || !isFinite(x) ? '–' : (x < 0.1 && x > 0 ? (100 * x).toFixed(1) : (100 * x).toFixed(0)) + '%');
  const pct1 = (x) => (x == null || !isFinite(x) ? '–' : (100 * x).toFixed(1) + '%');
  const gini = (g) => (g == null || !isFinite(g) ? '–' : g.toFixed(2));
  const css = (name, dflt) => getComputedStyle(document.body).getPropertyValue(name).trim() || dflt;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };
  const INST_SHORT = { 'New York University': 'NYU', 'University of California, Los Angeles': 'UCLA', 'University of California, Berkeley': 'Berkeley',
    'University of Pennsylvania': 'Penn', 'University of Texas at Austin': 'Texas', 'University of Southern California': 'USC',
    'George Washington University': 'GW', 'Columbia University School of Law': 'Columbia', 'Boston University': 'BU',
    'University of North Carolina at Chapel Hill': 'UNC', 'Washington University': 'WashU', 'Boston College': 'BC',
    'University of California, Davis': 'UC Davis', 'University of Notre Dame': 'Notre Dame', 'Georgetown University': 'Georgetown' };
  const instLabel = (name) => INST_SHORT[name] || name.replace(/^The /, '').replace(/ School of Law$| Law School$/, '').replace(/^University of California, /, 'UC ')
    .replace(/^University of /, '').replace(/ University$/, '');

  // the owner's slices: the flagship reviews (each school's main law review) of the schools U.S. News ranks 1st, 1-3,
  // 1-14, 1-50 and 1-100, and every flagship review. Ties are kept (a review whose school is tied at 14th is in the top
  // 14), so a slice can hold more reviews than its number. Colors: one blue, darker for the narrower slice (an ordinal
  // ramp, steps 700/600/500/350/250), and every review in the page's second ink. The two light steps are under 3:1 on
  // white (2.99 and 2.11) and the two darkest are close (1.5:1 apart), so every mark is also named directly: the Lorenz
  // curves on the chart, the five-year lines at their ends, the Gini bars on their axis.
  const SLICES = [
    { cut: 1, short: 'Ranked 1st', key: '1st', color: '#0d366b' },
    { cut: 3, short: 'Top 3', key: '1–3', color: '#184f95' },
    { cut: 14, short: 'Top 14', key: '1–14', color: '#256abf' },
    { cut: 50, short: 'Top 50', key: '1–50', color: '#5598e7' },
    { cut: 100, short: 'Top 100', key: '1–100', color: '#86b6ef' },
    { cut: Infinity, short: 'All flagship', key: 'All', color: '#52514e' },
  ];
  const inSlice = (r, cut) => (cut === Infinity ? r >= 0 : r >= 1 && r <= cut);   // 0: the review of an unranked school
  const HEAD = 2;                 // the headline's slice: the top 14, as legal academia talks about the top
  const OVER_TIME = [1, 2, 3, 5]; // the slices drawn over time (the table has all six)

  ////////////////////////////////////////////////////////////////////////// the numbers

  // One pass over the papers. Counted: research articles (short pieces left out) in flagship reviews with at least one
  // author on the faculty of a U.S. law school; an article counts once for each U.S. law school with an author on it
  // (not split among co-authors), so the schools' counts add up to a little more than the number of articles. "The
  // window" is the ten years the rankings show by default (meta.default_to and the nine before); the five-year windows
  // end at meta.default_to and step back while they start in 1980 or later.
  function compute(DATA, META) {
    const P = DATA.papers, C = DATA.credits, S = DATA.schools, J = DATA.journals, people = DATA.people;
    const NP = P.n || P.journal.length, NS = S.length;
    let maxYear = 0;
    for (let p = 0; p < NP; p++) if (P.year[p] > maxYear) maxYear = P.year[p];
    const to = META && META.default_to ? +META.default_to : maxYear;
    const from = to - 9;
    const wins = [];
    for (let e = to; e - 4 >= 1980; e -= 5) wins.unshift([e - 4, e]);
    const winOf = (y) => { for (let w = 0; w < wins.length; w++) if (y >= wins[w][0] && y <= wins[w][1]) return w; return -1; };
    // every U.S. law school on the faculty lists, and each person's (the rankings credit every U.S. school a person is
    // listed at)
    const US = [];
    S.forEach((row, s) => { if (row[1]) US.push(s); });
    const usOf = people.map((row) => (row[1] || []).filter((s) => S[s] && S[s][1]));
    // each flagship review's school rank (U.S. News overall); null for every other journal (insights.js journalColumn)
    const jr = (DATA.journal_ranks && DATA.journal_ranks.usnews) || J.map((j) => j[2]);
    const fr = J.map((j, ji) => {
      if (j[3] && j[3].length) return null;
      const r = j[2] == null ? null : (DATA.host_ranks ? jr[ji] : j[2]);
      return r == null || r < 0 ? null : r;
    });
    const reviews = SLICES.map((sl) => fr.map((r, ji) => (r != null && inSlice(r, sl.cut) ? ji : -1)).filter((ji) => ji >= 0));
    // each paper's credited people
    const start = new Int32Array(NP + 1);
    for (let i = 0; i < C.paper.length; i++) start[C.paper[i] + 1]++;
    for (let p = 0; p < NP; p++) start[p + 1] += start[p];
    const at = start.slice(0, NP), who = new Int32Array(C.paper.length);
    for (let i = 0; i < C.paper.length; i++) who[at[C.paper[i]]++] = C.person[i];

    const NL = SLICES.length;
    const cnt = SLICES.map(() => new Int32Array(NS)), arts = new Int32Array(NL);
    const wcnt = wins.map(() => SLICES.map(() => new Int32Array(NS))), warts = wins.map(() => new Int32Array(NL));
    const ss = [];
    for (let p = 0; p < NP; p++) {
      if (P.minor && P.minor[p]) continue;
      const r = fr[P.journal[p]];
      if (r == null) continue;
      const y = P.year[p], inWin = y >= from && y <= to, w = winOf(y);
      if (!inWin && w < 0) continue;
      ss.length = 0;
      for (let k = start[p]; k < start[p + 1]; k++) usOf[who[k]].forEach((s) => { if (!ss.includes(s)) ss.push(s); });
      if (!ss.length) continue;
      for (let i = 0; i < NL; i++) {
        if (!inSlice(r, SLICES[i].cut)) continue;
        if (inWin) { arts[i]++; for (const s of ss) cnt[i][s]++; }
        if (w >= 0) { warts[w][i]++; for (const s of ss) wcnt[w][i][s]++; }
      }
    }
    const R = { from, to, US, n: US.length, wins, reviews };
    R.slices = SLICES.map((sl, i) => Object.assign(lorenz(cnt[i], US), { articles: arts[i], counts: cnt[i] }));
    R.time = wins.map((w, k) => SLICES.map((sl, i) => Object.assign(lorenz(wcnt[k][i], US), { articles: warts[k][i] })));
    return R;
  }

  // the Lorenz curve over the schools (fewest articles first: L[k] = the share of the articles the k schools with the
  // fewest have) and its Gini coefficient, one less twice the area under the curve as drawn (straight between the
  // schools): 0 when every school has as many, (n-1)/n when one school has them all
  function lorenz(c, US) {
    const v = US.map((s) => c[s]).sort((a, b) => a - b);
    const n = v.length;
    let tot = 0;
    v.forEach((x) => { tot += x; });
    const L = new Float64Array(n + 1);
    let acc = 0, area = 0;
    for (let k = 0; k < n; k++) { acc += v[k]; L[k + 1] = tot ? acc / tot : 0; area += L[k + 1] + L[k]; }
    const desc = v.slice().reverse();
    let half = 0;
    for (let k = 0, s = 0; k < n; k++) { s += desc[k]; if (2 * s >= tot) { half = k + 1; break; } }
    return {
      v, L, tot, g: tot ? 1 - area / n : null,
      any: v.filter((x) => x > 0).length, none: v.filter((x) => x === 0).length,
      top10: n > 10 && tot ? 1 - L[n - 10] : null, bottom: tot ? L[Math.floor(n / 2)] : null, half,
      tenthTied: n > 10 && desc[9] === desc[10],
    };
  }

  ////////////////////////////////////////////////////////////////////////// the cards

  let DATA = null, META = null, R = null, drawn = false;
  const charts = [];
  const figs = [];      // { box, draw } for each figure, redrawn on resize
  let focus = null;     // the slice picked out in the keys (null: none)
  const keys = [];

  const font = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' };
  function base(W) {
    const ink2 = css('--ink-2', '#52514e'), muted = css('--muted', '#898781'), grid = css('--grid', '#e8e7e1'), axis = css('--axis', '#c3c2b7');
    const axisStyle = { color: muted, fontSize: '11.5px', fontVariantNumeric: 'tabular-nums' };
    return {
      chart: { backgroundColor: 'transparent', style: font, spacing: [8, 4, 6, 2], animation: false },
      title: { text: null }, subtitle: { text: null },
      credits: { enabled: false },          // (2026-10-26, the owner: "drop the highcharts logo")
      exporting: { enabled: false },
      legend: { enabled: false },           // each figure's key is the page's own, above the chart
      // (2026-10-26, the owner on the journal tree: "my cursor gets stuck in it"): a tap shows the tooltip, a swipe
      // always scrolls the page
      tooltip: { followTouchMove: false, useHTML: false, outside: false, hideDelay: 150, backgroundColor: 'rgba(255,255,255,0.97)', borderColor: 'rgba(11,11,11,0.10)',
        borderRadius: 8, borderWidth: 1, shadow: { opacity: 0.08 }, padding: 9, style: { fontSize: '12.5px', color: ink2, whiteSpace: 'normal', width: Math.min(300, W - 40) + 'px' } },
      xAxis: { lineColor: axis, tickColor: axis, gridLineColor: grid, labels: { style: axisStyle }, title: { style: { color: muted, fontSize: '12px', fontWeight: '400' } } },
      yAxis: { lineColor: axis, gridLineColor: grid, labels: { style: axisStyle }, title: { style: { color: muted, fontSize: '12px', fontWeight: '400' } } },
      plotOptions: { series: { animation: false, states: { inactive: { opacity: 0.35 } } } },
      accessibility: { enabled: true },
    };
  }
  function makeChart(box, opts, W) {
    const c = Highcharts.chart(box, Highcharts.merge(base(W), opts));
    charts.push(c);
    return c;
  }
  const has = (type) => typeof Highcharts !== 'undefined' && !!(Highcharts.seriesTypes && Highcharts.seriesTypes[type]);
  const faded = (color) => (typeof Highcharts !== 'undefined' ? Highcharts.color(color).setOpacity(0.2).get() : color);
  const isOn = (i) => focus == null || focus === i;

  // a card in the page's style: a heading that states the finding, what is counted, the figure, a note and the numbers
  function card(id, title, caption) {
    const fig = el('figure', { class: 'ins-card eq-card', id: id });
    const cap = el('figcaption');
    cap.appendChild(el('h3', null, title));
    cap.appendChild(el('p', null, caption));
    fig.appendChild(cap);
    const legend = el('div', { class: 'ins-legend eq-legend', role: 'group' });
    const box = el('div', { class: 'ins-chart eq-chart' });
    const foot = el('p', { class: 'ins-foot eq-foot' });
    fig.append(legend, box, foot);
    $('equalityBody').appendChild(fig);
    return { fig, legend, box, foot };
  }
  function details(c, summary) {
    const d = el('details', { class: 'ins-table' });
    d.appendChild(el('summary', null, summary));
    const tb = el('div');
    d.appendChild(tb);
    c.fig.appendChild(d);
    return { d, tb };
  }
  // a table; a cell is text, or [text, smaller text under it]
  function table(tb, head, rows, cls) {
    const t = el('table', cls ? { class: cls } : null);
    const tr = el('tr');
    head.forEach((h) => tr.appendChild(el('th', { scope: 'col' }, h)));
    t.appendChild(el('thead')).appendChild(tr);
    const body = el('tbody');
    rows.forEach((r) => {
      const x = el('tr');
      r.forEach((v, i) => {
        const td = el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null);
        if (Array.isArray(v)) { td.appendChild(document.createTextNode(v[0])); td.appendChild(el('small', null, v[1])); } else td.textContent = v;
        x.appendChild(td);
      });
      body.appendChild(x);
    });
    t.appendChild(body);
    tb.replaceChildren(t);
  }
  function noChart(c, d) {
    c.box.replaceChildren(el('p', { class: 'text-muted eq-none' }, 'The chart could not be drawn here; the table below has every number.'));
    if (d) d.open = true;
  }
  // the key above a chart: one button per slice (a tap picks that slice out in every chart of the section, a second
  // tap shows them all again) and, after them, plain entries for the reference marks
  // (each label in parts: the slice, its reviews (left out on a phone, where the table has them) and a value)
  function key(c, items, extra) {
    c.legend.setAttribute('aria-label', 'Key: tap a slice to pick it out');
    items.forEach(([i, tail]) => {
      const b = el('button', { type: 'button', class: 'eq-key', 'aria-pressed': 'false', 'data-slice': String(i) });
      const sw = el('i');
      sw.style.background = SLICES[i].color;
      const [main, more] = sliceParts(i);
      const t = el('span', { class: 'eq-lab' }, main);
      t.appendChild(el('span', { class: 'eq-long' }, more));
      if (tail) t.appendChild(document.createTextNode(tail));
      b.append(sw, t);
      b.addEventListener('click', () => { focus = focus === i ? null : i; applyFocus(); });
      c.legend.appendChild(b);
      keys.push(b);
    });
    (extra || []).forEach(([label, kind]) => {
      const s = el('span', { class: 'eq-ref' });
      s.append(el('i', { class: kind }), document.createTextNode(label));
      c.legend.appendChild(s);
    });
  }
  function applyFocus() {
    keys.forEach((b) => b.setAttribute('aria-pressed', String(focus === +b.dataset.slice)));
    charts.forEach((ch) => {
      if (!ch || !ch.series) return;
      ch.series.forEach((s) => {
        const o = s.options.custom || {};
        if (o.slice != null) s.update({ opacity: isOn(o.slice) ? 1 : 0.2, zIndex: (o.z || 1) + (focus === o.slice ? 10 : 0) }, false);
        if (o.bars) s.points.forEach((pt) => pt.update({ color: isOn(pt.custom) ? SLICES[pt.custom].color : faded(SLICES[pt.custom].color) }, false));
      });
      ch.redraw(false);
    });
  }

  const sliceName = (i, long) => {
    const sl = SLICES[i], n = R.reviews[i].length;
    if (sl.cut === 1 && n === 1) return long ? 'Ranked 1st: ' + DATA.journals[R.reviews[i][0]][0] : 'Ranked 1st';
    if (sl.cut === Infinity) return long ? 'Every flagship review (' + n + ')' : 'All flagship';
    return long ? (sl.cut === 1 ? 'Ranked 1st' : 'Ranked 1–' + sl.cut) + ' (' + n + ' reviews)' : sl.short;
  };
  const sliceParts = (i) => {
    const sl = SLICES[i], n = R.reviews[i].length;
    if (sl.cut === 1 && n === 1) return ['Ranked 1st', ': ' + DATA.journals[R.reviews[i][0]][0]];
    if (sl.cut === Infinity) return ['Every flagship review', ' (' + n + ')'];
    return [sl.cut === 1 ? 'Ranked 1st' : 'Ranked 1–' + sl.cut, ' (' + n + ' reviews)'];
  };
  const sliceSubject = (i) => {  // "the Stanford Law Review", "the top-14 reviews", in a sentence
    const sl = SLICES[i];
    if (sl.cut === 1 && R.reviews[i].length === 1) return 'the ' + DATA.journals[R.reviews[i][0]][0];
    return sl.cut === Infinity ? 'the flagship reviews' : sl.cut === 1 ? 'the reviews of the schools ranked 1st' : 'the top-' + sl.cut + ' reviews';
  };

  // ---------------------------------------------------------------- 0. three numbers
  function tiles() {
    const box = el('div', { class: 'ins-tiles eq-tiles' });
    const add = (v, l) => {
      const d = el('div', { class: 'ins-tile' });
      const vv = el('div', { class: 'v' });
      if (Array.isArray(v)) { vv.append(v[0]); vv.appendChild(el('span', { class: 'arrow' }, '→')); vv.append(v[1]); } else vv.append(v);
      d.append(vv, el('div', { class: 'l' }, l));
      box.appendChild(d);
    };
    const all = R.slices[5], h = R.slices[HEAD], top = R.slices[1];
    add([gini(all.g), gini(top.g)], 'the Gini coefficient of schools’ articles, every flagship review → the top 3 (' + R.from + '–' + R.to + ')');
    // (the ten's share of the school counts the curves add up, so "go to" with the counting rule, not "are by": counted by
    // article, the share with an author at one of the ten is higher and the share by the ten alone lower)
    add(pct(h.top10), 'of the top-14 reviews’ articles go to the 10 schools with the most (an article counts once for each school with an author on it)');
    add(num(h.none), 'of the ' + R.n + ' U.S. law schools had no article in a top-14 review in those years');
    $('equalityBody').appendChild(box);
  }

  // ---------------------------------------------------------------- 1. the Lorenz curves
  function figLorenz() {
    const h = R.slices[HEAD], n = R.n, S = DATA.schools;
    const half = Math.floor(n / 2);
    const c = card('eqLorenz',
      'Ten law schools have ' + pct(h.top10) + ' of the top-14 law reviews’ articles; the ' + half + ' with the fewest have ' + pct(h.bottom),
      'Each curve is a slice of the flagship law reviews (each school’s main review) by the school’s U.S. News overall rank, ties kept (the top 14 is ' + R.reviews[HEAD].length +
      ' reviews). It lines up all ' + n + ' U.S. law schools, fewest articles first and those with none included, against their running share of the articles: the further it sags ' +
      'below the diagonal, the more the articles sit with a few schools. The Gini coefficient measures the sag, from 0 (every school has as many) to 1 (one has them all). ' +
      'Counted: research articles (short pieces left out), ' + R.from + '–' + R.to + ', by current faculty at U.S. law schools, each at the school where they teach now; ' +
      'an article counts once for each school with an author on it, not split among co-authors. Tap a slice in the key to pick it out.');
    key(c, SLICES.map((sl, i) => [i, ' · Gini ' + gini(R.slices[i].g)]), [['Every school the same', 'dash']]);
    // the ten schools, named
    const top = R.US.slice().sort((a, b) => h.counts[b] - h.counts[a] || S[a][0].localeCompare(S[b][0]));
    const ten = top.slice(0, 10).map((s) => instLabel(S[s][0]));
    const one = R.slices[0];
    c.foot.textContent = 'The ten with the most top-14-review articles: ' + ten.slice(0, 9).join(', ') + ' and ' + ten[9] + (h.tenthTied ? ' (tied for tenth)' : '') + '. ' +
      'A slice with few articles looks unequal partly by chance: with few articles to go round, many schools would have none even if every school were equally likely to publish there. ' +
      sliceSubject(0).charAt(0).toUpperCase() + sliceSubject(0).slice(1) + ' had ' + num(one.articles) + ' articles by U.S. law faculty in these years, from ' + one.any + ' of the ' + n + ' schools.';
    const T = details(c, 'The numbers');
    table(T.tb, ['Slice (reviews)', 'Articles', 'School counts', 'Schools with any', 'Top 10 schools', 'Bottom ' + half, 'Gini'],
      SLICES.map((sl, i) => { const L = R.slices[i]; return [sliceName(i, false) + ' (' + num(R.reviews[i].length) + ')', num(L.articles), num(L.tot), num(L.any), pct1(L.top10), pct1(L.bottom), gini(L.g)]; }), 'eq-sum');
    T.tb.insertBefore(el('p', { class: 'eq-note' }, 'School counts: the articles counted once for each school with an author on them (what the curves add up). Top 10 schools: the share of those counts the ten schools with the most have; bottom ' +
      half + ': the share the ' + half + ' with the fewest have.'), T.tb.firstChild);
    // every school's counts
    const E = details(c, 'Each school’s articles');
    const rows = R.US.slice().sort((a, b) => {
      for (let i = SLICES.length - 1; i >= 0; i--) { const d = R.slices[i].counts[b] - R.slices[i].counts[a]; if (d) return d; }
      return S[a][0].localeCompare(S[b][0]);
    });
    table(E.tb, ['School', 'U.S. News'].concat(SLICES.map((sl) => sl.key)),
      rows.map((s) => [S[s][0], S[s][2] || 'unranked'].concat(SLICES.map((sl, i) => num(R.slices[i].counts[s])))), 'eq-schools');
    E.tb.insertBefore(el('p', { class: 'eq-note' }, 'Articles in each slice of flagship reviews, ' + R.from + '–' + R.to + ', by current faculty of each U.S. law school (an article once per school). The columns are the slices by school rank: 1st, 1–3, 1–14, 1–50, 1–100, and every flagship review.'), E.tb.firstChild);
    if (!has('line') || !has('bar')) { noChart(c, T.d); return { h, half, ten }; }

    // the chart and, beside it (under it on a phone), each slice's Gini as a bar
    const split = el('div', { class: 'eq-split' });
    const left = el('div', { class: 'ins-chart eq-chart' }), right = el('div', { class: 'eq-side' });
    const bars = el('div', { class: 'ins-chart eq-chart' });
    right.append(el('p', { class: 'eq-sub' }, 'Gini coefficient'), bars);
    split.append(left, right);
    c.box.replaceWith(split);
    const blue = css('--flagship', '#2a78d6'), rule = css('--axis', '#c3c2b7'), ink = css('--ink', '#0b0b0b'), ink2 = css('--ink-2', '#52514e'), muted = css('--muted', '#898781');
    const curves = SLICES.map((sl, i) => Array.from(R.slices[i].L, (y, k) => [100 * k / n, 100 * y]));
    // each curve named on the chart, as the five-year lines are at their ends: two of the blues are under 3:1 on white,
    // and the curves of the review ranked first and of the top 3 run together. A name goes beside its curve where no
    // other curve comes near; where none is clear (the curves lie close together), in the nearest clear space with a
    // rule to a dot on its curve; on a phone 'Ranked 1st' and 'All flagship' are '1st' and 'All', as the key spells them
    // out. Every curve rises, so in plot pixels each has one height (down the screen) at each x. The places are worked
    // out once for each size of the chart; picking a slice out only redraws the names.
    const placeNames = (ch, narrow, size) => {
      const PW = ch.plotWidth, PH = ch.plotHeight;
      const lines = ch.series.filter((s) => s.points && s.points.length > 1).map((s) => {
        const o = s.options.custom || {};
        return { i: o.slice == null ? -1 : o.slice, xs: s.points.map((p) => p.plotX), ys: s.points.map((p) => p.plotY) };
      });
      const yAt = (l, x) => {
        const xs = l.xs, m = xs.length - 1;
        if (x <= xs[0]) return l.ys[0];
        if (x >= xs[m]) return l.ys[m];
        let a = 0, b = m;
        while (b - a > 1) { const mid = (a + b) >> 1; if (xs[mid] <= x) a = mid; else b = mid; }
        return l.ys[a] + (l.ys[b] - l.ys[a]) * (x - xs[a]) / (xs[b] - xs[a]);
      };
      // line l passes through box b grown by m pixels (it is the box's height range it covers across the box)
      const hits = (l, b, m) => yAt(l, b.x1 + m) <= b.y1 + m && yAt(l, b.x0 - m) >= b.y0 - m;
      const over = (a, b, m) => a.x0 < b.x1 + m && b.x0 < a.x1 + m && a.y0 < b.y1 + m && b.y0 < a.y1 + m;
      // a straight rule from p to q crosses line l when its two ends lie on opposite sides of it
      const crosses = (l, p, q) => (yAt(l, p.x) - p.y) * (yAt(l, q.x) - q.y) < 0;
      const ruleIn = (p, q, b) => { for (let k = 0; k <= 10; k++) { const x = p.x + (q.x - p.x) * k / 10, y = p.y + (q.y - p.y) * k / 10; if (x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2) return true; } return false; };
      const cut = (p, q, r, s) => {   // two rules cross
        const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
        if (!d) return false;
        const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
        return t > 0 && t < 1 && u > 0 && u < 1;
      };
      // how far a point of line l stands from every other line: a rule's dot must sit on its own curve alone
      const apart = (l, p) => {
        let m = 99;
        lines.forEach((o) => {
          if (o === l) return;
          for (let k = 1; k < o.xs.length; k++) {
            const x0 = o.xs[k - 1], y0 = o.ys[k - 1], dx = o.xs[k] - x0, dy = o.ys[k] - y0;
            if (x0 + dx < p.x - 30 || x0 > p.x + 30) continue;
            const t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / (dx * dx + dy * dy || 1)));
            m = Math.min(m, Math.hypot(p.x - x0 - t * dx, p.y - y0 - t * dy));
          }
        });
        return m;
      };
      // the places a name can take: boxes on a grid over the plot, at least M pixels from every curve but its own. One
      // within 5 pixels of its own curve, with the others M + 4 or more away, names it as it stands; any other is tied to
      // its curve by the shortest rule (80 pixels at most) to a dot where the curve stands at least 5 pixels from the
      // rest, crossing as few curves as it can
      const M = narrow ? 6 : 8, GRID = narrow ? 4 : 6;
      const todo = lines.filter((l) => l.i >= 0 && size[l.i]).map((l) => {
        const w = size[l.i].w, h = size[l.i].h, cands = [], dots = [];
        const step = Math.max(1, Math.round(l.xs.length / 90));
        for (let k = step; k < l.xs.length - 1; k += step) {
          const p = { x: l.xs[k], y: l.ys[k] }, ap = apart(l, p);
          if (ap >= 5) dots.push({ p, ap });
        }
        // which side of its own curve a point of the rule lies on (the rule must not cross it)
        const side = (p, q, t) => Math.sign(yAt(l, p.x + (q.x - p.x) * t) - (p.y + (q.y - p.y) * t));
        for (let y0 = 2; y0 + h <= PH - 2; y0 += GRID) {
          for (let x0 = 2; x0 + w <= PW - 2; x0 += GRID) {
            const b = { x0, x1: x0 + w, y0, y1: y0 + h };
            if (hits(l, b, 2) || lines.some((o) => o !== l && hits(o, b, M))) continue;
            let room = 0;   // more room from the other curves: less doubt which curve it names
            while (room < 5 && !lines.some((o) => o !== l && hits(o, b, M + 4 * (room + 1)))) room++;
            if (room && hits(l, b, 5)) { cands.push({ i: l.i, b, q: null, s: 6 - room }); continue; }
            let best = null;
            dots.forEach(({ p, ap }) => {
              const q = { x: Math.min(Math.max(p.x, b.x0), b.x1), y: Math.min(Math.max(p.y, b.y0), b.y1) };
              const d = Math.hypot(q.x - p.x, q.y - p.y), s0 = d + 8 + 3 * Math.max(0, 12 - ap) - room;
              if (d < 8 || d > 80 || (best && s0 >= best.s)) return;
              const own = side(p, q, 0.2);
              if (!own || own !== side(p, q, 1)) return;
              const s = s0 + 30 * lines.filter((o) => o !== l && crosses(o, p, q)).length;
              if (!best || s < best.s) best = { i: l.i, b, p, q, s };
            });
            if (best) cands.push(best);
          }
        }
        return cands.sort((x, y) => x.s - y.s).slice(0, 400);
      });
      // every order of the names (each takes its best place still clear of the names and rules before it), keeping
      // the order whose places add up best; a name with no place left costs the most
      const free = (c, placed) => placed.every((o) => !over(c.b, o.b, 6) && !(o.q && ruleIn(o.p, o.q, c.b)) && !(c.q && (ruleIn(c.p, c.q, o.b) || (o.q && cut(c.p, c.q, o.p, o.q)))));
      let best = null;
      const order = (rest, placed, total) => {
        if (best && total >= best.total) return;
        if (!rest.length) { best = { total, placed: placed.slice() }; return; }
        rest.forEach((cands, k) => {
          const c = cands.find((x) => free(x, placed)), others = rest.filter((x, j) => j !== k);
          if (c) { placed.push(c); order(others, placed, total + c.s); placed.pop(); } else order(others, placed, total + 1000);
        });
      };
      order(todo, [], 0);
      return best ? best.placed : [];
    };
    const nameCurves = (ch, narrow) => {
      if (ch.eqNames) ch.eqNames.destroy();
      const g = ch.eqNames = ch.renderer.g('eq-names').attr({ zIndex: 7 }).add();   // (under the tooltip, 8)
      const X = ch.plotLeft, Y = ch.plotTop, key = [ch.plotWidth, ch.plotHeight, X, Y].join();
      const texts = {}, size = {};
      ch.series.forEach((s) => {
        const i = (s.options.custom || {}).slice;
        if (i == null) return;
        const t = texts[i] = ch.renderer.text(esc(narrow ? SLICES[i].short.replace('All flagship', 'All').replace('Ranked 1st', '1st') : SLICES[i].short), 0, 0)
          .css({ fontSize: narrow ? '11px' : '11.5px', fontWeight: '600', color: ink2, opacity: isOn(i) ? 1 : 0.35 }).add(g);
        const bb = t.getBBox();
        size[i] = { w: Math.ceil(bb.width), h: Math.ceil(bb.height), dy: -bb.y };
      });
      if (!ch.eqPlaces || ch.eqPlaces.key !== key) ch.eqPlaces = { key, list: placeNames(ch, narrow, size) };
      ch.eqPlaces.list.forEach((c) => {
        if (!texts[c.i]) return;
        const op = isOn(c.i) ? 1 : 0.35;
        texts[c.i].attr({ x: X + c.b.x0, y: Y + c.b.y0 + size[c.i].dy });
        delete texts[c.i];
        if (!c.q) return;
        ch.renderer.path([['M', X + c.p.x, Y + c.p.y], ['L', X + c.q.x, Y + c.q.y]]).attr({ stroke: muted, 'stroke-width': 1, opacity: op }).add(g);
        ch.renderer.circle(X + c.p.x, Y + c.p.y, 2.5).attr({ fill: SLICES[c.i].color, stroke: '#ffffff', 'stroke-width': 1, opacity: op }).add(g);
      });
      Object.keys(texts).forEach((i) => texts[i].destroy());   // no room anywhere: the key above names it
    };
    figs.push({ box: left, draw: () => {
      const W = left.clientWidth, narrow = W < 560;
      makeChart(left, {
        chart: { type: 'line', height: narrow ? 330 : 420, marginRight: narrow ? 14 : 18, events: { render() { nameCurves(this, narrow); } } },     // (room for the last label, 100%)
        accessibility: { description: 'Lorenz curves: for each slice of flagship law reviews, the share of its articles (up) held by the share of the ' + n + ' U.S. law schools with the fewest (across). The tables below the chart have every number.' },
        xAxis: { min: 0, max: 100, tickInterval: narrow ? 25 : 10, title: { text: narrow ? 'Schools, fewest articles first' : 'U.S. law schools, fewest articles first' }, labels: { format: '{value}%' },
          gridLineWidth: 1, crosshair: { color: rule, width: 1 } },
        yAxis: { min: 0, max: 100, tickInterval: 25, title: { text: narrow ? null : 'Share of the articles' }, labels: { format: '{value}%' } },
        tooltip: { shared: true, formatter() {
          const pts = (this.points || [this]).filter((p) => p.series && p.series.options.custom && p.series.options.custom.slice != null);
          if (!pts.length) return false;
          const k = Math.round(pts[0].x * n / 100);
          const head = k === 0 ? 'No schools' : k === n ? 'All ' + n + ' schools' : 'The ' + k + ' schools (' + pct(k / n) + ') with the fewest articles';
          return '<b>' + head + '</b><br>' + pts.map((p) => '<span style="color:' + p.series.color + '">●</span> ' + esc(p.series.name) + ': <b>' + pct1(p.y / 100) + '</b>').join('<br>') +
            '<br><span style="color:#898781">of each slice’s articles (each sorts the schools by its own count)</span>';
        } },
        plotOptions: { series: { marker: { enabled: false, symbol: 'circle' }, states: { hover: { lineWidthPlus: 0 } }, findNearestPointBy: 'x' } },
        series: [{ name: 'Every school the same', data: [[0, 0], [100, 100]], color: rule, lineWidth: 1.5, dashStyle: 'ShortDash', enableMouseTracking: false, zIndex: 0, accessibility: { enabled: false } }]
          .concat(SLICES.map((sl, i) => ({ name: sliceName(i, false), data: curves[i], color: sl.color, lineWidth: 2, custom: { slice: i, z: 1 + i },
            opacity: isOn(i) ? 1 : 0.2, zIndex: 1 + i + (focus === i ? 10 : 0) }))),
      }, W);
    } });
    figs.push({ box: bars, draw: () => {
      const W = bars.clientWidth, narrow = W < 560;
      makeChart(bars, {
        chart: { type: 'bar', height: SLICES.length * (narrow ? 34 : 40) + 46, marginRight: 34 },
        accessibility: { description: 'Bars: the Gini coefficient of each slice of flagship law reviews, from the review of the school ranked first to every flagship review.' },
        xAxis: { categories: SLICES.map((sl, i) => sliceName(i, false)), lineWidth: 1, tickLength: 0, labels: { style: { color: ink2, fontSize: '12px', textOverflow: 'none', whiteSpace: 'nowrap' } } },
        yAxis: { min: 0, max: 1, tickInterval: 0.25, title: { text: null }, labels: { format: '{value:.2f}' } },
        tooltip: { formatter() {
          const pt = this.point || this, i = pt.custom, L = R.slices[i];
          return '<b>' + esc(sliceName(i, true)) + '</b><br>Gini ' + gini(L.g) + '<br>' + num(L.articles) + ' articles, ' + L.any + ' of ' + n + ' schools with any<br>' +
            'Ten with the most: ' + pct1(L.top10) + '; the ' + half + ' with the fewest: ' + pct1(L.bottom);
        } },
        series: [{ name: 'Gini coefficient', borderRadius: 3, pointPadding: 0.16, groupPadding: 0, borderWidth: 0, custom: { bars: true },
          data: SLICES.map((sl, i) => ({ y: R.slices[i].g, color: isOn(i) ? sl.color : faded(sl.color), custom: i })),
          dataLabels: { enabled: true, crop: false, overflow: 'allow', formatter() { return gini((this.point || this).y); },
            style: { color: ink, fontSize: '11.5px', fontWeight: '600', textOutline: '3px #ffffff' } } }],
      }, W);
    } });
    return { h, half, ten, blue };
  }

  // ---------------------------------------------------------------- 2. the Gini over time
  function figTime() {
    const W5 = R.wins, T = R.time;
    if (W5.length < 3) return null;
    const first = T[0], last = T[T.length - 1];
    const lab = (w) => w[0] + '–' + w[1];
    // which way each of the six slices went, first window to last (by more than 0.01)
    const fell = SLICES.filter((sl, i) => first[i].g != null && last[i].g != null && last[i].g < first[i].g - 0.01).length;
    const rose = SLICES.filter((sl, i) => first[i].g != null && last[i].g != null && last[i].g > first[i].g + 0.01).length;
    const h0 = first[HEAD], h1 = last[HEAD];
    const trend = fell === SLICES.length ? '; every other slice fell too' : rose === SLICES.length ? '; every other slice rose too' : '';
    const c = card('eqTime',
      'Among today’s faculty, the top-14 reviews’ Gini ' + (h1.g < h0.g - 0.01 ? 'fell' : h1.g > h0.g + 0.01 ? 'rose' : 'went') + ' from ' + gini(h0.g) + ' in ' + lab(W5[0]) + ' to ' + gini(h1.g) + ' in ' + lab(W5[W5.length - 1]) + trend,
      'The Gini coefficient of the same counts, in five-year windows from ' + lab(W5[0]) + ' to ' + lab(W5[W5.length - 1]) + ', for four of the slices (the table has all six); ' +
      'every U.S. law school is counted in every window, those with no articles included. The reviews keep today’s ranks throughout. Only today’s faculty are counted, ' +
      'so the early windows hold the earlier work of those still teaching: fewer articles, which leave more schools at zero and by themselves raise the Gini. Read the change with that in mind.');
    key(c, OVER_TIME.map((i) => [i, '']));
    c.foot.textContent = 'Articles counted in the top-14 reviews: ' + num(h0.articles) + ' in ' + lab(W5[0]) + ', ' + num(h1.articles) + ' in ' + lab(W5[W5.length - 1]) +
      '; in every flagship review, ' + num(first[5].articles) + ' and ' + num(last[5].articles) + '.';
    const D = details(c, 'The numbers, by five years');
    table(D.tb, ['Years'].concat(SLICES.map((sl) => sl.key)),
      W5.map((w, k) => [lab(w)].concat(SLICES.map((sl, i) => [gini(T[k][i].g), num(T[k][i].articles)]))), 'eq-time');
    D.tb.insertBefore(el('p', { class: 'eq-note' }, 'Each cell: the Gini coefficient, and under it the number of articles. The columns are the slices by school rank: 1st, 1–3, 1–14, 1–50, 1–100, and every flagship review.'), D.tb.firstChild);
    if (!has('line')) { noChart(c, D.d); return { h0, h1, fell, rose }; }
    const rule = css('--axis', '#c3c2b7'), ink2 = css('--ink-2', '#52514e');
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      const cats = W5.map((w) => (narrow ? '’' + String(w[0]).slice(2) : w[0]) + '–' + String(w[1]).slice(2));
      const endText = (i) => (narrow ? SLICES[i].short.replace('All flagship', 'All') : SLICES[i].short);
      makeChart(c.box, {
        chart: { type: 'line', height: narrow ? 300 : 360, marginRight: narrow ? 58 : 92, events: { render() {
          // each line named at its right end, nudged apart where two would touch
          const ch = this;
          if (ch.eqEnds) ch.eqEnds.destroy();
          const g = ch.eqEnds = ch.renderer.g('eq-ends').attr({ zIndex: 7 }).add();   // (under the tooltip, 8)
          const ends = ch.series.map((s) => {
            const o = s.options.custom || {}, p = s.points[s.points.length - 1];
            return o.slice != null && p && p.plotY != null ? { y0: ch.plotTop + p.plotY, y: ch.plotTop + p.plotY, x: ch.plotLeft + p.plotX, i: o.slice } : null;
          }).filter(Boolean).sort((a, b) => a.y - b.y);
          for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
          const x = ch.plotLeft + ch.plotWidth + 10;
          ends.forEach((l) => {
            if (Math.abs(l.y - l.y0) > 3) ch.renderer.path([['M', l.x + 6, l.y0], ['L', x - 3, l.y]]).attr({ stroke: rule, 'stroke-width': 1 }).add(g);
            ch.renderer.text(esc(endText(l.i)), x, l.y + 4).css({ fontSize: '11.5px', fontWeight: '600', color: ink2, opacity: isOn(l.i) ? 1 : 0.35 }).add(g);
          });
        } } },
        accessibility: { description: 'Lines: the Gini coefficient of four slices of flagship law reviews in five-year windows, ' + lab(W5[0]) + ' to ' + lab(W5[W5.length - 1]) + '. The table below has every number.' },
        xAxis: { categories: cats, tickmarkPlacement: 'on', labels: { step: narrow ? 2 : 1, autoRotation: false, style: { textOverflow: 'none', whiteSpace: 'nowrap' } }, crosshair: { color: rule, width: 1 } },
        yAxis: { min: 0, max: 1, tickInterval: narrow ? 0.25 : 0.2, title: { text: narrow ? null : 'Gini coefficient' }, labels: { format: narrow ? '{value:.2f}' : '{value:.1f}' } },
        tooltip: { shared: true, formatter() {
          const pts = this.points || [this], k = (pts[0].point || pts[0]).index;
          return '<b>' + lab(W5[k]) + '</b><br>' + pts.map((p) => { const i = p.series.options.custom.slice; return '<span style="color:' + p.series.color + '">●</span> ' +
            esc(SLICES[i].short) + ': Gini <b>' + gini(p.y) + '</b>, ' + num(T[k][i].articles) + ' articles'; }).join('<br>');
        } },
        plotOptions: { series: { marker: { enabled: true, symbol: 'circle', radius: narrow ? 3 : 3.5, lineWidth: 1, lineColor: '#ffffff' }, states: { hover: { lineWidthPlus: 0 } } } },
        series: OVER_TIME.map((i, z) => ({ name: SLICES[i].short, color: SLICES[i].color, lineWidth: 2, custom: { slice: i, z: 1 + z },
          opacity: isOn(i) ? 1 : 0.2, zIndex: 1 + z + (focus === i ? 10 : 0), data: T.map((row) => row[i].g) })),
      }, W);
    } });
    return { h0, h1, fell, rose };
  }

  ////////////////////////////////////////////////////////////////////////// the section

  function lede(F) {
    const box = $('eqLede');
    if (!box) return;
    box.replaceChildren();
    const say = (t) => box.appendChild(document.createTextNode(t));
    const bold = (t) => box.appendChild(el('b', null, t));
    const all = R.slices[5], h = R.slices[HEAD], top = R.slices[1];
    const rising = all.g < h.g && h.g < top.g;
    say('How evenly are law review articles spread across the ' + R.n + ' U.S. law schools? ' + (rising ? 'Less evenly the higher the review. ' : '') +
      'Counting the flagship-review articles of current faculty, ' + R.from + '–' + R.to + ', the Gini coefficient across schools (0 if every school had as many, 1 if one had them all) is ');
    bold(gini(all.g)); say(' for every flagship law review, ');
    bold(gini(h.g)); say(' for the top 14 and ');
    bold(gini(top.g)); say(' for the top 3. Ten schools have ');
    bold(pct(h.top10)); say(' of the top-14 reviews’ articles, and ' + h.none + ' schools have none.');
    if (F.time && (F.time.fell === SLICES.length || F.time.rose === SLICES.length)) {
      say(' Every slice was ' + (F.time.fell === SLICES.length ? 'more' : 'less') + ' unequal in ' + R.wins[0][0] + '–' + R.wins[0][1] + ', a window that counts only the earlier work of today’s faculty.');
    }
  }

  function drawAll() {
    charts.splice(0).forEach((ch) => { try { ch.destroy(); } catch (e) { /* already gone */ } });
    figs.forEach((f) => { try { f.box.replaceChildren(); f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted eq-none' }, 'The chart could not be drawn; the table below has every number.')); } });
  }

  function build() {
    if (drawn) return;
    drawn = true;
    const body = $('equalityBody');
    if (!body) return;
    try {
      R = compute(DATA, META);
      if (!R.n || !R.slices[5].tot) throw new Error('no flagship-review articles');
    } catch (e) {
      body.replaceChildren(el('p', { class: 'text-muted' }, 'These figures could not be computed from this version of the data.'));
      return;
    }
    body.replaceChildren();
    const F = {};
    try { tiles(); } catch (e) { if (window.console) console.warn('equality: tiles', e); }
    // each figure on its own: one that cannot be computed is left out, the other still drawn
    [['lorenz', figLorenz], ['time', figTime]].forEach(([k, f]) => {
      try { F[k] = f(); } catch (e) { F[k] = null; if (window.console) console.warn('equality: ' + k, e); }
    });
    try { lede(F); } catch (e) { /* the lede is a summary; the cards stand alone */ }
    if (typeof Highcharts === 'undefined') { body.querySelectorAll('details.ins-table').forEach((d) => { d.open = true; }); figs.length = 0; }
    // one figure per frame, so drawing never holds up scrolling
    let i = 0;
    const next = () => {
      if (i >= figs.length) return;
      const f = figs[i++];
      try { f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted eq-none' }, 'The chart could not be drawn; the table below has every number.')); }
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
    // drawn again when the width changes (a phone turned, a window resized)
    let lastW = body.clientWidth, timer = null;
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        const w = body.clientWidth;
        if (!w || Math.abs(w - lastW) < 2) return;
        lastW = w;
        clearTimeout(timer);
        timer = setTimeout(drawAll, 150);
      }).observe(body);
    }
  }

  // (2026-10-26, the owner: "use lazy loading") computed and drawn when the section comes into view, or a few
  // seconds after the data is in, whichever is first; never before insights.js has shown the section
  function start() {
    const got = window.LSR_INS;
    if (!got || !got.DATA || DATA) return;
    DATA = got.DATA; META = got.META || {};
    const sec = $('equality');
    let done = false;
    const go = () => {
      if (done) return;
      if (!sec || sec.hidden || !sec.clientWidth) { setTimeout(go, 300); return; }
      done = true;
      build();
    };
    if (sec && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); setTimeout(go, 0); } }, { rootMargin: '400px 0px' });
      io.observe(sec);
      setTimeout(() => { io.disconnect(); go(); }, 5500);
    } else setTimeout(go, 0);
  }
  document.addEventListener('lsr-insights-data', () => setTimeout(start, 0));
  if (window.LSR_INS) setTimeout(start, 0);
})();
