// Law School Rankings: the Subject areas page. The tree and its sources from data/taxonomy.json (build_data.py, from
// the subject-area research); which specialty journals sit in each field from data/data.json, as on the rankings page.
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
  const LEVEL = ['area', 'field', 'topic', 'sub-topic'];
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let journalsByField = new Map();
  const nodes = [];      // {el, text, parent}
  const byId = new Map(); // a node's place in the tree ('a3.1.0': area 3, its field 1, that field's topic 0) -> its record

  function counts(c) {
    const s = el('span', { class: 'tx-counts' });
    if (c && c[0] != null) s.textContent = num(c[0]) + ' papers · ' + num(c[1]) + ' since 2016 · ' + num(c[2]) + ' faculty';
    return s;
  }

  function sourcesBlock(list) {
    if (!list || !list.length) return el('p', { class: 'tx-none' }, 'No outside scheme: rests on the title data.');
    const d = el('details', { class: 'tx-src' });
    d.appendChild(el('summary', null, 'Matches ' + list.length + ' outside scheme node' + (list.length === 1 ? '' : 's')));
    const ul = el('ul');
    list.forEach(([title, url]) => {
      const li = el('li');
      if (url) { const a = el('a', { href: url, target: '_blank', rel: 'noopener' }, title); li.appendChild(a); } else li.textContent = title;
      ul.appendChild(li);
    });
    d.appendChild(ul);
    return d;
  }

  // (audit, 2026-10-25) the school that publishes a journal and that school's U.S. News rank, as the rankings page shows
  // them. The owner, 2026-10-25: "click a topic to see its journals" with "the associated school" and "its US News rank"
  // (e.g. the Northwestern Journal of Technology and Intellectual Property and Northwestern's rank). A journal no school
  // publishes shows its publisher instead.
  const hostText = (j) => (j.school ? j.school + ' (U.S. News ' + (j.hr > 0 ? '#' + j.hr : 'unranked') + ')' : j.publisher);

  function journalBlock(field) {
    const js = journalsByField.get(field);
    const wrap = el('div', { class: 'tx-journals' });
    if (!js || !js.length) { wrap.appendChild(el('p', { class: 'tx-none' }, 'No specialty journal is placed in this field yet.')); return { wrap: wrap, text: '', rows: [] }; }
    // in the field's own order (W&L combined score, best first), as "count each group's top N" counts them; the number
    // is the journal's place in that order, not its W&L rank
    wrap.appendChild(el('p', { class: 'tx-label' }, js.length + ' specialty journal' + (js.length === 1 ? '' : 's') + ', in order of W&L score'));
    const ul = el('ul');
    const rows = js.map((j, i) => {
      const li = el('li');
      li.appendChild(el('span', { class: 'tx-rank' }, (i + 1) + '.'));
      li.appendChild(el('span', { class: 'tx-jname' }, ' ' + j.name));
      const host = hostText(j);
      if (host) li.appendChild(el('span', { class: 'text-muted' }, ' — ' + host));
      li.appendChild(el('span', { class: 'tx-counts' }, j.score >= 0 ? ' · W&L score ' + j.score : ' · not scored by W&L'));
      ul.appendChild(li);
      return { li: li, text: fold(j.name + ' ' + (j.school || j.publisher)) };
    });
    wrap.appendChild(ul);
    return { wrap: wrap, text: js.map((j) => j.name + ' ' + (j.school || j.publisher)).join(' '), rows: rows };
  }

  function render(n, depth, parent, withJournals, id) {
    const d = el('details', { class: 'tx-node tx-l' + depth });
    const sum = el('summary');
    sum.appendChild(el('span', { class: 'tx-name' }, n.n));
    sum.appendChild(counts(n.c));
    d.appendChild(sum);
    const body = el('div', { class: 'tx-body' });
    if (n.d) body.appendChild(el('p', { class: 'tx-desc' }, n.d));
    if (n.x && n.x.length) body.appendChild(el('p', { class: 'tx-also' }, 'Also listed under: ' + n.x.join('; ')));
    let jtext = '', jrows = [];
    if (withJournals && depth === 1) { const jb = journalBlock(n.n); body.appendChild(jb.wrap); jtext = jb.text; jrows = jb.rows; }
    body.appendChild(sourcesBlock(n.s));
    // (audit, 2026-10-25) the journals' text is kept apart too, so a match on a journal's name opens its field
    const rec = { id: id, el: d, text: fold(n.n + ' ' + (n.d || '') + ' ' + jtext), jtext: fold(jtext), jrows: jrows, parent: parent, kids: [] };
    if (parent) parent.kids.push(rec);
    nodes.push(rec);
    byId.set(id, rec);
    if (n.k && n.k.length) {
      const kids = el('div', { class: 'tx-kids' });
      kids.appendChild(el('p', { class: 'tx-label' }, n.k.length + ' ' + LEVEL[Math.min(depth + 1, 3)] + (n.k.length === 1 ? '' : 's')));
      n.k.forEach((k, i) => kids.appendChild(render(k, depth + 1, rec, withJournals, id + '.' + i)));
      body.appendChild(kids);
    }
    d.appendChild(body);
    return d;
  }

  function filter(q) {
    q = fold(q.trim());
    let hits = 0;
    const match = new Map();
    // a node shows when it or anything under it matches; it opens when something under it matches, or (audit,
    // 2026-10-25) when one of its journals does, with that journal marked
    const visit = (r) => {
      let any = !q || r.text.includes(q);
      if (q && r.text.includes(q)) hits++;
      let below = false;
      r.kids.forEach((k) => { if (visit(k)) below = true; });
      match.set(r, any || below);
      r.el.hidden = !(any || below);
      const jhit = !!(q && r.jtext && r.jtext.includes(q));
      r.jrows.forEach((row) => row.li.classList.toggle('tx-hit', jhit && row.text.includes(q)));
      if (q) r.el.open = below || jhit;
      return any || below;
    };
    nodes.filter((r) => !r.parent).forEach(visit);
    $('findNote').textContent = q ? hits + ' match' + (hits === 1 ? '' : 'es') : '';
    if (!q) nodes.forEach((r) => { r.el.hidden = false; });
  }

  // open a node of the list (and everything above it) and bring it into view; a Find that hides it is cleared first
  function reveal(id) {
    const rec = byId.get(id);
    if (!rec) return;
    if (rec.el.hidden) { $('find').value = ''; filter(''); }
    for (let r = rec; r; r = r.parent) r.el.open = true;
    nodes.forEach((r) => r.el.classList.remove('tx-here'));
    rec.el.classList.add('tx-here');
    rec.el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const s = rec.el.querySelector('summary');
    if (s) s.focus({ preventScroll: true });
  }

  // (audit, 2026-10-25) the whole tree in one picture, at the top of section 1. The owner, 2026-10-23: "can also have a
  // full visualization of this taxonomy on the explanation". A Highcharts sunburst: the areas around the centre, then
  // their fields and topics (a topic's sub-topics are named in its tooltip and listed below; a fourth ring of them
  // was mostly slivers). A topic's arc is its papers; an area or field is the sum of its topics. Click to drill down
  // (Back, or the centre, goes up); a click on a field or topic also opens it in the list below. One blue hue, darker
  // toward the centre (thirteen areas are more than a categorical palette can tell apart; the steps between rings were
  // checked for colour-vision deficiency, and white labels on the two dark rings, ink on the light one).
  const RING = ['#0b0b0b', '#104281', '#2770cb', '#86b6ef'];   // centre, then each ring outward
  const KIND = ['area', 'field', 'topic'];
  let txChart = null;

  // the points: one per node, its id its place in the tree (the list's ids), siblings in the tree's own order
  function sunburstData(tree) {
    const c = tree.counts || {};
    const pts = [{ id: 'all', parent: '', name: 'All areas', sortIndex: 0,
      custom: { kind: 'root', c: [c.faculty_papers, c.faculty_papers_2016_on, c.faculty], kids: tree.areas.length, share: c.share_with_a_subject_area } }];
    const add = (n, id, parent, depth, i, up) => {
      const kids = depth < 2 ? n.k || [] : [];
      const p = { id: id, parent: parent, name: n.n, sortIndex: i,
        custom: { kind: KIND[depth], d: n.d || '', c: n.c, kids: kids.length, up: up,
          journals: depth === 1 ? (journalsByField.get(n.n) || []).length : null,
          subs: depth === 2 ? (n.k || []).map((k) => k.n) : null } };
      // the topics carry their papers; areas and fields are the sum of their topics
      if (depth === 2) p.value = (n.c && n.c[0]) || 1;
      pts.push(p);
      kids.forEach((k, ki) => add(k, id + '.' + ki, id, depth + 1, ki, n.n));
    };
    tree.areas.forEach((a, i) => add(a, 'a' + i, 'all', 0, i, null));
    return pts;
  }

  // a label's text: the full name where it fits its arc, else its first part ("Constitutional & Public Law" ->
  // "Constitutional", "Civil procedure & litigation" -> "Civil procedure"), else its first word; Highcharts cuts
  // what still does not fit.
  // The room follows Highcharts' own placement: the centre is a disc; an arc reads along the radius, its lines
  // stacked across the arc, unless it is wide enough to be written along the arc
  const shortName = (s) => String(s).split(/,| & | and |: /)[0];
  const wraps = (text, w, lines, px) => {
    let n = 1, cur = 0;
    for (const word of text.split(' ')) {
      const len = word.length * px;
      if (len > w) return false;
      if (!cur) cur = len; else if (cur + px + len <= w) cur += px + len; else { n++; cur = len; }
    }
    return n <= lines;
  };
  function labelFor(point, px, centreW) {
    // the arc as laid out now (Highcharts 12.1 keeps it on the node, not on point.shapeArgs)
    const a = (point.node && point.node.values && point.node.values.r ? point.node.values : point.shapeExisting) || point.shapeArgs || {};
    const r = a.r || 0, ir = a.innerR || 0, ang = (a.end || 0) - (a.start || 0);
    let w, lines;
    if (!ir) { w = centreW || 1.6 * r; lines = Math.max(1, Math.floor(1.4 * r / 15)); }
    else if (ir * ang > 1 && r * ang > 1.5 * (r - ir)) { w = (r + ir) / 2 * ang - 6; lines = 1; }
    else { w = r - ir - 6; lines = Math.max(1, Math.floor(ir * ang / 16)); }
    const short = shortName(point.name), first = short.split(' ')[0];
    return [point.name, short, first].find((t) => wraps(t, w, lines, px)) || first;
  }

  function tipFor(point) {
    const c = point.custom || {};
    if (!c.kind) return false;
    const series = point.series;
    const atRoot = series && point.id === series.rootNode;
    const L = { root: 'The whole tree', area: 'Area', field: 'Field', topic: 'Topic' }[c.kind];
    const kidsWord = { root: 'area', area: 'field', field: 'topic' }[c.kind];
    let h = '<div class="tx-tip"><b>' + esc(point.name) + '</b><div class="tx-tip-k">' + L + (c.up ? ' in ' + esc(c.up) : '') + '</div>';
    if (c.c && c.c[0] != null) h += '<div>' + num(c.c[0]) + ' papers · ' + num(c.c[1]) + ' since 2016 · ' + num(c.c[2]) + ' faculty</div>';
    if (c.kind === 'root' && c.share) h += '<div>' + Math.round(c.share * 100) + '% of papers fall under at least one area</div>';
    const more = [];
    if (c.kids && kidsWord) more.push(c.kids + ' ' + kidsWord + (c.kids === 1 ? '' : 's'));
    if (c.journals != null) more.push(c.journals ? c.journals + ' specialty journal' + (c.journals === 1 ? '' : 's') : 'no specialty journal yet');
    if (more.length) h += '<div>' + more.join(' · ') + '</div>';
    if (c.subs && c.subs.length) h += '<div>Sub-topics: ' + esc(c.subs.join('; ')) + '</div>';
    if (c.d) h += '<div class="tx-tip-d">' + esc(c.d.length > 240 ? c.d.slice(0, 239).replace(/\s+\S*$/, '') + '…' : c.d) + '</div>';
    const hint = atRoot ? (c.kind === 'root' ? '' : 'Click to go back up')
      : c.kind === 'area' ? 'Click to see its fields'
        : c.kind === 'field' ? 'Click to see its topics and open it in the list below'
          : 'Click to open it in the list below';
    if (hint) h += '<div class="tx-tip-h">' + hint + '</div>';
    return h + '</div>';
  }

  function drawTree(tree) {
    const box = $('txChart');
    if (typeof Highcharts === 'undefined') {
      box.replaceChildren(el('p', { class: 'tx-none' }, 'The chart library did not load; the list below has the whole tree.'));
      return;
    }
    const keep = txChart && txChart.series[0] ? txChart.series[0].rootNode : 'all';
    if (txChart) { txChart.destroy(); txChart = null; }
    const W = box.clientWidth || 640;
    const S = Math.round(Math.min(W, 640));
    const narrow = W < 560;
    box.dataset.narrow = narrow ? '1' : '';
    const fs = narrow ? 10 : 11.5;
    const font = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' };
    const white = { fontSize: fs + 'px', fontWeight: '600', color: '#ffffff', textOutline: 'none' };
    const ink = { fontSize: fs + 'px', fontWeight: '400', color: RING[0], textOutline: 'none' };
    const lab = (px, centreW) => function () { return labelFor(this.point || this, px, centreW); };
    // the centre's label gets a set width: Highcharts gives a drilled-into centre only half its width. The narrowest
    // centre is the whole tree's (the most rings), under the Back button's row
    const weights = narrow ? [1.3, 3.3, 2.4, 1] : [1.1, 2.5, 2.5, 2];
    const centreW = Math.floor(0.9 * (S - 50) * weights[0] / weights.reduce((a, b) => a + b, 0));
    const describe = (p) => {
      const c = p.custom || {};
      return p.name + (c.up ? ', in ' + c.up : '') + (c.c && c.c[0] != null ? ': ' + num(c.c[0]) + ' papers, ' + num(c.c[2]) + ' faculty' : '') +
        (c.journals ? ', ' + c.journals + ' specialty journals' : '') + '.';
    };
    txChart = Highcharts.chart(box, {
      chart: { height: S, backgroundColor: 'transparent', style: font, spacing: [8, 4, 8, 4] },
      title: { text: null }, credits: { enabled: true, style: { fontSize: '9px' } }, exporting: { enabled: false },
      accessibility: { enabled: true, description: 'The subject areas of law-faculty scholarship: ' + tree.areas.length + ' areas, their fields and topics, ' +
        'sized by papers by current faculty. The list below the chart has the same tree.', point: { descriptionFormatter: describe } },
      tooltip: { useHTML: true, outside: false, backgroundColor: 'rgba(255,255,255,0.97)', borderColor: 'rgba(11,11,11,0.10)', borderRadius: 8,
        shadow: { opacity: 0.08 }, style: { fontSize: '12.5px', color: '#52514e' }, formatter() { return tipFor(this.point || this); } },
      series: [{
        type: 'sunburst', data: sunburstData(tree), name: 'Subject areas', turboThreshold: 0, allowTraversingTree: true, levelIsConstant: false,
        cursor: 'pointer', rootId: 'all', borderColor: '#ffffff', borderWidth: 1, animation: { duration: reducedMotion() ? 0 : 350 },
        states: { hover: { brightness: 0.08 } },
        breadcrumbs: { showFullPath: false, format: '◂ Back to {level.name}', floating: false,
          buttonTheme: { style: { fontSize: '12.5px', color: '#2a78d6' } } },
        dataLabels: { padding: 2, style: Object.assign({ textOverflow: 'ellipsis' }, white) },
        // rings counted from the centre of the current view: drill into an area and it moves to the centre, its
        // fields to the first ring
        levels: [
          { level: 1, levelSize: { unit: 'weight', value: weights[0] }, color: RING[0],
            dataLabels: { formatter: lab(fs * 0.6, centreW), style: Object.assign({}, white, { fontWeight: '700', width: centreW + 'px' }) } },
          { level: 2, levelSize: { unit: 'weight', value: weights[1] }, color: RING[1],
            dataLabels: { formatter: lab(fs * 0.58), style: white, filter: { property: 'outerArcLength', operator: '>', value: 16 } } },
          { level: 3, levelSize: { unit: 'weight', value: weights[2] }, color: RING[2],
            dataLabels: { formatter: lab(fs * 0.55), style: Object.assign({}, white, { fontWeight: '400' }), filter: { property: 'outerArcLength', operator: '>', value: 14 } } },
          { level: 4, levelSize: { unit: 'weight', value: weights[3] }, color: RING[3], borderWidth: 0.6,
            dataLabels: { formatter: lab(fs * 0.55), style: ink, filter: { property: 'outerArcLength', operator: '>', value: 14 } } },
        ],
        // a field or topic also opens in the list (an area only drills down; the centre goes back up)
        point: { events: { click: function () {
          const c = this.custom || {};
          if (this.series && this.id === this.series.rootNode) return;
          if (c.kind === 'field' || c.kind === 'topic') reveal(this.id);
        } } },
      }],
    });
    if (keep && keep !== 'all' && txChart.get(keep)) txChart.series[0].setRootNode(keep, true, { trigger: 'click' });
  }

  // the chart is as tall as it is wide, up to 640px; it is drawn again when the width crosses the phone layout
  let resizeTimer = null;
  function onResize(tree) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!txChart) return;
      const box = $('txChart'), W = box.clientWidth;
      if (!W) return;
      if ((W < 560) !== (box.dataset.narrow === '1')) { drawTree(tree); return; }
      const S = Math.round(Math.min(W, 640));
      if (Math.abs(txChart.chartHeight - S) > 2) txChart.setSize(null, S, false);
    }, 150);
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

  Promise.all(['data/taxonomy.json', 'data/data.json', 'data/meta.json'].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(u + ': ' + r.status);
    return r.json();
  }))).then(([tree, data, meta]) => {
    window.LSR.stampMasthead(meta);
    $('footer').innerHTML = window.LSR.siteFooter(meta);
    // field name -> its specialty journals, best W&L score first, with the publishing school and its U.S. News rank
    // (data.host_ranks: the host school's rank, 0 unranked, -1 no school) or, failing a school, the publisher
    const hostRanks = data.host_ranks && data.host_ranks.usnews;
    data.journals.forEach((j, ji) => {
      const [school, , , publisher] = j[5] || ['', '', '', ''];
      const hr = hostRanks ? hostRanks[ji] : null;
      (j[3] || []).forEach(([fi, wl, score]) => {
        const field = data.subjects[fi];
        if (!journalsByField.has(field)) journalsByField.set(field, []);
        journalsByField.get(field).push({ name: j[0], wl: wl, score: score == null ? -1 : score, school: school || '', publisher: publisher || '', hr: hr == null ? null : +hr });
      });
    });
    journalsByField.forEach((v) => v.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)));
    $('snapshot').textContent = 'research tree of ' + fmtDate(tree.generated);
    document.querySelectorAll('.snap').forEach((s) => { s.textContent = fmtDate(tree.generated); });
    const areas = $('areas');
    tree.areas.forEach((a, i) => areas.appendChild(render(a, 0, null, true, 'a' + i)));
    const app = $('approaches');
    // the approaches' children are subject fields (where the approach concentrates), not the place of journals
    (tree.approaches || []).forEach((a, i) => app.appendChild(render(a, 0, null, false, 'p' + i)));
    // the method journals, shown under the approaches heading as the rankings group them
    const methods = data.groups.indexOf('Interdisciplinary Methods');
    if (methods >= 0) {
      const js = data.journals.filter((j) => (j[4] || []).some(([g]) => g === methods)).map((j) => j[0]).sort();
      if (js.length) {
        const p = el('p', { class: 'tx-p' });
        p.appendChild(el('b', null, 'Journals in the rankings\' "Interdisciplinary Methods" group: '));
        p.append(js.join('; ') + '.');
        app.appendChild(p);
      }
    }
    renderSources(tree.sources || []);
    $('find').addEventListener('input', () => filter($('find').value));
    $('openAll').addEventListener('click', () => nodes.forEach((r) => { if (!r.el.hidden) r.el.open = true; }));
    $('closeAll').addEventListener('click', () => nodes.forEach((r) => { r.el.open = false; r.el.classList.remove('tx-here'); }));
    $('loading').remove();
    document.querySelectorAll('.ins-section').forEach((s) => { s.hidden = false; });
    // the chart once its section is on screen (it needs the width)
    try { drawTree(tree); } catch (e) { $('txChart').replaceChildren(el('p', { class: 'tx-none' }, 'The chart could not be drawn (' + e.message + '); the list below has the whole tree.')); }
    window.addEventListener('resize', () => onResize(tree));
    const want = decodeURIComponent((location.hash || '').slice(1));
    if (want && !['tree', 'how', 'sources'].includes(want)) { $('find').value = want; filter(want); $('tree').scrollIntoView(); }
    else if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
  }).catch((e) => {
    $('loading').textContent = 'The tree could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
