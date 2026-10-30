// Law School Rankings: the Insights page, section 7 "Words and wording of law review titles" (2026-10-29, the owner:
// "give me some title trends. NLP type inspection things on titles. break it out per tier buckets"). The numbers are
// computed in the build (build_data.title_words, data/insights.json 'title_words': the research-article titles of
// section 3, by tier, as words and two-word phrases compared by weighted log-odds ratios with an informative Dirichlet
// prior, and as title forms and term families per five-year window); this file only draws them. insights.js hands the
// data over (window.LSR_INS, event 'lsr-insights-data'); the cards are drawn once the section comes into view, as in
// anon.js. Aggregate words only: no single title and no author is shown.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const num = (n) => Number(n).toLocaleString('en-US');
  const MINUS = '−';
  const css = (name, dflt) => getComputedStyle(document.body).getPropertyValue(name).trim() || dflt;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };
  const pct = (x) => (x == null || !isFinite(x) ? '–' : (100 * x).toFixed(x < 0.1 ? 1 : 0) + '%');
  const pct1 = (x) => (x == null || !isFinite(x) ? '–' : (100 * x).toFixed(1) + '%');
  // a share under 1%: two decimals, so a non-zero count never shows as 0.0%
  const pctS = (x) => (x == null || !isFinite(x) ? '–' : x > 0 && x < 0.01 ? (100 * x < 0.005 ? '<0.01%' : (100 * x).toFixed(2) + '%') : (100 * x).toFixed(1) + '%');
  const byText = () => (st.by === 'review' ? 'by the law review’s school' : 'by the author’s school');
  const narrowNow = () => !!(window.matchMedia && window.matchMedia('(max-width: 767px)').matches);
  // the screen reader's summary of a chart: what it plots, and the range of the values with their unit
  const a11y = (description, lo, hi, fmt) => ({ description: description + '. The table below lists the numbers.',
    range: isFinite(lo) && isFinite(hi) ? 'Values from ' + fmt(lo) + ' to ' + fmt(hi) + '.' : undefined });
  const zf = (z) => (z < 0 ? MINUS : '+') + Math.abs(z).toFixed(1);
  const span = (w) => w[0] + '–' + w[1];
  const spanS = (w) => w[0] + '–' + String(w[1]).slice(2);

  // the tiers' colors: as in sections 3-5 (insights.js TI_COLORS); the comparison side of a bar chart in the page's
  // second ink, the tiers together in a dark gray line
  const TI_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
  const C_OTHER = '#8f8e87', C_ALL = '#52514e';
  const SHORT = { '101 & below, unranked': '101+', 'Top 14': 'Top 14' };
  const short = (b) => SHORT[b] || b;
  const tierName = (b) => (b === 'all' ? 'All tiers' : b === 'Top 14' || /below/.test(b) ? b : 'Ranked ' + b);

  let T = null, INS = null, drawn = false;
  const st = { by: 'review', dTier: 'Top 14', cTier: 'all', oTier: 'all', form: 1, fam: 0 };
  const figs = [];        // { box, draw } for each chart, redrawn on resize and when a picker changes
  const V = () => T[st.by];

  ////////////////////////////////////////////////////////////////////////// charts

  const font = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' };
  function base(W) {
    const ink2 = css('--ink-2', '#52514e'), muted = css('--muted', '#898781'), grid = css('--grid', '#e8e7e1'), axis = css('--axis', '#c3c2b7');
    const axisStyle = { color: muted, fontSize: '11.5px', fontVariantNumeric: 'tabular-nums' };
    return {
      chart: { backgroundColor: 'transparent', style: font, spacing: [8, 4, 6, 2], animation: false },
      title: { text: null }, subtitle: { text: null },
      credits: { enabled: false },
      exporting: { enabled: false },
      legend: { enabled: false },           // each figure's key is the page's own, above the chart
      tooltip: { followTouchMove: false, useHTML: false, outside: false, hideDelay: 150, backgroundColor: 'rgba(255,255,255,0.97)', borderColor: 'rgba(11,11,11,0.10)',
        borderRadius: 8, borderWidth: 1, shadow: { opacity: 0.08 }, padding: 9, style: { fontSize: '12.5px', color: ink2, whiteSpace: 'normal', width: Math.min(300, W - 40) + 'px' } },
      xAxis: { lineColor: axis, tickColor: axis, gridLineColor: grid, labels: { style: axisStyle }, title: { style: { color: muted, fontSize: '12px', fontWeight: '400' } } },
      yAxis: { lineColor: axis, gridLineColor: grid, labels: { style: axisStyle }, title: { style: { color: muted, fontSize: '12px', fontWeight: '400' } } },
      plotOptions: { series: { animation: false, states: { inactive: { opacity: 0.35 } } } },
      accessibility: { enabled: true },
    };
  }
  // a card's chart: the one it had is taken down first
  function makeChart(c, opts, W) {
    c.chart = Highcharts.chart(c.box, Highcharts.merge(base(W), opts));
    return c.chart;
  }
  function reset(c) {
    if (c.chart) { try { c.chart.destroy(); } catch (e) { /* already gone */ } c.chart = null; }
    c.box.replaceChildren();
  }

  ////////////////////////////////////////////////////////////////////////// the cards

  function card(id, title, caption) {
    const fig = el('figure', { class: 'ins-card tw-card', id: id });
    const cap = el('figcaption');
    const h = el('h3', null, title);
    const p = el('p', null, caption);
    cap.append(h, p);
    fig.appendChild(cap);
    const ctl = el('div', { class: 'tw-ctl' });
    const legend = el('div', { class: 'ins-legend tw-legend' });
    const box = el('div', { class: 'ins-chart tw-chart' });
    const foot = el('p', { class: 'ins-foot tw-foot' });
    fig.append(ctl, legend, box, foot);
    $('wordsBody').appendChild(fig);
    return { fig, h, p, ctl, legend, box, foot };
  }
  function details(parent, summary) {
    const d = el('details', { class: 'ins-table tw-table' });
    d.appendChild(el('summary', null, summary));
    const tb = el('div');
    d.appendChild(tb);
    parent.appendChild(d);
    return { d, tb };
  }
  // a table; a cell is text, or [text, smaller text under it]; a row may carry {cls} as its last item
  function table(tb, head, rows, note) {
    const t = el('table');
    const tr = el('tr');
    head.forEach((h) => tr.appendChild(el('th', { scope: 'col' }, h)));
    t.appendChild(el('thead')).appendChild(tr);
    const body = el('tbody');
    rows.forEach((r) => {
      const x = el('tr');
      const last = r[r.length - 1];
      const cells = last && typeof last === 'object' && !Array.isArray(last) ? (x.className = last.cls || '', r.slice(0, -1)) : r;
      cells.forEach((v, i) => {
        const td = el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null);
        if (Array.isArray(v)) { td.appendChild(document.createTextNode(v[0])); if (v[1] != null) td.appendChild(el('small', null, v[1])); } else td.textContent = v;
        x.appendChild(td);
      });
      body.appendChild(x);
    });
    t.appendChild(body);
    tb.replaceChildren();
    if (note) tb.appendChild(el('p', { class: 'text-muted tw-tnote' }, note));
    tb.appendChild(t);
  }
  // a row of buttons (one pressed); onPick(value)
  function seg(parent, label, items, cur, onPick) {
    const g = el('div', { class: 'ins-seg tw-seg', role: 'radiogroup', 'aria-label': label });
    items.forEach(([v, text]) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(v === cur) }, text);
      b.addEventListener('click', () => {
        g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        onPick(v);
      });
      g.appendChild(b);
    });
    parent.appendChild(g);
    return g;
  }
  function swatch(label, color, kind) {
    const s = el('span');
    const i = el('i', kind ? { class: kind } : null);
    if (color) i.style.background = color;
    s.append(i, document.createTextNode(label));
    return s;
  }
  const tierColor = (b) => (b === 'all' ? C_ALL : TI_COLORS[T.bands.indexOf(b)]);
  const tierItems = (withAll) => T.bands.map((b) => [b, short(b)]).concat(withAll ? [['all', 'All tiers']] : []);
  const fail = (box) => box.replaceChildren(el('p', { class: 'text-muted tw-none' }, 'The chart could not be drawn; the table below lists the numbers.'));

  // ---------------------------------------------------------------- the lede: what is counted
  function lede() {
    const box = $('twLede');
    if (!box) return;
    const nW = (v) => num(v.form.all.reduce((s, r) => s + (r ? r[0] : 0), 0));
    box.textContent = 'Words, two-word phrases and title forms of the research-article titles of section 3, ' + T.windows[0][0] + '–' + T.full +
      ', in five tiers: by the U.S. News rank of the school whose main law review published the title (' + nW(T.review) +
      ' titles), or by the rank of the school of a current faculty member credited with it (' + nW(T.school) +
      ' titles, in the journals collected here). Metadata from HeinOnline; counts of words across titles, with individual titles not shown.';
  }

  // the tiers' grouping, for every card below
  function byPicker() {
    const row = el('div', { class: 'ins-filters tw-filters', role: 'group', 'aria-label': 'Tiers for section 7' });
    const l = el('span', { class: 'tw-pick-l' }, 'Tiers by');
    row.appendChild(l);
    seg(row, 'Group the titles by', [['review', 'The law review’s school'], ['school', 'The author’s school']], st.by, (v) => { st.by = v; redrawAll(); });
    $('wordsBody').appendChild(row);
  }

  // ---------------------------------------------------------------- 1 and 2. log-odds bar charts
  // rows: [word, z, titles with it in group a, in group b]; n: [titles in a, titles in b]
  function oddsChart(c, R, aName, bName, aColor, desc) {
    const W = c.box.clientWidth;
    if (W < 160) return;
    if (!R) { c.box.replaceChildren(el('p', { class: 'text-muted tw-none' }, 'Fewer than ' + T.min_n + ' titles in one of the two groups.')); return; }
    const narrow = W < 560;
    const rows = R.hi.concat(R.lo.slice().reverse());
    const H = Math.max(160, rows.length * (narrow ? 21 : 23) + 46);
    c.box.style.height = H + 'px';
    const share = (k, n) => pctS(k / n);
    const zs = rows.map((r) => r[1]);
    const ax = a11y(desc, Math.min.apply(null, zs), Math.max.apply(null, zs), zf);
    makeChart(c, {
      chart: { type: 'bar', height: H, spacingRight: 10 },
      accessibility: { description: ax.description, point: { valueDecimals: 2 } },
      xAxis: { categories: rows.map((r) => r[0]), lineWidth: 1, tickLength: 0,
        labels: { step: 1, style: { color: css('--ink-2', '#52514e'), fontSize: narrow ? '11.5px' : '12.5px', textOverflow: 'ellipsis', width: narrow ? Math.round(W * 0.36) + 'px' : '200px' } } },
      yAxis: { accessibility: { rangeDescription: ax.range }, title: { text: narrow ? 'z-score' : 'z-score (weighted log-odds ratio)' }, gridLineWidth: 1, plotLines: [{ value: 0, width: 1, color: css('--axis', '#c3c2b7'), zIndex: 3 }],
        labels: { formatter() { return this.value < 0 ? MINUS + Math.abs(this.value) : String(this.value); } } },
      tooltip: { formatter() {
        const r = rows[this.point.index];
        return '<b>' + esc(r[0]) + '</b><br/>z = ' + zf(r[1]) + '<br/>' + esc(aName) + ': ' + num(r[2]) + ' of ' + num(R.n[0]) + ' titles (' + share(r[2], R.n[0]) + ')<br/>' +
          esc(bName) + ': ' + num(r[3]) + ' of ' + num(R.n[1]) + ' titles (' + share(r[3], R.n[1]) + ')';
      } },
      plotOptions: { bar: { borderWidth: 0, pointPadding: 0.08, groupPadding: 0.04, borderRadius: 2,
        dataLabels: { enabled: !narrow, formatter() { return zf(this.y); }, style: { fontSize: '11px', fontWeight: '400', color: css('--muted', '#898781'), textOutline: 'none' } } } },
      series: [{ name: 'z-score', data: rows.map((r) => ({ y: r[1], color: r[1] >= 0 ? aColor : C_OTHER })) }],
    }, W);
  }
  function oddsTable(tb, R, aName, bName, note) {
    if (!R) { tb.replaceChildren(el('p', { class: 'text-muted' }, 'Fewer than ' + T.min_n + ' titles in one of the two groups.')); return; }
    const rows = [];
    const add = (r, cls) => rows.push([r[0], zf(r[1]), [num(r[2]), pctS(r[2] / R.n[0])], [num(r[3]), pctS(r[3] / R.n[1])], { cls: cls }]);
    R.hi.forEach((r) => add(r, ''));
    R.lo.forEach((r, i) => add(r, i === 0 ? 'tw-break' : ''));
    table(tb, ['Word or phrase', 'z', aName + ' (titles, share)', bName + ' (titles, share)'], rows,
      note + ' Titles: ' + num(R.n[0]) + ' (' + aName + '), ' + num(R.n[1]) + ' (' + bName + '); ' + num(R.words) + ' words and phrases compared.');
  }

  function figDistinct() {
    const r = T.recent;
    const c = card('twDistinct', 'Words and phrases, each tier against the others, ' + span(r),
      'Weighted log-odds ratio with an informative Dirichlet prior (Monroe, Colaresi and Quinn 2008), as a z-score, for each word and two-word phrase: the titles of the tier picked below against the titles of the other four tiers, ' +
      span(r) + '. Bars to the right: the ' + T.top + ' highest z-scores (a higher share of the tier’s titles than of the other tiers’); to the left: the ' + T.top +
      ' lowest. Included: words and phrases in at least ' + T.min_titles + ' titles of the two groups together and ' + T.min_group + ' titles of the side they are listed for, in at least ' + T.min_journals + ' journals of that side' +
      (T.max_journal_share != null ? ' with no more than ' + Math.round(100 * T.max_journal_share) + '% of those titles in one journal' : '') +
      (T.nest != null ? '; a word is not listed beside a two-word phrase with it that is in ' + Math.round(100 * T.nest) + '% or more of the word’s titles on that side' : '') + '.');
    const tierLab = (b) => (b === 'Top 14' ? 'Top 14' : short(b));
    seg(c.ctl, 'Tier', tierItems(false), st.dTier, (v) => { st.dTier = v; draw(); });
    const t = details(c.fig, 'The numbers');
    const draw = () => {
      const R = V().distinct[st.dTier];
      const a = tierLab(st.dTier), b = 'Other tiers';
      c.legend.replaceChildren(swatch(tierName(st.dTier) + ' (z above 0)', tierColor(st.dTier), 'box'), swatch('Other four tiers (z below 0)', C_OTHER, 'box'));
      reset(c);
      try { oddsChart(c, R, a, b, tierColor(st.dTier), c.h.textContent + ', ' + tierName(st.dTier) + ', ' + byText()); } catch (e) { fail(c.box); }
      oddsTable(t.tb, R, a, b, 'z: the weighted log-odds ratio over its standard error; a title counts a word once.');
      c.foot.textContent = st.by === 'review'
        ? 'Titles in each school’s main law review, by the U.S. News rank of that school; pieces labeled as student work left out.'
        : 'Titles by current faculty in the journals collected here, by the U.S. News rank of each author’s school; compared with the titles of the other tiers not credited to this tier.';
    };
    figs.push({ box: c.box, draw });
  }

  function figChange() {
    const r = T.recent, e = T.earlier;
    const c = card('twChange', 'Words and phrases, ' + span(r) + ' against ' + span(e),
      'The same weighted log-odds ratio (z-score), for the titles of one tier (or of the five together) in ' + span(r) + ' against the same tier’s titles in ' + span(e) +
      '. Bars to the right: the ' + T.top + ' highest z-scores (a higher share of titles in ' + span(r) + '); to the left: the ' + T.top + ' lowest (a higher share in ' + span(e) +
      '). Same minimum counts as above.');
    seg(c.ctl, 'Tier', tierItems(true), st.cTier, (v) => { st.cTier = v; draw(); });
    const t = details(c.fig, 'The numbers');
    const draw = () => {
      const R = V().change[st.cTier];
      const a = span(r), b = span(e);
      c.legend.replaceChildren(swatch(tierName(st.cTier) + ', ' + a + ' (z above 0)', tierColor(st.cTier), 'box'), swatch(tierName(st.cTier) + ', ' + b + ' (z below 0)', C_OTHER, 'box'));
      reset(c);
      try { oddsChart(c, R, a, b, tierColor(st.cTier), c.h.textContent + ', ' + tierName(st.cTier) + ', ' + byText()); } catch (err) { fail(c.box); }
      oddsTable(t.tb, R, a, b, tierName(st.cTier) + '. z: the weighted log-odds ratio over its standard error; a title counts a word once.');
      c.foot.textContent = st.by === 'review'
        ? 'Titles in each school’s main law review, by the U.S. News rank of that school; pieces labeled as student work left out.'
        : 'Titles by current faculty in the journals collected here, by the U.S. News rank of the school where each author teaches now; the titles of ' + span(e) +
          ' are those of authors on a law faculty today.';
    };
    figs.push({ box: c.box, draw });
  }

  // ---------------------------------------------------------------- 3. title form per five-year window
  // form_columns: titles, subtitle, question, first person, quotation marks, opening phrase, words per title, characters
  // per word; [column, short name (the picker and the axis on a phone), full name, kind]
  const FORMS = [
    [1, 'Subtitle (colon)', 'Share of titles with a subtitle (a colon)', 'share'],
    [3, 'First-person word', 'Share of titles with a first-person word', 'share'],
    [5, 'Opening phrase', 'Share of titles opening with a listed phrase', 'share'],
    [6, 'Words per title', 'Mean words per title', 'mean'],
    [7, 'Characters per word', 'Mean characters per word (letters and digits)', 'mean'],
  ];
  // lines per tier over the five-year windows; get(b) gives the windows' rows, value(row) the plotted value
  function windowChart(c, get, value, isShare, label, shortLabel, desc) {
    const W = c.box.clientWidth;
    if (W < 160) return;
    const narrow = W < 560;
    const H = narrow ? 290 : 360;
    c.box.style.height = H + 'px';
    const cats = T.windows.map((w) => (narrow ? spanS(w) : span(w)));
    const fmt = (v) => (isShare ? pct1(v) : v.toFixed(2));
    const keys = T.bands.concat(['all']);
    const series = keys.map((b, k) => {
      const rows = get(b);
      return { name: tierName(b), color: tierColor(b), dashStyle: b === 'all' ? 'ShortDash' : 'Solid', lineWidth: b === 'all' ? 1.5 : 2,
        marker: { enabled: true, radius: narrow ? 2.5 : 3, symbol: 'circle' },
        data: rows.map((r, i) => (r ? { y: isShare ? 100 * value(r) : value(r), n: r[0], w: T.windows[i] } : null)), b: b };
    });
    const vals = [];
    series.forEach((x) => x.data.forEach((d) => { if (d) vals.push(d.y); }));
    const ax = a11y(desc, Math.min.apply(null, vals), Math.max.apply(null, vals), (v) => v.toFixed(2) + (isShare ? '%' : ''));
    makeChart(c, {
      chart: { type: 'line', height: H, spacingRight: narrow ? 8 : 14 },
      accessibility: { description: ax.description, point: isShare ? { valueDecimals: 2, valueSuffix: '%' } : { valueDecimals: 2 } },
      xAxis: { categories: cats, tickmarkPlacement: 'on', labels: { rotation: narrow ? -45 : 0, style: { fontSize: narrow ? '10.5px' : '11.5px' } } },
      yAxis: { accessibility: { rangeDescription: ax.range }, title: { text: narrow ? shortLabel : label }, labels: { formatter() { return isShare ? this.value + '%' : String(this.value); } } },
      tooltip: { formatter() {
        const p = this.point;
        return '<b>' + esc(this.series.name) + ', ' + span(p.w) + '</b><br/>' + esc(label) + ': ' + fmt(isShare ? p.y / 100 : p.y) + '<br/>' + num(p.n) + ' titles';
      } },
      plotOptions: { line: { connectNulls: false } },
      series: series,
    }, W);
  }
  function windowTable(tb, get, value, isShare, note) {
    const keys = T.bands.concat(['all']);
    const fmt = (v) => (isShare ? pct1(v) : v.toFixed(2));
    const rows = T.windows.map((w, i) => [spanS(w)].concat(keys.map((b) => { const r = get(b)[i]; return r ? [fmt(value(r)), num(r[0])] : '–'; }))).reverse();
    table(tb, ['Years'].concat(keys.map((b) => (b === 'all' ? 'All' : short(b)))), rows,
      note + ' Under each value, the number of titles. A dash: fewer than ' + T.min_n + ' titles.');
  }
  function tierLegend(c) {
    c.legend.replaceChildren();
    T.bands.forEach((b) => c.legend.appendChild(swatch(tierName(b), tierColor(b))));
    c.legend.appendChild(swatch('All tiers', C_ALL, 'dash'));
  }

  function figForm() {
    const c = card('twForm', 'Title form by tier, five-year windows',
      'For each tier and five-year window (' + span(T.windows[0]) + ' to ' + span(T.windows[T.windows.length - 1]) + '), the measure picked below. First-person words: ' +
      T.first_person.join(', ') + ' (“I” not as a numeral, “us” not in capitals). Listed opening phrases: ' + T.frames.join('; ') +
      '. Words: anything between spaces with a letter or digit; characters per word count letters and digits.');
    c.foot.classList.add('tw-marks');
    const sel = el('select', { class: 'ctl-select', 'aria-label': 'Measure' });
    FORMS.forEach(([i, s, l]) => { const o = el('option', { value: String(i) }, l); if (i === st.form) o.selected = true; sel.appendChild(o); });
    // the options' text: the short names on a phone, so the picked one is not cut off
    const optText = () => { const n = narrowNow(); Array.from(sel.options).forEach((o, k) => { o.textContent = FORMS[k][n ? 1 : 2]; }); };
    const lab = el('label', { class: 'ins-pick tw-pick' }, 'Measure ');
    lab.appendChild(sel);
    c.ctl.appendChild(lab);
    sel.addEventListener('change', () => { st.form = +sel.value; draw(); });
    const t = details(c.fig, 'The numbers, by five-year window');
    const draw = () => {
      const f = FORMS.find((x) => x[0] === st.form);
      const isShare = f[3] === 'share', get = (b) => V().form[b], value = (r) => r[f[0]];
      optText();
      tierLegend(c);
      reset(c);
      try { windowChart(c, get, value, isShare, f[2], f[1] + (isShare ? ', share' : ''), c.h.textContent + ', ' + f[2].charAt(0).toLowerCase() + f[2].slice(1) + ', ' + byText()); } catch (e) { fail(c.box); }
      windowTable(t.tb, get, value, isShare, f[2] + '.');
      marks();
    };
    // question marks and quotation marks: in HeinOnline's metadata from about T.marks_since on, so listed only for the
    // windows that start after it
    const marks = () => {
      const idx = T.windows.map((w, i) => (w[0] > T.marks_since ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) { c.foot.textContent = ''; return; }
      const parts = [];
      idx.forEach((i) => {
        const w = T.windows[i];
        const per = T.bands.concat(['all']).map((b) => {
          const r = V().form[b][i];
          return r ? (b === 'all' ? 'all tiers' : short(b)) + ' ' + pct1(r[2]) + ' and ' + pct1(r[4]) + ' (' + num(r[0]) + ' titles)' : null;
        }).filter(Boolean);
        parts.push(span(w) + ': ' + per.join('; '));
      });
      c.foot.textContent = 'Question marks and double quotation marks: in HeinOnline\u2019s title metadata from about ' + T.marks_since +
        ' on (seldom before), so listed here for the windows starting after ' + T.marks_since + ' rather than charted. Share of titles with a question mark and with quotation marks: ' + parts.join(' ') + '.';
    };
    figs.push({ box: c.box, draw });
  }

  // ---------------------------------------------------------------- 4. listed opening phrases, the two ten-year windows
  function figFrames() {
    const r = T.recent, e = T.earlier;
    const c = card('twFrames', 'Title openings (' + T.frames.length + ' listed phrases), ' + span(e) + ' and ' + span(r),
      'Share of titles opening with each listed phrase (after any opening quotation mark), for the tier picked below, in ' + span(e) + ' and ' + span(r) + '.');
    seg(c.ctl, 'Tier', tierItems(true), st.oTier, (v) => { st.oTier = v; draw(); });
    const t = details(c.fig, 'The numbers');
    const draw = () => {
      const F = V().frames[st.oTier];
      const col = tierColor(st.oTier);
      c.legend.replaceChildren(swatch(span(e), C_OTHER, 'box'), swatch(span(r), col, 'box'));
      reset(c);
      const ok = [F.n[0] >= T.min_n, F.n[1] >= T.min_n];
      const sh = (k, j) => (ok[j] && F.n[j] ? k / F.n[j] : null);
      try {
        const W = c.box.clientWidth;
        if (W >= 160) {
          const narrow = W < 560;
          const H = T.frames.length * (narrow ? 30 : 32) + 50;
          c.box.style.height = H + 'px';
          const vals = [];
          [0, 1].forEach((j) => F.k.forEach((k) => { const s = sh(k[j], j); if (s != null) vals.push(100 * s); }));
          const ax = a11y(c.h.textContent + ', ' + tierName(st.oTier) + ', ' + byText(), Math.min.apply(null, vals), Math.max.apply(null, vals), (v) => v.toFixed(2) + '%');
          const mk = (j, name, color) => ({ name: name, color: color, data: F.k.map((k) => { const s = sh(k[j], j); return s == null ? null : { y: 100 * s, k: k[j], n: F.n[j] }; }) });
          makeChart(c, {
            chart: { type: 'bar', height: H, spacingRight: 10 },
            accessibility: { description: ax.description, point: { valueDecimals: 2, valueSuffix: '%' } },
            xAxis: { categories: T.frames, tickLength: 0, labels: { step: 1, style: { color: css('--ink-2', '#52514e'), fontSize: narrow ? '11.5px' : '12.5px', width: narrow ? Math.round(W * 0.38) + 'px' : '200px' } } },
            yAxis: { min: 0, tickPixelInterval: narrow ? 72 : 110, accessibility: { rangeDescription: ax.range }, title: { text: 'share of titles' }, labels: { style: { textOverflow: 'none' }, formatter() { return this.value + '%'; } } },
            tooltip: { formatter() { const p = this.point; return '<b>' + esc(T.frames[p.index]) + '</b><br/>' + esc(this.series.name) + ': ' + num(p.k) + ' of ' + num(p.n) + ' titles (' + (p.y).toFixed(2) + '%)'; } },
            plotOptions: { bar: { borderWidth: 0, pointPadding: 0.04, groupPadding: 0.12, borderRadius: 2 } },
            series: [mk(0, span(e), C_OTHER), mk(1, span(r), col)],
          }, W);
        }
      } catch (err) { fail(c.box); }
      const p2 = (k, j) => (ok[j] ? [num(k), (100 * k / F.n[j]).toFixed(2) + '%'] : '–');
      table(t.tb, ['Opening', span(e) + ' (titles, share)', span(r) + ' (titles, share)'],
        T.frames.map((f, i) => [f, p2(F.k[i][0], 0), p2(F.k[i][1], 1)]).concat([['Titles', num(F.n[0]), num(F.n[1]), { cls: 'tw-break' }]]),
        tierName(st.oTier) + '. A dash: fewer than ' + T.min_n + ' titles in the window.');
    };
    figs.push({ box: c.box, draw });
  }

  // ---------------------------------------------------------------- 5. term families per five-year window
  function figFamily() {
    const c = card('twFamily', 'Term families by tier, five-year windows',
      'Share of titles with at least one word or phrase of the family picked below, per tier and five-year window. The families are fixed lists, printed under the picker; matching is on whole lowercased words, two-word entries as phrases.');
    const sel = el('select', { class: 'ctl-select', 'aria-label': 'Term family' });
    T.families.forEach(([key, label], i) => { const o = el('option', { value: String(i) }, label); if (i === st.fam) o.selected = true; sel.appendChild(o); });
    const lab = el('label', { class: 'ins-pick tw-pick' }, 'Family ');
    lab.appendChild(sel);
    c.ctl.appendChild(lab);
    const words = el('p', { class: 'tw-words' });
    c.ctl.appendChild(words);
    sel.addEventListener('change', () => { st.fam = +sel.value; draw(); });
    const t = details(c.fig, 'The numbers, by five-year window');
    const draw = () => {
      const fam = T.families[st.fam];
      words.textContent = 'Words and phrases: ' + fam[2].join(', ') + '.';
      // family rows carry no title count: it is the form rows' first column (the same titles)
      const get = (b) => V().family[b].map((r, i) => (r ? [V().form[b][i][0]].concat(r) : null));
      const value = (r) => r[1 + st.fam];
      const label = 'Share of titles, ' + fam[1].toLowerCase();
      tierLegend(c);
      reset(c);
      try { windowChart(c, get, value, true, label, 'Share of titles', c.h.textContent + ', ' + fam[1].toLowerCase() + ', ' + byText()); } catch (e) { fail(c.box); }
      windowTable(t.tb, get, value, true, label + '.');
    };
    figs.push({ box: c.box, draw });
  }

  ////////////////////////////////////////////////////////////////////////// drawing

  function redrawAll() {
    figs.forEach((f) => { try { f.draw(); } catch (e) { fail(f.box); } });
  }

  function build() {
    if (drawn) return;
    drawn = true;
    const body = $('wordsBody');
    if (!body) return;
    if (!T || !T.review || !T.school) {
      body.replaceChildren(el('p', { class: 'text-muted' }, 'This analysis is not in this version of the data.'));
      return;
    }
    body.replaceChildren();
    try { lede(); } catch (e) { if (window.console) console.warn('titlewords: lede', e); }
    [byPicker, figDistinct, figChange, figForm, figFrames, figFamily].forEach((f) => {
      try { f(); } catch (e) { if (window.console) console.warn('titlewords: ' + f.name, e); }
    });
    if (typeof Highcharts === 'undefined') { body.querySelectorAll('details.ins-table').forEach((d) => { d.open = true; }); }
    // one figure per frame, so drawing never holds up scrolling
    let i = 0;
    const next = () => {
      if (i >= figs.length) return;
      const f = figs[i++];
      try { f.draw(); } catch (e) { fail(f.box); }
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
        timer = setTimeout(redrawAll, 150);
      }).observe(body);
    }
  }

  // drawn when the section comes into view, or a few seconds after the data is in, whichever is first; never before
  // insights.js has shown the section
  function start() {
    const got = window.LSR_INS;
    if (!got || !got.INS || INS) return;
    INS = got.INS; T = INS.title_words || null;
    const sec = $('words');
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
      setTimeout(() => { io.disconnect(); go(); }, 7000);
    } else setTimeout(go, 0);
  }
  document.addEventListener('lsr-insights-data', () => setTimeout(start, 0));
  if (window.LSR_INS) setTimeout(start, 0);
})();
