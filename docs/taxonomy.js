// Law School Rankings: the Subject areas page. From each specialty journal to its category: the journal sits in one
// field, the field in one category (the subject areas), and a person's categories on the rankings page are the
// categories of the specialty journals they published in. (2026-10-26, the owner: "there needs to be a really clear
// line between specalty journal and then category. then use that category to place authors into buckets ... cite all
// of the work".) The tree, each journal's placement with what it rests on, its school, U.S. News rank and W&L score,
// the author buckets and the sources all come from data/taxonomy.json (build_data.py: journal_tree), so the page
// loads no data.json (2026-10-26: "use lazy loading"). Nothing is guessed from titles.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
  const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtDate = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '?');
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

  let T = null;           // taxonomy.json
  let current = 0;        // the category shown
  let chart = null;
  const rowOf = new Map(); // journal id -> its row in the table

  // the school that publishes a journal and that school's U.S. News rank, as the rankings page shows them (the owner,
  // 2026-10-25: "the associated school" and "its US News rank"); a journal no school publishes shows its publisher
  // T.jinfo: journal id -> [name, school, publisher, the school's U.S. News rank (0 unranked, -1 no school), W&L score]
  const info = (ji) => (T.jinfo && T.jinfo[ji]) || ['', '', '', null, null];
  const jname = (ji) => info(ji)[0];
  function hostText(ji) {
    const [, school, publisher, hr] = info(ji);
    return school ? school + ' (U.S. News ' + (hr > 0 ? '#' + hr : 'unranked') + ')' : publisher || '';
  }
  const wlScore = (ji) => info(ji)[4];
  const placed = (ji) => (T.placed && T.placed[ji]) || ['', '', '', '', '', ''];
  // journal_taxonomy_scope.csv's basis ("1 scope names one subject") in words
  const RULE = {
    1: 'its scope statement names one subject', 2: 'its scope statement names several; the first (or its W&L subject) decides',
    3: 'no usable scope statement: its W&L subject', 4: 'its scope is law or policy generally: no subject', 5: 'its scope statement names a method',
  };
  const ruleText = (basis) => RULE[String(basis).trim()[0]] || basis || '';
  const counts = (c) => (c && c[0] != null ? num(c[0]) + ' papers · ' + num(c[1]) + ' since 2016 · ' + num(c[2]) + ' current faculty' : '');

  // ---- the category picker
  function renderPicker() {
    const box = $('txPick');
    box.replaceChildren();
    T.areas.forEach((a, i) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(i === current) }, a.n);
      b.addEventListener('click', () => { current = i; renderPicker(); renderCategory(); });
      box.appendChild(b);
    });
  }

  // ---- one category: what it is, its whole tree (category -> fields -> every journal), its bucket of authors
  function renderCategory() {
    const a = T.areas[current];
    $('txName').textContent = a.n;
    $('txDesc').textContent = a.d || '';
    $('txCounts').textContent = (a.k.reduce((s, f) => s + f.j.length, 0)) + ' specialty journals in ' + a.k.length + ' field' +
      (a.k.length === 1 ? '' : 's') + ' · ' + counts(a.c);
    const src = $('txSrc');
    src.replaceChildren();
    if (a.s && a.s.length) {        // the outside schemes this category matches, cited (folded: there can be 20+)
      const d = el('details', { class: 'tx-srcs' });
      d.appendChild(el('summary', null, 'Matches ' + a.s.length + ' outside scheme' + (a.s.length === 1 ? '' : 's') + ' (law faculties, libraries, research classifications)'));
      const ul = el('ul');
      a.s.forEach(([title, url]) => {
        const li = el('li');
        li.appendChild(url ? el('a', { href: url, target: '_blank', rel: 'noopener' }, title) : el('span', null, title));
        ul.appendChild(li);
      });
      d.appendChild(ul);
      src.appendChild(d);
    }
    drawTree(a);
    renderBucket(a);
  }

  function drawTree(a) {
    const box = $('txChart');
    if (chart) { chart.destroy(); chart = null; }
    if (typeof Highcharts === 'undefined') { box.replaceChildren(el('p', { class: 'tx-none' }, 'The chart library did not load; the table below has every journal.')); return; }
    const W = box.clientWidth || 700;
    const narrow = W < 560;
    const ink = '#0b0b0b', field = '#2770cb', jour = '#5f9be3';
    const pts = [{ id: 'c', name: a.n, color: ink, marker: { radius: narrow ? 8 : 10, fillColor: ink }, custom: { kind: 'category', a: a } }];
    let rows = 0;
    a.k.forEach((f, fi) => {
      pts.push({ id: 'f' + fi, parent: 'c', name: f.n, color: field, marker: { radius: narrow ? 5 : 6, fillColor: field }, custom: { kind: 'field', f: f, up: a.n } });
      f.j.forEach(([ji, papers, since, faculty, cnt]) => {
        rows++;
        pts.push({ id: 'j' + ji, parent: 'f' + fi, name: jname(ji), color: jour, marker: { radius: 3.5, fillColor: jour },
          custom: { kind: 'journal', ji: ji, c: [papers, since, faculty], cnt: cnt, up: f.n, cat: a.n } });
      });
    });
    const tip = (p) => {
      const c = p.custom || {};
      if (c.kind === 'category') return '<div class="tx-tip"><b>' + esc(p.name) + '</b><div class="tx-tip-k">Category</div><div>' + esc(counts(c.a.c)) + '</div></div>';
      if (c.kind === 'field') return '<div class="tx-tip"><b>' + esc(p.name) + '</b><div class="tx-tip-k">Field in ' + esc(c.up) + '</div><div>' +
        c.f.j.length + ' specialty journal' + (c.f.j.length === 1 ? '' : 's') + ' · ' + esc(counts(c.f.c)) + '</div>' + (c.f.d ? '<div class="tx-tip-d">' + esc(clip(c.f.d, 220)) + '</div>' : '') + '</div>';
      const [basis, words, , , , wl] = placed(c.ji);
      const sc = wlScore(c.ji);
      return '<div class="tx-tip"><b>' + esc(p.name) + '</b><div class="tx-tip-k">' + esc(c.up) + ' &rarr; ' + esc(c.cat) + '</div>' +
        (hostText(c.ji) ? '<div>' + esc(hostText(c.ji)) + '</div>' : '') + '<div>' + (sc != null && sc >= 0 ? 'W&amp;L score ' + sc : 'Not scored by W&amp;L') + ' · ' +
        esc(counts(c.c)) + '</div><div class="tx-tip-d">Placed: ' + esc(ruleText(basis)) + (words ? ' (' + esc(clip(words, 140)) + ')' : '') + '</div>' +
        (wl ? '<div class="tx-tip-h">W&amp;L subject: ' + esc(wl) + '</div>' : '') + (c.cnt ? '' : '<div class="tx-tip-h">General scope: gives no one a category</div>') +
        '<div class="tx-tip-h">Click for its row in the table below</div></div>';
    };
    chart = Highcharts.chart(box, {
      chart: { height: Math.max(220, rows * (narrow ? 20 : 22) + 40), backgroundColor: 'transparent', spacing: [8, 4, 8, 4],
        marginLeft: narrow ? 6 : 16, marginRight: narrow ? 150 : 360, style: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' } },
      title: { text: null }, credits: { enabled: false }, exporting: { enabled: false },
      accessibility: { enabled: true, description: a.n + ': its fields and every specialty journal in them. The table below lists the same journals with what each placement rests on.' },
      tooltip: { useHTML: true, outside: false, backgroundColor: 'rgba(255,255,255,0.97)', borderColor: 'rgba(11,11,11,0.10)', borderRadius: 8,
        shadow: { opacity: 0.08 }, style: { fontSize: '12.5px', color: '#52514e' }, formatter() { return tip(this.point || this); } },
      series: [{
        type: 'treegraph', data: pts, turboThreshold: 0, cursor: 'pointer', animation: { duration: reducedMotion() ? 0 : 300 },
        fillSpace: true, reversed: true, collapseButton: { enabled: false },
        marker: { symbol: 'circle', lineWidth: 1.5, lineColor: '#ffffff' },
        link: { type: 'curved', color: '#b9cfe9', lineWidth: 1.2 },
        states: { hover: { link: { color: field } }, inactive: { opacity: 0.4, link: { opacity: 0.3 } } },
        dataLabels: { enabled: true, crop: false, overflow: 'allow', align: 'left', x: 8, useHTML: false,
          style: { fontSize: narrow ? '10.5px' : '12px', fontWeight: '400', color: '#52514e', textOutline: '3px #ffffff', whiteSpace: 'nowrap' },
          formatter() {
            const c = this.point.custom || {};
            if (c.kind === 'category') return '';
            if (c.kind === 'field') return clip(this.point.name, narrow ? 16 : 30);
            return clip(this.point.name, narrow ? 24 : 52);
          } },
        levels: [
          { level: 1, dataLabels: { enabled: true, align: 'left', x: -6, y: -16, verticalAlign: 'bottom', formatter() { return clip(a.n, narrow ? 18 : 40); },
            style: { fontSize: '13px', fontWeight: '700', color: ink, textOutline: '3px #ffffff' } } },
          { level: 2, dataLabels: { style: { fontWeight: '600', color: ink } } },
        ],
        point: { events: { click: function () {
          const c = this.custom || {};
          if (c.kind === 'journal') showRow(c.ji);
          return false;
        } } },
      }],
    });
  }

  // the category's bucket of authors: everyone with an article in its journals (a person can be in several)
  function renderBucket(a) {
    const box = $('txBucket');
    box.replaceChildren();
    const [n, top] = a.b || [0, []];
    if (!n) { box.appendChild(el('p', { class: 'tx-none' }, 'No one is placed in this group: its journals have no subject focus.')); return; }
    box.appendChild(el('p', { class: 'tx-label' }, num(n) + ' current faculty in this bucket: everyone with an article in these journals. Most articles:'));
    const ol = el('ol', { class: 'tx-bucket' });
    top.forEach(([name, schools, home, k]) => {
      const li = el('li');
      li.appendChild(home ? el('a', { href: home, target: '_blank', rel: 'noopener' }, name) : el('span', null, name));
      li.appendChild(el('span', { class: 'text-muted' }, (schools ? ', ' + schools : '') + ' · ' + k));
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  // ---- every journal and its category, with what its placement rests on
  function renderTable() {
    const tb = $('txRows');
    tb.replaceChildren();
    T.areas.forEach((a, ai) => a.k.forEach((f) => f.j.forEach(([ji, papers, , faculty, cnt]) => {
      const [basis, words, quote, url, how, wl] = placed(ji);
      const tr = el('tr', { 'data-j': String(ji) });
      const td1 = el('td', { 'data-h': 'Specialty journal' });
      td1.appendChild(el('b', null, jname(ji)));
      const host = hostText(ji);
      if (host) td1.appendChild(el('div', { class: 'text-muted' }, host));
      td1.appendChild(el('div', { class: 'tx-counts' }, num(papers) + ' papers by ' + num(faculty) + ' current faculty'));
      const td2 = el('td', { 'data-h': 'Field' }, f.n);
      const td3 = el('td', { 'data-h': 'Category' });
      const go = el('button', { type: 'button', class: 'tx-catlink' }, a.n);
      go.addEventListener('click', () => { current = ai; renderPicker(); renderCategory(); $('txFig').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
      td3.appendChild(go);
      if (!cnt) td3.appendChild(el('div', { class: 'text-muted' }, 'gives no one a category'));
      const td4 = el('td', { 'data-h': 'Placed by' });
      td4.appendChild(el('div', null, ruleText(basis)));
      if (words) td4.appendChild(el('div', { class: 'tx-words' }, '“' + clip(words.replace(/^["“\s]+|["”\s]+$/g, ''), 180) + '”'));
      if (quote || url) {
        const d = el('div', { class: 'text-muted tx-cite' });
        d.append('Scope statement' + (how ? ' (' + how + ')' : '') + ': ');
        if (url) d.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener', title: quote }, quote ? clip(quote.replace(/^"+|"+$/g, ''), 120) : url));
        else d.append(clip(quote, 120));
        td4.appendChild(d);
      }
      if (wl) td4.appendChild(el('div', { class: 'text-muted tx-cite' }, 'W&L subject: ' + wl));
      [td1, td2, td3, td4].forEach((td) => tr.appendChild(td));
      tr.dataset.text = fold([jname(ji), host, f.n, a.n, words, quote, wl].join(' '));
      tb.appendChild(tr);
      rowOf.set(ji, tr);
    })));
    const note = () => {
      const shown = [...tb.children].filter((r) => !r.hidden).length;
      $('findNote').textContent = shown === tb.children.length ? num(shown) + ' specialty journals' : num(shown) + ' of ' + num(tb.children.length) + ' journals';
    };
    $('find').addEventListener('input', () => {
      const q = fold($('find').value.trim());
      [...tb.children].forEach((r) => { r.hidden = !!q && !r.dataset.text.includes(q); });
      note();
    });
    note();
  }

  function showRow(ji) {
    const tr = rowOf.get(ji);
    if (!tr) return;
    if (tr.hidden) { $('find').value = ''; $('find').dispatchEvent(new Event('input')); }
    document.querySelectorAll('#txRows tr.tx-hit').forEach((r) => r.classList.remove('tx-hit'));
    tr.classList.add('tx-hit');
    tr.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  }

  function renderSources(list) {
    const box = $('sourceList');
    const ul = el('ul', { class: 'tx-source-list' });
    const rows = list.map(([title, url, supports, verified]) => {
      const li = el('li');
      if (url) li.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener' }, title)); else li.appendChild(el('span', null, title));
      if (!verified) li.appendChild(el('span', { class: 'tx-unv' }, 'unverified'));
      if (supports) li.appendChild(el('div', { class: 'text-muted tx-supports' }, 'Supports: ' + supports));
      ul.appendChild(li);
      return { li: li, text: fold(title + ' ' + supports + ' ' + url) };
    });
    box.replaceChildren(ul);
    const note = () => { const shown = rows.filter((r) => !r.li.hidden).length; $('sourceNote').textContent = shown.toLocaleString() + ' of ' + rows.length.toLocaleString() + ' sources'; };
    $('findSource').addEventListener('input', () => {
      const q = fold($('findSource').value.trim());
      rows.forEach((r) => { r.li.hidden = q && !r.text.includes(q); });
      note();
    });
    note();
  }

  // drawn again when the width changes enough to move the labels
  let drawnW = 0, resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const W = $('txChart').clientWidth;
      if (W && Math.abs(W - drawnW) > 24) { drawnW = W; drawTree(T.areas[current]); }
    }, 150);
  }

  if (window.LSR.crunch) window.LSR.crunch.show('Loading the categories');
  Promise.all(['data/taxonomy.json', 'data/meta.json'].map((u) => fetch(u).then((r) => {   // (2026-10-26) a plain fetch, so the <head>'s preload is used
    if (!r.ok) throw new Error(u + ': ' + r.status);
    return r.json();
  }))).then(([tree, meta]) => {
    T = tree;
    window.LSR.stampMasthead(meta);
    $('footer').innerHTML = window.LSR.siteFooter(meta);
    $('snapshot').textContent = 'data of ' + fmtDate(tree.generated);
    document.querySelectorAll('.snap').forEach((s) => { s.textContent = fmtDate(tree.generated); });
    const want = decodeURIComponent((location.hash || '').slice(1));
    const at = T.areas.findIndex((a) => fold(a.n) === fold(want));
    if (at >= 0) current = at;
    $('loading').remove();
    document.querySelectorAll('.ins-section').forEach((s) => { s.hidden = false; });
    renderPicker();
    try { drawnW = $('txChart').clientWidth; renderCategory(); } catch (e) { $('txChart').replaceChildren(el('p', { class: 'tx-none' }, 'The chart could not be drawn (' + e.message + '); the table below has every journal.')); }
    renderTable();
    renderSources(tree.sources || []);
    window.addEventListener('resize', onResize);
    if (want && at < 0 && !['tree', 'mapping', 'how', 'sources'].includes(want)) { $('find').value = want; $('find').dispatchEvent(new Event('input')); $('mapping').scrollIntoView(); }
    else if (location.hash && at < 0) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
    if (window.LSR.crunch) window.LSR.crunch.hide();
  }).catch((e) => {
    if (window.LSR.crunch) window.LSR.crunch.hide(0);
    $('loading').textContent = 'The categories could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
