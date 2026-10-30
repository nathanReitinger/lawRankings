// Law School Rankings: the Insights page, section 4 "Connections in the data" (2026-10-27, the owner: "Give me a bunch
// of charts that are interesting. Look for connections and nuggets of interesting information. Then display that in a
// high charts figure"; "Use high charts for all figures"). Six figures, each computed in the browser from
// data/data.json (the rankings' own data: current faculty's articles, each author at the U.S. law school where they
// teach now), each drawn with Highcharts above a table of its numbers. insights.js hands the data over
// (window.LSR_INS, event 'lsr-insights-data'); the figures are computed and drawn once the section comes into view.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n).toLocaleString('en-US');
  const pct = (x) => (x == null || !isFinite(x) ? '–' : (x < 0.1 && x > 0 ? (100 * x).toFixed(1) : (100 * x).toFixed(0)) + '%');
  const pct1 = (x) => (x == null || !isFinite(x) ? '–' : (100 * x).toFixed(1) + '%');
  const yrs = (a, b) => (a === b ? String(a) : a + '–' + b);
  const rankNum = (label) => { const m = /\d+/.exec(label == null ? '' : String(label)); return m ? +m[0] : null; };
  const css = (name, dflt) => getComputedStyle(document.body).getPropertyValue(name).trim() || dflt;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };

  // the groups of schools question 1 uses (insights.js BANDS): the "top 14" split out, as legal academia talks
  const BANDS = [
    { label: 'Top 14', short: 'Top 14', lo: 1, hi: 14 },
    { label: '15–25', short: '15–25', lo: 15, hi: 25 },
    { label: '26–50', short: '26–50', lo: 26, hi: 50 },
    { label: '51–100', short: '51–100', lo: 51, hi: 100 },
    { label: '101 & below, unranked', short: '101+', lo: 101, hi: Infinity },
  ];
  const bandOf = (r) => (r == null || r <= 0 ? 4 : BANDS.findIndex((b) => r >= b.lo && r <= b.hi));
  const bandProse = (k) => (k === 4 ? '101 and below, or unranked' : BANDS[k].label.toLowerCase());   // (in a sentence: 'Schools ranked top 14')
  const INST_SHORT = { 'New York University': 'NYU', 'University of California, Los Angeles': 'UCLA', 'University of California, Berkeley': 'Berkeley',
    'Southern Illinois University Carbondale': 'Southern Illinois', 'Mitchell Hamline School of Law': 'Mitchell Hamline', 'New York Law School': 'NY Law School',
    'University of Pennsylvania': 'Penn', 'University of Texas at Austin': 'Texas', 'University of Southern California': 'USC',
    'George Washington University': 'GW', 'Columbia University School of Law': 'Columbia', 'Boston University': 'BU',
    'University of North Carolina at Chapel Hill': 'UNC', 'Washington University': 'WashU', 'Boston College': 'BC',
    'University of Minnesota': 'Minnesota', 'University of Notre Dame': 'Notre Dame', 'Georgetown University': 'Georgetown' };
  const instLabel = (name, n) => {
    const t = INST_SHORT[name] || name.replace(/^The /, '').replace(/ School of Law$| Law School$/, '').replace(/^University of California, /, 'UC ')
      .replace(/^University of /, '').replace(/ University$/, '');
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };
  // the subject areas (data.groups) in a chart's narrow rows
  const AREA_SHORT = { 'Constitutional & Public Law': 'Constitutional & public', 'Courts, Litigation & Dispute Resolution': 'Courts & litigation',
    'Criminal Law & Justice': 'Criminal law', 'Business & Financial Law': 'Business & finance', 'Tax, Trusts & Estates': 'Tax & estates',
    'Property, Environment & Natural Resources': 'Property & environment', 'International & Comparative Law': 'International',
    'Science, Technology & IP': 'Science, tech & IP', 'Health Law & Bioethics': 'Health & bioethics', 'Civil Rights, Equality & Family': 'Civil rights & family',
    'Labor & Employment': 'Labor & employment', 'Legal Profession & Education': 'Legal profession', 'Legal Theory, Humanities & Society': 'Legal theory',
    'Interdisciplinary Methods': 'Interdisciplinary', 'General & Policy Journals': 'General & policy' };
  const areaLabel = (name, narrow) => (narrow ? AREA_SHORT[name] || name : name);

  ////////////////////////////////////////////////////////////////////////// the numbers

  // One pass over the papers. Every figure counts articles with at least one author on the faculty of a U.S. law
  // school, in the years of the page's bar (insights.js; 2026-10-29, the owner: "Add the year range into the
  // 'insights' ... either asked on all data or that limited range a user selects. And include the optional options
  // too"): all years, or a range; short pieces left out when that option is on; groups by the U.S. News overall rank
  // or, with that option, the TaxProf peer rank; with a school's own journals left out, an article does not count for
  // a school that publishes its journal. "Twenty years earlier" (the subject-area shift) is the last ten of the chosen
  // years (all of them when there are fewer) and the same years two decades back. Without the bar (an older
  // insights.js): research articles, the ten years ending at meta.default_to, U.S. News, as before.
  function compute(DATA, META, B) {
    const P = DATA.papers, C = DATA.credits, S = DATA.schools, J = DATA.journals, people = DATA.people;
    const NP = P.n || P.journal.length, NS = S.length, NJ = J.length;
    let maxYear = 0;
    for (let p = 0; p < NP; p++) if (P.year[p] > maxYear) maxYear = P.year[p];
    const to = B ? B.to : META && META.default_to ? +META.default_to : maxYear;
    const from = B ? B.from : to - 9;
    const lFrom = Math.max(from, to - 9), lTo = to, eFrom = lFrom - 20, eTo = lTo - 20;
    const minor = B ? B.minor : true;
    const src = B && B.src === 'peer' ? 'peer' : 'usnews';
    const own = B && B.noHome && DATA.journal_school ? DATA.journal_school : null;
    // each person's U.S. law school (-1: none on the faculty lists)
    const usOf = Int32Array.from(people, (row) => { const s = (row[1] || []).find((x) => S[x] && S[x][1]); return s == null ? -1 : s; });
    const sRank = S.map((row) => (row[1] ? rankNum(src === 'peer' ? row[3] : row[2]) : null));
    const sBand = sRank.map(bandOf);
    const jr = (DATA.journal_ranks && (DATA.journal_ranks[src] || DATA.journal_ranks.usnews)) || J.map((j) => j[2]);
    // 0..4 flagship review by its school's band, 5 online editions & other general journals, 6 specialty (insights.js journalColumn)
    const col = J.map((j, ji) => {
      if (j[3] && j[3].length) return 6;
      const r = j[2] == null ? null : (DATA.host_ranks ? jr[ji] : j[2]);
      if (r == null) return 6;
      return r < 0 ? 5 : bandOf(r);
    });
    // each specialty journal's subject area (the field it counts toward, data.field_of, sits in one area: journals[ji][4])
    const areaOf = J.map((j, ji) => (DATA.field_of && DATA.field_of[ji] >= 0 && j[4] && j[4][0] ? j[4][0][0] : -1));
    // each school's own flagship review(s) (data.journal_school; by the host school's name where that list is missing)
    const ownJ = S.map(() => []);
    J.forEach((j, ji) => {
      if (col[ji] > 4) return;
      let ss = DATA.journal_school ? DATA.journal_school[ji] : null;
      if (!ss) { const host = j[5] && j[5][0]; ss = host ? S.map((row, s) => (row[0] === host ? s : -1)).filter((s) => s >= 0) : []; }
      ss.forEach((s) => { if (ownJ[s]) ownJ[s].push(ji); });
    });
    // each paper's credited people (credits come in paper order, but nothing here relies on it)
    const start = new Int32Array(NP + 1);
    for (let i = 0; i < C.paper.length; i++) start[C.paper[i] + 1]++;
    for (let p = 0; p < NP; p++) start[p + 1] += start[p];
    const at = start.slice(0, NP), who = new Int32Array(C.paper.length);
    for (let i = 0; i < C.paper.length; i++) who[at[C.paper[i]]++] = C.person[i];

    const NA = (DATA.groups || []).length;
    const R = {
      from, to, eFrom, eTo, lFrom, lTo, sRank, sBand, ownJ, col, NJ, src, minor, noHome: !!own,
      rankCol: src === 'peer' ? 3 : 2, srcShort: src === 'peer' ? 'TaxProf peer' : 'U.S. News', srcName: src === 'peer' ? 'TaxProf peer rank' : 'U.S. News overall rank',
      art: minor ? 'research articles' : 'articles', Art: minor ? 'Research articles' : 'Articles',
      papers: 0, cross: 0, pairs: new Map(), drivers: new Map(), crossOf: new Int32Array(NS), crossList: [],   // 1. co-authors across schools
      flagTot: new Int32Array(NS), flagHome: new Int32Array(NS),                                      // 2. the school's own review
      tier: BANDS.map(() => new Float64Array(NA)), tierAll: new Float64Array(NA),                     // 3. areas by group of schools
      teamTot: new Float64Array(NA), teamMulti: new Float64Array(NA), hasAuthors: !!P.authors,         // 4. co-authored, by area
      early: new Float64Array(NA), late: new Float64Array(NA),                                         // 5. areas twenty years apart
      allOf: new Map(), topOf: new Map(),                                                              // 6. articles per person
    };
    const persons = [], schools = [], bands = new Set();
    for (let p = 0; p < NP; p++) {
      if (minor && P.minor && P.minor[p]) continue;
      const y = P.year[p];
      const inWin = y >= from && y <= to, inEarly = y >= eFrom && y <= eTo;
      if (!inWin && !inEarly) continue;
      const ji = P.journal[p], a = areaOf[ji], ow = own ? own[ji] : null;
      persons.length = 0; schools.length = 0;
      for (let k = start[p]; k < start[p + 1]; k++) {
        const per = who[k], s = usOf[per];
        if (s < 0 || persons.includes(per) || (ow && ow.includes(s))) continue;
        persons.push(per);
        if (!schools.includes(s)) schools.push(s);
      }
      if (!schools.length) continue;
      // (the earlier years of the subject-area shift can overlap the chosen years when those run over thirty years)
      if (inEarly && a >= 0) R.early[a]++;
      if (!inWin) continue;
      R.papers++;
      if (a >= 0) {
        if (y >= lFrom && y <= lTo) R.late[a]++;
        R.tierAll[a]++;
        bands.clear();
        schools.forEach((s) => bands.add(sBand[s]));
        bands.forEach((b) => { R.tier[b][a]++; });
        if (R.hasAuthors) { R.teamTot[a]++; if (P.authors[p] >= 2) R.teamMulti[a]++; }
      }
      persons.forEach((per) => {
        R.allOf.set(per, (R.allOf.get(per) || 0) + 1);
        if (col[ji] === 0) R.topOf.set(per, (R.topOf.get(per) || 0) + 1);
      });
      if (col[ji] <= 4) {
        schools.forEach((s) => { R.flagTot[s]++; if (ownJ[s].includes(ji)) R.flagHome[s]++; });
      }
      if (schools.length >= 2) {
        R.cross++;
        R.crossList.push(schools.slice());        // each such article's schools, once (for the wheel's per-school count)
        schools.forEach((s) => { R.crossOf[s]++; });
        for (let i = 0; i < schools.length; i++) {
          for (let k = i + 1; k < schools.length; k++) {
            const a1 = Math.min(schools[i], schools[k]), b1 = Math.max(schools[i], schools[k]), key = a1 * NS + b1;
            R.pairs.set(key, (R.pairs.get(key) || 0) + 1);
            // the pair of authors behind the most of a pair of schools' articles
            let dm = R.drivers.get(key);
            if (!dm) { dm = new Map(); R.drivers.set(key, dm); }
            persons.forEach((x) => { if (usOf[x] !== a1) return; persons.forEach((z) => { if (usOf[z] === b1) { const pk = x + ',' + z; dm.set(pk, (dm.get(pk) || 0) + 1); } }); });
          }
        }
      }
    }
    R.NS = NS;
    return R;
  }

  ////////////////////////////////////////////////////////////////////////// the cards

  let DATA = null, META = null, R = null, drawn = false;
  const charts = [];
  const figs = [];      // { box, draw } for each figure, redrawn on resize

  const font = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' };
  function base(W) {
    const ink2 = css('--ink-2', '#52514e'), muted = css('--muted', '#898781'), grid = css('--grid', '#e8e7e1'), axis = css('--axis', '#c3c2b7');
    const axisStyle = { color: muted, fontSize: '11.5px', fontVariantNumeric: 'tabular-nums' };
    return {
      chart: { backgroundColor: 'transparent', style: font, spacing: [8, 4, 6, 2], animation: false },
      title: { text: null }, subtitle: { text: null },
      credits: { enabled: false },          // (2026-10-26, the owner: "drop the highcharts logo")
      exporting: { enabled: false },
      legend: { enabled: false, itemStyle: { color: ink2, fontWeight: '400', fontSize: '12.5px' }, itemHoverStyle: { color: css('--ink', '#0b0b0b') },
        symbolRadius: 2, margin: 6, padding: 4 },
      // (2026-10-26, the owner on the journal tree: "my cursor gets stuck in it"): a tap shows the tooltip, a swipe
      // always scrolls the page
      // (SVG text, whatever the page's other figures set: it wraps at the width given here)
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

  // a card in the page's style: a heading that names what is shown, what is counted, the figure, a note and the numbers
  function card(id, title, caption) {
    const fig = el('figure', { class: 'ins-card cn-card', id: id });
    const cap = el('figcaption');
    cap.appendChild(el('h3', null, title));
    cap.appendChild(el('p', null, caption));
    fig.appendChild(cap);
    const legend = el('div', { class: 'ins-legend cn-legend' });
    const box = el('div', { class: 'ins-chart cn-chart' });
    const foot = el('p', { class: 'ins-foot cn-foot' });
    const details = el('details', { class: 'ins-table' });
    details.appendChild(el('summary', null, 'The numbers'));
    const tb = el('div');
    details.appendChild(tb);
    fig.append(legend, box, foot, details);
    $('connectionsBody').appendChild(fig);
    return { fig, legend, box, foot, details, tb };
  }
  function table(tb, head, rows) {
    const t = el('table');
    const tr = el('tr');
    head.forEach((h) => tr.appendChild(el('th', { scope: 'col' }, h)));
    t.appendChild(el('thead')).appendChild(tr);
    const body = el('tbody');
    rows.forEach((r) => { const x = el('tr'); r.forEach((v) => x.appendChild(el('td', null, v))); body.appendChild(x); });
    t.appendChild(body);
    tb.replaceChildren(t);
  }
  // a figure that needs a Highcharts module the page did not load: its table, open, stands in for it
  function noChart(c) {
    c.box.replaceChildren(el('p', { class: 'text-muted cn-none' }, 'The chart could not be drawn here; the table below lists the numbers.'));
    c.details.open = true;
  }
  const has = (type) => typeof Highcharts !== 'undefined' && !!(Highcharts.seriesTypes && Highcharts.seriesTypes[type]);
  const legendKey = (c, items) => {
    c.legend.replaceChildren();
    items.forEach(([label, color, kind]) => {
      const s = el('span');
      const i = el('i', kind ? { class: kind } : null);
      i.style.background = color;
      s.append(i, document.createTextNode(label));
      c.legend.appendChild(s);
    });
  };

  // ---------------------------------------------------------------- 1. co-authors at two schools
  function figPairs() {
    const S = DATA.schools, people = DATA.people, NS = R.NS;
    const all = [...R.pairs.entries()].map(([key, n]) => ({ a: Math.floor(key / NS), b: key % NS, n, key }));
    all.sort((x, y) => y.n - x.n || S[x.a][0].localeCompare(S[y.a][0]) || S[x.b][0].localeCompare(S[y.b][0]));
    // the 20 busiest pairs, and every pair tied with the 20th (a cut through a tie would drop pairs by their names)
    const cut = all.length > 20 ? all[19].n : 0;
    const top = all.filter((o) => o.n >= cut);
    if (!top.length) return null;
    // each school's articles with a co-author at a school it is joined to on the wheel, each article once (an article
    // with authors at three wheel schools sits in two of its ribbons)
    const onWheel = new Set(top.map((o) => o.key)), wheelN = new Int32Array(NS);
    R.crossList.forEach((ss) => ss.forEach((s) => { if (ss.some((o) => o !== s && onWheel.has(Math.min(s, o) * NS + Math.max(s, o)))) wheelN[s]++; }));
    top.forEach((o) => {
      const dm = R.drivers.get(o.key);
      let best = null, ties = 0;
      if (dm) dm.forEach((n, pk) => { if (!best || n > best[1]) { best = [pk, n]; ties = 1; } else if (n === best[1]) ties++; });
      o.by = best ? best[0].split(',').map((x) => people[+x][0]) : null;
      o.byN = best ? best[1] : 0;
      o.tied = ties > 1;          // another pair of authors has as many (the one shown is the first found)
    });
    const share = R.cross / (R.papers || 1);
    const first = top[0];
    const name = (s) => instLabel(S[s][0], 18);
    const c = card('cnPairs',
      'Co-authored articles across law schools, by pair of schools',
      R.Art + ' by current faculty at U.S. law schools, ' + yrs(R.from, R.to) + ', with authors at two or more of those schools (' +
      num(R.cross) + ' of ' + num(R.papers) + ', ' + pct1(share) + '). The wheel joins the ' + top.length + ' pairs of schools with the most such articles; ' +
      'the wider the ribbon, the more articles. Each author counts at the school where they teach now. Tap a ribbon for the count and the two authors with the most of those articles.');
    // the pairs of schools on the wheel (10 or more articles) with the largest share by one pair of authors, when that
    // share is 75% or more; pairs tied at that share are all named, most articles first
    const solos = top.filter((o) => o.n >= 10 && o.byN / o.n >= 0.75).sort((x, y) => y.byN / y.n - x.byN / x.n);
    const solo = solos.filter((o) => solos[0] && o.byN * solos[0].n === solos[0].byN * o.n);
    const lead = top.filter((o) => o.n === first.n);
    c.foot.textContent = (lead.length === 1 ? 'Pair with the most articles: ' + S[first.a][0] + ' and ' + S[first.b][0] + ', ' + num(first.n) + ' article' + (first.n === 1 ? '' : 's') + '.'
      : 'Most articles for one pair of schools: ' + num(first.n) + ' (' + lead.length + ' pairs).') +
      (solo.length ? ' Largest share by one pair of authors (pairs on the wheel with 10 or more articles): ' +
        solo.map((o) => name(o.a) + '–' + name(o.b) + ' (' + o.by.join(' and ') + ', ' + num(o.byN) + ' of ' + num(o.n) + ')').join('; ') + '.' : '');
    table(c.tb, ['Schools', 'Articles together', 'Most by'], top.map((o) => [S[o.a][0] + ' & ' + S[o.b][0], num(o.n), o.by ? o.by.join(' & ') + ' (' + o.byN + (o.tied ? ', tied' : '') + ')' : '']));
    if (!has('dependencywheel')) { noChart(c); return { c }; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      const nodes = [...new Set(top.flatMap((o) => [o.a, o.b]))].sort((x, y) => (R.sRank[x] || 999) - (R.sRank[y] || 999) || S[x][0].localeCompare(S[y][0]));
      const dark = css('--seq-3', '#104281'), blue = css('--flagship', '#2a78d6'), ink2 = css('--ink-2', '#52514e');
      // the schools' names run out from the ring (a name along a small arc would be cut short); the wheel leaves
      // room for the longest
      const lab = (s) => instLabel(S[s][0], narrow ? 14 : 18);
      const fs = narrow ? 11 : 12.5, room = Math.max(...nodes.map((s) => lab(s).length)) * fs * 0.56 + 14;
      let H = Math.round(Math.min(640, Math.max(320, narrow ? W : W * 0.62)));
      const diam = Math.max(140, Math.min(W, H - 16) - 2 * room);
      H = Math.max(H, Math.ceil(diam + 2 * room + 16));
      makeChart(c.box, {
        chart: { height: H, events: { render() {
          const ch = this, s = ch.series[0];
          if (ch.cnLabels) ch.cnLabels.destroy();
          const ctr = s && s.getCenter ? s.getCenter() : null;      // [x, y, diameter] in the plot area
          if (!ctr) return;
          const g = ch.cnLabels = ch.renderer.g('cn-wheel-labels').attr({ zIndex: 7 }).add();
          const cx = ch.plotLeft + ctr[0], cy = ch.plotTop + ctr[1], r = ctr[2] / 2 + 6;
          s.nodes.forEach((n) => {
            if (n.angle == null) return;
            const left = Math.cos(n.angle) < 0, deg = n.angle * 180 / Math.PI + (left ? 180 : 0);
            const t = ch.renderer.text(esc(n.name), cx + Math.cos(n.angle) * r, cy + Math.sin(n.angle) * r)
              .attr({ rotation: deg, align: left ? 'right' : 'left' }).css({ color: ink2, fontSize: fs + 'px', fontWeight: '500' }).add(g);
            t.element.setAttribute('dominant-baseline', 'central');
          });
        } } },
        accessibility: { description: 'A dependency wheel of the ' + top.length + ' pairs of U.S. law schools whose current faculty wrote the most ' + R.art + ' together, ' + yrs(R.from, R.to) + '. The table below the chart lists the pairs.' },
        tooltip: { formatter() {
          const pt = this.point || this;
          if (pt.isNode) {
            const s = pt.custom && pt.custom.s;
            return '<b>' + esc(S[s][0]) + '</b><br>' + num(R.crossOf[s]) + ' article' + (R.crossOf[s] === 1 ? '' : 's') + ' with a co-author at another U.S. law school<br>' + num(wheelN[s]) + ' with the schools it is joined to on the wheel';
          }
          const o = pt.custom || {};
          return '<b>' + esc(S[o.a][0]) + ' & ' + esc(S[o.b][0]) + '</b><br>' + num(o.n) + ' article' + (o.n === 1 ? '' : 's') + ' together, ' + yrs(R.from, R.to) +
            (o.by ? '<br>Most by ' + esc(o.by.join(' & ')) + ' (' + o.byN + (o.tied ? ', tied' : '') + ')' : '');
        } },
        series: [{
          type: 'dependencywheel', name: 'Articles together', keys: ['from', 'to', 'weight'],
          nodes: nodes.map((s) => ({ id: 's' + s, name: lab(s), color: dark, custom: { s } })),
          data: top.map((o) => ({ from: 's' + o.a, to: 's' + o.b, weight: o.n, color: blue, custom: o })),
          size: diam, center: ['50%', '50%'], nodeWidth: narrow ? 7 : 9, nodePadding: 3, borderWidth: 0, linkOpacity: 0.32, curveFactor: 0.55,
          states: { hover: { linkOpacity: 0.85 }, inactive: { linkOpacity: 0.08, opacity: 0.3 } },
          dataLabels: { enabled: false },
        }],
      }, W);
    } });
    return { c };
  }

  // ---------------------------------------------------------------- 2. the school's own review
  function figHome() {
    if (R.noHome) return null;        // (the bar's option leaves those very articles out)
    const S = DATA.schools, J = DATA.journals;
    const rows = [];
    for (let s = 0; s < S.length; s++) {
      if (!S[s][1] || !R.ownJ[s].length || R.flagTot[s] < 20) continue;
      rows.push({ s, rank: R.sRank[s], home: R.flagHome[s], tot: R.flagTot[s], share: R.flagHome[s] / R.flagTot[s] });
    }
    if (rows.length < 10) return null;
    rows.sort((x, y) => y.share - x.share || x.tot - y.tot);
    const sorted = rows.map((r) => r.share).sort((x, y) => x - y);
    const mid = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    // each group's articles pooled (the unranked go with 101 and below, as in question 1)
    const pooled = BANDS.map((b, k) => {
      const rs = rows.filter((r) => bandOf(r.rank) === k);
      const h = rs.reduce((a, r) => a + r.home, 0), t = rs.reduce((a, r) => a + r.tot, 0);
      return { k, n: rs.length, home: h, tot: t, share: t ? h / t : null, lo: b.lo, hi: Math.min(b.hi, Math.max(b.lo, ...rs.map((r) => r.rank || 0))) };
    });
    const t14 = rows.filter((r) => bandOf(r.rank) === 0).sort((x, y) => y.share - x.share);
    const ownName = (s) => R.ownJ[s].map((ji) => J[ji][0]).join(' or ');
    const c = card('cnHome',
      'Faculty’s flagship-review articles in their school’s own law review',
      'One dot per U.S. law school with its own flagship review and at least 20 flagship-review articles by its current faculty, ' + yrs(R.from, R.to) +
      ' (' + rows.length + ' schools): across, its ' + R.srcName + '; up, the share of those articles that appeared in its own review. The line is each group of schools with their articles pooled.');
    c.foot.textContent = 'Median school: ' + pct1(mid) + '.' +
      (t14.length ? ' Highest share among the top 14: ' + S[t14[0].s][0] + ', ' + pct(t14[0].share) + ' (' + num(t14[0].home) + ' of ' + num(t14[0].tot) + ') in the ' + ownName(t14[0].s) + '.' : '');
    table(c.tb, ['School', R.srcShort, 'In its own review', 'Flagship-review articles', 'Share'],
      rows.map((r) => [S[r.s][0], S[r.s][R.rankCol] || 'unranked', num(r.home), num(r.tot), pct1(r.share)])
        .concat(pooled.filter((g) => g.tot).map((g) => [BANDS[g.k].label + ' (' + num(g.n) + ' school' + (g.n === 1 ? '' : 's') + ', pooled)', '', num(g.home), num(g.tot), pct1(g.share)])));
    if (!has('scatter')) { noChart(c); return { c }; }
    const blue = css('--flagship', '#2a78d6'), ink = css('--ink', '#0b0b0b'), ink2 = css('--ink-2', '#52514e');
    legendKey(c, [['Each school', blue, 'dot'], ['Each group of schools, pooled', ink2, '']]);
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      const label = new Set(rows.slice(0, narrow ? 3 : 5).map((r) => r.s));
      if (t14.length) label.add(t14[0].s);
      const ranked = rows.filter((r) => r.rank != null);
      const maxX = Math.max(...ranked.map((r) => r.rank));
      // on a phone a labelled dot less than 3 points below a higher labelled dot labelled on the same side is labelled
      // under the dot (Highcharts would hide one of two labels that overlap)
      const under = new Set(), lab = ranked.filter((r) => label.has(r.s)), right = (r) => r.rank > maxX * 0.7;
      if (narrow) lab.forEach((r, i) => { if (lab.slice(0, i).some((q) => !under.has(q.s) && right(q) === right(r) && q.share - r.share < 0.03)) under.add(r.s); });
      const line = [];
      pooled.forEach((g) => { if (g.share != null) line.push({ x: g.lo, y: 100 * g.share, custom: g }, { x: Math.min(g.hi, maxX), y: 100 * g.share, custom: g }, { x: Math.min(g.hi, maxX) + 0.5, y: null }); });
      makeChart(c.box, {
        chart: { type: 'scatter', height: narrow ? 340 : 400 },
        accessibility: { description: 'A scatter plot of ' + rows.length + ' U.S. law schools: ' + R.srcName + ' across, share of their faculty’s flagship-review articles in their own review up. The table below the chart lists the schools.' },
        xAxis: { min: 0, max: Math.ceil((maxX + 2) / 10) * 10, tickInterval: narrow ? 50 : 25, startOnTick: false, endOnTick: false, title: { text: R.srcShort + ' rank (1 = top)' }, gridLineWidth: 0 },
        yAxis: { min: 0, softMax: 50, tickInterval: narrow ? 20 : 10, title: { text: narrow ? null : 'In its own review' }, labels: { format: '{value}%' } },
        tooltip: { formatter() {
          const pt = this.point || this, o = pt.custom || {};
          if (o.k != null) return '<b>Schools ranked ' + esc(bandProse(o.k)) + '</b><br>' + pct1(o.share) + ' of their flagship-review articles in their own review<br>' + num(o.home) + ' of ' + num(o.tot) + ', ' + num(o.n) + ' school' + (o.n === 1 ? '' : 's') + ' pooled';
          return '<b>' + esc(S[o.s][0]) + '</b><br>' + R.srcShort + ' ' + esc(S[o.s][R.rankCol] || 'unranked') + '<br>' + pct1(o.share) + ' in its own review (' + num(o.home) + ' of ' + num(o.tot) + ')<br><span style="color:#898781">' + esc(ownName(o.s)) + '</span>';
        } },
        series: [
          { type: 'line', name: 'Each group of schools, pooled', data: line, color: ink2, lineWidth: 2, marker: { enabled: false }, zIndex: 1, findNearestPointBy: 'xy',
            states: { hover: { lineWidthPlus: 0 } } },
          { type: 'scatter', name: 'Each school', zIndex: 2, color: blue, marker: { symbol: 'circle', radius: narrow ? 3.5 : 4.5, lineWidth: 1, lineColor: '#ffffff' },
            data: ranked.map((r) => ({ x: r.rank, y: 100 * r.share, custom: r,
              dataLabels: label.has(r.s) ? { enabled: true, format: instLabel(S[r.s][0], narrow ? 18 : 24), align: r.rank > maxX * 0.7 ? 'right' : 'left',
                x: r.rank > maxX * 0.7 ? -7 : 7, y: under.has(r.s) ? 22 : 9, crop: false, overflow: 'allow', style: { fontSize: '11.5px', fontWeight: '500', color: ink, textOutline: '3px #ffffff' } } : undefined })) },
        ],
      }, W);
    } });
    return { c };
  }

  // ---------------------------------------------------------------- 3. what each group of schools writes about
  function figTiers() {
    const G = DATA.groups || [];
    const areas = G.map((g, a) => a).filter((a) => R.tierAll[a] >= 50);
    if (areas.length < 4) return null;
    // (review, 2026-10-29) the totals and each group's count run over every subject area, listed or not: an area with
    // fewer than 50 articles is not given a row, but its articles stay in the shares' denominators and the bottom row
    const allN = G.reduce((x, g, a) => x + R.tierAll[a], 0);
    const bandN = BANDS.map((b, k) => G.reduce((x, g, a) => x + R.tier[k][a], 0));
    const shareAll = (a) => R.tierAll[a] / allN, share = (k, a) => (bandN[k] ? R.tier[k][a] / bandN[k] : null);
    const lr = (k, a) => Math.log2(share(k, a) / shareAll(a));
    // the areas the top leans to first, those below the top 100 lean to last
    areas.sort((x, y) => (lr(0, y) - lr(4, y)) - (lr(0, x) - lr(4, x)));
    const c = card('cnTiers',
      'Specialty-journal articles by subject area and group of schools',
      'For each group of U.S. law schools (by ' + R.srcName + '; 101+ includes the unranked), the share of its current faculty’s specialty-journal ' + R.art + ', ' + yrs(R.from, R.to) +
      ', in each subject area. Blue cells are above that area’s share in the total, red below; an article with authors in two groups counts in each. Subject areas with fewer than 50 articles are not listed (they are in the totals).');
    c.foot.textContent = 'Rows: subject areas, highest ratio of the top-14 share to the 101+ share (unranked included) first.';
    table(c.tb, ['Subject area'].concat(BANDS.map((b) => b.short), ['Total']),
      areas.map((a) => [G[a]].concat(BANDS.map((b, k) => pct1(share(k, a)) + ' (' + num(R.tier[k][a]) + ')'), [pct1(shareAll(a)) + ' (' + num(R.tierAll[a]) + ')']))
        .concat([['Specialty-journal articles'].concat(bandN.map(num), [num(allN)])]));
    if (!has('heatmap')) { noChart(c); return { c }; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      const ink = css('--ink', '#0b0b0b');
      const data = [];
      areas.forEach((a, y) => BANDS.forEach((b, k) => {
        const v = Math.max(-2, Math.min(2, lr(k, a)));
        data.push({ x: k, y, value: v, custom: { a, k }, dataLabels: { color: Math.abs(v) > 1.15 ? '#ffffff' : ink } });
      }));
      makeChart(c.box, {
        // (on a phone the ranges take two lines, "26–" over "50", so the column heads do not run together)
        chart: { type: 'heatmap', height: areas.length * (narrow ? 27 : 30) + (narrow ? 124 : 104), marginTop: narrow ? 42 : 30 },
        accessibility: { description: 'A table-like heat map: subject areas down, groups of law schools across, each cell the share of that group’s specialty-journal articles in that area.' },
        xAxis: { categories: BANDS.map((b) => b.short), opposite: true, lineWidth: 0, tickLength: 0,
          labels: { autoRotation: false, overflow: 'allow', formatter() { const t = String(this.value); return narrow && t.length > 4 ? t.replace('–', '–<br>') : t; },
            style: { color: css('--ink-2', '#52514e'), fontSize: narrow ? '10px' : '12px', fontWeight: '600', textOverflow: 'none' } } },
        yAxis: { categories: areas.map((a) => areaLabel(G[a], narrow)), reversed: true, title: { text: null }, gridLineWidth: 0, lineWidth: 0,
          labels: { style: { color: css('--ink-2', '#52514e'), fontSize: narrow ? '11px' : '12px', textOverflow: 'none', whiteSpace: 'nowrap' } } },
        colorAxis: { min: -2, max: 2, tickPositions: [-2, -1, 0, 1, 2],
          stops: [[0, '#c23b3a'], [0.25, '#f0a29f'], [0.5, '#f0efec'], [0.75, '#86b6ef'], [1, '#1c5cab']],
          labels: { formatter() { return ({ '-2': '¼×', '-1': '½×', 0: 'same', 1: '2×', 2: '4×' })[this.value]; }, style: { color: css('--muted', '#898781'), fontSize: '11px' } } },
        legend: { enabled: true, align: 'left', verticalAlign: 'bottom', layout: 'horizontal', symbolWidth: Math.min(260, W - 40), symbolHeight: 8,
          title: { text: 'Share compared with the total', style: { color: css('--ink-2', '#52514e'), fontSize: '12px', fontWeight: '400' } } },
        tooltip: { formatter() {
          const pt = this.point || this, o = pt.custom || {};
          return '<b>' + esc(G[o.a]) + '</b><br>Schools ranked ' + esc(bandProse(o.k)) + ': ' + pct1(share(o.k, o.a)) + ' of their specialty-journal articles (' + num(R.tier[o.k][o.a]) + ')<br>Total: ' + pct1(shareAll(o.a));
        } },
        series: [{ name: 'Share of specialty-journal articles', data, borderWidth: 2, borderColor: '#ffffff', borderRadius: 3, colsize: 1, rowsize: 1,
          dataLabels: { enabled: true, formatter() { const o = (this.point || this).custom; return pct(share(o.k, o.a)); },
            style: { fontSize: narrow ? '11px' : '12px', fontWeight: '500', textOutline: 'none', fontVariantNumeric: 'tabular-nums' } } }],
      }, W);
    } });
    return { c };
  }

  // ---------------------------------------------------------------- 4. co-written, by subject area
  function figTeams() {
    const G = DATA.groups || [];
    if (!R.hasAuthors) return null;
    const areas = G.map((g, a) => a).filter((a) => R.teamTot[a] >= 50).sort((x, y) => R.teamMulti[y] / R.teamTot[y] - R.teamMulti[x] / R.teamTot[x]);
    if (areas.length < 4) return null;
    // (review, 2026-10-29) the total runs over every subject area, listed or not
    const tot = G.reduce((x, g, a) => x + R.teamTot[a], 0), multi = G.reduce((x, g, a) => x + R.teamMulti[a], 0);
    const sh = (a) => R.teamMulti[a] / R.teamTot[a];
    const c = card('cnTeams',
      'Co-written specialty-journal articles, by subject area',
      'Of the specialty-journal ' + R.art + ' with an author on a U.S. law faculty, ' + yrs(R.from, R.to) + ', the share with two or more authors (co-authors counted with or without a law-faculty appointment), by the journal’s subject area. Subject areas with fewer than 50 articles are not listed (they are in the total).');
    c.foot.textContent = 'Specialty journals, total: ' + pct(multi / tot) + ' (' + num(multi) + ' of ' + num(tot) + ').';
    table(c.tb, ['Subject area', 'Articles', 'Two or more authors', 'Share'], areas.map((a) => [G[a], num(R.teamTot[a]), num(R.teamMulti[a]), pct1(sh(a))])
      .concat([['Specialty journals, total', num(tot), num(multi), pct1(multi / tot)]]));
    if (!has('bar')) { noChart(c); return { c }; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      const orange = css('--specialty', '#eb6834'), ink = css('--ink', '#0b0b0b'), ink2 = css('--ink-2', '#52514e');
      makeChart(c.box, {
        chart: { type: 'bar', height: areas.length * (narrow ? 26 : 28) + 64, marginRight: narrow ? 20 : 26 },
        accessibility: { description: 'Bars: the share of co-written specialty-journal articles in each subject area, most first.' },
        xAxis: { categories: areas.map((a) => areaLabel(G[a], narrow)), lineWidth: 1, tickLength: 0, labels: { style: { color: ink2, fontSize: narrow ? '11px' : '12px', textOverflow: 'none', whiteSpace: 'nowrap' } } },
        yAxis: { min: 0, max: 100, tickInterval: 25, title: { text: null }, labels: { format: '{value}%' },
          plotLines: [{ value: 100 * multi / tot, color: ink, width: 1, dashStyle: 'ShortDash', zIndex: 4,
            label: { text: 'Total: ' + pct(multi / tot), rotation: 0, align: 'left', x: 5, y: -4, verticalAlign: 'bottom', style: { color: ink, fontSize: '11.5px', textOutline: '3px #ffffff' } } }] },
        tooltip: { formatter() {
          const pt = this.point || this, a = pt.custom;
          return '<b>' + esc(G[a]) + '</b><br>' + pct1(sh(a)) + ' co-written: ' + num(R.teamMulti[a]) + ' of ' + num(R.teamTot[a]) + ' articles';
        } },
        series: [{ name: 'Share co-written', color: orange, borderRadius: 3, pointPadding: 0.18, groupPadding: 0, borderWidth: 0,
          data: areas.map((a) => ({ y: 100 * sh(a), custom: a })),
          dataLabels: { enabled: true, formatter() { return pct((this.point || this).y / 100); }, style: { color: ink2, fontSize: '11.5px', fontWeight: '500', textOutline: '3px #ffffff' } } }],
      }, W);
    } });
    return { c };
  }

  // ---------------------------------------------------------------- 5. the areas twenty years apart
  function figShift() {
    const G = DATA.groups || [];
    const eN = G.reduce((x, g, a) => x + R.early[a], 0), lN = G.reduce((x, g, a) => x + R.late[a], 0);
    if (eN < 500 || lN < 500) return null;
    const areas = G.map((g, a) => a).filter((a) => R.early[a] + R.late[a] >= 50);
    const e = (a) => R.early[a] / eN, l = (a) => R.late[a] / lN, d = (a) => l(a) - e(a);
    areas.sort((x, y) => d(y) - d(x));
    const ep = yrs(R.eFrom, R.eTo), lp = yrs(R.lFrom, R.lTo);
    const c = card('cnShift',
      'Specialty-journal articles by subject area, ' + ep + ' and ' + lp,
      'The share of each subject area in the specialty-journal ' + R.art + ' of today’s U.S. law faculty: ' + ep + ' (' + num(eN) + ' articles) and ' + lp +
      ' (' + num(lN) + '). An area’s share includes journals that opened between the two periods; the earlier years count only the faculty who still teach.');
    table(c.tb, ['Subject area', ep, lp, 'Change'], areas.map((a) => [G[a], pct1(e(a)) + ' (' + num(R.early[a]) + ')', pct1(l(a)) + ' (' + num(R.late[a]) + ')',
      (d(a) >= 0 ? '+' : '−') + Math.abs(100 * d(a)).toFixed(1) + ' pts']));
    if (!has('scatter')) { noChart(c); return { c }; }
    const orange = css('--specialty', '#eb6834'), grey = css('--muted', '#898781'), rule = css('--axis', '#c3c2b7');
    legendKey(c, [[ep, grey, 'dot'], [lp, orange, 'dot']]);
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      const ink2 = css('--ink-2', '#52514e');
      const tip = function () {
        const pt = this.point || this, a = pt.custom;
        return '<b>' + esc(G[a]) + '</b><br>' + ep + ': ' + pct1(e(a)) + ' (' + num(R.early[a]) + ')<br>' + lp + ': ' + pct1(l(a)) + ' (' + num(R.late[a]) + ')';
      };
      const series = areas.map((a, i) => ({ type: 'line', data: [{ x: i, y: 100 * e(a) }, { x: i, y: 100 * l(a) }], color: rule, lineWidth: 2,
        marker: { enabled: false }, enableMouseTracking: false, showInLegend: false, zIndex: 1, accessibility: { enabled: false } }));
      series.push({ type: 'scatter', name: ep, color: grey, zIndex: 2, marker: { symbol: 'circle', radius: 5, lineWidth: 1, lineColor: '#ffffff' },
        data: areas.map((a, i) => ({ x: i, y: 100 * e(a), custom: a })) });
      series.push({ type: 'scatter', name: lp, color: orange, zIndex: 3, marker: { symbol: 'circle', radius: 5, lineWidth: 1, lineColor: '#ffffff' },
        data: areas.map((a, i) => ({ x: i, y: 100 * l(a), custom: a })) });
      makeChart(c.box, {
        chart: { inverted: true, height: areas.length * (narrow ? 26 : 28) + 56 },
        accessibility: { description: 'Two dots per subject area: its share of specialty-journal articles in ' + ep + ' and in ' + lp + ', ordered by the change in share, largest increase first.' },
        xAxis: { categories: areas.map((a) => areaLabel(G[a], narrow)), min: 0, max: areas.length - 1, lineWidth: 1, tickLength: 0, gridLineWidth: 0,
          labels: { step: 1, style: { color: ink2, fontSize: narrow ? '11px' : '12px', textOverflow: 'none', whiteSpace: 'nowrap' } } },
        yAxis: { min: 0, title: { text: null }, labels: { format: '{value}%' }, tickAmount: narrow ? 4 : 6 },
        tooltip: { formatter: tip },
        series,
      }, W);
    } });
    return { c };
  }

  // ---------------------------------------------------------------- 6. a few people write much of the top reviews
  function figFew() {
    const allV = [...R.allOf.values()].sort((x, y) => y - x);
    const N = allV.length;
    if (N < 100) return null;
    const topV = [...R.topOf.entries()].map(([per, n]) => n).sort((x, y) => y - x);
    const T = allV.reduce((x, n) => x + n, 0), Tt = topV.reduce((x, n) => x + n, 0);
    if (!Tt) return null;
    const cum = (v, k) => { let s = 0; for (let i = 0; i < Math.min(k, v.length); i++) s += v[i]; return s; };
    const half = (v, tot) => { let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (s >= tot / 2) return i + 1; } return v.length; };
    const hTop = half(topV, Tt), hAll = half(allV, T);
    const nTop = DATA.journals.filter((j, ji) => R.col[ji] === 0).length;
    const c = card('cnFew',
      'Share of articles by the most prolific faculty authors',
      'Current faculty at U.S. law schools with at least one ' + R.art.replace(/s$/, '') + ' ' + yrs(R.from, R.to) + ' (' + num(N) + ' people), ranked by their number of articles (each curve ranks them by its own count), and the running share of those articles: ' +
      'in the journals collected here, and in the ' + nTop + ' flagship reviews of the schools in the top 14 by the ' + R.srcName + '. ' +
      'An article by two of them counts once for each (one author credit each), so the totals in the table run above the number of articles.');
    c.foot.textContent = 'People accounting for half of the top-14-review articles: ' + num(hTop) + ' (' + pct1(hTop / N) + ' of those who published); for half of their articles in the journals collected here: ' + num(hAll) +
      ' (' + pct1(hAll / N) + '). People with at least one top-14-review article: ' + num(topV.length) + ' (' + pct(topV.length / N) + ').';
    const marks = [0.01, 0.05, 0.1, 0.2, 0.5];
    table(c.tb, ['Most prolific', 'People', 'Share of top-14-review articles', 'Share of articles in the journals collected here'],
      marks.map((f) => { const k = Math.round(f * N); return [pct(f), num(k), pct1(cum(topV, k) / Tt), pct1(cum(allV, k) / T)]; })
        .concat([['Total', num(N), '100% (' + num(Tt) + ' author credits)', '100% (' + num(T) + ' author credits)']]));
    if (!has('line')) { noChart(c); return { c }; }
    const blue = css('--flagship', '#2a78d6'), ink2 = css('--ink-2', '#52514e'), rule = css('--axis', '#c3c2b7');
    legendKey(c, [['Top-14 law reviews', blue, ''], ['Journals collected here', ink2, ''], ['Equal shares', rule, 'dash']]);
    // the curves at every half percent of people, and at the halfway mark (both curves, for the shared tooltip)
    const ks = [...new Set(Array.from({ length: 201 }, (x, q) => Math.round(q / 200 * N)).concat([hTop]))].sort((x, y) => x - y);
    const curve = (v, tot) => ks.map((k) => ({ x: 100 * k / N, y: 100 * cum(v, k) / tot, custom: k }));
    const topC = curve(topV, Tt), allC = curve(allV, T);
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      const ink = css('--ink', '#0b0b0b');
      const at = (arr, x) => arr.reduce((m, p) => (Math.abs(p.x - x) < Math.abs(m.x - x) ? p : m), arr[0]);
      const topData = topC.map((p) => (p.custom !== hTop ? p : Object.assign({}, p, {
        marker: { enabled: true, symbol: 'circle', radius: 4.5, fillColor: blue, lineColor: '#ffffff', lineWidth: 1 },
        dataLabels: { enabled: true, align: 'left', x: 8, y: 14, format: num(hTop) + ' people: half', style: { color: ink, fontSize: '11.5px', fontWeight: '600', textOutline: '3px #ffffff' } } })));
      const allData = allC.slice();
      const lab = (p, text, y) => Object.assign({}, p, { dataLabels: { enabled: true, format: text, align: 'left', x: 6, y, style: { color: ink2, fontSize: '11.5px', fontWeight: '500', textOutline: '3px #ffffff' } } });
      // each curve named just below its bend where there is room (on a phone the legend above names the top-14 curve)
      const allL = at(allData, narrow ? 38 : 30);
      if (!narrow) { const topL = at(topData, 9.5); topData[topData.indexOf(topL)] = lab(topL, 'Top-14 law reviews', 15); }
      allData[allData.indexOf(allL)] = lab(allL, 'Journals collected here', 16);
      makeChart(c.box, {
        chart: { type: 'line', height: narrow ? 320 : 380 },
        accessibility: { description: 'Two running-share curves: the share of articles written by the most prolific faculty, for the top-14 law reviews and for the journals collected here.' },
        xAxis: { min: 0, max: 100, tickInterval: narrow ? 25 : 10, title: { text: 'Faculty who published, most prolific first' }, labels: { format: '{value}%' }, gridLineWidth: 1,
          crosshair: { color: rule, width: 1 } },
        yAxis: { min: 0, max: 100, tickInterval: 25, title: { text: narrow ? null : 'Share of the articles' }, labels: { format: '{value}%' } },
        tooltip: { shared: true, formatter() {
          const pts = this.points || [this], p0 = pts[0].point || pts[0];
          const k = p0.custom;
          // (each curve ranks the people by its own count: the k most prolific in the top-14 reviews are not the k most
          // prolific overall)
          const lines = pts.filter((p) => (p.series || {}).name !== 'Equal shares').map((p) => 'The ' + num(k) + ' with the most ' +
            (p.series.name === 'Journals collected here' ? 'articles in the journals collected here' : 'top-14-review articles') + ' wrote <b>' + pct(p.y / 100) + '</b> of them');
          return '<b>' + num(k) + (k === 1 ? ' person (' : ' people (') + pct1(k / N) + ' of those who published)</b><br>' + lines.join('<br>');
        } },
        plotOptions: { series: { marker: { enabled: false }, states: { hover: { lineWidthPlus: 0 } } } },
        series: [
          { name: 'Equal shares', data: [[0, 0], [100, 100]], color: rule, lineWidth: 1, dashStyle: 'ShortDash', enableMouseTracking: false, zIndex: 0, accessibility: { enabled: false } },
          { name: 'Journals collected here', data: allData, color: ink2, lineWidth: 2, zIndex: 1 },
          { name: 'Top-14 law reviews', data: topData, color: blue, lineWidth: 2, zIndex: 2 },
        ],
      }, W);
    } });
    return { c };
  }

  ////////////////////////////////////////////////////////////////////////// the section

  // the section's lede: what the figures below cover (the figures that could be computed), not what they show
  function lede(F) {
    const box = $('cnLede');
    if (!box) return;
    box.replaceChildren();
    const parts = [['pairs', 'articles with co-authors at two or more schools, by pair of schools'],
      ['home', 'flagship-review articles in the school’s own law review'],
      ['tiers', 'specialty-journal articles by subject area and group of schools'],
      ['teams', 'co-written specialty-journal articles by subject area'],
      ['shift', 'specialty-journal articles by subject area, ' + yrs(R.eFrom, R.eTo) + ' and ' + yrs(R.lFrom, R.lTo)],
      ['few', 'the share of articles by the most prolific authors']].filter(([k]) => F[k]).map(([, t]) => t);
    if (!parts.length) return;
    box.appendChild(document.createTextNode(R.Art + ' by current faculty at U.S. law schools, ' + yrs(R.from, R.to) +
      (F.shift && (R.eFrom < R.from || R.eTo > R.to) ? ' (one chart also ' + yrs(R.eFrom, R.eTo) + ')' : '') + ': ' + parts.join('; ') + '.'));
  }

  function drawAll() {
    charts.splice(0).forEach((ch) => { try { ch.destroy(); } catch (e) { /* already gone */ } });
    figs.forEach((f) => { try { f.box.replaceChildren(); f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted cn-none' }, 'The chart could not be drawn; the table below lists the numbers.')); } });
  }

  let gen = 0, observed = false;
  const barOf = () => (window.LSR_INS && LSR_INS.bar ? LSR_INS.bar : null);
  // the line under the heading: the years and options these figures use; the subject-area shift's years only when
  // that figure is drawn (F: the figures computed)
  const GONE = [['pairs', 'pairs of schools'], ['home', 'own review'], ['tiers', 'subject areas by group of schools'], ['teams', 'co-written articles by subject area'],
    ['shift', 'subject-area shift'], ['few', 'most prolific authors']];
  // the figures left out for too few articles (none named when no figure is drawn: the section then says so itself)
  const gone = (F) => (F && Object.keys(F).some((k) => F[k]) ? GONE.filter(([k]) => !F[k] && !(k === 'home' && R.noHome) && !(k === 'teams' && !R.hasAuthors)).map(([, t]) => t) : []);
  function usesLine(F) {
    const b = barOf();
    if (!b || !R) return;
    b.uses('cnUses', [b.yearsText(R.from, R.to) + (F && F.shift && (R.eFrom < R.from || R.eTo > R.to || R.lFrom > R.from) ? ' (the subject-area shift: ' + yrs(R.eFrom, R.eTo) + ' and ' + yrs(R.lFrom, R.lTo) + ')' : ''),
      b.shortText(), 'groups by ' + R.srcName, R.noHome ? 'a school’s own journals left out (so the own-review chart is not drawn)' : null,
      gone(F).length ? 'not drawn for too few articles in these years: ' + gone(F).join('; ') : null]);
  }
  function build() {
    if (drawn) return;
    drawn = true;
    const my = ++gen;
    const body = $('connectionsBody');
    if (!body) return;
    try {
      R = compute(DATA, META, barOf() ? barOf().get() : null);
    } catch (e) {
      body.replaceChildren(el('p', { class: 'text-muted' }, 'These figures could not be computed from this version of the data.'));
      return;
    }
    body.replaceChildren();
    const F = {};
    // each figure on its own: one that cannot be computed is left out, the others still drawn
    [['pairs', figPairs], ['home', figHome], ['tiers', figTiers], ['teams', figTeams], ['shift', figShift], ['few', figFew]].forEach(([k, f]) => {
      try { F[k] = f(); } catch (e) { F[k] = null; if (window.console) console.warn('connections: ' + k, e); }
    });
    try { usesLine(F); } catch (e) { /* the line under the heading names the years; the cards stand alone */ }
    try { lede(F); } catch (e) { /* the lede lists the figures; the cards stand alone */ }
    if (!Object.keys(F).some((k) => F[k])) {
      $('cnLede') && $('cnLede').replaceChildren();
      body.replaceChildren(el('p', { class: 'text-muted' }, 'Too few articles in the years chosen for these figures.'));
    }
    if (typeof Highcharts === 'undefined') { body.querySelectorAll('details.ins-table').forEach((d) => { d.open = true; }); figs.length = 0; }
    // one figure per frame, so drawing never holds up scrolling (a newer build stops an older one's frames)
    let i = 0;
    const next = () => {
      if (my !== gen || i >= figs.length) return;
      const f = figs[i++];
      try { f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted cn-none' }, 'The chart could not be drawn; the table below lists the numbers.')); }
      requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
    // drawn again when the width changes (a phone turned, a window resized)
    if (observed) return;
    observed = true;
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

  // the page's bar changed: computed and drawn again, if drawn already (else the first draw reads the bar)
  function rebuild() {
    if (!drawn) return;
    charts.splice(0).forEach((ch) => { try { ch.destroy(); } catch (e) { /* already gone */ } });
    figs.length = 0;
    drawn = false;
    build();
  }

  // (2026-10-26, the owner: "use lazy loading") computed and drawn when the section comes into view, or a few
  // seconds after the data is in, whichever is first; never before insights.js has shown the section
  function start() {
    const got = window.LSR_INS;
    if (!got || !got.DATA || DATA) return;
    DATA = got.DATA; META = got.META || {};
    if (got.bar) got.bar.on(rebuild, 'connections');   // (with its section: recomputed when near the screen)
    const sec = $('connections');
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
      setTimeout(() => { io.disconnect(); go(); }, 4500);
    } else setTimeout(go, 0);
  }
  document.addEventListener('lsr-insights-data', () => setTimeout(start, 0));
  if (window.LSR_INS) setTimeout(start, 0);
})();
