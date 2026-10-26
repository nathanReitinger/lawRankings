// Law School Rankings: the Subject areas page. The tree (area > field > specialty journal, with the papers by current
// faculty in those journals) and its sources from data/taxonomy.json (build_data.py: journal_tree); each journal's
// school, U.S. News rank and W&L score from data/data.json, as on the rankings page. (2026-10-25, the owner: "I want
// zero inferences drawn. I want a clear taxonomy presented as a tree structure that pulls information from grouped
// specialty journals. That's it.": no topics from titles any more.)
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

  let J = [];            // data.json's journals
  let hostRanks = null;   // data.host_ranks.usnews: the publishing school's U.S. News rank (0 unranked, -1 no school)
  const nodes = [];      // {el, text, parent}
  const byId = new Map(); // a node's place in the tree ('a3.1': area 3, its field 1) -> its record

  function counts(c) {
    const s = el('span', { class: 'tx-counts' });
    if (c && c[0] != null) s.textContent = num(c[0]) + ' papers · ' + num(c[1]) + ' since 2016 · ' + num(c[2]) + ' current faculty';
    return s;
  }

  function sourcesBlock(list) {
    if (!list || !list.length) return el('p', { class: 'tx-none' }, 'No outside scheme matched by name.');
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
  function hostText(ji) {
    const [school, , , publisher] = J[ji][5] || ['', '', '', ''];
    const hr = hostRanks ? hostRanks[ji] : null;
    return school ? school + ' (U.S. News ' + (hr > 0 ? '#' + hr : 'unranked') + ')' : publisher || '';
  }
  const wlScore = (ji) => (J[ji][3] && J[ji][3][0] ? J[ji][3][0][2] : null);

  // a field's journals, in the field's own order (W&L combined score, best first, as "count each group's top N"
  // counts them; the number is the journal's place in that order, not its W&L rank), each with the papers current
  // faculty published there
  function journalBlock(field) {
    const js = field.j || [];
    const wrap = el('div', { class: 'tx-journals' });
    if (!js.length) { wrap.appendChild(el('p', { class: 'tx-none' }, 'No specialty journal is placed in this field yet.')); return { wrap: wrap, text: '', rows: [] }; }
    wrap.appendChild(el('p', { class: 'tx-label' }, js.length + ' specialty journal' + (js.length === 1 ? '' : 's') + ', in order of W&L score'));
    const ul = el('ul');
    const rows = js.map(([ji, papers, since, faculty, counts], i) => {
      const li = el('li', { 'data-j': String(ji) });
      li.appendChild(el('span', { class: 'tx-rank' }, (i + 1) + '.'));
      li.appendChild(el('span', { class: 'tx-jname' }, ' ' + J[ji][0]));
      const host = hostText(ji);
      if (host) li.appendChild(el('span', { class: 'text-muted' }, ' — ' + host));
      const sc = wlScore(ji);
      li.appendChild(el('span', { class: 'tx-counts' }, (sc != null && sc >= 0 ? ' · W&L score ' + sc : ' · not scored by W&L') +
        ' · ' + num(papers) + ' paper' + (papers === 1 ? '' : 's') + ' by ' + num(faculty) + ' current faculty' +
        (counts ? '' : ' · general scope: gives no one an area')));
      ul.appendChild(li);
      return { li: li, ji: ji, text: fold(J[ji][0] + ' ' + host) };
    });
    wrap.appendChild(ul);
    return { wrap: wrap, text: rows.map((r) => r.text).join(' '), rows: rows };
  }

  function render(n, depth, parent, id) {
    const d = el('details', { class: 'tx-node tx-l' + depth });
    const sum = el('summary');
    sum.appendChild(el('span', { class: 'tx-name' }, n.n));
    sum.appendChild(counts(n.c));
    d.appendChild(sum);
    const body = el('div', { class: 'tx-body' });
    if (n.d) body.appendChild(el('p', { class: 'tx-desc' }, n.d));
    let jtext = '', jrows = [];
    if (depth === 1) { const jb = journalBlock(n); body.appendChild(jb.wrap); jtext = jb.text; jrows = jb.rows; }
    body.appendChild(sourcesBlock(n.s));
    // (audit, 2026-10-25) the journals' text is kept apart too, so a match on a journal's name opens its field
    const rec = { id: id, el: d, text: fold(n.n + ' ' + (n.d || '') + ' ' + jtext), jtext: jtext, jrows: jrows, parent: parent, kids: [] };
    if (parent) parent.kids.push(rec);
    nodes.push(rec);
    byId.set(id, rec);
    if (n.k && n.k.length) {
      const kids = el('div', { class: 'tx-kids' });
      kids.appendChild(el('p', { class: 'tx-label' }, n.k.length + ' field' + (n.k.length === 1 ? '' : 's')));
      n.k.forEach((k, i) => kids.appendChild(render(k, depth + 1, rec, id + '.' + i)));
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
  function reveal(id, ji) {
    const rec = byId.get(id);
    if (!rec) return;
    if (rec.el.hidden) { $('find').value = ''; filter(''); }
    for (let r = rec; r; r = r.parent) r.el.open = true;
    nodes.forEach((r) => { r.el.classList.remove('tx-here'); r.jrows.forEach((row) => row.li.classList.toggle('tx-hit', row.ji === ji)); });
    rec.el.classList.add('tx-here');
    rec.el.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const s = rec.el.querySelector('summary');
    if (s) s.focus({ preventScroll: true });
  }

  // (audit, 2026-10-25) the whole tree in one picture, at the top of section 1. The owner, 2026-10-23: "can also have a
  // full visualization of this taxonomy on the explanation"; 2026-10-25: "use tree in view by default. drop sunburst
  // chart" and "a clear taxonomy presented as a tree structure that pulls information from grouped specialty
  // journals". A Highcharts tree: all areas -> the areas -> a clicked area's fields -> a clicked field's specialty
  // journals. Dot size and line width follow papers by current faculty in those journals. Click an area or field to
  // open or close it; a journal opens its field in the list below. One blue hue, darker toward the root (the areas are
  // more than a categorical palette can tell apart).
  const DEPTH = ['#0b0b0b', '#104281', '#2770cb', '#5f9be3'];   // all areas, then each level outward
  const KIND = ['area', 'field', 'journal'];
  const opened = new Set();      // ids of the areas and fields whose children show
  let txChart = null;
  let drawnW = 0;

  // the points: one per node shown, its id its place in the tree (the list's ids), siblings in the tree's own order. A
  // closed area or field keeps invisible placeholder children, so the tree keeps its four columns (and does not jump)
  // as nodes open and close
  function treeData(tree, W) {
    const c = tree.counts || {};
    const narrow = W < 560;
    const maxP = Math.max(1, ...tree.areas.map((a) => (a.c && a.c[0]) || 0));
    const size = (p) => Math.sqrt(Math.max(0, p) / maxP);
    const label = (name, depth) => {
      const room = narrow ? [14, 16, 18][depth] : [40, 34, 40][depth];
      if (name.length <= room) return name;
      const short = depth < 2 ? shortName(name) : name;
      return short.length <= room ? short : short.slice(0, room - 1).trimEnd() + '…';
    };
    const pts = [{ id: 'all', name: 'All areas', color: DEPTH[0], marker: { radius: narrow ? 9 : 12, fillColor: DEPTH[0] },
      custom: { kind: 'root', c: [c.faculty_papers, c.faculty_papers_2016_on, c.faculty], kids: tree.areas.length } }];
    let rows = 0;
    const pad = (id, parent, depth) => {
      pts.push({ id: id, parent: parent, name: '', marker: { radius: 0.01, lineWidth: 0, fillColor: 'transparent' }, link: { lineWidth: 0 },
        dataLabels: { enabled: false }, accessibility: { enabled: false }, custom: { kind: 'pad' } });
      if (depth < 3) pad(id + 'p', id, depth + 1);
    };
    const point = (id, parent, depth, name, cnt, extra) => {
      const col = DEPTH[depth + 1];
      const papers = (cnt && cnt[0]) || 0;
      pts.push({ id: id, parent: parent, name: name, color: col,
        marker: { radius: 3 + (narrow ? 5 : 7) * size(papers), fillColor: col }, link: { lineWidth: 1 + (narrow ? 4 : 6) * size(papers) },
        custom: Object.assign({ kind: KIND[depth], c: cnt, label: label(name, depth) }, extra) });
    };
    tree.areas.forEach((a, i) => {
      const id = 'a' + i;
      const isOpen = opened.has(id);
      point(id, 'all', 0, a.n, a.c, { d: a.d || '', kids: a.k.length, open: isOpen });
      if (!isOpen) { rows++; pad(id + 'p', id, 2); return; }
      a.k.forEach((f, fi) => {
        const fid = id + '.' + fi;
        const fOpen = opened.has(fid);
        point(fid, id, 1, f.n, f.c, { d: f.d || '', kids: f.j.length, open: fOpen, up: a.n, journals: f.j.length });
        if (!fOpen) { rows++; pad(fid + 'p', fid, 3); return; }
        f.j.forEach(([ji, papers, since, faculty, cnt]) => {
          rows++;
          point(fid + '.j' + ji, fid, 2, J[ji][0], [papers, since, faculty], { ji: ji, field: fid, up: f.n, host: hostText(ji), score: wlScore(ji), counts: cnt });
        });
      });
    });
    return { pts: pts, rows: rows };
  }

  const shortName = (s) => String(s).split(/,| & | and |: /)[0];

  function tipFor(point) {
    const c = point.custom || {};
    if (!c.kind || c.kind === 'pad') return false;
    const L = { root: 'The whole tree', area: 'Area', field: 'Field', journal: 'Specialty journal' }[c.kind];
    const kidsWord = { root: 'area', area: 'field', field: 'specialty journal' }[c.kind];
    let h = '<div class="tx-tip"><b>' + esc(point.name) + '</b><div class="tx-tip-k">' + L + (c.up ? ' in ' + esc(c.up) : '') + '</div>';
    if (c.kind === 'journal' && c.host) h += '<div>' + esc(c.host) + '</div>';
    if (c.kind === 'journal') h += '<div>' + (c.score != null && c.score >= 0 ? 'W&amp;L score ' + c.score : 'Not scored by W&amp;L') + '</div>';
    if (c.c && c.c[0] != null) h += '<div>' + num(c.c[0]) + ' papers · ' + num(c.c[1]) + ' since 2016 · ' + num(c.c[2]) + ' current faculty</div>';
    if (c.kind === 'journal' && !c.counts) h += '<div>General scope: gives no one an area</div>';
    if (c.kids && kidsWord) h += '<div>' + c.kids + ' ' + kidsWord + (c.kids === 1 ? '' : 's') + '</div>';
    if (c.d) h += '<div class="tx-tip-d">' + esc(c.d.length > 240 ? c.d.slice(0, 239).replace(/\s+\S*$/, '') + '…' : c.d) + '</div>';
    const hint = c.kind === 'root' ? ''
      : c.kind === 'area' ? 'Click to ' + (c.open ? 'close its fields' : 'see its fields')
        : c.kind === 'field' ? 'Click to ' + (c.open ? 'close its journals' : 'see its journals')
          : 'Click to open its field in the list below';
    if (hint) h += '<div class="tx-tip-h">' + hint + '</div>';
    return h + '</div>';
  }

  function drawTree(tree) {
    const box = $('txChart');
    if (typeof Highcharts === 'undefined') {
      box.replaceChildren(el('p', { class: 'tx-none' }, 'The chart library did not load; the list below has the whole tree.'));
      return;
    }
    if (txChart) { txChart.destroy(); txChart = null; }
    const W = box.clientWidth || 640;
    drawnW = W;
    const narrow = W < 560;
    const { pts, rows } = treeData(tree, W);
    const font = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' };
    const describe = (p) => {
      const c = p.custom || {};
      return p.name + (c.up ? ', in ' + c.up : '') + (c.c && c.c[0] != null ? ': ' + num(c.c[0]) + ' papers by ' + num(c.c[2]) + ' current faculty' : '') +
        (c.journals ? ', ' + c.journals + ' specialty journals' : '') + '.';
    };
    txChart = Highcharts.chart(box, {
      // the height follows the rows on screen: the closed areas and fields, plus the journals of the fields opened
      chart: { height: Math.max(360, Math.min(4800, rows * 26 + 40)), backgroundColor: 'transparent', style: font, spacing: [8, 4, 8, 4],
        marginLeft: narrow ? 8 : 24, marginRight: narrow ? 112 : 250 },
      title: { text: null }, credits: { enabled: false }, exporting: { enabled: false },   // (2026-10-26) no Highcharts logo
      accessibility: { enabled: true, description: 'The specialty journals grouped into ' + tree.areas.length + ' areas and their fields, ' +
        'sized by papers by current faculty in those journals. The list below the chart has the same tree.', point: { descriptionFormatter: describe } },
      tooltip: { useHTML: true, outside: false, backgroundColor: 'rgba(255,255,255,0.97)', borderColor: 'rgba(11,11,11,0.10)', borderRadius: 8,
        shadow: { opacity: 0.08 }, style: { fontSize: '12.5px', color: '#52514e' }, formatter() { return tipFor(this.point || this); } },
      series: [{
        type: 'treegraph', data: pts, name: 'Subject areas', turboThreshold: 0, cursor: 'pointer', animation: { duration: reducedMotion() ? 0 : 350 },
        fillSpace: true, reversed: true,             // the tree's own order, top to bottom
        marker: { symbol: 'circle', lineWidth: 2, lineColor: '#ffffff' },
        link: { type: 'curved', color: '#86b6ef', lineWidth: 1 },
        collapseButton: { enabled: false },
        states: { hover: { link: { color: DEPTH[1] } }, inactive: { opacity: 0.35, link: { opacity: 0.25 } } },
        dataLabels: { enabled: true, crop: false, overflow: 'allow', align: 'left', x: 10, useHTML: false,
          style: { fontSize: narrow ? '11px' : '12px', fontWeight: '400', color: '#52514e', textOutline: '3px #ffffff', whiteSpace: 'nowrap' },
          formatter() {
            const c = this.point.custom || {};
            if (c.kind === 'root' || c.kind === 'pad') return '';
            return c.label + (c.kids ? (c.open ? '  −' : '  +') : '');
          } },
        levels: [
          { level: 1, dataLabels: { enabled: true, align: 'left', x: -8, y: narrow ? -16 : -20, verticalAlign: 'bottom', formatter() { return 'All areas'; },
            style: { fontSize: '13px', fontWeight: '700', color: DEPTH[0], textOutline: '3px #ffffff' } } },
          { level: 2, dataLabels: { style: { fontWeight: '600', color: DEPTH[0] } } },
          { level: 3, dataLabels: { style: { fontWeight: '500' } } },
          { level: 4, dataLabels: { style: { fontSize: narrow ? '10.5px' : '11.5px' } } },
        ],
        // an area or field opens or closes: the chart is drawn again in the same order, at the height its rows need
        // (Highcharts' own toggle cannot be kept from reordering); a journal opens its field in the list below
        point: { events: { click: function () {
          const c = this.custom || {};
          if (c.kind === 'area' || c.kind === 'field') {
            const id = this.id;
            if (opened.has(id)) { [...opened].forEach((k) => { if (k === id || k.startsWith(id + '.')) opened.delete(k); }); } else opened.add(id);
            setTimeout(() => drawTree(tree), 0);
            return false;
          }
          if (c.kind === 'journal') reveal(c.field, c.ji);
          if (c.kind === 'root') { setTimeout(() => drawTree(tree), 0); return false; }
          return undefined;
        } } },
      }],
    });
  }

  // drawn again when the width changes enough to move the columns or the labels' length
  let resizeTimer = null;
  function onResize(tree) {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!txChart) return;
      const W = $('txChart').clientWidth;
      if (W && Math.abs(W - drawnW) > 24) drawTree(tree);
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

  if (window.LSR.crunch) window.LSR.crunch.show('Loading the tree');
  Promise.all(['data/taxonomy.json', 'data/data.json', 'data/meta.json'].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(u + ': ' + r.status);
    return r.json();
  }))).then(([tree, data, meta]) => {
    window.LSR.stampMasthead(meta);
    $('footer').innerHTML = window.LSR.siteFooter(meta);
    J = data.journals;
    hostRanks = data.host_ranks && data.host_ranks.usnews;
    $('snapshot').textContent = 'data of ' + fmtDate(tree.generated);
    document.querySelectorAll('.snap').forEach((s) => { s.textContent = fmtDate(tree.generated); });
    const areas = $('areas');
    tree.areas.forEach((a, i) => areas.appendChild(render(a, 0, null, 'a' + i)));
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
    if (window.LSR.crunch) window.LSR.crunch.hide();
  }).catch((e) => {
    if (window.LSR.crunch) window.LSR.crunch.hide(0);
    $('loading').textContent = 'The tree could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
