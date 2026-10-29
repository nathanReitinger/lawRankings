// Law School Rankings: the Insights page, section 6 "Does anonymous review change who gets in?" (2026-10-29, the owner:
// "research when journals went anonymous and show trends in publication around that time. some of the top law journals
// say they are anonymous. i think it is fake news. help me prove that with the data ... look at where people are
// publishing from in those years (diff in diff) between anon. and non-anon. years. run a stat test if you can get it to
// have the results displayed online"). A test of the claim either way, not of the hunch: the numbers are computed in
// the build (build_data.anonymous_review_analysis, data/insights.json 'anon': the flagship reviews that switched to
// anonymous or partly anonymous review in a dated year against the other flagship reviews, journal-years weighted by
// their articles, two-way fixed effects, an event study, a randomization test and robustness checks), from the
// reviews' own dated statements (anonymous_review_policies.csv); this file only draws them. insights.js hands the data
// over (window.LSR_INS, event 'lsr-insights-data'); the cards are drawn once the section comes into view, as in
// connections.js and equality.js.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n).toLocaleString('en-US');
  const MINUS = '−';
  const signed = (x, d) => (x > 0 ? '+' : x < 0 ? MINUS : '') + Math.abs(x).toFixed(d);
  const css = (name, dflt) => getComputedStyle(document.body).getPropertyValue(name).trim() || dflt;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtP = (p) => (p == null ? '–' : p < 0.001 ? '<0.001' : p.toFixed(3));
  const pIs = (p) => (p != null && p < 0.001 ? 'p < 0.001' : 'p = ' + fmtP(p));     // in a sentence

  // the four outcomes (insights.json anon.outcomes, the primary one first): shares are drawn in percentage points,
  // the mean rank in places (a higher number is a lower-ranked school)
  const SHORT = { t14: 'Top-14 share', t25: 'Top-25 share', rank: 'Mean school rank', own: 'Own-faculty share' };
  const SAY = { t14: 'articles by professors at top-14 schools', t25: 'articles by professors at top-25 schools',
    rank: 'the U.S. News rank of the authors’ schools', own: 'articles by the review’s own faculty' };
  let A = null, DATA = null, INS = null, drawn = false, outcome = 't14';
  const charts = [];
  const figs = [];        // { box, draw } for each chart, redrawn on resize and when the measure changes
  const isShare = (k) => (A.outcomes.find((o) => o.key === k) || {}).unit === 'share';
  const scale = (k) => (isShare(k) ? 100 : 1);
  const unitWord = (k, long) => (isShare(k) ? (long ? ' percentage points' : ' points') : (long ? ' places' : ' places'));
  const val = (k, v) => (v == null ? '–' : isShare(k) ? (100 * v).toFixed(1) + '%' : v.toFixed(1));
  const eff = (k, v) => (v == null ? '–' : signed(scale(k) * v, 1));
  const ci = (k, lo, hi) => (lo == null ? '–' : eff(k, lo) + ' to ' + eff(k, hi));
  const jname = (j) => (DATA && DATA.journals[j] ? DATA.journals[j][0] : '');
  const JSHORT = { 'U.C. Irvine Law Review': 'UC Irvine', 'New York University Law Review': 'NYU', 'University of Chicago Law Review': 'Chicago',
    'University of Pennsylvania Law Review': 'Penn', 'Northwestern University Law Review': 'Northwestern', 'Washington University Law Review': 'WashU',
    'UC Law Journal': 'UC Law Journal', 'Washington Law Review': 'Washington' };
  const jshort = (name) => JSHORT[name] || name.replace(/ Law (Review|Journal)$/, '').replace(/^University of /, '');
  const listSay = (xs) => (xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);

  // colors: the switching reviews in the page's flagship blue, the comparison reviews in its second ink (a pair with
  // ample contrast for every kind of color vision); the policy groups of the last card in the same family
  const C_SW = '#2a78d6', C_CMP = '#52514e';
  const ROLE = {
    'before': { label: 'Anonymous, no known start', color: '#104281' },
    'switched': { label: 'Switched (dated)', color: '#86b6ef' },
    'too recent': { label: 'Switched 2025', color: '#86b6ef' },
    'named': { label: 'Names authors (on record)', color: '#eb6834' },
    'no statement': { label: 'No anonymity statement found', color: '#f2a27f' },
    'unknown': { label: 'Not researched', color: '#c9c8c0' },
    'undated': { label: 'Anonymous, undated', color: '#104281' },
  };

  ////////////////////////////////////////////////////////////////////////// charts

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

  ////////////////////////////////////////////////////////////////////////// the cards

  function card(id, title, caption) {
    const fig = el('figure', { class: 'ins-card an-card', id: id });
    const cap = el('figcaption');
    const h = el('h3', null, title);
    const p = el('p', null, caption);
    cap.append(h, p);
    fig.appendChild(cap);
    const legend = el('div', { class: 'ins-legend an-legend' });
    const box = el('div', { class: 'ins-chart an-chart' });
    const foot = el('p', { class: 'ins-foot an-foot' });
    fig.append(legend, box, foot);
    $('anonymousBody').appendChild(fig);
    return { fig, h, p, legend, box, foot };
  }
  function details(parent, summary, open) {
    const d = el('details', { class: 'ins-table an-table' });
    if (open) d.open = true;
    d.appendChild(el('summary', null, summary));
    const tb = el('div');
    d.appendChild(tb);
    parent.appendChild(d);
    return { d, tb };
  }
  // a table; a cell is text, or [text, smaller text under it]; a row may carry {cls} as its last item; a column whose
  // heading ends in '*' is left out on a phone (anon.css .an-wide; the card's note has it in words)
  function table(tb, head, rows, cls) {
    const t = el('table', cls ? { class: cls } : null);
    const tr = el('tr');
    const wide = head.map((h) => /\*$/.test(h));
    head.forEach((h, i) => tr.appendChild(el('th', wide[i] ? { scope: 'col', class: 'an-wide' } : { scope: 'col' }, h.replace(/\*$/, ''))));
    t.appendChild(el('thead')).appendChild(tr);
    const body = el('tbody');
    rows.forEach((r) => {
      const x = el('tr');
      const last = r[r.length - 1];
      const cells = last && typeof last === 'object' && !Array.isArray(last) ? (x.className = last.cls || '', r.slice(0, -1)) : r;
      cells.forEach((v, i) => {
        const td = el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : wide[i] ? { class: 'an-wide' } : null);
        if (Array.isArray(v)) { td.appendChild(document.createTextNode(v[0])); td.appendChild(el('small', null, v[1])); } else td.textContent = v;
        x.appendChild(td);
      });
      body.appendChild(x);
    });
    t.appendChild(body);
    tb.replaceChildren(t);
    return t;
  }
  function noChart(c, d) {
    c.box.replaceChildren(el('p', { class: 'text-muted an-none' }, 'The chart could not be drawn here; the table below has every number.'));
    if (d) d.open = true;
  }
  function swatch(label, color, kind) {
    const s = el('span');
    const i = el('i', kind ? { class: kind } : null);
    if (color) i.style.background = color;
    s.append(i, document.createTextNode(label));
    return s;
  }

  // ---------------------------------------------------------------- 0. the verdict, in words
  function verdict(k) {
    const m = A.main[k];
    const strong = m.p < 0.05 && m.p_perm < 0.05;
    const some = !strong && Math.min(m.p, m.p_perm) < 0.05 && Math.max(m.p, m.p_perm) < 0.1;
    return { m, strong, some, none: !strong && !some };
  }

  function lede() {
    const box = $('anLede');
    if (!box) return;
    box.replaceChildren();
    const say = (t) => box.appendChild(document.createTextNode(t));
    const bold = (t) => box.appendChild(el('b', null, t));
    const C = A.counts, k = 't14', V = verdict(k), m = V.m;
    const sw = A.journals.filter((j) => j.role === 'switched'), recent = A.journals.filter((j) => j.role === 'too recent');
    const yrs = sw.map((j) => j.adopted), y0 = Math.min.apply(null, yrs), y1 = Math.max.apply(null, yrs);
    const fewer = m.est < 0;
    const old = A.journals.filter((j) => j.role === 'before');
    say('Some law reviews say they choose articles without knowing who wrote them. If that were only for show, a review that switched should go on taking the same authors. ' +
      'The data hold ' + num(sw.length + recent.length) + ' flagship reviews with a dated switch to anonymous or partly anonymous review: ' +
      listSay(sw.map((j) => jshort(j.name) + ' (' + j.adopted + ')')) + (recent.length ? ', and ' + listSay(recent.map((j) => jshort(j.name))) + ' in ' + recent[0].adopted + ', too recent to test' : '') + '. ');
    say('Compared with ' + num(C.comparison) + ' other flagship reviews over the same years, the share of the ' + sw.length + ' switchers’ faculty articles written by professors at top-14 schools went ');
    bold(Math.abs(100 * m.est).toFixed(1) + ' points ' + (fewer ? 'down' : 'up'));
    say(' after the switch (it was ' + val(k, m.treated_before) + ' before; 95% interval ' + ci(k, m.lo, m.hi) + ' points). ');
    say('A randomization test, which hands the same switch years to reviews that never switched, gives ' + pIs(m.p_perm) + '; the usual clustered test gives ' + pIs(m.p) + '. ');
    // does it rest on one review?
    const drops = (A.robust[k] || []).filter((r) => /^drop/.test(r.key));
    const weak = drops.filter((r) => (r.p_perm != null ? r.p_perm : r.p) >= 0.05).sort((a, b) => Math.abs(a.est) - Math.abs(b.est));
    if (!V.none && weak.length) {
      const r = weak[0], who = r.label.replace(/^Without /, '');
      say('It leans on ' + jshort(who) + ': without it the change is ' + eff(k, r.est) + ' points and could be chance. ');
    }
    if (!V.none && fewer) say('So these data do not bear out calling the policies fake: where a switch can be dated, the reviews moved away from top-14 authors' + (V.some ? ', though the evidence is borderline. ' : '. '));
    else if (!V.none) say('The change runs the opposite way from what anonymity is meant to do. ');
    else say('The test cannot tell this from no change: it would reliably catch only a change of about ' + (100 * m.mde).toFixed(0) + ' points or more, so it neither shows the policies work nor that they are fake. ');
    say('A test on ' + sw.length + ' reviews cannot settle it, though: the switches came in ' + y0 + '–' + y1 + ' alongside other changes, partial policies still show editors a CV, and authors are placed at the school where they teach now. ' +
      (old.length ? listSay(old.map((j) => jshort(j.name))) + ', anonymous with no known start (the earliest records: ' + listSay(old.map((j) => j.adopted)) + '), cannot be tested this way; the last chart compares them with their peers.' : ''));
  }

  // ---------------------------------------------------------------- 1. three numbers
  function tiles() {
    const box = el('div', { class: 'ins-tiles an-tiles' });
    const add = (v, small, l) => {
      const d = el('div', { class: 'ins-tile' });
      const vv = el('div', { class: 'v' }, v);
      if (small) vv.appendChild(el('small', null, small));
      d.append(vv, el('div', { class: 'l' }, l));
      box.appendChild(d);
    };
    const m = A.main.t14, C = A.counts;
    add(eff('t14', m.est), ' points', 'change in the share of articles by top-14 professors after a switch, against the other flagship reviews (95% interval ' + ci('t14', m.lo, m.hi) + ')');
    add(fmtP(m.p_perm), null, 'randomization p-value (' + num(A.draws) + ' placebo switches; clustered ' + pIs(m.p) + ')');
    add(num(C.treated), ' reviews', 'switched with a dated policy and have volumes chosen after it (' + num(C.treated_articles_after) + ' articles); ' + num(C.comparison) + ' flagship reviews compared');
    $('anonymousBody').appendChild(box);
  }

  // ---------------------------------------------------------------- 2. the estimates, every measure
  function figMain() {
    const C = A.counts;
    const c = card('anMain', 'The test: each measure, after a switch against before, compared with the other reviews',
      'Each row is a difference in differences: how much a measure changed at the ' + C.treated + ' switching reviews from before their switch to after it, minus how much it changed at the ' +
      num(C.comparison) + ' comparison reviews over the same years (two-way fixed effects for review and year, ' + A.since + '–' + A.last + ', each review-year weighted by its articles). ' +
      '“After” starts with the first volume chosen under the policy, the year after the switch. The top-14 share was picked as the main measure before any estimate was looked at; the others are secondary.');
    c.legend.remove(); c.box.remove();
    const rows = A.outcomes.map((o) => {
      const m = A.main[o.key];
      return [[SHORT[o.key] + (o.primary ? ' (main)' : ''), o.label], val(o.key, m.treated_before), [eff(o.key, m.est) + unitWord(o.key), ci(o.key, m.lo, m.hi)], fmtP(m.p), fmtP(m.p_perm),
        '±' + (scale(o.key) * m.mde).toFixed(1), o.primary ? { cls: 'an-primary' } : {}];
    });
    const T = el('div', { class: 'an-scroll' });
    c.fig.insertBefore(T, c.foot);
    table(T, ['Measure', 'Before', 'Change (95% interval)', 'p, clustered', 'p, random\u00ADization', 'Detectable*'], rows, 'an-main');
    const m = A.main.t14;
    c.foot.textContent = 'Reviews: ' + C.treated + ' switching, ' + num(C.comparison) + ' comparison (' + C.comparison_on_record + ' on record as naming authors or with no anonymity statement, the rest not researched); ' +
      num(C.journal_years) + ' review-years and ' + num(C.articles) + ' articles. Before: the switching reviews’ level before their switch. Clustered: standard errors clustered by review. With only ' + C.treated + ' switching reviews those can be too small, so the randomization p-value is the safer one: ' +
      'it gives the same switch years to ' + num(A.draws) + ' random sets of comparison reviews of top-' + A.placebo_top + ' schools (from ' + m.placebo_pool + ') and counts how often the placebo change is as large. ' +
      'Detectable: the smallest true change the test would catch four times in five (2.8 standard errors): ' + A.outcomes.map((o) => SHORT[o.key].toLowerCase() + ' ±' + (scale(o.key) * A.main[o.key].mde).toFixed(1) + unitWord(o.key)).join(', ') +
      '. Mean school rank: a higher number means authors from lower-ranked schools.';
  }

  // the measure chosen for the next three cards
  function picker() {
    const row = el('div', { class: 'ins-row an-pick' });
    const lab = el('span', { class: 'an-pick-l' }, 'Measure for the charts below:');
    const seg = el('div', { class: 'ins-seg', role: 'radiogroup', 'aria-label': 'Measure for the charts below' });
    A.outcomes.forEach((o) => {
      const b = el('button', { type: 'button', 'data-k': o.key, 'aria-pressed': String(o.key === outcome) }, SHORT[o.key] + (o.primary ? ' (main)' : ''));
      b.addEventListener('click', () => {
        if (outcome === o.key) return;
        outcome = o.key;
        seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === outcome)));
        texts.forEach((f) => f());
        drawAll();
      });
      seg.appendChild(b);
    });
    row.append(lab, seg);
    $('anonymousBody').appendChild(row);
  }
  const texts = [];       // the cards' words that follow the chosen measure

  // ---------------------------------------------------------------- 3. the event study
  function figEvent() {
    const c = card('anEvent', '', '');
    const E = () => A.event[outcome];
    const lab = (e) => (e === -A.bin ? '≤' + MINUS + A.bin : e === A.bin ? '≥' + A.bin : e < 0 ? MINUS + Math.abs(e) : e === 0 ? '0' : '+' + e);
    const T = details(c.fig, 'The numbers, by year since the switch');
    const words = () => {
      const k = outcome, ev = E(), V = verdict(k);
      const pre = (ev.pretest_p_perm != null ? ev.pretest_p_perm : ev.pretest_p) >= 0.1 ? 'the switchers moved with the other reviews' : 'the switchers were already moving apart';
      const post = V.none ? 'after it, any gap is within chance' : k === 'rank' ? 'after it, their authors came from ' + (V.m.est > 0 ? 'lower' : 'higher') + '-ranked schools'
        : 'after it, they took ' + (V.m.est < 0 ? 'fewer' : 'more') + ' ' + SAY[k];
      c.h.textContent = 'Year by year: before the switch ' + pre + '; ' + post;
      c.p.textContent = 'Each dot is how far the switching reviews were from the comparison reviews in a year counted from the switch, against the year before the switch (set to 0), in ' + SHORT[k].toLowerCase() +
        (isShare(k) ? ' (percentage points)' : ' (places)') + ', with its 95% interval. Years six or more before or after are pooled at the ends. The switch year itself (0) mostly holds articles chosen before the policy. Dots near 0 on the left mean the two groups moved together before the switch, which is what the comparison needs.';
      const lp = ev.pretest_p, lpr = ev.pretest_p_perm;
      c.foot.textContent = 'Did the switchers move differently before the switch? A joint test of the ' + ev.pretest_df + ' earlier years gives clustered ' + pIs(lp) +
        (lpr != null ? ' and randomization ' + pIs(lpr) : '') + '. ' + (lp < 0.05 && lpr != null && lpr >= 0.1 ? 'With so few switching reviews the clustered test is the one to distrust; against placebo switches the earlier years look ordinary. ' : '') +
        'The intervals are wide because each year rests on ' + Math.min.apply(null, ev.reviews) + '–' + Math.max.apply(null, ev.reviews) + ' reviews and about ' + num(Math.round(ev.articles.slice(1, -1).reduce((s, x) => s + x, 0) / (ev.articles.length - 2))) + ' articles.';
      table(T.tb, ['Years since the switch', 'Estimate', '95% interval', 'Reviews', 'Articles'],
        ev.e.map((e, i) => [lab(e) + (e === -1 ? ' (reference)' : ''), e === -1 ? '0' : eff(k, ev.b[i]), e === -1 ? '–' : ci(k, ev.lo[i], ev.hi[i]), num(ev.reviews[i]), num(ev.articles[i])]));
    };
    texts.push(words);
    words();
    c.legend.append(swatch('Before the switch', C_CMP, 'dot'), swatch('After (from the first volume chosen under it)', C_SW, 'dot'), swatch('Reference year', '#ffffff', 'dot ring'));
    if (!has('errorbar') || !has('scatter')) { noChart(c, T.d); return; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560, k = outcome, ev = E(), s = scale(k);
      const rule = css('--axis', '#c3c2b7'), plane = css('--plane', '#f7f7f5');
      const color = (e) => (e >= 1 ? C_SW : C_CMP);
      const pts = ev.e.map((e, i) => ({ x: e, y: s * ev.b[i], color: color(e), custom: i,
        marker: e === -1 ? { fillColor: '#ffffff', lineColor: C_CMP, lineWidth: 1.5 } : undefined }));
      makeChart(c.box, {
        chart: { height: narrow ? 300 : 360 },
        accessibility: { description: 'Event study: the difference between switching and comparison reviews in ' + SHORT[k] + ', by year since the switch, with 95% intervals. The table below has every number.' },
        xAxis: { min: -A.bin - 0.5, max: A.bin + 0.5, tickPositions: ev.e, labels: { formatter() { return lab(this.value); }, autoRotation: false, padding: 0,
          style: { fontSize: narrow ? '10px' : '11.5px', textOverflow: 'none', whiteSpace: 'nowrap' } },
          title: { text: narrow ? 'Years since the switch' : 'Years since the switch (volume year minus switch year)' },
          plotBands: [{ from: 0.5, to: A.bin + 0.5, color: plane, label: { text: 'after', align: 'left', x: 6, y: 14, style: { color: css('--muted', '#898781'), fontSize: '11.5px' } } }] },
        yAxis: { title: { text: narrow ? null : (isShare(k) ? 'Difference, percentage points' : 'Difference, places') },
          labels: { formatter() { return (this.value > 0 ? '+' : this.value < 0 ? MINUS : '') + Math.abs(this.value); } },
          plotLines: [{ value: 0, color: rule, width: 1.5, zIndex: 2 }] },
        tooltip: { formatter() {
          const i = this.point.custom != null ? this.point.custom : this.point.index, e = ev.e[i];
          const when = e === -1 ? 'The year before the switch (the reference)' : e === 0 ? 'The switch year' : e <= -A.bin ? A.bin + ' or more years before' : e >= A.bin ? A.bin + ' or more years after' :
            Math.abs(e) + (Math.abs(e) === 1 ? ' year ' : ' years ') + (e < 0 ? 'before' : 'after');
          return '<b>' + when + '</b><br>' + (e === -1 ? '0 by construction' : 'Difference: <b>' + eff(k, ev.b[i]) + unitWord(k) + '</b><br>95% interval ' + ci(k, ev.lo[i], ev.hi[i])) +
            '<br>' + ev.reviews[i] + ' reviews, ' + num(ev.articles[i]) + ' articles';
        } },
        series: [
          { type: 'errorbar', name: '95% interval', data: ev.e.map((e, i) => ({ x: e, low: s * ev.lo[i], high: s * ev.hi[i], color: color(e), custom: i })).filter((p) => ev.e[p.custom] !== -1),
            whiskerLength: narrow ? 6 : 10, stemWidth: 1.5, whiskerWidth: 1.5, enableMouseTracking: false, states: { inactive: { opacity: 1 } } },
          { type: 'scatter', name: 'Difference', data: pts, marker: { symbol: 'circle', radius: narrow ? 4 : 5, lineWidth: 1, lineColor: '#ffffff' }, zIndex: 3 },
        ],
      }, W);
    } });
  }

  // ---------------------------------------------------------------- 4. the trends, and each switching review
  function figTrend() {
    const c = card('anTrend', '', '');
    const T = details(c.fig, 'The numbers, by year');
    const R = details(c.fig, 'Each switching review, before and after', false);
    const sw = A.journals.filter((j) => j.role === 'switched'), yrs = sw.map((j) => j.adopted);
    const y0 = Math.min.apply(null, yrs), y1 = Math.max.apply(null, yrs);
    const words = () => {
      const k = outcome, t = A.trend[k];
      c.h.textContent = SHORT[k] + ', switching reviews and the rest, ' + A.since + '–' + A.last;
      c.p.textContent = 'Per volume year, the ' + sw.length + ' switching reviews pooled (each article once) and the ' + num(A.counts.comparison) + ' comparison reviews pooled: ' + SAY[k] +
        (k === 'rank' ? ' (each article the mean over its authors; lower is a higher-ranked school)' : '') + '. The shaded years are when the ' + sw.length + ' switched (' + y0 + '–' + y1 + '). ' +
        'The levels differ, as the reviews do; the test asks whether the gap between the lines changed after the switches. ' + A.last + ' is still coming out.';
      table(T.tb, ['Year', 'Switching', 'Articles', 'Comparison', 'Articles'],
        t.years.map((y, i) => { const a = t.switched[i], b = t.comparison[i]; return [String(y), a ? val(k, a[0]) : '–', a ? num(a[1]) : '0', b ? val(k, b[0]) : '–', b ? num(b[1]) : '0']; }));
      const P = A.per_journal[k];
      table(R.tb, ['Review (switch)', 'Before', 'After', 'Comparison before → after', 'Difference'],
        P.map((r) => [[jname(r.j) + ' (' + A.journals.find((x) => x.j === r.j).adopted + ')', r.years_before[0] + '–' + r.years_before[1] + ' vs ' + r.years_after[0] + '–' + r.years_after[1]],
          r.before ? [val(k, r.before[0]), num(r.before[1]) + ' articles'] : '–', r.after ? [val(k, r.after[0]), num(r.after[1]) + ' articles'] : '–',
          r.cmp_before && r.cmp_after ? val(k, r.cmp_before[0]) + ' → ' + val(k, r.cmp_after[0]) : '–', r.diff == null ? '–' : eff(k, r.diff) + unitWord(k)]));
      R.tb.insertBefore(el('p', { class: 'an-note' }, 'Before: the six volume years before the switch (fewer where the review is younger); after: from the first volume chosen under the policy. Difference: the review’s change minus the comparison reviews’ change over the same years (a plain difference in differences, one review at a time; not the regression above).'), R.tb.firstChild);
    };
    texts.push(words);
    words();
    c.legend.append(swatch('Switching reviews (' + sw.length + ')', C_SW), swatch('Comparison reviews (' + num(A.counts.comparison) + ')', C_CMP), swatch('Switch years', css('--plane', '#f7f7f5'), 'box an-band'));
    if (!has('line')) { noChart(c, T.d); return; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560, k = outcome, t = A.trend[k], s = scale(k);
      const ser = (key, name, color) => ({ type: 'line', name: name, color: color, lineWidth: 2, data: t.years.map((y, i) => (t[key][i] ? { x: y, y: s * t[key][i][0], custom: i } : { x: y, y: null })),
        marker: { enabled: true, symbol: 'circle', radius: narrow ? 2.5 : 3, lineWidth: 1, lineColor: '#ffffff' } });
      makeChart(c.box, {
        chart: { height: narrow ? 280 : 340 },
        accessibility: { description: SHORT[k] + ' per year for the switching reviews and the comparison reviews. The table below has every number.' },
        xAxis: { tickInterval: narrow ? 4 : 2, plotBands: [{ from: y0 - 0.5, to: y1 + 0.5, color: css('--plane', '#f7f7f5') }], crosshair: { color: css('--axis', '#c3c2b7'), width: 1 } },
        yAxis: { title: { text: narrow ? null : (isShare(k) ? 'Share of articles' : 'Mean U.S. News rank') }, labels: { format: isShare(k) ? '{value}%' : '{value}' }, reversed: false, min: isShare(k) ? 0 : null },
        tooltip: { shared: true, formatter() {
          const i = this.points[0].point.custom;
          return '<b>' + t.years[i] + '</b><br>' + this.points.map((p) => {
            const row = p.series.index === 0 ? t.switched[i] : t.comparison[i];
            return '<span style="color:' + p.series.color + '">●</span> ' + esc(p.series.name) + ': <b>' + val(k, row[0]) + '</b> (' + num(row[1]) + ' articles, ' + row[2] + ' reviews)';
          }).join('<br>');
        } },
        series: [ser('switched', 'Switching reviews', C_SW), ser('comparison', 'Comparison reviews', C_CMP)],
      }, W);
    } });
  }

  // ---------------------------------------------------------------- 5. robustness
  const ROB_SHORT = { main: 'Main estimate', stacked: 'Stacked DiD', switch_year: 'Switch year as after', top50: 'Top-50 comparisons', evidence: 'On-record comparisons',
    fully: 'Fully anonymous only', unweighted: 'Unweighted', since2000: 'From 2000' };
  const ROB_NARROW = { switch_year: 'Switch year after', top50: 'Top-50 only', evidence: 'On-record only', fully: 'Fully anonymous' };
  const robLabel = (r, narrow) => (narrow && ROB_NARROW[r.key]) || ROB_SHORT[r.key] ||
    (/^drop/.test(r.key) ? 'Without ' + (narrow ? jshort(r.label.replace(/^Without /, '')).replace(/ Journal$/, ' J.') : jshort(r.label.replace(/^Without /, ''))) : r.label);
  function figRobust() {
    const c = card('anRobust', '', '');
    const T = details(c.fig, 'The numbers');
    const rows = () => [Object.assign({ key: 'main', label: 'The main estimate (above)' }, A.main[outcome])].concat(A.robust[outcome]);
    const words = () => {
      const k = outcome, R = rows();
      const others = R.slice(1), same = others.filter((r) => Math.sign(r.est) === Math.sign(R[0].est)).length;
      const withP = others.filter((r) => r.p_perm != null), sig = withP.filter((r) => r.p_perm < 0.05).length;
      c.h.textContent = 'Checks' + (k === 't14' ? '' : ' (' + SHORT[k].toLowerCase() + ')') + ': ' + same + ' of ' + others.length + ' point the same way as the main estimate; ' +
        sig + ' of ' + withP.length + ' have a randomization p-value below 0.05';
      c.p.textContent = 'The same comparison done other ways. The stacked difference-in-differences runs each switch year as its own experiment against reviews that do not switch within six years, so no review that has already switched serves as a control (the worry with staggered switches). ' +
        'The others change the comparison reviews, which switchers count, the weighting, or the years, and leave out one switching review at a time. Rows resting on two switching reviews are the least reliable; the randomization p-value is the safer guide throughout.';
      table(T.tb, ['Check', 'Change (95% interval)', 'p, clustered', 'p, random\u00ADization', 'Reviews'],
        R.map((r, i) => [[robLabel(r), r.label], [eff(k, r.est) + unitWord(k), ci(k, r.lo, r.hi)], fmtP(r.p), r.p_perm == null ? '–' : fmtP(r.p_perm), [r.n_treated + ' / ' + num(r.n_control), 'switching / comparison'], i === 0 ? { cls: 'an-primary' } : {}]), 'an-rob');
      c.foot.textContent = 'Stacked: no randomization p-value (its placebo would need the stacking redone each draw). Unweighted: each review-year with 5 or more articles counts once, however many articles it has.';
    };
    texts.push(words);
    words();
    c.legend.append(swatch('Estimate and 95% interval', C_SW, 'dot'), swatch('Main estimate', css('--ink-2', '#52514e'), 'dash'));
    if (!has('errorbar') || !has('scatter')) { noChart(c, T.d); return; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560, k = outcome, s = scale(k), R = rows();
      makeChart(c.box, {
        chart: { inverted: true, height: 46 + R.length * (narrow ? 24 : 26), marginLeft: narrow ? 132 : 190 },
        accessibility: { description: 'Each robustness check’s estimate of the change in ' + SHORT[k] + ' with its 95% interval. The table below has every number.' },
        xAxis: { categories: R.map((r) => robLabel(r, narrow)), labels: { style: { fontSize: narrow ? '11px' : '12px', color: css('--ink-2', '#52514e'), textOverflow: 'ellipsis' }, step: 1 }, tickLength: 0, lineWidth: 0 },
        yAxis: { title: { text: narrow ? null : (isShare(k) ? 'Change, percentage points' : 'Change, places') }, labels: { formatter() { return (this.value > 0 ? '+' : this.value < 0 ? MINUS : '') + Math.abs(this.value); } },
          plotLines: [{ value: 0, color: css('--axis', '#c3c2b7'), width: 1.5, zIndex: 2 }, { value: s * R[0].est, color: css('--ink-2', '#52514e'), width: 1, dashStyle: 'Dash', zIndex: 2 }] },
        tooltip: { formatter() {
          const r = R[this.point.index];
          return '<b>' + esc(r.label) + '</b><br>Change: <b>' + eff(k, r.est) + unitWord(k) + '</b><br>95% interval ' + ci(k, r.lo, r.hi) + '<br>p ' + fmtP(r.p) + ' clustered' + (r.p_perm != null ? ', ' + fmtP(r.p_perm) + ' randomization' : '') +
            '<br>' + r.n_treated + ' switching, ' + num(r.n_control) + ' comparison reviews';
        } },
        series: [
          { type: 'errorbar', data: R.map((r) => [s * r.lo, s * r.hi]), color: C_SW, whiskerLength: narrow ? 6 : 8, stemWidth: 1.5, whiskerWidth: 1.5, enableMouseTracking: false, states: { inactive: { opacity: 1 } } },
          { type: 'scatter', data: R.map((r, i) => ({ x: i, y: s * r.est, color: i === 0 ? css('--ink', '#0b0b0b') : C_SW })), marker: { symbol: 'circle', radius: narrow ? 4 : 4.5, lineWidth: 1, lineColor: '#ffffff' }, zIndex: 3 },
        ],
      }, W);
    } });
  }

  // ---------------------------------------------------------------- 6. the reviews and their policies
  function figList() {
    const c = card('anList', 'The law reviews and what they say about anonymous review',
      'Every flagship review whose submission policy was looked up, from its own pages (current or archived), its editors’ accounts, or published studies. A year is counted as a switch only when the review announced it, its editors reported it, or archived pages show the policy absent and then present; ' +
      'an “earliest” year is only the first time the policy shows up, and it may be much older. Flagship reviews not listed here were not looked up and count as comparison reviews.');
    c.legend.remove(); c.box.remove(); c.foot.remove();
    const groups = [
      ['switched', 'Switched in a dated year: the test', 0],
      ['too recent', 'Switched too recently to test (a comparison review until then)', 0],
      ['before', 'Anonymous, but only the earliest record is known: left out of the test', 0],
      ['undated', 'Anonymous, no date at all: left out of the test', 0],
      ['named', 'On record as asking for names or CVs: comparison reviews', 1],
      ['no statement', 'No anonymity statement found: comparison reviews', 1],
      ['unknown', 'Article policy not found: comparison reviews', 1],
    ];
    const wrap = [el('div', { class: 'an-list' }), el('div', { class: 'an-list' })];
    let ul = null;
    groups.forEach(([role, title, part]) => {
      const js = A.journals.filter((j) => j.role === role);
      if (!js.length) return;
      wrap[part].appendChild(el('h4', null, title + ' (' + js.length + ')'));
      ul = el('ul');
      wrap[part].appendChild(ul);
      js.forEach((j) => {
        const li = el('li');
        const head = el('div', { class: 'an-li-h' });
        head.appendChild(el('b', null, j.name));
        const bits = [j.school_rank ? 'school ranked ' + j.school_rank : 'unranked school'];
        if (j.adopted) bits.push((role === 'switched' || role === 'too recent' ? 'switched ' : 'earliest ') + j.adopted);
        if (j.policy && !/^(not anonymous|unknown|no anonymity)/.test(j.policy)) bits.push(j.policy);
        if (j.confidence) bits.push(j.confidence + ' confidence');
        head.appendChild(el('span', { class: 'an-meta' }, ' · ' + bits.join(' · ')));
        li.appendChild(head);
        const basis = el('p', { class: 'an-basis' }, j.basis.charAt(0).toUpperCase() + j.basis.slice(1) + '. ');
        if (/^https?:\/\//.test(j.url)) {
          const a = el('a', { href: j.url, rel: 'noopener', target: '_blank' }, 'Source');
          basis.appendChild(a);
        }
        li.appendChild(basis);
        ul.appendChild(li);
      });
    });
    c.fig.appendChild(wrap[0]);
    const n1 = A.journals.filter((j) => ['named', 'no statement', 'unknown'].includes(j.role)).length;
    if (n1) {
      const D = details(c.fig, 'The ' + num(n1) + ' comparison reviews on the list');
      D.tb.replaceChildren(wrap[1]);
      D.tb.classList.add('an-list-box');
    }
  }

  // ---------------------------------------------------------------- 7. the reviews anonymous all along: a description
  function figHome() {
    const H = A.home, rv = H.reviews.filter((r) => r.ratio != null).slice().sort((a, b) => a.ratio - b.ratio || jname(a.j).localeCompare(jname(b.j)));
    if (!rv.length) return;
    const anon = rv.filter((r) => r.role === 'before');
    const named = rv.filter((r) => r.role === 'named' || r.role === 'no statement');
    const med = (xs) => { const s = xs.map((r) => r.ratio).sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
    const mn = med(named), below = anon.filter((r) => r.ratio < mn).length, above = anon.filter((r) => r.ratio > mn).length;
    const who = listSay(anon.map((r) => jshort(jname(r.j))));
    const c = card('anHome', (anon.length ? who + ' cannot be tested this way; their home-faculty edge is ' + (below === anon.length ? 'among the smaller ones' : above === anon.length ? 'among the larger ones' : 'mixed') : 'The home-faculty edge at the top-14 reviews'),
      (anon.length ? 'Their policies have no known start (the earliest records: ' + listSay(anon.map((r) => jshort(jname(r.j)) + ' ' + r.adopted)) + '), so there is no before and after. ' : '') +
      'As a description only: for each review of a top-14 school (' + rv.length + ' reviews, ties kept), how much more often its own school’s faculty appear in it than in the other top-14 reviews, ' +
      H.window[0] + '–' + H.window[1] + ': the share of its faculty-authored articles with an author on its own faculty, divided by that faculty’s share of the other reviews’ articles. 1 would be no home edge. ' +
      'A home edge is not proof of favoritism (faculty may send their work home first, and some reviews give their own faculty a guaranteed read), and the reviews differ in more than policy.');
    const lg = {}, swYears = [];
    rv.forEach((r) => { const k = r.role === 'too recent' ? 'switched' : r.role; lg[k] = 1; if (k === 'switched' && swYears.indexOf(r.adopted) < 0) swYears.push(r.adopted); });
    Object.keys(ROLE).filter((k) => lg[k]).forEach((k) => c.legend.appendChild(swatch(k === 'switched' ? 'Switched (' + swYears.sort().join(', ') + ')' : ROLE[k].label, ROLE[k].color, 'box')));
    c.legend.appendChild(swatch('95% interval', css('--ink-2', '#52514e'), 'line'));
    const fmtR = (x) => (x == null ? '–' : x.toFixed(1) + '×');
    const lo = Math.min.apply(null, rv.map((r) => r.own)), hi = Math.max.apply(null, rv.map((r) => r.own));
    c.foot.textContent = (anon.length ? 'Median home edge: ' + fmtR(med(anon)) + ' for the ' + anon.length + ' anonymous reviews with no known start (' + listSay(anon.map((r) => jshort(jname(r.j)) + ' ' + fmtR(r.ratio))) + '), ' +
      fmtR(mn) + ' for the ' + named.length + ' on record as naming authors or with no anonymity statement. ' : '') +
      (rv.every((r) => r.ratio_lo != null && r.ratio_lo > 1) ? 'Every review’s edge is above 1, anonymous or not, beyond chance. ' : '') +
      'The intervals are wide: the reviews had ' + num(lo) + ' to ' + num(hi) + ' articles by their own faculty in these years.';
    const T = details(c.fig, 'The numbers');
    table(T.tb, ['Review', 'Policy', 'Own faculty', 'Elsewhere', 'Home edge'],
      rv.slice().reverse().map((r) => [jname(r.j), ROLE[r.role] ? (r.role === 'switched' || r.role === 'too recent' ? 'Switched ' + r.adopted : ROLE[r.role].label) : r.role,
        [(100 * r.share).toFixed(1) + '%', num(r.own) + ' of ' + num(r.articles)], [(100 * r.elsewhere_share).toFixed(1) + '%', num(r.elsewhere) + ' of ' + num(r.elsewhere_articles)],
        [fmtR(r.ratio), r.ratio_lo != null ? r.ratio_lo.toFixed(1) + '–' + r.ratio_hi.toFixed(1) : '']]), 'an-home');
    T.tb.insertBefore(el('p', { class: 'an-note' }, 'Own faculty: the review’s faculty-authored articles with an author on its own school’s faculty. Elsewhere: that faculty’s articles in the other top-14 reviews, of all their faculty-authored articles. Home edge: the first share over the second, with a 95% interval.'), T.tb.firstChild);
    if (!has('bar') || !has('errorbar')) { noChart(c, T.d); return; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      makeChart(c.box, {
        chart: { type: 'bar', height: 40 + rv.length * (narrow ? 24 : 26), marginLeft: narrow ? 104 : 270 },
        accessibility: { description: 'Bars: each top-14 review’s home edge (its own faculty’s share of its articles over that faculty’s share of the other top-14 reviews), with 95% intervals, colored by anonymous-review policy. The table below has every number.' },
        xAxis: { categories: rv.map((r) => (narrow ? jshort(jname(r.j)) : jname(r.j))), labels: { style: { fontSize: narrow ? '11px' : '12px', color: css('--ink-2', '#52514e') }, step: 1 }, tickLength: 0, lineWidth: 0 },
        yAxis: { min: 0, title: { text: narrow ? null : 'Home edge (1 = none)' }, labels: { format: '{value}×' }, plotLines: [{ value: 1, color: css('--ink-2', '#52514e'), width: 1, dashStyle: 'Dash', zIndex: 3 }] },
        tooltip: { formatter() {
          const r = rv[this.point.index];
          return '<b>' + esc(jname(r.j)) + '</b><br>Home edge <b>' + fmtR(r.ratio) + '</b>' + (r.ratio_lo != null ? ' (95% ' + r.ratio_lo.toFixed(1) + '–' + r.ratio_hi.toFixed(1) + ')' : '') +
            '<br>Own faculty: ' + num(r.own) + ' of ' + num(r.articles) + ' articles (' + (100 * r.share).toFixed(1) + '%)<br>In the other top-14 reviews: ' + num(r.elsewhere) + ' of ' + num(r.elsewhere_articles) + ' (' + (100 * r.elsewhere_share).toFixed(1) + '%)';
        } },
        plotOptions: { bar: { borderWidth: 0, borderRadius: 2, pointPadding: 0.12, groupPadding: 0.06 } },
        series: [
          { type: 'bar', data: rv.map((r) => ({ y: r.ratio, color: (ROLE[r.role] || ROLE.unknown).color })) },
          { type: 'errorbar', data: rv.map((r) => (r.ratio_lo != null ? [r.ratio_lo, r.ratio_hi] : null)), color: css('--ink-2', '#52514e'), whiskerLength: narrow ? 5 : 7, stemWidth: 1, whiskerWidth: 1, enableMouseTracking: false, states: { inactive: { opacity: 1 } } },
        ],
      }, W);
    } });
  }

  // ---------------------------------------------------------------- 8. what this can and cannot show
  function caveats() {
    const C = A.counts, ev = A.event.t14;
    const yrs = A.journals.filter((j) => j.role === 'switched').map((j) => j.adopted);
    const quiet = (ev.pretest_p_perm != null ? ev.pretest_p_perm : ev.pretest_p) >= 0.1;
    const box = el('div', { class: 'ins-card an-card an-limits' });
    box.appendChild(el('h3', null, 'What this can and cannot show'));
    const ul = el('ul');
    [
      'Authors are credited to the school where they teach now, not where they taught when the article came out: a professor who published in 2015 and later moved to a top-14 school counts as top-14 in 2015. Older years therefore look more top-14 than they were. The year fixed effects take out what all reviews share; a review whose authors move up more often than others’ could still drift on its own, and ' +
        (quiet ? 'the years before the switches show no such drift for the switchers.' : 'the years before the switches do show the switchers moving apart, so read the estimate with care.'),
      'Only ' + C.treated + ' reviews switched in a dated year with volumes chosen after it, all in ' + Math.min.apply(null, yrs) + '–' + Math.max.apply(null, yrs) + '. A test this small can miss a real change and can be swayed by one review; the leave-one-out rows show by how much.',
      'Anonymity cannot be told apart from anything else the same reviews changed at the same time, such as the diversity commitments many reviews made in 2020.',
      (() => {
        const sw = A.journals.filter((j) => j.role === 'switched'), n = (re) => sw.filter((j) => re.test(j.policy)).length;
        return 'Of the ' + sw.length + ' switchers’ policies, ' + n(/^partially/) + ' are partial (editors still see a CV at some stage), ' + n(/track$/) + ' is an optional track and ' + n(/^fully/) +
          ' are fully anonymous. A weak effect may mean a policy leaks rather than that it is fake, and a strong one does not show which stage of review made the difference.';
      })(),
      'The comparison reviews were mostly not looked up (' + num(C.comparison_unknown) + ' of ' + num(C.comparison) + '). If some quietly went anonymous too, the test understates any change.',
      'Counted are research articles by current faculty of U.S. law schools, the people this site ranks; articles by practitioners, students, foreign scholars or those who left teaching are not, so a review that took more of them after switching would not show it here.',
    ].forEach((t) => ul.appendChild(el('li', null, t)));
    box.appendChild(ul);
    $('anonymousBody').appendChild(box);
  }

  ////////////////////////////////////////////////////////////////////////// drawing

  function drawAll() {
    charts.splice(0).forEach((ch) => { try { ch.destroy(); } catch (e) { /* already gone */ } });
    figs.forEach((f) => { try { f.box.replaceChildren(); f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted an-none' }, 'The chart could not be drawn; the table below has every number.')); } });
  }

  function build() {
    if (drawn) return;
    drawn = true;
    const body = $('anonymousBody');
    if (!body) return;
    if (!A || !A.main || !A.main.t14) {
      body.replaceChildren(el('p', { class: 'text-muted' }, 'This analysis is not in this version of the data.'));
      return;
    }
    body.replaceChildren();
    try { lede(); } catch (e) { if (window.console) console.warn('anon: lede', e); }
    [tiles, figMain, picker, figEvent, figTrend, figRobust, figList, figHome, caveats].forEach((f) => {
      try { f(); } catch (e) { if (window.console) console.warn('anon: ' + f.name, e); }
    });
    if (typeof Highcharts === 'undefined') { body.querySelectorAll('details.ins-table').forEach((d) => { d.open = true; }); figs.length = 0; }
    // one figure per frame, so drawing never holds up scrolling
    let i = 0;
    const next = () => {
      if (i >= figs.length) return;
      const f = figs[i++];
      try { f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted an-none' }, 'The chart could not be drawn; the table below has every number.')); }
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

  // (2026-10-26, the owner: "use lazy loading") drawn when the section comes into view, or a few seconds after the
  // data is in, whichever is first; never before insights.js has shown the section
  function start() {
    const got = window.LSR_INS;
    if (!got || !got.INS || INS) return;
    INS = got.INS; DATA = got.DATA; A = INS.anon || null;
    const sec = $('anonymous');
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
      setTimeout(() => { io.disconnect(); go(); }, 6500);
    } else setTimeout(go, 0);
  }
  document.addEventListener('lsr-insights-data', () => setTimeout(start, 0));
  if (window.LSR_INS) setTimeout(start, 0);
})();
