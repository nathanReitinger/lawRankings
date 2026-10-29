// Law School Rankings: the Insights page (2026-10-25, the owner: "who is publishing where (do top law schools only
// publish with top law journals)" and "co-authorship used to happen less and today it is happening more").
// Question 1 is computed in the browser from data/data.json (the rankings' own data: current faculty's articles);
// question 2 from data/insights.json (build_data.py: every collected piece by year, kind of journal and number of
// authors) and, for the spread across schools, data.json again. Every figure is drawn with Highcharts (2026-10-26, the
// owner: "Use high charts for all figures"); the page no longer loads d3.
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
  // names go into Highcharts' tooltip and label markup as text, never as markup
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // plain stand-ins for the few d3 helpers the page used (sum, max, min, quantile, range)
  const sum = (a, f) => a.reduce((s, d, i) => s + (f ? f(d, i) : d), 0);
  const max = (a, f) => { let m; a.forEach((d, i) => { const v = f ? f(d, i) : d; if (v != null && !isNaN(v) && (m === undefined || v > m)) m = v; }); return m; };
  const min = (a, f) => { let m; a.forEach((d, i) => { const v = f ? f(d, i) : d; if (v != null && !isNaN(v) && (m === undefined || v < m)) m = v; }); return m; };
  const quantileSorted = (v, p) => {          // linear between the two nearest ranks (d3's and R's type 7)
    if (!v.length) return null;
    const i = (v.length - 1) * p, i0 = Math.floor(i);
    return i0 + 1 < v.length ? v[i0] + (v[i0 + 1] - v[i0]) * (i - i0) : v[i0];
  };
  const range = (a, b, step) => { const out = []; for (let x = a; x < b; x += step) out.push(x); return out; };   // [a, b)

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
  const SRC_LABEL = { usnews: 'U.S. News', peer: 'TaxProf peer' };
  // (2026-10-26, the owner: "add analysis on title character length over time. break it out per law review rank and
  // school rank") the groups' colors, here and in every figure that colors by group: the reference categorical order
  // (blue, orange, aqua, yellow, magenta), which passes the adjacent-pair color-vision checks on white; three sit under
  // 3:1, so every mark in them carries a direct label and the numbers are in a table
  const TI_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];

  let DATA, META, INS;
  const st = { from: 0, to: 0, src: 'usnews', skipShort: true, band: 0, school: null, journal: null, matrix: 'row',
               measure: '2', articles: true, panel: false, tiBy: 'review', tiM: 0 };
  let W1 = null;   // question 1's aggregates for the current filters
  let coDone = false;   // question 2 drawn (lazily)
  let tiDone = false;   // question 3 drawn (lazily)

  ////////////////////////////////////////////////////////////////////////// Highcharts: one look for every figure

  const HC = typeof Highcharts !== 'undefined';
  const SANS = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  const INK = css('--ink') || '#0b0b0b', INK2 = css('--ink-2') || '#52514e', MUTED = css('--muted') || '#898781';
  const GRID = css('--grid') || '#e8e7e1', AXIS = css('--axis') || '#c3c2b7', ACCENT = css('--accent') || '#2a78d6';
  const DIM = '#c9c8c0';
  const mix = (a, b, t) => Highcharts.color(a).tweenTo(Highcharts.color(b), t);
  const alpha = (c, a) => Highcharts.color(c).setOpacity(a).get();
  const ramp = (stops, t) => {                 // piecewise between the stops, t in [0, 1]
    const x = Math.max(0, Math.min(1, t || 0)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
    return mix(stops[i], stops[i + 1], x - i);
  };
  const lightness = (c) => { const v = Highcharts.color(c).rgba; return (Math.max(v[0], v[1], v[2]) + Math.min(v[0], v[1], v[2])) / 510; };
  if (HC) {
    Highcharts.setOptions({
      lang: { thousandsSep: ',' },
      chart: { backgroundColor: 'transparent', style: { fontFamily: SANS }, spacing: [10, 4, 8, 4] },
      title: { text: null },
      credits: { enabled: false },          // (2026-10-26, the owner: "drop the highcharts logo")
      exporting: { enabled: false },
      legend: { enabled: false },           // each figure's legend is the page's own, above the chart
      // (2026-10-26, the owner: "my cursor gets stuck in it"): a finger swiping over a chart scrolls the page
      // (followTouchMove: false keeps Highcharts from claiming the touch); a tap shows the tooltip, which stays
      // until the next tap elsewhere
      tooltip: { followTouchMove: false, useHTML: true, hideDelay: 150, padding: 9, borderWidth: 1, borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.97)', borderColor: 'rgba(11,11,11,0.10)', shadow: { color: '#000000', opacity: 0.06, offsetX: 0, offsetY: 3, width: 6 },
        style: { fontSize: '12.5px', color: INK2, whiteSpace: 'normal' } },
      xAxis: { lineColor: AXIS, tickColor: AXIS, gridLineColor: GRID, labels: { style: { color: MUTED, fontSize: '11.5px' } },
        title: { style: { color: MUTED, fontSize: '11.5px', fontWeight: '400' } } },
      yAxis: { lineColor: AXIS, tickColor: AXIS, gridLineColor: GRID, labels: { style: { color: MUTED, fontSize: '11.5px' } },
        title: { text: null, style: { color: MUTED, fontSize: '11.5px', fontWeight: '400' } } },
      plotOptions: { series: { animation: { duration: 300 }, states: { inactive: { opacity: 1 } } } },
    });
  }

  // one chart per box: a chart drawn again goes into its box after the old one is destroyed; without the library,
  // a note in its place (every number is also in the text, the detail panels and the tables)
  const charts = {};
  function clearChart(id) {
    if (charts[id]) { charts[id].destroy(); charts[id] = null; }
    $(id).replaceChildren();
  }
  function draw(id, options) {
    clearChart(id);
    if (!HC) { $(id).appendChild(el('p', { class: 'text-muted' }, 'The chart library did not load; the numbers are in the text and tables on this page.')); return null; }
    return (charts[id] = Highcharts.chart($(id), options));
  }

  // the tooltips' content: value first when there is one, then what it is, then rows keyed by a short line of the
  // series color; text in ink, never the series color
  function tipHTML(o) {
    let h = '<div class="ins-tt">';
    if (o.value != null) h += '<div class="tv">' + esc(o.value) + '</div>';
    if (o.title != null) h += '<div class="tt">' + esc(o.title) + '</div>';
    (o.lines || []).forEach((t) => { h += '<div>' + esc(t) + '</div>'; });
    (o.rows || []).forEach(([label, value, color]) => {
      h += '<div class="row">' + (color ? '<i style="background:' + color + '"></i>' : '') + '<span>' + esc(label) + '</span> <b>' + esc(value) + '</b></div>';
    });
    if (o.note != null) h += '<div class="m">' + esc(o.note) + '</div>';
    return h + '</div>';
  }

  // direct labels at the right end of each line (series name or value), nudged apart where they would touch, with a
  // short leader back to the line's end when one moved; drawn again on every render (resize, toggle)
  function endLabels(chart, items) {
    if (chart.insEnds) chart.insEnds.destroy();
    const g = chart.insEnds = chart.renderer.g('ins-ends').attr({ zIndex: 8 }).add();
    const ends = items.map((it) => {
      const s = chart.series[it.i], p = s && s.points.length ? s.points[s.points.length - 1] : null;
      return p && p.plotY != null && isFinite(p.plotY) ? { y: chart.plotTop + p.plotY, x: chart.plotLeft + p.plotX, text: it.text } : null;
    }).filter(Boolean);
    const x = chart.plotLeft + chart.plotWidth + 10;
    placeLabels(ends, chart.plotTop, chart.plotTop + chart.plotHeight).forEach((l) => {
      if (Math.abs(l.y - l.y0) > 3) chart.renderer.path([['M', l.x + 6, l.y0], ['L', x - 3, l.y]]).attr({ stroke: AXIS, 'stroke-width': 1 }).add(g);
      chart.renderer.text(esc(l.text), x, l.y + 4).css({ fontSize: '12px', fontWeight: '600', color: INK2, textOutline: '3px #ffffff' }).add(g);
    });
  }

  function placeLabels(items, lo, hi) {
    // labels at their points, nudged apart to 13px (a leader line is drawn for one that moved)
    const v = items.map((d) => Object.assign({}, d, { y0: d.y, y: d.y })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < v.length; i++) if (v[i].y - v[i - 1].y < 13) v[i].y = v[i - 1].y + 13;
    const over = v.length ? v[v.length - 1].y - hi : 0;
    if (over > 0) v.forEach((d) => { d.y -= over; });
    for (let i = v.length - 2; i >= 0; i--) if (v[i + 1].y - v[i].y < 13) v[i].y = v[i + 1].y - 13;
    if (v.length && v[0].y < lo) { const s = lo - v[0].y; v.forEach((d) => { d.y += s; }); }
    return v;
  }

  // a fill no one sees that still takes the pointer: the hit area around small dots (at least 24px across)
  const HIT_FILL = 'rgba(192,192,192,0.002)';

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

  // every (school, journal) pair with its number of articles in the window (an article counts once for each school
  // with an author on it: the "credits" M), and, per article, the groups of schools its authors come from (D: an
  // article counts once per group of schools it has an author in; review, 2026-10-25: article counts shown as
  // "articles" must not count a co-authored article twice)
  function computeWhere() {
    const P = DATA.papers, C = DATA.credits, S = DATA.schools, people = DATA.people;
    const NJ = DATA.journals.length, NS = S.length;
    const jr = journalRanks();
    const col = DATA.journals.map((j, ji) => journalColumn(ji, jr));
    const sRank = S.map((s, i) => schoolRank(i));
    const pair = new Map();
    const seen = new Set();
    const paperBands = new Map();
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
        let pb = paperBands.get(p);
        if (!pb) { pb = new Set(); paperBands.set(p, pb); }
        pb.add(bandOf(sRank[s]));
      }
    }
    const D = BANDS.map(() => [0, 0, 0, 0, 0, 0, 0]);
    const colPapers = [0, 0, 0, 0, 0, 0, 0];
    const journalPapers = new Map();      // ji -> {n distinct articles, bands[5]: of them, with an author in band b}
    let topOutside = 0;                    // top-14-review articles with an author from a school ranked below 25
    paperBands.forEach((bands, p) => {
      const ji = P.journal[p], c = col[ji];
      colPapers[c]++;
      bands.forEach((b) => { D[b][c]++; });
      if (c === 0 && (bands.has(2) || bands.has(3) || bands.has(4))) topOutside++;
      if (c <= 4) {
        let jp = journalPapers.get(ji);
        if (!jp) { jp = { n: 0, bands: [0, 0, 0, 0, 0] }; journalPapers.set(ji, jp); }
        jp.n++;
        bands.forEach((b) => { jp.bands[b]++; });
      }
    });
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
        edges.push({ s: s, j: ji, n: n, b: b, c: c });
        let jo = journal.get(ji);
        if (!jo) { jo = { n: 0, schools: new Map(), papers: journalPapers.get(ji) }; journal.set(ji, jo); }
        jo.n += n;                       // credits: sizes the review's dot
        jo.schools.set(s, n);
      }
    });
    school.forEach((so) => { so.median = weightedMedian(so.ranks); });
    return { M: M, D: D, colPapers: colPapers, topOutside: topOutside, edges: edges, school: school, journal: journal,
             sRank: sRank, jr: jr, col: col };
  }

  function weightedMedian(pairs) {
    if (!pairs.length) return null;
    const v = pairs.slice().sort((a, b) => a[0] - b[0]);
    const half = sum(v, (d) => d[1]) / 2;
    let acc = 0;
    for (const [r, n] of v) { acc += n; if (acc >= half) return r; }
    return v[v.length - 1][0];
  }

  ////////////////////////////////////////////////////////////////////////// question 1: tiles and lede

  function renderWhereText() {
    const D = W1.D;
    const flag = (row) => sum(row.slice(0, 5));
    const share = (k) => (flag(D[k]) ? D[k][0] / flag(D[k]) : null);
    const a = share(0), b = share(3);
    const top = W1.colPapers[0];
    const c = top ? D[0][0] / top : null;
    const outside = top ? W1.topOutside / top : null;
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
    tile(pct(c), 'of the top-14 reviews\' articles by U.S. law faculty had a top-14 author');
    tile(pct(outside), 'had an author from a school ranked below 25');
    const lede = $('whereLede');
    lede.replaceChildren();
    // (review, 2026-10-25) the wording follows the numbers: thin years, a top 14 that does not stand out, a
    // closed top
    if (!(flag(D[0]) >= 30) || a == null) {
      lede.append('Too few articles by top-14 faculty in flagship reviews from ' + st.from + ' to ' + st.to + ' to say; try a wider range of years.');
      return;
    }
    const others = max([1, 2, 3, 4].map(share).filter((x) => x != null)) || 0;
    const ratio = b > 0 ? a / b : null;
    lede.append(a >= 0.5 ? 'Largely, yes. ' : a >= 1.5 * others ? 'Not only, but far more than anyone else. ' : 'Not only, and not much more than others. ');
    lede.append('From ' + st.from + ' to ' + st.to + ', faculty at the top 14 schools placed ');
    lede.appendChild(el('b', null, pct(a)));
    lede.append(' of their flagship-review articles in top-14 reviews' + (ratio ? ', ' + ratio.toFixed(1) + ' times the share for faculty at schools ranked 51–100 (' + pct(b) + ')' : '') + '. ');
    if (outside >= 0.1) {
      lede.append('The top reviews are not closed, though: ');
      lede.appendChild(el('b', null, pct(outside)));
      lede.append(' of their articles by law faculty had an author from a school ranked below 25.');
    } else {
      lede.append('Few of the top reviews\' articles by law faculty (');
      lede.appendChild(el('b', null, pct(outside)));
      lede.append(') had an author from a school ranked below 25.');
    }
  }


  ////////////////////////////////////////////////////////////////////////// question 1: one journal's institutions and authors

  // (2026-10-25, the owner: "the user picks Harvard law review and then we see who (author and author institution,
  // grouped by author institution) published there. Network graph showing thicker lines for more connections. I'm
  // hunting for high publishing institutions and then within that high publishing authors.")
  // Articles by current faculty in the journal in the chosen years; an institution's count is its distinct articles
  // (one with two of its authors counts once), an author's is theirs; every institution, US or not.
  const jn = { journal: null, top: 20, focus: null, fromList: null, open: new Set() };   // open: institutions whose authors show

  function computeJournal() {
    const P = DATA.papers, C = DATA.credits, people = DATA.people;
    const inst = new Map();          // school -> {papers: Set, authors: Map(person -> n)}
    const all = new Set();
    for (let i = 0; i < C.paper.length; i++) {
      const p = C.paper[i];
      if (P.journal[p] !== jn.journal) continue;
      const y = P.year[p];
      if (y < st.from || y > st.to || (st.skipShort && P.minor[p])) continue;
      all.add(p);
      const person = C.person[i];
      people[person][1].forEach((s) => {
        let o = inst.get(s);
        if (!o) { o = { s: s, papers: new Set(), authors: new Map() }; inst.set(s, o); }
        o.papers.add(p);
        o.authors.set(person, (o.authors.get(person) || 0) + 1);
      });
    }
    const list = [...inst.values()].map((o) => ({ s: o.s, n: o.papers.size, authors: [...o.authors.entries()].sort((a, b) => b[1] - a[1] ||
      DATA.people[a[0]][0].localeCompare(DATA.people[b[0]][0])) }))
      .sort((a, b) => b.n - a.n || b.authors.length - a.authors.length || DATA.schools[a.s][0].localeCompare(DATA.schools[b.s][0]));
    return { articles: all.size, list: list };
  }

  function renderJournal() {
    if (jn.journal == null) return;
    const R = computeJournal();
    if (jn.focus != null && !R.list.some((o) => o.s === jn.focus)) jn.focus = null;     // (review) gone after a filter change
    jn.open.forEach((s) => { if (!R.list.some((o) => o.s === s)) jn.open.delete(s); });
    const shown = R.list.slice(0, jn.top);
    // (review) an institution focused from the list below the top N is drawn too, so the focus shows something
    if (jn.focus != null && !shown.some((o) => o.s === jn.focus)) shown.push(R.list.find((o) => o.s === jn.focus));
    // the lede: how concentrated the journal's faculty authorship is
    const lede = $('jnLede');
    lede.replaceChildren();
    const jname = DATA.journals[jn.journal][0];
    if (!R.articles) {
      lede.append('No articles by current faculty in ' + jname + ' from ' + st.from + ' to ' + st.to + '.');
      clearChart('jnGraph');
      $('jnList').replaceChildren();
      return;
    }
    const top5 = R.list.slice(0, 5);
    const top5papers = new Set();
    // distinct articles with an author from the top five institutions
    const P = DATA.papers, C = DATA.credits;
    const topSet = new Set(top5.map((o) => o.s));
    for (let i = 0; i < C.paper.length; i++) {
      const p = C.paper[i];
      if (P.journal[p] !== jn.journal || P.year[p] < st.from || P.year[p] > st.to || (st.skipShort && P.minor[p])) continue;
      if (DATA.people[C.person[i]][1].some((s) => topSet.has(s))) top5papers.add(p);
    }
    lede.appendChild(el('b', null, jname));
    lede.append(', ' + st.from + '–' + st.to + ': ' + num(R.articles) + ' article' + (R.articles === 1 ? '' : 's') + ' by current faculty at ' +
      num(R.list.length) + ' institution' + (R.list.length === 1 ? '' : 's') + ' (any institution on the faculty lists, courts and non-US schools included).');
    if (R.list.length > 5) {
      lede.append(' The top five (' + top5.map((o) => shortName(DATA.schools[o.s][0], 22)).join(', ') + ') had an author on ');
      lede.appendChild(el('b', null, pct(top5papers.size / R.articles)));
      lede.append(' of them.');
    }

    // ---- the chart (Highcharts; 2026-10-25, the owner: "multiple level with first journal. Then schools of authors who
    // publish there. Then authors themselves. You can use drill downs. Look to high charts"): a tree, journal ->
    // institutions -> authors, an institution's authors opening when it is clicked. (2026-10-25, the owner: "use tree in
    // view by default. drop sunburst chart": the tree on every screen, no sunburst)
    drawJournalChart(R, shown, jname);
    // ---- the list: every institution, most articles first; open one for its authors
    const listBox = $('jnList');
    listBox.replaceChildren();
    const maxL = R.list.length ? R.list[0].n : 1;
    R.list.slice(0, Math.max(jn.top, 40)).forEach((o, k) => {
      const isOn = jn.open.has(o.s) || jn.focus === o.s;
      const item = el('div', { class: 'jn-inst' + (isOn ? ' on' : '') });
      const b = el('button', { type: 'button', 'aria-expanded': String(isOn), 'data-s': String(o.s) });
      b.appendChild(el('span', { class: 'jn-rank' }, String(k + 1)));
      b.appendChild(el('span', { class: 'jn-iname' }, DATA.schools[o.s][0]));
      b.appendChild(el('span', { class: 'jn-inum' }, num(o.n) + ' · ' + o.authors.length + ' author' + (o.authors.length === 1 ? '' : 's')));
      const bar = el('span', { class: 'jn-ibar' });
      bar.style.width = Math.max(3, Math.round(100 * o.n / maxL)) + '%';
      b.appendChild(bar);
      b.addEventListener('click', () => { toggleOpen(o.s); jn.fromList = o.s; renderJournal(); });
      item.appendChild(b);
      const ul = el('ul', { class: 'jn-authors' });
      o.authors.forEach(([person, n]) => {
        const li = el('li');
        const url = DATA.people[person][3];
        const nm = url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, DATA.people[person][0]) : el('span', null, DATA.people[person][0]);
        li.appendChild(nm);
        li.appendChild(el('span', null, String(n)));
        ul.appendChild(li);
      });
      item.appendChild(ul);
      listBox.appendChild(item);
    });
    if (R.list.length > Math.max(jn.top, 40)) listBox.appendChild(el('div', { class: 'jn-other' }, num(R.list.length - Math.max(jn.top, 40)) + ' more institutions with as many or fewer articles'));
    // (review) never scroll the page: only the list's own box (two-column layout), and keyboard focus stays on the
    // institution the reader opened
    const focused = listBox.querySelector('.jn-inst.on');
    if (focused && listBox.scrollHeight > listBox.clientHeight + 2) {
      const top = focused.offsetTop - listBox.offsetTop;
      if (top < listBox.scrollTop || top > listBox.scrollTop + listBox.clientHeight - 40) listBox.scrollTop = Math.max(0, top - 40);
    }
    if (jn.fromList != null) {
      const btn = [...listBox.querySelectorAll('.jn-inst > button')].find((x) => x.dataset.s === String(jn.fromList));
      if (btn) btn.focus({ preventScroll: true });
      jn.fromList = null;
    }
  }

  // the Highcharts view of one journal: a tree. Node sizes and line widths follow article counts: an institution's
  // distinct articles, an author's articles there. (2026-10-26, the owner: "the lines are too thick it makes the chart
  // seem toy looking" and "I need a way to make it more Better on movile"): links from a hairline to 3px in a light
  // tint (thicker still means more articles), small nodes, the journal's name above the tree instead of on its links,
  // and an opened institution shows its first 12 authors (10 on a phone), the rest in the list
  function drawJournalChart(R, shown, jname) {
    const box = $('jnGraph');
    if (!HC) { draw('jnGraph'); return; }
    const W = box.clientWidth, narrow = W < 560;
    const maxN = max(shown, (o) => o.n) || 1;
    const maxA = max(shown, (o) => (o.authors[0] ? o.authors[0][1] : 1)) || 1;
    const capA = narrow ? 10 : 12;
    const rS = (n) => 3 + 3.5 * Math.sqrt(n / maxN), rA = (n) => 2.5 + 2 * Math.sqrt(n / maxA);
    const wS = (n) => 0.75 + 2.25 * Math.sqrt(n / maxN), wA = (n) => 0.6 + 1.2 * Math.sqrt(n / maxA);
    const isOpen = (o) => jn.open.has(o.s) || jn.focus === o.s;
    const schoolName = (s) => (W >= 900 ? DATA.schools[s][0] : instLabel(DATA.schools[s][0], narrow ? 14 : 22));
    const data = [{ id: 'J', name: jname, custom: { kind: 'journal', n: R.articles, schools: R.list.length } }];
    shown.forEach((o, k) => {
      const blue = mix('#1c5cab', '#86b6ef', shown.length > 1 ? k / (shown.length - 1) : 0);   // one hue, darker = more articles
      const open = isOpen(o);
      // value: Highcharts orders siblings by it (an opened institution's authors would otherwise move it to the top)
      data.push({ id: 's' + o.s, parent: 'J', name: schoolName(o.s), value: o.n, color: blue,
        marker: { radius: rS(o.n), fillColor: blue }, link: { lineWidth: wS(o.n) },
        custom: { kind: 'school', s: o.s, full: DATA.schools[o.s][0], n: o.n, authors: o.authors.length, open: open,
          top: o.authors[0] && o.authors[0][1] > 1 && !(o.authors[1] && o.authors[1][1] === o.authors[0][1]) ? o.authors[0] : null } });
      // the tree has an institution's authors only while it is open (closed ones have none, so the order stays the
      // ranking's)
      // a closed institution keeps an invisible placeholder child, so the tree keeps its three columns (and does not
      // jump) as institutions open and close
      if (!open) {
        data.push({ id: 'p' + o.s, parent: 's' + o.s, name: '', marker: { radius: 0.01, lineWidth: 0, fillColor: 'transparent' },
          link: { lineWidth: 0 }, dataLabels: { enabled: false }, accessibility: { enabled: false }, custom: { kind: 'pad' } });
        return;
      }
      const tint = mix(blue, '#ffffff', 0.35);
      o.authors.slice(0, capA).forEach(([person, n]) => {
        data.push({ id: 'a' + person + '_' + o.s, parent: 's' + o.s, name: DATA.people[person][0], value: n, color: tint,
          marker: { radius: rA(n), fillColor: tint }, link: { lineWidth: wA(n) },
          custom: { kind: 'author', n: n, url: DATA.people[person][3], school: DATA.schools[o.s][0], label: shortName(DATA.people[person][0], narrow ? 16 : 26) } });
      });
      if (o.authors.length > capA) {
        data.push({ id: 'm' + o.s, parent: 's' + o.s, name: '', value: 0, marker: { radius: 0.01, lineWidth: 0, fillColor: 'transparent' },
          link: { lineWidth: 0 }, accessibility: { enabled: false },
          dataLabels: { style: { color: MUTED, fontStyle: 'italic', fontWeight: '400' } },
          custom: { kind: 'more', n: o.authors.length - capA, school: DATA.schools[o.s][0] } });
      }
    });
    const tooltip = {
      followTouchMove: false,
      formatter() {
        const c = this.point.custom || {};
        if (c.kind === 'journal') return tipHTML({ title: jname, lines: [num(c.n) + ' article' + (c.n === 1 ? '' : 's') + ' by current faculty at ' +
          num(c.schools) + ' institution' + (c.schools === 1 ? '' : 's')] });
        if (c.kind === 'school') return tipHTML({ title: c.full, lines: [num(c.n) + ' article' + (c.n === 1 ? '' : 's') + ' by ' + c.authors + ' author' + (c.authors === 1 ? '' : 's')]
          .concat(c.top ? ['Most: ' + DATA.people[c.top[0]][0] + ' (' + c.top[1] + ')'] : []), note: (c.open ? 'Click to close' : 'Click to open') + ' its authors' });
        if (c.kind === 'author') return tipHTML({ title: this.point.name, lines: [c.school, c.n + ' article' + (c.n === 1 ? '' : 's') + ' in ' + jname],
          note: c.url ? 'Click for their faculty page' : null });
        if (c.kind === 'more') return tipHTML({ lines: [num(c.n) + ' more author' + (c.n === 1 ? '' : 's') + ' from ' + c.school + ' in the list'] });
        return false;
      },
    };
    const openAuthor = function () { if (this.custom && this.custom.kind === 'author' && this.custom.url) window.open(this.custom.url, '_blank', 'noopener'); };
    const describe = (point) => {
      const c = point.custom || {};
      if (c.kind === 'journal') return jname + ': ' + R.articles + ' articles by current faculty at ' + R.list.length + ' institutions.';
      if (c.kind === 'school') return c.full + ': ' + c.n + ' articles by ' + c.authors + ' authors.';
      if (c.kind === 'author') return point.name + ', ' + c.school + ': ' + c.n + ' articles.';
      return '';
    };
    // the tree's height follows the rows on screen: the institutions, plus the authors of those opened (22px apart)
    const rows = shown.reduce((a, o) => a + (isOpen(o) ? Math.max(1, Math.min(o.authors.length, capA) + (o.authors.length > capA ? 1 : 0)) : 1), 0);
    const height = Math.max(narrow ? 300 : 380, Math.min(2400, rows * (narrow ? 21 : 23) + 70));
    draw('jnGraph', {
      chart: { height: height, marginLeft: narrow ? 8 : 24, marginRight: narrow ? 128 : 200, marginTop: 34, spacing: [8, 8, 8, 8] },
      // the journal's name over the tree, clear of its links
      title: { text: esc(narrow ? shortName(jname, 40) : jname.length > 80 ? jname.slice(0, 79) + '…' : jname), align: 'left', x: 0, y: 14, margin: 0,
        style: { fontSize: '13px', fontWeight: '700', color: INK } },
      accessibility: { enabled: true, description: 'Institutions and authors publishing in ' + jname + ', ' + st.from + '–' + st.to + '. The list beside the chart has every institution and author.',
        point: { descriptionFormatter: describe } },
      tooltip: tooltip,
      series: [{
        type: 'treegraph', data: data, name: jname, turboThreshold: 0, cursor: 'pointer', animation: { duration: 350 },
        fillSpace: true, reversed: true,             // the whole width while authors are closed; the most articles on top
        marker: { symbol: 'circle', lineWidth: 1, lineColor: '#ffffff' },
        link: { type: 'curved', color: '#a9c7ec', lineWidth: 1 },
        collapseButton: { enabled: false },
        states: { hover: { link: { color: '#1c5cab' } }, inactive: { opacity: 0.6, link: { opacity: 0.45 } } },
        dataLabels: { enabled: true, crop: false, overflow: 'allow', align: 'left', x: 8, useHTML: false,
          style: { fontSize: '12px', fontWeight: '400', color: INK2, textOutline: '3px #ffffff', whiteSpace: 'nowrap' },
          formatter() {
            const c = this.point.custom || {};
            if (c.kind === 'journal' || c.kind === 'pad') return '';
            if (c.kind === 'more') return '+' + num(c.n) + ' more in the list';
            return esc(c.label || this.point.name) + ' · ' + c.n + (c.kind === 'school' && c.authors ? (c.open ? '  −' : '  +') : '');
          } },
        levels: [
          { level: 1, marker: { radius: narrow ? 5 : 6, fillColor: INK }, color: INK, dataLabels: { enabled: false } },
          { level: 2, dataLabels: { style: { fontWeight: '600', color: INK } } },
          { level: 3, dataLabels: { style: { fontSize: '11.5px' } } },
        ],
        // drill down: a click on an institution opens or closes its authors. The chart is drawn again in the same
        // order, at the height its rows need (Highcharts' own toggle moved an opened institution to the top)
        point: { events: { click: function () {
          const c = this.custom || {};
          if (c.kind === 'school') {
            toggleOpen(c.s);
            setTimeout(renderJournal, 0);            // the chart and the list together
            return false;
          }
          if (c.kind !== 'author') {                  // (review) Highcharts' own toggle would fold every institution away
            setTimeout(() => drawJournalChart(R, shown, jname), 0);
            return false;
          }
          return openAuthor.call(this);
        } } },
      }],
    });
  }

  // an institution opened or closed (the tree's authors; the list's drop-down)
  function toggleOpen(s) {
    if (jn.open.has(s) || jn.focus === s) { jn.open.delete(s); if (jn.focus === s) jn.focus = null; } else { jn.open.add(s); jn.focus = s; }
  }
  function fillJournalPicker() {
    const sel = $('jnJournal');
    sel.replaceChildren();
    const jr = journalRanks();
    const groups = [['Flagship law reviews', (ji) => journalColumn(ji, jr) <= 4], ['Specialty journals', (ji) => journalColumn(ji, jr) === 6],
                    ['Online editions & other general journals', (ji) => journalColumn(ji, jr) === 5]];
    groups.forEach(([label, test]) => {
      const og = document.createElement('optgroup');
      og.label = label;
      const ids = DATA.journals.map((j, ji) => ji).filter(test);
      ids.sort((a, b) => (label.startsWith('Flagship') ? ((jr[a] > 0 ? jr[a] : 1e9) - (jr[b] > 0 ? jr[b] : 1e9)) : 0) || DATA.journals[a][0].localeCompare(DATA.journals[b][0]));
      ids.forEach((ji) => og.appendChild(new Option(DATA.journals[ji][0], String(ji))));
      sel.appendChild(og);
    });
    if (jn.journal == null) {
      const h = DATA.journals.findIndex((j) => j[0] === 'Harvard Law Review');
      jn.journal = h >= 0 ? h : 0;
    }
    sel.value = String(jn.journal);
  }

  ////////////////////////////////////////////////////////////////////////// question 1: the flows between groups

  // (2026-10-26, the owner: "Use high charts for all figures") a Highcharts sankey: on the left the law schools in their
  // groups by rank, on the right the flagship law reviews grouped by their school's rank; a flow's width is the number
  // of articles (an article once for each school with an author on it). A flow that runs straight across stays at its
  // own level; one that climbs or falls crosses the ranking. The group picked with the chips keeps its color and the
  // rest go gray; a school or a law review picked above becomes a node of its own, next to its group.
  function renderNetwork() {
    const box = $('network');
    const W = box.clientWidth, wide = W >= 700;
    const sel = st.school, selJ = st.journal, band = st.band;
    const selB = sel != null ? bandOf(W1.sRank[sel]) : null;
    const selC = selJ != null ? W1.col[selJ] : null;
    $('netEnds').replaceChildren(
      el('span', null, 'Law schools, by ' + SRC_LABEL[st.src] + ' rank'),
      el('span', null, 'Flagship law reviews, by their school\'s rank'));
    if (!HC) { draw('network'); return; }
    const left = [0, 1, 2, 3, 4].map((b) => 'S' + b), right = [0, 1, 2, 3, 4].map((c) => 'R' + c);
    if (sel != null) left.splice(selB, 0, 'Sx');
    if (selJ != null && selC <= 4) right.splice(selC, 0, 'Rx');
    const flow = new Map();
    W1.edges.forEach((e) => {
      const k = (sel != null && e.s === sel ? 'Sx' : 'S' + e.b) + '>' + (selJ != null && e.j === selJ ? 'Rx' : 'R' + e.c);
      flow.set(k, (flow.get(k) || 0) + e.n);
    });
    const fromBand = (id) => (id === 'Sx' ? selB : +id.slice(1));
    const isHi = (from, to) => (sel != null ? from === 'Sx' : selJ != null ? to === 'Rx' : band >= 0 ? from === 'S' + band : true);
    const single = sel != null || selJ != null;
    // every pair in order, the empty ones too: Highcharts stacks a column's nodes in the order the links name them
    const links = [];
    left.forEach((from) => right.forEach((to) => {
      const n = flow.get(from + '>' + to) || 0;
      const hi = isHi(from, to), b = fromBand(from);
      links.push({ from: from, to: to, weight: n, color: hi ? TI_COLORS[b] : DIM, linkOpacity: hi ? (single ? 0.62 : band >= 0 ? 0.55 : 0.42) : 0.22,
        custom: { b: b, hi: hi } });
    }));
    // node labels: outside the columns on a wide screen, inside them (over the flows' ends) on a phone; the label's
    // box carries 5px of padding, so 1px past the node leaves a 6px gap
    const nodeW = wide ? 12 : 9;
    const lab = (inside, side) => (inside
      ? { align: side < 0 ? 'left' : 'right', x: side < 0 ? nodeW + 1 : -(nodeW + 1) }
      : { align: side < 0 ? 'right' : 'left', x: side < 0 ? -(nodeW + 1) : nodeW + 1 });
    const leftColor = (b) => (sel != null ? '#b3b2a9' : selJ != null || band < 0 || band === b ? TI_COLORS[b] : '#b3b2a9');
    const nodes = left.map((id) => {
      const b = fromBand(id), x = id === 'Sx';
      return { id: id, column: 0, color: x ? INK : leftColor(b),
        name: x ? shortName(DATA.schools[sel][0], wide ? 24 : 12) : wide ? MATRIX_HEADS[b] : BANDS[b].short,
        dataLabels: Object.assign({}, lab(!wide, -1), { style: { color: x ? INK : INK2 } }), custom: x ? { kind: 'school', s: sel } : { kind: 'sband', b: b } };
    }).concat(right.map((id) => {
      const x = id === 'Rx', c = x ? selC : +id.slice(1);
      return { id: id, column: 1, color: x ? INK : '#8f8e86',
        name: x ? shortName(DATA.journals[selJ][0], wide ? 26 : 12) : wide ? MATRIX_HEADS[c] : BANDS[c].short,
        dataLabels: Object.assign({}, lab(!wide, 1), { style: { color: x ? INK : INK2 } }), custom: x ? { kind: 'review', j: selJ } : { kind: 'rband', c: c } };
    }));
    const rowShare = (b) => sum(W1.M[b].slice(0, 5));
    const tip = function () {
      const p = this.point, c = p.isNode ? (p.options.custom || {}) : null;
      if (!p.isNode) {
        const a = p.fromNode, z = p.toNode;
        return tipHTML({ value: num(p.weight) + ' article' + (p.weight === 1 ? '' : 's'), title: a.name + ' → ' + z.name,
          lines: [pct(p.weight / (a.sum || 1)) + ' of ' + (a.options.custom.kind === 'school' ? 'the school\'s' : 'its schools\'') + ' flagship-review articles',
            pct(p.weight / (z.sum || 1)) + ' of the articles by U.S. law faculty in ' + (z.options.custom.kind === 'review' ? 'the review' : 'those reviews')] });
      }
      if (c.kind === 'school') return tipHTML({ title: DATA.schools[c.s][0], lines: [rankLabel(c.s)], rows: schoolRows(c.s), note: 'Tap or click to let go of it' });
      if (c.kind === 'review') return tipHTML({ title: DATA.journals[c.j][0], lines: [journalRankLine(c.j)], rows: journalRows(c.j), note: 'Tap or click to let go of it' });
      if (c.kind === 'sband') {
        const t = rowShare(c.b);
        return tipHTML({ title: 'Schools ranked ' + BANDS[c.b].label.toLowerCase(), rows: [['Flagship-review articles', num(t)],
          ['In reviews of their own group', pct(W1.M[c.b][c.b] / (t || 1))], ['In top-14 reviews', pct(W1.M[c.b][0] / (t || 1))]],
          note: band === c.b && !single ? null : 'Tap or click to pick this group' });
      }
      const n = W1.colPapers[c.c];
      return tipHTML({ title: 'Flagship reviews of schools ranked ' + BANDS[c.c].label.toLowerCase(), rows: [['Articles by U.S. law faculty', num(n)],
        ['With a top-14 author', pct(W1.D[0][c.c] / (n || 1))]] });
    };
    draw('network', {
      chart: { height: wide ? 460 : 420, marginLeft: wide ? 176 : 4, marginRight: wide ? 196 : 4, marginTop: 8, marginBottom: 8 },
      accessibility: { description: 'Flows of flagship-review articles, ' + st.from + '–' + st.to + ', from groups of law schools by ' + SRC_LABEL[st.src] +
        ' rank to the groups of flagship law reviews by their school\'s rank. The table "Where each group of schools publishes" has the shares.' },
      tooltip: { followTouchMove: false, formatter: tip },
      series: [{
        type: 'sankey', name: 'Flagship-review articles', keys: ['from', 'to', 'weight'], data: links, nodes: nodes,
        nodeWidth: nodeW, nodePadding: wide ? 14 : 12, minLinkWidth: 1, borderRadius: 2, curveFactor: 0.42, linkOpacity: 0.42,
        cursor: 'pointer', turboThreshold: 0,
        states: { hover: { linkOpacity: 0.85 }, inactive: { linkOpacity: 0.12, opacity: 0.5 } },
        dataLabels: { enabled: true, inside: true, crop: false, overflow: 'allow', verticalAlign: 'middle',
          style: { fontSize: '12px', fontWeight: '600', color: INK2, textOutline: '3px #ffffff' },
          nodeFormatter() {
            return esc(this.point.name) + (wide && this.point.sum ? ' · ' + num(this.point.sum) : '');
          } },
        point: { events: { click: function () {
          const c = this.isNode ? (this.options.custom || {}) : null;
          if (c && (c.kind === 'school' || c.kind === 'review')) { setSelection(null, null); return false; }
          if (c && c.kind === 'sband') { setBand(c.b); return false; }
          return false;                               // a flow: its tooltip only (a tap on a phone reads it)
        } } },
      }],
    });
  }

  // an institution's name on the journal graph: the short form people use (the list beside it has the full name)
  const INST_SHORT = { 'New York University': 'NYU', 'University of California, Los Angeles': 'UCLA', 'University of California, Berkeley': 'UC Berkeley',
    'University of Pennsylvania': 'Penn', 'University of Texas at Austin': 'UT Austin', 'University of Southern California': 'USC',
    'George Washington University': 'GW', 'Columbia University School of Law': 'Columbia', 'Massachusetts Institute of Technology': 'MIT',
    'Boston University': 'BU', 'University of Michigan': 'Michigan', 'University of Virginia': 'Virginia', 'University of Chicago': 'Chicago',
    'Georgetown University': 'Georgetown', 'Stanford University': 'Stanford', 'Harvard University': 'Harvard', 'Yale University': 'Yale',
    'Duke University': 'Duke', 'Cornell University': 'Cornell', 'Northwestern University': 'Northwestern', 'Vanderbilt University': 'Vanderbilt',
    'University of Minnesota': 'Minnesota', 'University of Notre Dame': 'Notre Dame', 'Fordham University': 'Fordham', 'Boston College': 'BC',
    'University of North Carolina at Chapel Hill': 'UNC', 'Washington University': 'WashU', 'U.S. Supreme Court': 'Supreme Court' };
  function instLabel(name, n) {
    const t = INST_SHORT[name] || name.replace(/^The /, '').replace(/ School of Law$| Law School$/, '').replace(/^University of (California, )?/, '')
      .replace(/ University$/, '');
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }

  function shortName(s, n) {
    s = s.replace(/^University of California, Los Angeles$/, 'UCLA').replace(/^University of California, /, 'UC ')
      .replace(/ School of Law$| Law School$/, '').replace(/^The /, '').replace(/University/g, 'Univ.')
      .replace(/ Law Review$/, ' L. Rev.').replace(/ Law Journal$/, ' L.J.');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function rankLabel(s) {
    const r = W1.sRank[s];
    return r ? SRC_LABEL[st.src] + ' ' + (st.src === 'peer' ? DATA.schools[s][3] : DATA.schools[s][2]) : 'unranked';
  }
  // a school's and a review's numbers, for the tooltips (rows of label, value)
  function schoolRows(s) {
    const v = W1.school.get(s);
    if (!v || !v.n) return [['Flagship-review articles', '0']];
    const rows = [['Flagship-review articles', num(v.n)], ['In top-14 reviews', pct(v.cols[0] / (v.n || 1))]];
    if (v.median) rows.push(['Median review rank', String(v.median)]);
    return rows;
  }
  function journalRankLine(ji) {
    const r = W1.jr[ji];
    return r > 0 ? 'school ranked ' + r + ' (' + SRC_LABEL[st.src] + ')' : 'school unranked';
  }
  function journalRows(ji) {
    const v = W1.journal.get(ji);
    if (!v) return [['Articles by U.S. law faculty', '0']];
    return [['Articles by U.S. law faculty', num(v.papers.n)], ['With a top-14 author', pct(v.papers.bands[0] / (v.papers.n || 1))]];
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
      p.append(': ' + num(v.papers.n) + ' articles by U.S. law faculty, ' + yrs + '. With an author from schools ranked ' + bandShares(v.papers.bands, v.papers.n) +
        ' (an article with authors from two groups counts in both).');
      d.appendChild(p);
      d.appendChild(el('div', { style: 'margin-top:6px' }, 'Most frequent schools:'));
      d.appendChild(list(Array.from(v.schools.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6), (s) => DATA.schools[s][0]));
      return;
    }
    // one group of schools: its articles (D, each once); all U.S. faculty: every article once
    const cols = st.band >= 0 ? W1.D[st.band].slice(0, 5) : W1.colPapers.slice(0, 5);
    const total = sum(cols);
    const p = el('div');
    p.appendChild(el('b', null, st.band >= 0 ? 'Faculty at schools ranked ' + BANDS[st.band].label.toLowerCase() : 'All U.S. law faculty'));
    p.append(': ' + num(total) + ' flagship-review articles, ' + yrs + '. In reviews of schools ranked ' + bandShares(cols, total) + '.');
    d.appendChild(p);
    d.appendChild(el('div', { class: 'text-muted', style: 'margin-top:4px;font-size:13px' }, 'Tap a group on the left to pick it, a flow for its numbers; pick a school or a law review above to follow its own flows.'));
  }

  // one school or one review followed in every figure that can show it (the flows, the rank chart, the spread)
  let pickedFrom = null;      // the chart whose dot was tapped or clicked to pick the school
  function setSelection(s, j) {
    st.school = s;
    st.journal = j;
    $('netSchool').value = s == null ? '' : String(s);
    $('coSchool').value = s == null ? '' : String(s);
    $('netJournal').value = j == null ? '' : String(j);
    renderNetwork();
    renderNetDetail();
    renderScatter();
    if (coDone) renderSpread();
    pickedFrom = null;
  }
  // the tooltip of the dot that picked a school, shown again once its chart is drawn anew (the last series is the
  // hit layer)
  function showPicked(chart, test) {
    const hit = chart.series[chart.series.length - 1], p = hit && hit.points.find(test);
    if (p) { p.setState('hover'); chart.tooltip.refresh(p); }
  }
  // a group of schools picked with the chips (or a tap on the flows)
  function setBand(k) {
    st.band = k;
    $('netChips').querySelectorAll('.ins-chip').forEach((x) => x.setAttribute('aria-checked', String(+x.dataset.k === k)));
    setSelection(null, null);
  }

  ////////////////////////////////////////////////////////////////////////// question 1: the matrix

  const RAMP = ['#f3f8fe', '#cde2fb', '#9ec5f4', '#5598e7', '#2a78d6', '#1c5cab', '#104281', '#0d366b'];
  const GRAYS = ['#f7f7f5', '#e6e5df', '#cfcec6', '#b3b2a9', '#8f8e86'];
  const MATRIX_HEADS = BANDS.map((b) => (b.label === '101 & below, unranked' ? '101+ & unranked' : b.label)).concat(['Online & other general', 'Specialty journals']);
  function renderMatrix() {
    // by row: articles, each once per group of schools it has an author in (rows add to 100%); by column: credits,
    // an article once for each school with an author on it (columns add to 100%)
    const byRow = st.matrix === 'row';
    const M = byRow ? W1.D : W1.M;
    const rowSum = M.map((r) => sum(r));
    const colSum = [0, 1, 2, 3, 4, 5, 6].map((c) => sum(M, (r) => r[c]));
    const share = (r, c) => (byRow ? M[r][c] / (rowSum[r] || 1) : M[r][c] / (colSum[c] || 1));
    const narrow = $('figMatrix').clientWidth < 560;
    const heads = narrow ? BANDS.map((b) => b.short).concat(['Online', 'Spec.'])
      : MATRIX_HEADS.slice(0, 5).map(esc).concat(['Online &amp; other<br>general', 'Specialty<br>journals']);
    $('matrixTitle').textContent = byRow ? 'Where each group of schools publishes' : 'Who writes for each group of journals';
    $('matrixNote').textContent = (byRow
      ? 'Each row is a group of law schools; across it, the share of its faculty\'s articles in each group of journals (rows add to 100%).'
      : 'Each column is a group of journals; down it, each group of schools\' share of the author credits there (an article counts once for each school with an author on it; columns add to 100%).') +
      ' Flagship reviews are grouped by their school\'s ' + SRC_LABEL[st.src] + ' rank; ' + st.from + '–' + st.to + '.';
    // the numbers behind the cells
    const tbl = el('table');
    const hr = el('tr');
    [narrow ? '' : byRow ? 'Authors\' school' : 'Authors\' school (credits)'].concat(narrow ? BANDS.map((x) => x.short).concat(['Online', 'Spec.']) : MATRIX_HEADS,
      [byRow ? (narrow ? 'n' : 'Articles') : '']).forEach((h) => hr.appendChild(el('th', null, h)));
    tbl.appendChild(el('thead')).appendChild(hr);
    const tb = el('tbody');
    M.forEach((row, r) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, narrow ? BANDS[r].short : BANDS[r].label));
      row.forEach((v, c) => {
        const td = el('td', null, pct(share(r, c), narrow ? 0 : 1));
        td.appendChild(el('span', { class: 'text-muted' }, (narrow ? ' ' : ' · ') + num(v)));
        tr.appendChild(td);
      });
      tr.appendChild(el('td', null, byRow ? num(rowSum[r]) : ''));
      tb.appendChild(tr);
    });
    if (!byRow) {
      const tr = el('tr');
      tr.appendChild(el('td', null, 'Credits'));
      colSum.forEach((v) => tr.appendChild(el('td', null, num(v))));
      tr.appendChild(el('td'));
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    $('matrixTable').replaceChildren(el('p', { class: 'text-muted' }, 'Each cell: the share, then the number of ' + (byRow ? 'articles.' : 'credits.')), tbl);
    if (!HC) { draw('matrix'); return; }
    // a Highcharts heatmap. Flagship cells on the blue ramp, the two "other" columns on a gray one (each scaled to its
    // own block), so the specialty journals' large share does not wash out the flagship block, which is the question;
    // the diagonal (a group in reviews of its own group) is outlined
    let mx = 0, mxOther = 0;
    M.forEach((row, r) => row.forEach((v, c) => { if (c < 5) mx = Math.max(mx, share(r, c)); else mxOther = Math.max(mxOther, share(r, c)); }));
    const data = [];
    M.forEach((row, r) => row.forEach((v, c) => {
      const s = share(r, c), bg = c < 5 ? ramp(RAMP, s / (mx || 1)) : ramp(GRAYS, s / (mxOther || 1)), diag = r === c && c < 5;
      data.push({ x: c, y: r, value: s, color: bg, custom: { n: v }, borderColor: diag ? INK : undefined, borderWidth: diag ? 1.5 : undefined,
        dataLabels: { style: { color: lightness(bg) < 0.55 ? '#ffffff' : INK } } });
    }));
    const rowH = narrow ? 40 : 46, top = narrow ? 52 : 58, bottom = byRow ? 6 : 26;
    const fs = narrow ? '10px' : '12px';
    draw('matrix', {
      chart: { type: 'heatmap', height: top + 5 * rowH + bottom, marginTop: top, marginBottom: bottom, marginLeft: narrow ? 50 : 158,
        marginRight: byRow ? (narrow ? 34 : 70) : 4, spacing: [0, 0, 0, 0],
        events: { render() { matrixHeads(this, narrow, byRow, fs); } } },
      accessibility: { description: $('matrixTitle').textContent + '. ' + $('matrixNote').textContent },
      xAxis: [{ categories: heads, opposite: true, lineWidth: 0, tickLength: 0, min: 0, max: 6,
        labels: { autoRotation: false, rotation: 0, padding: 2, overflow: 'allow', style: { color: INK2, fontWeight: '600', fontSize: fs, whiteSpace: 'nowrap' } } }]
        .concat(byRow ? [] : [{ linkedTo: 0, opposite: false, categories: colSum.map(num), lineWidth: 0, tickLength: 0,
          labels: { autoRotation: false, rotation: 0, y: 14, overflow: 'allow', style: { color: MUTED, fontSize: narrow ? '10px' : '11.5px', whiteSpace: 'nowrap' } } }]),
      yAxis: [{ categories: BANDS.map((b) => (narrow ? b.short : b.label)), reversed: true, min: 0, max: 4, startOnTick: false, endOnTick: false, gridLineWidth: 0,
        labels: { style: { color: INK2, fontWeight: '600', fontSize: narrow ? '10.5px' : '12px', whiteSpace: 'nowrap' } } }]
        .concat(byRow ? [{ linkedTo: 0, opposite: true, reversed: true, categories: rowSum.map(num), gridLineWidth: 0, title: { text: null },
          labels: { align: 'left', x: 6, style: { color: MUTED, fontSize: narrow ? '10.5px' : '12px' } } }] : []),
      tooltip: { followTouchMove: false, formatter() {
        const p = this.point, r = p.y, c = p.x, lh = MATRIX_HEADS[c].toLowerCase();
        return tipHTML({ value: pct(p.value, 1), lines: [byRow
          ? 'of articles by faculty at schools ranked ' + BANDS[r].label.toLowerCase() + ' appeared in ' + lh + (c < 5 ? ' flagship reviews' : '')
          : 'of the school credits in ' + (c < 5 ? BANDS[c].label.toLowerCase() + ' flagship reviews' : lh) + ' went to schools ranked ' + BANDS[r].label.toLowerCase()],
          note: num(p.custom.n) + ' of ' + num(byRow ? rowSum[r] : colSum[c]) + (byRow ? ' articles' : ' credits') });
      } },
      series: [{ type: 'heatmap', name: $('matrixTitle').textContent, data: data, pointPadding: 1, borderRadius: 4, borderWidth: 0,
        states: { hover: { brightness: -0.06 } },
        dataLabels: { enabled: true, formatter() { return pct(this.point.value); },
          style: { fontSize: narrow ? '12px' : '13.5px', fontWeight: '600', textOutline: 'none' } } }],
    });
  }
  // the matrix's two-level header (flagship reviews | other journals) and its corner labels
  function matrixHeads(chart, narrow, byRow, fs) {
    if (chart.insHeads) chart.insHeads.destroy();
    const g = chart.insHeads = chart.renderer.g('ins-heads').attr({ zIndex: 7 }).add();
    const x = chart.xAxis[0], y = 13;
    [[-0.5, 4.5, narrow ? 'Flagship reviews, by school rank' : 'Flagship law reviews, by their school\'s rank'], [4.5, 6.5, narrow ? 'Other' : 'Other journals']]
      .forEach(([a, b, t]) => {
        const x0 = x.toPixels(a) + 3, x1 = x.toPixels(b) - 3;
        chart.renderer.text(esc(t), (x0 + x1) / 2, y).attr({ align: 'center' }).css({ fontSize: fs, fontWeight: '600', color: INK2 }).add(g);
        chart.renderer.path([['M', x0, y + 5], ['L', x1, y + 5]]).attr({ stroke: AXIS, 'stroke-width': 1 }).add(g);
      });
    const corner = (t, xx, yy, align) => chart.renderer.text(t, xx, yy).attr({ align: align }).css({ fontSize: fs, color: MUTED }).add(g);
    corner(narrow ? 'Authors' : 'Authors\' school', chart.plotLeft - 8, chart.plotTop - 10, 'right');
    if (byRow) corner(narrow ? 'n' : 'Articles', chart.plotLeft + chart.plotWidth + 6, chart.plotTop - 10, 'left');
    else corner(narrow ? 'n' : 'Credits', chart.plotLeft - 8, chart.plotTop + chart.plotHeight + 18, 'right');
  }

  ////////////////////////////////////////////////////////////////////////// question 1: rank vs rank

  function renderScatter() {
    const box = $('scatter');
    const W = box.clientWidth;
    const wide = W >= 700, narrow = W < 420;
    const H = wide ? 460 : Math.round(Math.max(340, Math.min(480, W * 1.0)));
    const pts = [];
    W1.school.forEach((v, s) => { if (W1.sRank[s] && v.median && v.n >= 10) pts.push({ s: s, x: W1.sRank[s], y: v.median, n: v.n, t14: v.cols[0] / v.n }); });
    const maxR = Math.max(max(pts, (d) => Math.max(d.x, d.y)) || 200, 50);
    const top = Math.ceil(maxR / 20) * 20;      // ranks start at 1: ticks 1, 20, 40, ...
    const tv = [1].concat(range(wide ? 20 : 40, top + 1, wide ? 20 : 40));
    const me = pts.find((d) => d.s === st.school);
    const point = (d) => ({ x: d.x, y: d.y, custom: d });
    const label = (d) => ({ align: d.x < top * 0.6 ? 'left' : 'right', x: d.x < top * 0.6 ? 10 : -10 });
    const chart = draw('scatter', {
      chart: { type: 'scatter', height: H, marginTop: 30, marginRight: 14,
        events: {
          // a click away from every dot lets go of the school
          click() { setSelection(null, null); },
          render() {
            if (this.insEmpty) { this.insEmpty.destroy(); this.insEmpty = null; }
            if (!pts.length) this.insEmpty = this.renderer.text('No school has 10 or more flagship-review articles in these years.', this.plotLeft + this.plotWidth / 2, this.plotTop + this.plotHeight / 2)
              .attr({ align: 'center', zIndex: 6 }).css({ color: MUTED, fontSize: '12px' }).add();
          } } },
      // the y axis's name sits above the plot, where it reads across
      title: { text: narrow ? '↑ Median review rank (1 = top)' : '↑ Median rank of the reviews its faculty publish in (1 = top)', align: 'left', x: 0, y: 12, margin: 0,
        style: { fontSize: '11.5px', fontWeight: '400', color: MUTED } },
      accessibility: { description: 'Each school\'s ' + SRC_LABEL[st.src] + ' rank against the median rank of the flagship reviews its faculty publish in, ' + st.from + '–' + st.to + '.' },
      xAxis: { min: 1, max: top, tickPositions: tv, startOnTick: false, endOnTick: false, gridLineWidth: 1, lineWidth: 0, tickLength: 0,
        title: { text: 'School\'s ' + SRC_LABEL[st.src] + ' rank →', align: 'high', margin: 6 } },
      yAxis: { min: 1, max: top, tickPositions: tv, startOnTick: false, endOnTick: false, reversed: true, gridLineWidth: 1 },
      tooltip: { followTouchMove: false, formatter() {
        const d = this.point.custom;
        return tipHTML({ title: DATA.schools[d.s][0], rows: [['School rank', String(d.x)], ['Median review rank', String(d.y)],
          ['Flagship-review articles', num(d.n)], ['In top-14 reviews', pct(d.t14)]], note: d.s === st.school ? 'Tap or click to let go of it' : 'Tap or click to follow this school' });
      } },
      plotOptions: { series: { states: { inactive: { opacity: 1 } } } },
      series: [
        // the diagonal: a school publishing at its own level
        { type: 'line', name: 'Own level', data: [[1, 1], { x: top * 0.86, y: top * 0.86, dataLabels: { enabled: true, format: 'own level', align: 'left', x: 6, y: -2,
          style: { color: MUTED, fontSize: '11.5px', fontWeight: '400', textOutline: '3px #ffffff' } } }, [top, top]],
          color: alpha(INK2, 0.45), lineWidth: 1, marker: { enabled: false }, enableMouseTracking: false, accessibility: { enabled: false } },
        { type: 'scatter', name: 'Regions', data: [
          { x: top * 0.98, y: top * 0.05, dataLabels: { format: 'publishing up', align: 'right' } },
          { x: top * 0.03, y: top * 0.95, dataLabels: { format: 'publishing down', align: 'left' } }],
          marker: { enabled: false }, enableMouseTracking: false, accessibility: { enabled: false },
          dataLabels: { enabled: true, style: { color: MUTED, fontSize: '11.5px', fontWeight: '400', fontStyle: 'italic', textOutline: 'none' } } },
        { name: 'Law schools', data: pts.filter((d) => d.s !== st.school).map(point), enableMouseTracking: false, accessibility: { enabled: false },
          marker: { symbol: 'circle', radius: wide ? 4.5 : 4, fillColor: alpha(ACCENT, st.school != null ? 0.35 : 0.8), lineColor: '#ffffff', lineWidth: 1.5 } },
        { name: 'Picked school', data: me ? [Object.assign(point(me), { dataLabels: label(me) })] : [], enableMouseTracking: false, accessibility: { enabled: false },
          marker: { symbol: 'circle', radius: 6.5, fillColor: INK, lineColor: '#ffffff', lineWidth: 2 },
          dataLabels: { enabled: true, verticalAlign: 'middle', formatter() { return esc(shortName(DATA.schools[this.point.custom.s][0], 28)); },
            style: { color: INK2, fontSize: '12px', fontWeight: '600', textOutline: '3px #ffffff' } } },
        // the hit layer: every school again, an invisible 24px target with a ring on hover
        { name: 'Law schools', data: pts.map(point), color: ACCENT, cursor: 'pointer', zIndex: 5,
          marker: { symbol: 'circle', radius: 12, fillColor: HIT_FILL, lineWidth: 0, states: { hover: { enabled: true, radiusPlus: 0, fillColor: HIT_FILL, lineWidth: 0 } } },
          states: { hover: { halo: { size: 9, opacity: 0.3 } } },
          point: { events: { click() { pickedFrom = { chart: 'scatter' }; setSelection(this.custom.s !== st.school ? this.custom.s : null, null); return false; } } },
          accessibility: { point: { descriptionFormatter: (p) => DATA.schools[p.custom.s][0] + ': school rank ' + p.custom.x + ', median review rank ' + p.custom.y + ', ' + p.custom.n + ' articles.' } } },
      ],
    });
    // a school picked by a tap on its dot: its numbers stay up after the redraw (a phone has no hover)
    if (chart && pickedFrom && pickedFrom.chart === 'scatter' && me) showPicked(chart, (p) => p.custom.s === me.s);
    return chart;
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
    const end = lastFull();
    const yrs = INS.years.map((y, i) => [y, i]).filter(([y]) => y >= 1950 && y <= end);
    const kinds = ['flagship', 'specialty'];
    const color = { flagship: css('--flagship'), specialty: css('--specialty') };
    const v = INS[variant()];
    const series = kinds.map((k) => ({ k: k, pts: yrs.map(([y, i]) => ({ y: y, v: measureOf(v[k][i], st.measure), n: v[k][i][0] })).filter((d) => d.v != null && d.n >= 20) }));
    const vmax = max(series, (s) => max(s.pts, (d) => d.v)) || 1;
    const fmt = st.measure === 'mean' ? (d) => d.toFixed(2) : (d) => (100 * d).toFixed(0) + '%';
    $('trendTitle').textContent = st.measure === 'mean' ? 'Authors per article' : st.measure === '3' ? 'Share of articles with three or more authors' : 'Share of articles with more than one author';
    const lg = $('trendLegend');
    lg.replaceChildren();
    kinds.forEach((k) => { const s = el('span'); const i = el('i'); i.style.background = color[k]; s.appendChild(i); s.append(KIND_LABEL[k]); lg.appendChild(s); });

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

    // the chart: one line per kind of journal; the crosshair snaps to a year and the tooltip lists both
    draw('trend', {
      chart: { type: 'line', height: H, marginRight: wide ? 150 : 44,
        events: { render() { endLabels(this, series.map((s, i) => ({ i: i, text: (wide ? KIND_LABEL[s.k].replace(' law reviews', '') + ' ' : '') +
          (s.pts.length ? fmt(s.pts[s.pts.length - 1].v) : '') }))); } } },
      accessibility: { description: $('trendTitle').textContent + ', by year, flagship law reviews and specialty journals. The table below the chart has every year.' },
      xAxis: { min: 1950, max: end, tickInterval: wide ? 10 : 20, tickLength: 4, labels: { formatter() { return String(this.value); } },
        crosshair: { color: alpha(INK2, 0.5), width: 1 } },
      yAxis: { min: st.measure === 'mean' ? 1 : 0, softMax: st.measure === 'mean' ? Math.max(1.1, vmax) : vmax, tickAmount: 6, gridLineWidth: 1,
        labels: { formatter() { return fmt(this.value); } } },
      tooltip: { shared: true, followTouchMove: false, formatter() {
        return tipHTML({ title: String(this.x), rows: this.points.map((p) => [p.series.name, fmt(p.y) + ' of ' + num(p.point.custom.n), p.series.color]) });
      } },
      plotOptions: { series: { lineWidth: 2, marker: { enabled: false, symbol: 'circle', radius: 4, lineColor: '#ffffff', lineWidth: 2 },
        states: { hover: { lineWidthPlus: 0 } } } },
      series: series.map((s) => ({ name: KIND_LABEL[s.k], color: color[s.k],
        data: s.pts.map((d, i, a) => ({ x: d.y, y: d.v, custom: { n: d.n }, marker: i === a.length - 1 ? { enabled: true } : undefined })) })),
    });
  }

  function renderTeams() {
    const box = $('teams');
    const W = box.clientWidth;
    const wide = W >= 700;
    const end = lastFull();
    const decades = range(1950, end + 1, 10).map((d) => ({ label: d + 's', a: d, b: Math.min(d + 9, end) }));
    decades.forEach((d) => {
      const r = sumRows(ALL, d.a, d.b);
      d.co = r[2] + r[3] + r[4];
      d.counts = [r[2], r[3], r[4]];
      // the current decade is partial: named by its years
      d.name = d.label === (Math.floor(end / 10) * 10) + 's' && d.b < d.a + 9 ? d.a + '–' + String(d.b).slice(2) : d.label;
    });
    const colors = [css('--seq-1'), css('--seq-2'), css('--seq-3')];
    const names = ['2 authors', '3 authors', '4 or more'];
    const lg = $('teamsLegend');
    lg.replaceChildren();
    names.forEach((nm, k) => { const s = el('span'); const i = el('i', { class: 'box' }); i.style.background = colors[k]; s.appendChild(i); s.append(nm); lg.appendChild(s); });
    // a Highcharts bar per decade, stacked to 100%: two authors from the left, then three, then four or more; the
    // share is written inside a segment only where it fits (the tooltip has every one)
    draw('teams', {
      chart: { type: 'bar', height: decades.length * 34 + 16, marginLeft: 66, marginRight: wide ? 118 : 50, spacing: [4, 4, 4, 4] },
      accessibility: { description: 'Co-authored articles by number of authors, by decade.' },
      xAxis: [{ categories: decades.map((d) => d.name), lineWidth: 0, tickLength: 0, labels: { style: { color: INK2, fontSize: '12px', whiteSpace: 'nowrap' } } },
        { linkedTo: 0, opposite: true, categories: decades.map((d) => num(d.co) + (wide ? ' co-authored' : '')), lineWidth: 0, tickLength: 0,
          labels: { align: 'left', x: 6, style: { color: MUTED, fontSize: wide ? '11.5px' : '10.5px', whiteSpace: 'nowrap' } } }],
      yAxis: { min: 0, max: 100, visible: false, reversedStacks: false },
      tooltip: { followTouchMove: false, formatter() {
        const d = decades[this.point.index], k = this.series.index;
        return tipHTML({ value: pct(this.percentage / 100, 1), lines: ['of co-authored articles in the ' + d.label + ' had ' + names[k].replace('4 or more', 'four or more authors')],
          note: num(this.y) + ' of ' + num(d.co) });
      } },
      plotOptions: { bar: { stacking: 'percent', pointWidth: 22, borderWidth: 1, borderColor: '#ffffff',
        borderRadius: { radius: 4, scope: 'stack', where: 'end' }, groupPadding: 0.1,
        dataLabels: { enabled: true, inside: true, crop: false, style: { fontSize: '12px', fontWeight: '600', textOutline: 'none' },
          formatter() {
            const t = pct(this.percentage / 100), w = this.percentage / 100 * this.series.chart.plotWidth;
            return w > t.length * 7.5 + 10 ? t : '';
          } } } },
      series: names.map((nm, k) => ({ name: nm, color: colors[k], data: decades.map((d) => d.counts[k]),
        dataLabels: { style: { color: k === 0 ? INK : '#ffffff' } } })),
    });
  }

  ////////////////////////////////////////////////////////////////////////// question 2: the spread across schools

  // (2026-10-26, the owner: "Violin charts are bad. Use something else ... it must be better") every school is a dot,
  // not a smoothed shape: per period, the schools' co-authored shares, with bands for the middle half of schools and for
  // the 10th to 90th percentile and a line through the median school. The dots spread sideways where schools crowd
  // together (by how many sit within two points of each other), so none hides behind another; the school picked above
  // is followed across the periods, and a tap on a dot picks that school.
  function renderSpread() {
    const from = pickedFrom;
    const box = $('spread');
    const W = box.clientWidth;
    const wide = W >= 700;
    const H = wide ? 420 : 340;
    const end = lastFull();
    const periods = range(1980, end + 1, 5).map((a) => ({ a: a, b: a + 4 >= end - 1 ? end : a + 4 }))
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
      p.q = p.vals.length ? [0.1, 0.25, 0.5, 0.75, 0.9].map((q) => quantileSorted(p.vals, q)) : null;
    });
    const ok = periods.map((p, i) => [i, p]).filter(([, p]) => p.vals.length >= 5);
    const top = Math.min(1, Math.max(0.4, (max(periods, (p) => p.vals[p.vals.length - 1] || 0) || 0.4) + 0.02));   // every school fits
    // each school's dot: a fixed sideways offset from its id, scaled by how crowded its level is in that period
    const dots = [];
    periods.forEach((p, i) => {
      if (p.vals.length < 5) return;
      const near = (x) => p.vals.filter((u) => Math.abs(u - x) <= 0.02).length;
      const most = max(p.vals, near) || 1;
      p.bySchool.forEach((v, s) => {
        const share = v[1] / v[0];
        const off = (((Math.sin((s + 1) * 12.9898 + i * 78.233) * 43758.5453) % 1) + 1) % 1 - 0.5;   // -0.5..0.5, the same on every draw
        dots.push({ x: i + off * (0.14 + 0.5 * near(share) / most), y: share, custom: { s: s, n: v[0], co: v[1], k: i } });
      });
    });
    const pick = st.school;
    const pickPts = pick == null ? [] : periods.map((p, i) => { const v = p.bySchool.get(pick); return v ? { x: i, y: v[1] / v[0], custom: { s: pick, n: v[0], co: v[1], k: i } } : null; });
    const SPEC = css('--specialty'), DARK = '#1c5cab';
    // the legend (identity never by color alone) and the table behind the chart
    const lg = $('spreadLegend');
    lg.replaceChildren();
    const key = (cls, bg, text) => { const s = el('span'); const i = el('i', { class: cls }); i.style.background = bg; s.appendChild(i); s.append(text); lg.appendChild(s); };
    key('dot', alpha(ACCENT, 0.6), 'One school');
    key('box', alpha(ACCENT, 0.3), 'Middle half of schools');
    key('box', alpha(ACCENT, 0.12), '10th to 90th percentile');
    key('', DARK, 'Median school');
    if (pick != null) key('dot', SPEC, shortName(DATA.schools[pick][0], 30));
    const tbl = el('table');
    const hr = el('tr');
    ['Period', 'Schools', '10th', '25th', 'Median', '75th', '90th'].concat(pick != null ? [shortName(DATA.schools[pick][0], 22)] : []).forEach((h) => hr.appendChild(el('th', null, h)));
    tbl.appendChild(el('thead')).appendChild(hr);
    const tb = el('tbody');
    periods.slice().reverse().forEach((p) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, p.label));
      tr.appendChild(el('td', null, num(p.vals.length)));
      (p.q || [null, null, null, null, null]).forEach((q) => tr.appendChild(el('td', null, pct(q))));
      if (pick != null) { const v = p.bySchool.get(pick); tr.appendChild(el('td', null, v ? pct(v[1] / v[0]) + ' of ' + num(v[0]) : 'under 15')); }
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    $('spreadTable').replaceChildren(tbl);

    const tip = function () {
      const c = this.point.custom, p = periods[c.k];
      const rows = p.q ? [['Median school', pct(p.q[2])], ['Middle half', pct(p.q[1]) + '–' + pct(p.q[3])], ['10th to 90th percentile', pct(p.q[0]) + '–' + pct(p.q[4])],
        ['Schools', num(p.vals.length)]] : [];
      return tipHTML({ value: pct(c.co / c.n), title: DATA.schools[c.s][0], lines: [num(c.co) + ' of ' + num(c.n) + ' articles co-authored, ' + p.label], rows: rows,
        note: c.s === st.school ? 'Tap or click to let go of it' : 'Tap or click to follow this school' });
    };
    const chart = draw('spread', {
      chart: { height: H, marginRight: pick != null ? (wide ? 12 : 8) : 8 },
      accessibility: { description: 'For each period since 1980, every U.S. law school with at least 15 articles by its current faculty, at the share of those articles that were co-authored, with the median school and the middle half of schools. The table below the chart has the numbers.' },
      xAxis: { min: -0.5, max: periods.length - 0.5, tickPositions: periods.map((p, i) => i), lineWidth: 1, tickLength: 0, startOnTick: false, endOnTick: false,
        labels: { autoRotation: false, formatter() { const p = periods[this.value]; return p ? (wide ? p.label : String(p.a)) : ''; } } },
      yAxis: { min: 0, max: top, tickInterval: 0.1, startOnTick: false, endOnTick: false, gridLineWidth: 1, labels: { formatter() { return pct(this.value); } } },
      tooltip: { followTouchMove: false, formatter: tip },
      plotOptions: { series: { states: { inactive: { opacity: 1 } } } },
      series: [
        { type: 'arearange', name: '10th to 90th percentile', data: ok.map(([i, p]) => [i, p.q[0], p.q[4]]), color: ACCENT, fillOpacity: 0.12, lineWidth: 0,
          marker: { enabled: false }, enableMouseTracking: false, zIndex: 0 },
        { type: 'arearange', name: 'Middle half of schools', data: ok.map(([i, p]) => [i, p.q[1], p.q[3]]), color: ACCENT, fillOpacity: 0.26, lineWidth: 0,
          marker: { enabled: false }, enableMouseTracking: false, zIndex: 1 },
        { type: 'scatter', name: 'Schools', data: dots, turboThreshold: 0, enableMouseTracking: false, zIndex: 2, accessibility: { enabled: false },
          marker: { symbol: 'circle', radius: wide ? 2.6 : 2.2, fillColor: alpha(ACCENT, pick != null ? 0.32 : 0.5), lineWidth: 0 } },
        { type: 'line', name: 'Median school', data: ok.map(([i, p]) => [i, p.q[2]]), color: DARK, lineWidth: 2, zIndex: 3, enableMouseTracking: false,
          marker: { enabled: true, symbol: 'circle', radius: 3.5, fillColor: DARK, lineColor: '#ffffff', lineWidth: 1.5 } },
        { type: 'line', name: pick != null ? DATA.schools[pick][0] : 'Picked school', data: pickPts, color: SPEC, lineWidth: 1.5, zIndex: 4, enableMouseTracking: false,
          marker: { enabled: true, symbol: 'circle', radius: 4.5, fillColor: SPEC, lineColor: '#ffffff', lineWidth: 2 },
          dataLabels: { enabled: true, formatter() {     // the school's name once, at its last period
            const last = pickPts.filter(Boolean).pop();
            return last && this.point.x === last.x ? esc(shortName(DATA.schools[pick][0], wide ? 26 : 16)) : '';
          }, align: 'right', x: -8, y: -6, style: { color: INK2, fontSize: '12px', fontWeight: '600', textOutline: '3px #ffffff' } } },
        // the hit layer: every dot again, an invisible target with a ring on hover
        { type: 'scatter', name: 'Law schools', data: dots, turboThreshold: 0, color: ACCENT, cursor: 'pointer', zIndex: 5,
          marker: { symbol: 'circle', radius: wide ? 6 : 7, fillColor: HIT_FILL, lineWidth: 0, states: { hover: { enabled: true, radiusPlus: 0, fillColor: HIT_FILL, lineWidth: 0 } } },
          states: { hover: { halo: { size: 7, opacity: 0.35 } } },
          point: { events: { click() { pickedFrom = { chart: 'spread', k: this.custom.k }; setSelection(this.custom.s !== st.school ? this.custom.s : null, null); return false; } } },
          accessibility: { point: { descriptionFormatter: (p) => DATA.schools[p.custom.s][0] + ', ' + periods[p.custom.k].label + ': ' + pct(p.custom.co / p.custom.n) + ' co-authored.' } } },
      ],
    });
    if (chart && from && from.chart === 'spread' && pick != null) showPicked(chart, (p) => p.custom.s === pick && p.custom.k === from.k);
  }

  ////////////////////////////////////////////////////////////////////////// question 3: title length (insights.json 'titles')

  // (the groups' colors are TI_COLORS, at the top)
  const tiShort = (b) => (b === '101 & below, unranked' ? '101+' : b);
  const tiFmt = (m) => (m === 3 ? (v) => Math.round(100 * v) + '%' : (v) => String(Math.round(v)));
  const tiSpan = (w) => w[0] + '–' + String(w[1]).slice(2);

  function renderTitlesText() {
    const T = INS.titles, [w0, w1] = T.windows;
    const R = T.review_summary, S = T.school_summary;
    const low = T.bands[T.bands.length - 1];
    const val = (s, k, c) => (s[k] && s[k][c] && s[k][c][0] != null ? s[k][c] : null);
    const t = $('tiTiles');
    t.replaceChildren();
    const tile = (a, b, l, f) => {
      if (a == null || b == null) return;
      const d = el('div', { class: 'ins-tile' });
      const v = el('div', { class: 'v' });
      v.append(f(a));
      v.appendChild(el('span', { class: 'arrow' }, '→'));
      v.append(f(b));
      d.appendChild(v);
      d.appendChild(el('div', { class: 'l' }, l));
      t.appendChild(d);
    };
    const span = tiSpan(w0) + ' → ' + tiSpan(w1);
    const chars = (x) => String(Math.round(x));
    tile(R['Top 14'][0] && R['Top 14'][0][0], R['Top 14'][1] && R['Top 14'][1][0], 'characters in the median title, Top 14 law reviews (' + span + ')', chars);
    tile(R[low][0] && R[low][0][0], R[low][1] && R[low][1][0], 'in reviews ranked 101 and below, or unranked', chars);
    tile(R['Top 14'][0] && R['Top 14'][0][3], R['Top 14'][1] && R['Top 14'][1][3], 'of Top 14 review titles had a subtitle (a colon)', pct);
    const a = val(R, 'Top 14', 0), b = val(R, 'Top 14', 1), c = val(R, low, 0), d = val(R, low, 1);
    const fa = val(S, 'Top 14', 0), fb = val(S, 'Top 14', 1), fc = val(S, low, 0), fd = val(S, low, 1);
    const lede = $('tiLede');
    lede.replaceChildren();
    if (!a || !b || !c || !d) return;
    const drop = (b[0] - a[0]) / a[0], dropLow = (d[0] - c[0]) / c[0];
    lede.append(drop <= -0.15 && dropLow > -0.1 ? 'At the top, yes. ' : drop <= -0.15 ? 'Yes. ' : 'Not much. ');
    lede.append('The median research-article title in the Top 14 law reviews ran ');
    lede.appendChild(el('b', null, Math.round(a[0]) + ' characters'));
    lede.append(' in ' + w0[0] + '–' + w0[1] + ' and ');
    lede.appendChild(el('b', null, String(Math.round(b[0]))));
    lede.append(' in ' + w1[0] + '–' + w1[1] + '; in reviews ranked 101 and below, or unranked, ' + Math.round(c[0]) + ' and ' + Math.round(d[0]) + '.');
    if (fa && fb && fc && fd) {
      lede.append(' By the author\'s school, titles by current faculty at Top 14 schools went from ' + Math.round(fa[0]) + ' to ' + Math.round(fb[0]) +
        ' characters, and at schools ranked 101 and below, or unranked, from ' + Math.round(fc[0]) + ' to ' + Math.round(fd[0]) + '.');
    }
  }

  function renderTitlesChart() {
    const T = INS.titles;
    const box = $('tiChart');
    const W = box.clientWidth;
    if (W < 160) return;          // not laid out yet (a hidden tab): the ResizeObserver draws it once it has a width
    const wide = W >= 700;
    const H = wide ? 380 : 300;
    const by = st.tiBy, mi = st.tiM, fmt = tiFmt(mi);
    const first = T.years[0], last = T.years[T.years.length - 1];
    $('tiTitle').textContent = mi === 3 ? 'Share of titles with a subtitle (a colon)' : 'Median title length, in characters';
    $('tiNote').textContent = by === 'review'
      ? 'Research articles in each school\'s main law review, grouped by the U.S. News rank of the school that publishes it, whoever wrote them (pieces labelled as student work left out). Each point pools the year with the years either side.'
      : 'Research articles by current faculty in any journal collected here, grouped by the U.S. News rank of the author\'s school (an article by authors in two groups counts in both). Each point pools the year with the years either side.';
    const series = T.bands.map((b, k) => ({ b: b, k: k, pts: T[by][b].p.map((r, i) => (r ? { y: T.years[i], v: r[mi], n: r[2] } : null)).filter(Boolean) }));
    const all = series.flatMap((s) => s.pts.map((d) => d.v));
    const lg = $('tiLegend');
    lg.replaceChildren();
    series.forEach((s) => { const e = el('span'); const i = el('i'); i.style.background = TI_COLORS[s.k]; e.appendChild(i); e.append(s.b); lg.appendChild(e); });

    // the table behind the chart: single years, not pooled
    const tbl = el('table');
    const hr = el('tr');
    hr.appendChild(el('th', null, 'Year'));
    T.bands.forEach((b) => hr.appendChild(el('th', null, tiShort(b))));
    tbl.appendChild(el('thead')).appendChild(hr);
    const tb = el('tbody');
    T.years.slice().reverse().forEach((yr) => {
      const i = T.years.indexOf(yr);
      const tr = el('tr');
      tr.appendChild(el('td', null, String(yr)));
      T.bands.forEach((b) => {
        const r = T[by][b].y[i];
        const td = el('td', null, r ? fmt(r[mi]) : '–');
        if (r) { td.appendChild(el('span', { class: 'text-muted' }, ' · ' + num(r[2]))); td.title = num(r[2]) + ' titles'; }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    $('tiTable').replaceChildren(el('p', { class: 'text-muted' }, 'Single years (not pooled); after each value, the number of titles. A dash: fewer than ' + T.min_n + ' titles.'), tbl);

    // the chart: one line per group; the crosshair snaps to a year and the tooltip lists every group, longest first;
    // the group is named at the end of its line at every width (five lines, not two)
    draw('tiChart', {
      chart: { type: 'line', height: H, marginRight: wide ? 120 : 84,
        events: { render() { endLabels(this, series.map((s, i) => ({ i: i, text: s.pts.length ? tiShort(s.b) + ' ' + fmt(s.pts[s.pts.length - 1].v) : '' }))); } } },
      accessibility: { description: $('tiTitle').textContent + ', by year, by ' + (by === 'review' ? 'the law review\'s rank' : 'the author\'s school\'s rank') + '. The table below the chart has every year.' },
      xAxis: { min: first, max: last, tickInterval: wide ? 5 : 10, tickLength: 4, labels: { formatter() { return String(this.value); } },
        crosshair: { color: alpha(INK2, 0.5), width: 1 } },
      yAxis: mi === 3 ? { min: 0, softMax: Math.max(0.1, max(all) || 1), tickAmount: 6, gridLineWidth: 1, labels: { formatter() { return fmt(this.value); } } }
        : { min: Math.max(0, Math.floor(((min(all) || 0) - 5) / 10) * 10), softMax: (max(all) || 100) + 5, gridLineWidth: 1, labels: { formatter() { return fmt(this.value); } } },
      tooltip: { shared: true, followTouchMove: false, formatter() {
        const yr = this.x;
        return tipHTML({ title: yr + ' (' + Math.max(first, yr - 1) + '–' + String(Math.min(last, yr + 1)).slice(2) + ')',
          rows: this.points.slice().sort((a, b) => b.y - a.y).map((p) => [p.series.name, fmt(p.y) + (mi === 3 ? '' : ' chars') + ' · ' + num(p.point.custom.n) + ' titles', p.series.color]) });
      } },
      plotOptions: { series: { lineWidth: 2, marker: { enabled: false, symbol: 'circle', radius: 4, lineColor: '#ffffff', lineWidth: 2 },
        states: { hover: { lineWidthPlus: 0 } } } },
      series: series.map((s) => ({ name: s.b, color: TI_COLORS[s.k],
        data: s.pts.map((d, i, a) => ({ x: d.y, y: d.v, custom: { n: d.n }, marker: i === a.length - 1 ? { enabled: true } : undefined })) })),
    });
  }
  // the method note's numbers: how much the heading rule leaves out, and the check with headings cut off instead
  function renderTitlesMethod() {
    const T = INS.titles, [w0, w1] = T.windows, low = T.bands[T.bands.length - 1];
    const L = T.review_left_out, C = T.review_summary_cut;
    const box = $('tiLeftOut');
    if (!box || !L || !C || !L['Top 14'] || !L[low]) return;
    const p = (x) => (x == null ? '–' : Math.round(100 * x) + '%');
    const m = (r) => (r && r[0] != null ? String(Math.round(r[0])) : '–');
    box.textContent = 'This rule is not small: of the research articles otherwise measured in the main law reviews, it leaves out ' +
      p(L['Top 14'][0]) + ' in the Top 14 reviews in ' + w0[0] + '–' + w0[1] + ' and ' + p(L['Top 14'][1]) + ' in ' + w1[0] + '–' + w1[1] +
      ', and ' + p(L[low][0]) + ' and ' + p(L[low][1]) + ' in reviews ranked 101 and below, or unranked. As a check, keeping those titles with the shared ending cut off instead (a guess, right about five times in six) gives medians of ' +
      m(C['Top 14'][0]) + ' and ' + m(C['Top 14'][1]) + ' characters for the Top 14 reviews, and ' + m(C[low][0]) + ' and ' + m(C[low][1]) + ' for those ranked 101 and below.';
  }
  function renderTitles() {
    renderTitlesText();
    renderTitlesChart();
  }

  ////////////////////////////////////////////////////////////////////////// controls

  // (2026-10-25, the owner: "add in a spinner for crunching numbers") the years, rank source or short-piece switch
  // recompute every chart of section 1 behind the spinner (masthead.js: LSR.crunch)
  function renderWhere() {
    if (window.LSR && LSR.crunch) LSR.crunch.run(renderWhereNow); else renderWhereNow();
  }
  function renderWhereNow() {
    W1 = computeWhere();
    renderWhereText();
    renderJournal();
    renderNetwork();
    renderNetDetail();
    renderMatrix();
    renderScatter();
  }
  function renderCo() {
    renderCoText();
    renderTrend();
    renderTeams();
    renderSpread();
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
    // (2026-10-26) the same default window as the rankings page: ten year labels ending at the build's default_to
    st.to = Math.min(META.default_to || maxY, maxY);
    st.from = st.to - 9;
    for (let y = maxY; y >= Math.max(META.years.min, 1950); y--) { $('wFrom').add(new Option(y, y)); $('wTo').add(new Option(y, y)); }
    $('wFrom').value = st.from;
    $('wTo').value = st.to;
    (DATA.rank_sources || [['usnews', 'U.S. News overall rank']]).forEach((s) => $('wSrc').add(new Option(s[0] === 'peer' ? 'TaxProf peer rank' : 'U.S. News overall rank', s[0])));
    $('wSrc').value = st.src;
    const yearChange = () => {
      let a = +$('wFrom').value, b = +$('wTo').value;
      if (a > b) { const t = a; a = b; b = t; $('wFrom').value = a; $('wTo').value = b; }
      st.from = a; st.to = b;
      renderWhere();
    };
    $('wFrom').addEventListener('change', yearChange);
    $('wTo').addEventListener('change', yearChange);
    $('wSrc').addEventListener('change', () => { st.src = $('wSrc').value; fillSchoolSelect('netSchool'); fillSchoolSelect('coSchool'); fillJournalSelect(); fillJournalPicker(); renderWhere(); });
    $('wShort').addEventListener('change', () => { st.skipShort = $('wShort').checked; renderWhere(); });

    const chips = $('netChips');
    [['All schools', -1]].concat(BANDS.map((b, k) => [b.label === 'Top 14' ? 'Top 14' : b.label.replace('101 & below, unranked', '101+ & unranked'), k])).forEach(([label, k]) => {
      const c = el('button', { type: 'button', class: 'ins-chip', role: 'radio', 'aria-checked': String(k === st.band), 'data-k': String(k) }, label);
      c.addEventListener('click', () => setBand(k));
      chips.appendChild(c);
    });
    fillSchoolSelect('netSchool');
    fillSchoolSelect('coSchool');
    fillJournalSelect();
    fillJournalPicker();
    // (2026-10-26, the owner: "I need a way to make it more Better on movile") a phone starts with the top 10
    if ($('jnGraph').clientWidth < 560) { jn.top = 10; $('jnTop').value = '10'; }
    $('jnJournal').addEventListener('change', () => { jn.journal = +$('jnJournal').value; jn.focus = null; jn.open.clear(); renderJournal(); });
    $('jnTop').addEventListener('change', () => { jn.top = +$('jnTop').value; renderJournal(); });
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
    [['tiBy', 'by', (v) => { st.tiBy = v; }], ['tiMeasure', 'm', (v) => { st.tiM = +v; }]].forEach(([id, key, set]) => {
      document.querySelectorAll('#' + id + ' button').forEach((b) => b.addEventListener('click', () => {
        set(b.dataset[key]);
        document.querySelectorAll('#' + id + ' button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderTitlesChart();
      }));
    });
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
      timer = setTimeout(() => {
        renderJournal(); renderNetwork(); renderMatrix(); renderScatter();
        if (coDone) { renderTrend(); renderTeams(); renderSpread(); }
        if (tiDone) renderTitlesChart();
      }, 120);
    }).observe(document.body);
  }

  if (LSR.crunch) LSR.crunch.show('Loading the data');
  Promise.all(['data/data.json', 'data/meta.json', 'data/insights.json'].map((u) => fetch(u).then((r) => {   // (2026-10-26) a plain fetch, so the <head>'s preload is used
    if (!r.ok) throw new Error(u + ': ' + r.status);
    return r.json();
  }))).then(([data, meta, ins]) => {
    DATA = LSR.unpack(data); META = meta; INS = ins;      // (2026-10-26) packed core; homepages come after
    // the data for connections.js (section 4), which draws its own figures from it
    window.LSR_INS = { DATA: DATA, META: META, INS: INS };
    document.dispatchEvent(new CustomEvent('lsr-insights-data'));
    LSR.stampMasthead(meta);
    $('footer').innerHTML = LSR.siteFooter(meta);
    $('loading').remove();
    document.querySelectorAll('.ins-section').forEach((s) => { s.hidden = false; });
    setup();
    renderWhere();
    // (2026-10-26, the owner: "use lazy loading") the co-authorship and title sections are computed when they come
    // into view (or a few seconds after the first section is up, whichever comes first)
    const lazy = (id, render, wait) => {
      const sec = document.getElementById(id);
      let done = false;
      const go = () => { if (!done) { done = true; render(); } };
      if (sec && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '400px 0px' });
        io.observe(sec);
        setTimeout(() => { io.disconnect(); go(); }, wait);
      } else go();
    };
    lazy('coauthor', () => { coDone = true; renderCo(); }, 2500);
    if (INS.titles) { renderTitlesMethod(); lazy('titles', () => { tiDone = true; renderTitles(); }, 3500); }
    else $('titles').remove();
    LSR.people(DATA).then(() => { if (jn.journal != null) renderJournal(); });   // authors' faculty pages in the journal view
    if (LSR.crunch) LSR.crunch.hide();
    if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
  }).catch((e) => {
    if (LSR.crunch) LSR.crunch.hide(0);
    $('loading').textContent = 'The data could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
