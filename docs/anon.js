// Law School Rankings: the Insights page, section 6 "Does anonymous review change who gets in?" (2026-10-29, the owner:
// "research when journals went anonymous and show trends in publication around that time ... look at where people are
// publishing from in those years (diff in diff) between anon. and non-anon. years. run a stat test if you can get it to
// have the results displayed online"). A test of the claim either way: the numbers are computed in
// the build (build_data.anonymous_review_analysis, data/insights.json 'anon': the flagship reviews that switched to
// anonymous or partly anonymous review in a dated year against the other flagship reviews, journal-years weighted by
// their articles, two-way fixed effects, an event study, a randomization test and robustness checks), from the
// reviews' own dated statements (anonymous_review_policies_2026-10-31.csv); this file only draws them. insights.js hands the data
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
  const SAY = { t14: 'share of articles by professors at top-14 schools', t25: 'share of articles by professors at top-25 schools',
    rank: 'mean U.S. News rank of the authors’ schools', own: 'share of articles by the review’s own faculty' };
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
    'early': { label: 'Switched (dated, own window only)', color: '#86b6ef' },
    'named': { label: 'Not anonymous (stated or inferred)', color: '#eb6834' },
    'no statement': { label: 'No anonymity statement found', color: '#f2a27f' },
    'unknown': { label: 'Article policy not found', color: '#c9c8c0' },     // (2026-10-31: Florida and Villanova)
    'undated': { label: 'Anonymous or partly anonymous, undated', color: '#104281' },
  };
  // a policy as the per-review panels and the lede name it
  const polShort = (p) => (/^partially/.test(p || '') ? 'partly anonymous' : /track$/.test(p || '') ? 'optional anonymous track' :
    /stages not stated/.test(p || '') ? 'anonymous (stages not stated)' : /^fully/.test(p || '') ? 'anonymous' : p || '');

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
      accessibility: { enabled: true, point: { valueDecimals: 1 } },
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
    c.box.replaceChildren(el('p', { class: 'text-muted an-none' }, 'The chart could not be drawn here; the table below lists the numbers.'));
    if (d) d.open = true;
  }
  function swatch(label, color, kind) {
    const s = el('span');
    const i = el('i', kind ? { class: kind } : null);
    if (color) i.style.background = color;
    s.append(i, document.createTextNode(label));
    return s;
  }

  // ---------------------------------------------------------------- 0. the lede: what is compared, and the main estimate
  function lede() {
    const box = $('anLede');
    if (!box) return;
    box.replaceChildren();
    const say = (t) => box.appendChild(document.createTextNode(t));
    const bold = (t) => box.appendChild(el('b', null, t));
    const C = A.counts, k = 't14', m = A.main[k];
    const sw = A.journals.filter((j) => j.role === 'switched'), recent = A.journals.filter((j) => j.role === 'too recent');
    const old = A.journals.filter((j) => j.role === 'before'), early = A.journals.filter((j) => j.role === 'early');
    say('Flagship law reviews with a dated switch to anonymous or partly anonymous review of articles (' + num(sw.length + recent.length + early.length) + '): ' +
      listSay(sw.map((j) => jshort(j.name) + ' (' + j.adopted + ')')) + (recent.length ? '; ' + listSay(recent.map((j) => jshort(j.name) + ' (' + j.adopted + ')')) +
      (recent.length === 1 ? ', counted as a comparison review until its switch' : ', counted as comparison reviews until their switches') : '') +
      (early.length ? '; ' + listSay(early.map((j) => jshort(j.name) + ' (' + j.adopted + ')')) + ', switched before ' + (A.since + A.bin) + ', too early for the ' + A.since + '–' + A.last + ' comparison, so only in the per-review windows below' : '') +
      '. Comparison: ' + num(C.comparison) + ' other flagship reviews over the same years. ');
    say('Change in the share of faculty-authored articles by professors at top-14 schools after the switch, the ' + sw.length + ' switching reviews minus the comparison reviews: ');
    bold(eff(k, m.est) + ' percentage points');
    say(' (before the switch: ' + val(k, m.treated_before) + '; 95% interval ' + ci(k, m.lo, m.hi) + ' points). ');
    say('p-values: randomization test (the same switch years given to comparison reviews) ' + fmtP(m.p_perm) + '; clustered by review ' + fmtP(m.p) + '. ');
    const und = A.journals.filter((j) => j.role === 'undated');
    if (old.length || und.length) say('Not in the before-and-after comparison: ' +
      (old.length ? listSay(old.map((j) => jshort(j.name))) + ', anonymous with no known start (earliest records: ' + listSay(old.map((j) => j.adopted)) +
        (() => { const inH = old.filter((j) => A.home.reviews.some((r) => r.j === j.j)); return !inH.length ? ')' : inH.length === old.length ? '; the last chart includes them)' : '; the last chart includes ' + listSay(inH.map((j) => jshort(j.name))) + ')'; })() : '') +
      (und.length ? (old.length ? '; ' : '') + listSay(und.map((j) => jshort(j.name) + ', ' + polShort(j.policy))) + ', with no date found' : '') + '.');
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
    add(fmtP(m.p_perm) + ' / ' + fmtP(m.p), null, 'p-values: randomization (' + num(A.draws) + ' placebo switches) / clustered by review');
    add(num(C.treated), ' reviews', 'switched with a dated policy and have volumes chosen after it (' + num(C.treated_articles_after) + ' articles); ' + num(C.comparison) + ' flagship reviews compared');
    $('anonymousBody').appendChild(box);
  }

  // ---------------------------------------------------------------- 2. the estimates, every measure
  function figMain() {
    const C = A.counts;
    const c = card('anMain', 'Difference-in-differences estimates by measure',
      'Each row is a difference in differences: how much a measure changed at the ' + C.treated + ' switching reviews from before their switch to after it, minus how much it changed at the ' +
      num(C.comparison) + ' comparison reviews over the same years (two-way fixed effects for review and year, ' + A.since + '–' + A.last + ', each review-year weighted by its articles). ' +
      '“After” starts with the first volume chosen under the policy, the year after the switch. Main measure: the top-14 share, chosen before the estimates were looked at; the other three are secondary.');
    c.legend.remove(); c.box.remove();
    const rows = A.outcomes.map((o) => {
      const m = A.main[o.key];
      return [[SHORT[o.key] + (o.primary ? ' (main)' : ''), o.label], val(o.key, m.treated_before), [eff(o.key, m.est) + unitWord(o.key), ci(o.key, m.lo, m.hi)], fmtP(m.p), fmtP(m.p_perm),
        '±' + (scale(o.key) * m.mde).toFixed(1), o.primary ? { cls: 'an-primary' } : {}];
    });
    const T = el('div', { class: 'an-scroll' });
    c.fig.insertBefore(T, c.foot);
    table(T, ['Measure', 'Before', 'Change (95% interval)', 'p, clustered', 'p, random\u00ADization', 'Detectable*'], rows, 'an-main');
    const m = A.main.t14, recent = A.journals.filter((j) => j.role === 'too recent');
    // (review, 2026-10-29) the comparison is the reviews on record, a review that switched too recently to test (until
    // its switch), and the rest, whose article policy is not known (not on the list, or looked up with nothing found)
    c.foot.textContent = 'Reviews: ' + C.treated + ' switching, ' + num(C.comparison) + ' comparison (' + C.comparison_on_record + ' on record as naming authors or with no anonymity statement, ' +
      (recent.length ? listSay(recent.map((j) => jshort(j.name) + ' before its ' + j.adopted + ' switch')) + ', and ' : '') + num(C.comparison_unknown) + ' with no known article policy); ' +
      num(C.journal_years) + ' review-years and ' + num(C.articles) + ' articles. Before: the switching reviews’ level before their switch. Clustered: standard errors clustered by review. Randomization: the same switch years ' +
      'given to ' + num(A.draws) + ' random sets of comparison reviews of top-' + A.placebo_top + ' schools (from ' + m.placebo_pool + '), counting how often the placebo change is as large' +
      // (review, 2026-10-29) it tests "no switching review changed at all", so one review that changed a lot can carry it
      (m.se > m.placebo_sd ? '; this test does not allow for the switching reviews changing by different amounts (clustered standard error ' + (100 * m.se).toFixed(1) + ' points; placebo spread ' + (100 * m.placebo_sd).toFixed(1) + ' points)' : '') + '. ' +
      'Detectable: the smallest true change the test would catch four times in five (2.8 times the larger of the clustered standard error and the placebo spread): ' + A.outcomes.map((o) => SHORT[o.key].toLowerCase() + ' ±' + (scale(o.key) * A.main[o.key].mde).toFixed(1) + unitWord(o.key)).join(', ') +
      '. Mean school rank: a higher number means authors from lower-ranked schools.';
  }

  // the measure chosen for the next three cards
  function picker() {
    const row = el('div', { class: 'ins-row an-pick' });
    const lab = el('span', { class: 'an-pick-l' }, 'Measure for the charts below:');
    const seg = el('div', { class: 'ins-seg', role: 'group', 'aria-label': 'Measure for the charts below' });
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
      const k = outcome, ev = E();
      c.h.textContent = 'Difference in ' + SHORT[k].toLowerCase() + ' by year since the switch';
      c.p.textContent = 'Dots: the difference between the switching and comparison reviews in ' + SHORT[k].toLowerCase() + (isShare(k) ? ' (percentage points)' : ' (places)') +
        ' in each year counted from the switch, relative to the year before the switch (set to 0), with 95% intervals. Years ' + A.bin + ' or more before or after are pooled at the ends. Year 0, the switch year, mostly holds articles chosen before the policy. ' +
        'The difference-in-differences design assumes the two groups would have moved in parallel without the switch; the years left of 0 are the years before it.';
      const lp = ev.pretest_p, lpr = ev.pretest_p_perm;
      c.foot.textContent = 'Joint test of the ' + ev.pretest_df + ' years before the reference year: clustered ' + pIs(lp) + (lpr != null ? ', randomization ' + pIs(lpr) : '') + '. ' +
        'Per year: ' + Math.min.apply(null, ev.reviews) + '–' + Math.max.apply(null, ev.reviews) + ' reviews and about ' + num(Math.round(ev.articles.slice(1, -1).reduce((s, x) => s + x, 0) / (ev.articles.length - 2))) + ' articles (mean of the years between the pooled ends).';
      table(T.tb, ['Years since the switch', 'Estimate', '95% interval', 'Reviews', 'Articles'],
        ev.e.map((e, i) => [lab(e) + (e === -1 ? ' (reference)' : ''), e === -1 ? '0' : eff(k, ev.b[i]), e === -1 ? '–' : ci(k, ev.lo[i], ev.hi[i]), num(ev.reviews[i]), num(ev.articles[i])]));
    };
    texts.push(words);
    words();
    c.legend.append(swatch('Before the switch, and the switch year', C_CMP, 'dot'), swatch('After (from the first volume chosen under it)', C_SW, 'dot'), swatch('Reference year', '#ffffff', 'dot ring'));
    if (!has('errorbar') || !has('scatter')) { noChart(c, T.d); return; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560, k = outcome, ev = E(), s = scale(k);
      const rule = css('--axis', '#c3c2b7'), plane = css('--plane', '#f7f7f5');
      const color = (e) => (e >= 1 ? C_SW : C_CMP);
      const pts = ev.e.map((e, i) => ({ x: e, y: s * ev.b[i], color: color(e), custom: i,
        marker: e === -1 ? { fillColor: '#ffffff', lineColor: C_CMP, lineWidth: 1.5 } : undefined }));
      makeChart(c.box, {
        chart: { height: narrow ? 300 : 360 },
        accessibility: { description: 'Event study: the difference between switching and comparison reviews in ' + SHORT[k].toLowerCase() + ', by year since the switch, with 95% intervals. The table below lists the numbers.',
          // the pooled ends read as ≤−6 and ≥6, as on the axis
          point: { descriptionFormatter(p) { const f = (v) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(1);
            return lab(p.x) + (Math.abs(p.x) === 1 ? ' year' : ' years') + ' since the switch, ' + (p.low != null ? f(p.low) + ' to ' + f(p.high) : f(p.y)) + '. ' + p.series.name + '.'; } } },
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
      c.h.textContent = SHORT[k] + ', switching and comparison reviews, ' + A.since + '–' + A.last;
      c.p.textContent = 'Per volume year: ' + SAY[k] + (k === 'rank' ? ' (each article the mean over its authors; lower is a higher-ranked school)' : '') +
        ', for the ' + sw.length + ' switching reviews pooled (each article once) and the ' + num(A.counts.comparison) + ' comparison reviews pooled. Shaded: the switch years of the ' + sw.length + ' (' + y0 + '–' + y1 + '). ' +
        'The difference-in-differences estimate is the change in the gap between the two lines after the switches. Volume year ' + A.last + ' is partial.';
      table(T.tb, ['Year', 'Switching', 'Switching articles', 'Comparison', 'Comparison articles'],
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
        accessibility: { description: SHORT[k] + ' per year for the switching reviews and the comparison reviews. The table below lists the numbers.' },
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

  // ---------------------------------------------------------------- 3b. each switching review in its own window
  // (2026-10-31, the owner: "did that change before and after the journal went anonymous. do a diff n diff stat test
  // and a graph that shows line and change and trends"): one panel per dated switch, the review's yearly measure, a
  // straight line fitted to its years on each side of the switch, the review without the change as the fixed-effects
  // model has it (anon.each[].counterfactual: its own level plus the year effects, so the weighted gap after the
  // switch is the printed change), the switch year dotted; insights.json anon.each (build_data: window, studentized
  // placebo p-values) and anon.stacked_all (the windows pooled)
  function figEach() {
    if (!A.each || !A.each.t14 || !A.each.t14.length) return;
    const C = A.counts, K = C.each_k;
    const c = card('anEach', '', '');
    c.box.remove();
    const grid = el('div', { class: 'an-grid' });
    c.fig.insertBefore(grid, c.foot);
    const T = details(c.fig, 'The numbers, review by review');
    const pol = (j) => { const x = A.journals.find((y) => y.j === j) || {}; return x; };
    const per = (k) => (isShare(k) ? ' points a year' : ' places a year');
    const panels = A.each.t14.map((r0) => {
      const p = el('div', { class: 'an-panel' });
      const h = el('h4');
      const s = el('p', { class: 'an-panel-s' });
      const box = el('div', { class: 'an-panel-c' });
      p.append(h, s, box);
      grid.appendChild(p);
      return { j: r0.j, h, s, box };
    });
    const words = () => {
      const k = outcome, E = A.each[k], S = A.stacked_all[k];
      c.h.textContent = SHORT[k] + ' before and after each review’s switch';
      const none = A.journals.filter((j) => j.role === 'too recent');
      c.p.textContent = 'One panel per flagship review with a dated switch and two or more volume years chosen after it (' + E.length + (none.length ? '; ' + listSay(none.map((j) => jshort(j.name))) + ', switching in ' + listSay(none.map((j) => j.adopted).filter((y, i, a) => a.indexOf(y) === i)) + ', have fewer' : '') +
        '), volume years ' + K + ' before to ' + K + ' after the switch. Dots: the review’s ' + SAY[k] + ' each year' + (k === 'rank' ? ' (lower is a higher-ranked school)' : '') +
        '. Solid lines: straight lines fitted to the review’s years before the switch and after it. Dashed: the review without the change, as the model has it: its own level before the switch plus the year-to-year movement of the comparison reviews (flagship reviews with no anonymous policy on record; review and year fixed effects, each review-year weighted by its articles). ' +
        'Dotted line: the switch year; shaded: the volume years chosen under the policy. Over the shaded years, the gap between the dots and the dashed line averages (weighted by articles) to the change printed above the panel.';
      panels.forEach((P) => {
        const r = E.find((x) => x.j === P.j), J = pol(P.j);
        P.h.textContent = '';
        P.h.append(el('b', null, jshort(jname(P.j))), document.createTextNode(' · ' + polShort(J.policy || '') + ' from ' + (r ? r.adopted : J.adopted)));
        P.s.textContent = !r ? 'Too few volume years on one side of the switch for this measure.' :
          'Change against the comparison: ' + eff(k, r.level) + unitWord(k) + ' (placebo ' + pIs(r.p_level) + '). Change in yearly trend against the comparison: ' + eff(k, r.trend) + per(k) + ' (placebo ' + pIs(r.p_trend) + '). Articles: ' + num(r.articles[0]) + ' before, ' + num(r.articles[1]) + ' after.';
      });
      table(T.tb, ['Review (switch)', 'Before → after*', 'Comparison, pooled*', 'Change (placebo p)', 'Trend change (placebo p)'],
        E.map((r) => [[jname(r.j) + ' (' + r.adopted + ')', r.window[0] + '–' + r.window[1] + ', ' + num(r.n_comparison) + ' comparison reviews'],
          [val(k, r.before) + ' → ' + val(k, r.after), num(r.articles[0]) + ' / ' + num(r.articles[1]) + ' articles'],
          val(k, r.cmp_before) + ' → ' + val(k, r.cmp_after),
          [eff(k, r.level) + unitWord(k), 'p ' + fmtP(r.p_level) + ' (' + r.placebo_n + ' placebos)'], [eff(k, r.trend) + per(k), 'p ' + fmtP(r.p_trend)]])
          .concat(S ? [[['All ' + S.windows + ' windows, stacked', num(S.switching_articles) + ' articles at the switching reviews; ' + num(S.articles) + ' in all'], '', '',
            [eff(k, S.est) + unitWord(k), ci(k, S.lo, S.hi) + '; p ' + fmtP(S.p) + ' clustered, ' + fmtP(S.p_perm) + ' randomization'], '', { cls: 'an-primary' }]] : []), 'an-each');
      T.tb.insertBefore(el('p', { class: 'an-note' }, 'Before: the review’s volume years up to the switch year; after: from the year after it (the first volume chosen under the policy). Change: the difference in differences with review and year fixed effects, each review-year weighted by its articles. ' +
        'Comparison, pooled: the comparison reviews’ articles before and after, pooled (reviews enter and leave the data over the years; the fixed effects in the change allow for that). ' +
        'Trend change: the review’s yearly slope after the switch minus its slope before, minus the same for the comparison reviews (fitted with the change and the review’s own trend across its window). ' +
        'Placebo p: the same switch year given to each comparison review with 3 or more volume years before it and 2 or more after, with the real review left out; each estimate is divided by its own standard error (heteroskedasticity-robust), since most comparison reviews publish fewer articles a year than the switching ones, and p counts how often a placebo is as large. ' +
        'Stacked: the windows pooled, fixed effects within each window, standard errors clustered by review; randomization: each window’s switch given to one of its comparison reviews at random, ' + num(C.each_draws) + ' times. “In all” counts each article once, comparison articles included. Volume year ' + A.last + ' is partial.'), T.tb.firstChild);
      c.foot.textContent = S ? 'All ' + S.windows + ' windows pooled (stacked): ' + eff(k, S.est) + unitWord(k, true) + ' (95% interval ' + ci(k, S.lo, S.hi) + '; p ' + fmtP(S.p) + ' clustered by review, ' + fmtP(S.p_perm) + ' randomization). ' +
        'Reviews that switched fewer than ' + K + ' years before ' + A.last + ' have fewer volume years after the switch. Authors are credited to the school where they teach now (see the limits below).' : '';
    };
    texts.push(words);
    words();
    c.legend.append(swatch('The review, by year', C_SW, 'dot'), swatch('Fitted line, before and after', '#104281', 'line an-hline'), swatch('The review without the change (model)', css('--ink-2', '#52514e'), 'dash'),
      swatch('Switch year', css('--ink-2', '#52514e'), 'dot-line'), swatch('Volumes chosen under the policy', css('--plane', '#f7f7f5'), 'box an-band'));
    if (!has('line')) { panels.forEach((P) => P.box.remove()); T.d.open = true; return; }
    panels.forEach((P) => figs.push({ box: P.box, draw: () => {
      const k = outcome, r = A.each[k].find((x) => x.j === P.j);
      if (!r) return;
      const W = P.box.clientWidth, narrow = W < 360, s = scale(k);
      const pt = (y, i) => (r.review[i] ? { x: y, y: s * r.review[i][0], custom: i } : { x: y, y: null });
      const cm = (y, i) => (r.counterfactual[i] != null ? { x: y, y: s * r.counterfactual[i], custom: i } : { x: y, y: null });
      const seg = (L) => (L ? [{ x: L[0], y: s * L[1] }, { x: L[2], y: s * L[3] }] : []);
      const ink2 = css('--ink-2', '#52514e');
      makeChart(P.box, {
        chart: { height: narrow ? 200 : 220, spacing: [6, 4, 4, 0] },
        accessibility: { description: jname(P.j) + ': ' + SHORT[k].toLowerCase() + ' by volume year, ' + r.window[0] + '–' + r.window[1] + ', with fitted lines before and after its ' + r.adopted + ' switch and the review without the change as the model has it. The table below lists the numbers.' },
        xAxis: { min: r.window[0] - 0.5, max: r.window[1] + 0.5, tickInterval: narrow ? 4 : 2, labels: { style: { fontSize: '10.5px' } },
          plotBands: [{ from: r.adopted + 0.5, to: r.window[1] + 0.5, color: css('--plane', '#f7f7f5') }],
          plotLines: [{ value: r.adopted, color: ink2, width: 1.5, dashStyle: 'Dot', zIndex: 3,
            label: { text: 'switch', rotation: 0, align: 'right', x: -4, y: 12, style: { color: css('--muted', '#898781'), fontSize: '10.5px' } } }],
          crosshair: { color: css('--axis', '#c3c2b7'), width: 1 } },
        yAxis: { title: { text: null }, labels: { format: isShare(k) ? '{value}%' : '{value}', style: { fontSize: '10.5px' } }, min: isShare(k) ? 0 : undefined, tickAmount: 5 },
        tooltip: { shared: true, formatter() {
          const pnt = this.points.find((q) => q.point.custom != null);
          if (!pnt) return false;
          const i = pnt.point.custom, a = r.review[i], b = r.comparison[i], f = r.counterfactual[i];
          return '<b>' + r.years[i] + '</b>' + (r.years[i] > r.adopted ? ' (chosen under the policy)' : r.years[i] === r.adopted ? ' (the switch year)' : '') +
            (a ? '<br><span style="color:' + C_SW + '">●</span> ' + esc(jshort(jname(P.j))) + ': <b>' + val(k, a[0]) + '</b> (' + num(a[1]) + ' articles)' : '<br>' + esc(jshort(jname(P.j))) + ': no articles counted') +
            (f != null ? '<br><span style="color:' + ink2 + '">●</span> Without the change (model): ' + val(k, f) : '') +
            (b ? '<br>Comparison reviews, pooled: ' + val(k, b[0]) + ' (' + num(b[1]) + ' articles)' : '');
        } },
        series: [
          { type: 'line', name: 'Without the change (model)', data: r.years.map(cm), color: ink2, dashStyle: 'Dash', lineWidth: 1.5, marker: { enabled: false }, zIndex: 1 },
          { type: 'line', name: jname(P.j), data: r.years.map(pt), color: C_SW, lineWidth: 1, marker: { enabled: true, symbol: 'circle', radius: narrow ? 2.5 : 3, lineWidth: 1, lineColor: '#ffffff' }, zIndex: 2 },
          { type: 'line', name: 'Fitted line before', data: seg(r.line_before), color: '#104281', lineWidth: 2.5, marker: { enabled: false }, enableMouseTracking: false, zIndex: 3, states: { inactive: { opacity: 1 } } },
          { type: 'line', name: 'Fitted line after', data: seg(r.line_after), color: '#104281', lineWidth: 2.5, marker: { enabled: false }, enableMouseTracking: false, zIndex: 3, states: { inactive: { opacity: 1 } } },
        ],
      }, W);
    } }));
  }

  // ---------------------------------------------------------------- 5. robustness
  const ROB_SHORT = { main: 'Main estimate', stacked: 'Stacked DiD', switch_year: 'Switch year as after', top50: 'Top-50 comparisons', top25: 'Top-25 comparisons', evidence: 'On-record comparisons',
    fully: 'No stage named as open', unweighted: 'Unweighted', since2000: 'From 2000' };
  const ROB_NARROW = { switch_year: 'Switch year after', top50: 'Top-50 only', top25: 'Top-25 only', evidence: 'On-record only', fully: 'No open stage' };
  const robLabel = (r, narrow) => (narrow && ROB_NARROW[r.key]) || ROB_SHORT[r.key] ||
    (/^drop/.test(r.key) ? 'Without ' + (narrow ? jshort(r.label.replace(/^Without /, '')).replace(/ Journal$/, ' J.') : jshort(r.label.replace(/^Without /, ''))) : r.label);
  function figRobust() {
    const c = card('anRobust', '', '');
    const T = details(c.fig, 'The numbers');
    const rows = () => [Object.assign({ key: 'main', label: 'The main estimate (above)' }, A.main[outcome])].concat(A.robust[outcome]);
    const words = () => {
      const k = outcome, R = rows();
      c.h.textContent = 'Other specifications' + (k === 't14' ? '' : ' (' + SHORT[k].toLowerCase() + ')');
      c.p.textContent = 'The same comparison with other specifications. The stacked difference-in-differences runs each switch year as its own experiment against reviews that do not switch within six years, so reviews that have already switched are not used as comparisons. ' +
        'The other rows change the comparison reviews, which switching reviews count, the weighting, or the years, or leave out one switching review at a time. Reviews: the number of switching and comparison reviews in each row.';
      table(T.tb, ['Specification', 'Change (95% interval)', 'p, clustered', 'p, random\u00ADization', 'Reviews'],
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
        accessibility: { description: 'Estimate of the change in ' + SHORT[k].toLowerCase() + ' for each specification, with its 95% interval. The table below lists the numbers.' },
        xAxis: { categories: R.map((r) => robLabel(r, narrow)), labels: { style: { fontSize: narrow ? '11px' : '12px', color: css('--ink-2', '#52514e'), textOverflow: 'ellipsis' }, step: 1 }, tickLength: 0, lineWidth: 0 },
        yAxis: { title: { text: narrow ? null : (isShare(k) ? 'Change, percentage points' : 'Change, places') }, labels: { formatter() { return (this.value > 0 ? '+' : this.value < 0 ? MINUS : '') + Math.abs(this.value); } },
          plotLines: [{ value: 0, color: css('--axis', '#c3c2b7'), width: 1.5, zIndex: 2 }, { value: s * R[0].est, color: css('--ink-2', '#52514e'), width: 1, dashStyle: 'Dash', zIndex: 2 }] },
        tooltip: { formatter() {
          const r = R[this.point.index];
          return '<b>' + esc(r.label) + '</b><br>Change: <b>' + eff(k, r.est) + unitWord(k) + '</b><br>95% interval ' + ci(k, r.lo, r.hi) + '<br>p ' + fmtP(r.p) + ' clustered' + (r.p_perm != null ? ', ' + fmtP(r.p_perm) + ' randomization' : '') +
            '<br>' + r.n_treated + ' switching, ' + num(r.n_control) + ' comparison reviews';
        } },
        series: [
          { type: 'errorbar', name: '95% interval', data: R.map((r) => [s * r.lo, s * r.hi]), color: C_SW, whiskerLength: narrow ? 6 : 8, stemWidth: 1.5, whiskerWidth: 1.5, enableMouseTracking: false, states: { inactive: { opacity: 1 } } },
          { type: 'scatter', name: 'Estimate', data: R.map((r, i) => ({ x: i, y: s * r.est, color: i === 0 ? css('--ink', '#0b0b0b') : C_SW })), marker: { symbol: 'circle', radius: narrow ? 4 : 4.5, lineWidth: 1, lineColor: '#ffffff' }, zIndex: 3 },
        ],
      }, W);
    } });
  }

  // ---------------------------------------------------------------- 6. the reviews and their policies
  // (review, 2026-10-30) each evidence link says what it is; the basis text gets American quotation marks and
  // en dashes in ranges for display
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const srcLabel = (u) => {
    const m = /web\.archive\.org\/web\/(\d{4})(\d{2})/.exec(u);
    if (m) return 'Archived page, Internet Archive, ' + MON[+m[2] - 1] + ' ' + m[1];
    if (/jolt\.law\.harvard\.edu/.test(u)) return 'Thomson, Harvard Journal of Law & Technology (PDF)';
    if (/Conklin\.pdf$/i.test(u)) return 'Conklin, University of Illinois Law Review (PDF)';
    if (/blog\.scholasticahq\.com/.test(u)) return 'Scholastica blog post';
    if (/scholasticahq\.com/.test(u)) return 'Review’s Scholastica page';
    if (/illinoislawreview\.org\/online\//.test(u)) return 'Conklin, University of Illinois Law Review Online';
    try { return 'Review’s page (' + new URL(u).hostname.replace(/^www\./, '') + ')'; } catch (e) { return 'Review’s page'; }
  };
  const MONS = 'Jan|Feb|Mar|Apr|May|June|July|Aug|Sept|Oct|Nov|Dec';
  const typo = (t) => t.replace(/(\w)'(\w)/g, '$1’$2').replace(/(^|[\s(])'/g, '$1“').replace(/'/g, '”')
    .replace(/\b(\d{4})-(\d{4})\b/g, '$1–$2').replace(new RegExp('\\b(' + MONS + ')-(' + MONS + ')\\b', 'g'), '$1–$2');
  function figList() {
    const c = card('anList', 'Flagship law reviews and their stated anonymous-review policies',
      'Flagship reviews with a policy entry: the policy found and its source (the review’s own pages, current or archived, its editors’ accounts, or published studies), or that it was not checked. A year is counted as a switch only when the review announced it, its editors reported it, or archived pages show the policy absent and then present; ' +
      'an “earliest” year is the first record of the policy, which may be older. Confidence: how firmly the source supports the policy and its year (high, medium, low); a switch year is used only at high or medium confidence. Flagship reviews not listed here count as comparison reviews.');
    c.legend.remove(); c.box.remove(); c.foot.remove();
    const groups = [
      ['switched', 'Switched in a dated year: switching reviews', 0],
      ['early', 'Switched in a dated year before ' + (A.since + A.bin) + ': in the per-review windows and their pooled estimate, not in the ' + A.since + '–' + A.last + ' panel', 0],
      ['too recent', 'Switched with fewer than two volume years chosen after it: a comparison review until its switch', 0],
      ['before', 'Anonymous, earliest record only: not in the comparison', 0],
      ['undated', 'Anonymous or partly anonymous, undated: not in the comparison', 0],
      ['named', 'Not anonymous (the page asks for names or CVs, or by inference where the entry says so): comparison reviews', 1],
      ['no statement', 'No anonymity statement found: comparison reviews', 1],
      ['unknown', 'Article policy not known: comparison reviews', 1],
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
        if (j.adopted) bits.push((role === 'switched' || role === 'too recent' || role === 'early' ? 'switched ' : 'earliest ') + j.adopted);
        if (j.policy && !/^(not anonymous|unknown|no anonymity)/.test(j.policy)) bits.push(j.policy);
        if (j.confidence) bits.push(j.confidence + ' confidence');
        head.appendChild(el('span', { class: 'an-meta' }, ' · ' + bits.join(' · ')));
        li.appendChild(head);
        const bt = typo(j.basis);
        const basis = el('p', { class: 'an-basis' }, bt.charAt(0).toUpperCase() + bt.slice(1) + '. ');
        if (/^https?:\/\//.test(j.url)) {
          const a = el('a', { href: j.url, rel: 'noopener', target: '_blank' }, srcLabel(j.url));
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
    const c = card('anHome', 'Own-faculty ratio of top-14 law reviews, by stated anonymous-review policy',
      (anon.length ? listSay(anon.map((r) => jshort(jname(r.j)))) + ': anonymous review with no known start (earliest records: ' + listSay(anon.map((r) => jshort(jname(r.j)) + ' ' + r.adopted)) + '), so not in the before-and-after comparison. ' : '') +
      'For each review of a top-14 school (' + rv.length + ' reviews, ties kept), the own-faculty ratio, ' + H.window[0] + '–' + H.window[1] +
      ': the share of its faculty-authored articles with an author on its own faculty, divided by that faculty’s share of the other top-14 reviews’ articles (1 = the same share in both). ' +
      'The ratio counts published articles; submissions and reading practices (such as a guaranteed read for a review’s own faculty) are not in the data.');
    const lg = {}, swYears = [];
    rv.forEach((r) => { const k = r.role === 'too recent' || r.role === 'early' ? 'switched' : r.role; lg[k] = 1; if (k === 'switched' && swYears.indexOf(r.adopted) < 0) swYears.push(r.adopted); });
    Object.keys(ROLE).filter((k) => lg[k]).forEach((k) => c.legend.appendChild(swatch(k === 'switched' ? 'Switched (' + swYears.sort().join(', ') + ')' : ROLE[k].label, ROLE[k].color, 'box')));
    c.legend.appendChild(swatch('95% interval', css('--ink-2', '#52514e'), 'line'));
    const fmtR = (x) => (x == null ? '–' : x.toFixed(1) + '×');
    const lo = Math.min.apply(null, rv.map((r) => r.own)), hi = Math.max.apply(null, rv.map((r) => r.own));
    c.foot.textContent = 'Articles by a review’s own faculty, ' + H.window[0] + '–' + H.window[1] + ': ' + num(lo) + ' to ' + num(hi) + ' per review.';
    const T = details(c.fig, 'The numbers');
    table(T.tb, ['Review', 'Policy', 'Own faculty', 'Elsewhere', 'Ratio'],
      rv.slice().reverse().map((r) => [jname(r.j), ROLE[r.role] ? (r.role === 'switched' || r.role === 'too recent' || r.role === 'early' ? 'Switched ' + r.adopted : ROLE[r.role].label) : r.role,
        [(100 * r.share).toFixed(1) + '%', num(r.own) + ' of ' + num(r.articles)], [(100 * r.elsewhere_share).toFixed(1) + '%', num(r.elsewhere) + ' of ' + num(r.elsewhere_articles)],
        [fmtR(r.ratio), r.ratio_lo != null ? r.ratio_lo.toFixed(1) + '–' + r.ratio_hi.toFixed(1) : '']]), 'an-home');
    T.tb.insertBefore(el('p', { class: 'an-note' }, 'Own faculty: the review’s faculty-authored articles with an author on its own school’s faculty. Elsewhere: that faculty’s articles in the other top-14 reviews, as a share of those reviews’ faculty-authored articles. Ratio: the first share over the second, with a 95% interval.'), T.tb.firstChild);
    if (!has('bar') || !has('errorbar')) { noChart(c, T.d); return; }
    figs.push({ box: c.box, draw: () => {
      const W = c.box.clientWidth, narrow = W < 560;
      makeChart(c.box, {
        chart: { type: 'bar', height: 40 + rv.length * (narrow ? 24 : 26), marginLeft: narrow ? 104 : 270 },
        accessibility: { description: 'Bars: each top-14 review’s own-faculty ratio (its own faculty’s share of its articles over that faculty’s share of the other top-14 reviews), with 95% intervals, colored by anonymous-review policy. The table below lists the numbers.' },
        xAxis: { categories: rv.map((r) => (narrow ? jshort(jname(r.j)) : jname(r.j))), labels: { style: { fontSize: narrow ? '11px' : '12px', color: css('--ink-2', '#52514e') }, step: 1 }, tickLength: 0, lineWidth: 0 },
        yAxis: { min: 0, title: { text: narrow ? null : 'Own-faculty ratio (1 = same share)' }, labels: { format: '{value}×' }, plotLines: [{ value: 1, color: css('--ink-2', '#52514e'), width: 1, dashStyle: 'Dash', zIndex: 3 }] },
        tooltip: { formatter() {
          const r = rv[this.point.index];
          return '<b>' + esc(jname(r.j)) + '</b><br>Ratio <b>' + fmtR(r.ratio) + '</b>' + (r.ratio_lo != null ? ' (95% ' + r.ratio_lo.toFixed(1) + '–' + r.ratio_hi.toFixed(1) + ')' : '') +
            '<br>Own faculty: ' + num(r.own) + ' of ' + num(r.articles) + ' articles (' + (100 * r.share).toFixed(1) + '%)<br>In the other top-14 reviews: ' + num(r.elsewhere) + ' of ' + num(r.elsewhere_articles) + ' (' + (100 * r.elsewhere_share).toFixed(1) + '%)';
        } },
        plotOptions: { bar: { borderWidth: 0, borderRadius: 2, pointPadding: 0.12, groupPadding: 0.06 } },
        series: [
          { type: 'bar', name: 'Own-faculty ratio', data: rv.map((r) => ({ y: r.ratio, color: (ROLE[r.role] || ROLE.unknown).color })) },
          { type: 'errorbar', name: '95% interval', data: rv.map((r) => (r.ratio_lo != null ? [r.ratio_lo, r.ratio_hi] : null)), color: css('--ink-2', '#52514e'), whiskerLength: narrow ? 5 : 7, stemWidth: 1, whiskerWidth: 1, enableMouseTracking: false, states: { inactive: { opacity: 1 } } },
        ],
      }, W);
    } });
  }

  // ---------------------------------------------------------------- 8. what this can and cannot show
  function caveats() {
    const C = A.counts;
    const yrs = A.journals.filter((j) => j.role === 'switched').map((j) => j.adopted);
    const box = el('div', { class: 'ins-card an-card an-limits' });
    box.appendChild(el('h3', null, 'Limits of the data and method'));
    const ul = el('ul');
    [
      'Authors are credited to the school where they teach now, not where they taught when the article came out: a professor who published in 2015 and later moved to a top-14 school counts as top-14 in 2015. The year fixed effects remove what the reviews share; a review whose authors move up more often than others’ can still drift on its own. The event study reports the years before the switch, with a joint test of them.',
      'In the ' + A.since + '–' + A.last + ' comparison: ' + C.treated + ' switching reviews with a dated year and volumes chosen after it, with switches in ' + Math.min.apply(null, yrs) + '–' + Math.max.apply(null, yrs) + '. The leave-one-out rows drop one switching review at a time; the note under the first table gives the detectable change for each measure.',
      'Other changes at the same reviews in the same years (editorial or selection changes made at the same time) are not separated from the policy change in this design.',
      ...(A.each && A.each.t14 && A.each.t14.some((r) => r.window[0] < A.since) ? ['Only articles by professors on today’s faculty lists are counted, so an older window holds a smaller part of what a review published: ' +
        listSay(A.each.t14.filter((r) => r.window[0] < A.since).map((r) => jshort(jname(r.j)) + '’s window (' + r.window[0] + '–' + r.window[1] + ') counts ' + num(r.articles[0] + r.articles[1]) + ' such articles')) +
        '. The comparison reviews in the same years are counted the same way.'] : []),
      (() => {
        const sw = A.journals.filter((j) => j.role === 'switched'), n = (re) => sw.filter((j) => re.test(j.policy)).length, nt = n(/track$/);
        const nf = n(/^fully/), ns = n(/stages not stated/);
        return 'Of the ' + sw.length + ' switching reviews’ policies in the ' + A.since + '–' + A.last + ' comparison, ' + n(/^partially/) + ' are partial (editors still see a CV at some stage), ' + nt + (nt === 1 ? ' is an optional track' : ' are optional tracks') + ', ' +
          nf + (nf === 1 ? ' is' : ' are') + ' fully anonymous and ' + ns + (ns === 1 ? ' states' : ' state') + ' anonymous review without describing its stages. The estimates do not separate the stages of review.';
      })(),
      'Comparison reviews with no known article policy: ' + num(C.comparison_unknown) + ' of ' + num(C.comparison) + '. A comparison review that adopted anonymous review without a record of it would be counted as a comparison review.',
      'Counted: research articles by current faculty of U.S. law schools, the people this site ranks. Articles by practitioners, students, foreign scholars and former faculty are not counted.',
    ].forEach((t) => ul.appendChild(el('li', null, t)));
    box.appendChild(ul);
    $('anonymousBody').appendChild(box);
  }

  ////////////////////////////////////////////////////////////////////////// drawing

  function drawAll() {
    charts.splice(0).forEach((ch) => { try { ch.destroy(); } catch (e) { /* already gone */ } });
    figs.forEach((f) => { try { f.box.replaceChildren(); f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted an-none' }, 'The chart could not be drawn; the table below lists the numbers.')); } });
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
    [tiles, figMain, picker, figEach, figEvent, figTrend, figRobust, figList, figHome, caveats].forEach((f) => {
      try { f(); } catch (e) { if (window.console) console.warn('anon: ' + f.name, e); }
    });
    if (typeof Highcharts === 'undefined') { body.querySelectorAll('details.ins-table').forEach((d) => { d.open = true; }); figs.length = 0; }
    // one figure per frame, so drawing never holds up scrolling
    let i = 0;
    const next = () => {
      if (i >= figs.length) return;
      const f = figs[i++];
      try { f.draw(); } catch (e) { f.box.replaceChildren(el('p', { class: 'text-muted an-none' }, 'The chart could not be drawn; the table below lists the numbers.')); }
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
    const ms = $('mAnonSince');                 // the method note's first year (insights.html)
    if (ms && A && A.since) ms.textContent = A.since;
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
