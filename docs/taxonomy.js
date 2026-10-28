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
  let current = 0;        // the category shown (ALL: every higher-level group in one tree)
  let chart = null;
  const rowOf = new Map(); // journal id -> its row in the table
  const groupBox = new Map(); // group name -> its <details> under the tree
  // (2026-10-28, audit R51) the All view: every higher-level group and its groups in one tree, each group's journals
  // folded until clicked; which nodes are open survives redrawing (resize, switching away and back)
  const ALL = -1;
  const allFold = new Map(); // node id -> folded (true/false), when the reader changed it
  // (2026-10-28, audit R46 option a) the thirteen subject areas first; these two are listed after them, under "Also"
  const ALSO = ['Interdisciplinary Methods', 'General & Policy Journals'];
  // a phone or tablet: a tap shows the tooltip first, a second tap on the same journal or group follows it
  const touchy = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  const verb = () => (touchy() ? 'Tap again' : 'Click');

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

  // ---- the category picker: All, the thirteen subject areas, then "Also" the method and the general journals
  function renderPicker() {
    const box = $('txPick');
    box.replaceChildren();
    const add = (i, label, cls) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(i === current), 'data-i': String(i) }, label);
      if (cls) b.className = cls;
      b.addEventListener('click', () => pick(i));
      box.appendChild(b);
    };
    add(ALL, 'All', 'tx-pick-all');
    T.areas.forEach((a, i) => { if (!ALSO.includes(a.n)) add(i, a.n); });
    const also = T.areas.map((a, i) => [a, i]).filter(([a]) => ALSO.includes(a.n));
    if (also.length) {
      box.appendChild(el('span', { class: 'tx-pick-break', 'aria-hidden': 'true' }));
      box.appendChild(el('span', { class: 'tx-pick-also' }, 'Also'));
      also.forEach(([a, i]) => add(i, a.n));
    }
  }
  // the buttons stay put (and keep the keyboard focus); only the pressed one changes
  function pick(i) {
    current = i;
    $('txPick').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.i === i)));
    renderCategory();
  }

  // ---- one category: what it is, its whole tree (category -> fields -> every journal), its bucket of authors
  function renderCategory() {
    if (current === ALL) { renderAll(); return; }
    const a = T.areas[current];
    $('txName').textContent = a.n;
    $('txDesc').textContent = a.d || '';
    $('txCounts').textContent = (a.k.reduce((s, f) => s + f.j.length, 0)) + ' specialty journals in ' + a.k.length + ' group' +
      (a.k.length === 1 ? '' : 's') + ' · ' + counts(a.c);
    const src = $('txSrc');
    src.replaceChildren();
    if (a.s && a.s.length) {        // the outside schemes this category matches, cited (folded: there can be 20+)
      const d = el('details', { class: 'tx-srcs' });
      d.appendChild(el('summary', null, 'Matches ' + a.s.length + ' node' + (a.s.length === 1 ? '' : 's') + ' in outside schemes (law faculties, libraries, research classifications)'));
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
    renderGroups(a);
    renderBucket(a);
  }

  // the groups of this higher-level group, each a drop-down (2026-10-28, audit R50; the owner, 2026-10-23: "drop-down
  // classifications on where each jouranl fits into the higher level category"): "group · n journals", opening to its
  // definition, the journals' own scope words that hold it together, and its journals, each with its school and that
  // school's U.S. News rank and a link to its row in the table
  function groupDetails(f) {
    const d = el('details', { class: 'tx-node tx-l1' });
    const s = el('summary');
    s.appendChild(el('span', { class: 'tx-name' }, f.n));
    s.appendChild(el('span', { class: 'tx-counts' }, '· ' + f.j.length + ' journal' + (f.j.length === 1 ? '' : 's')));
    d.appendChild(s);
    const body = el('div', { class: 'tx-body' });
    if (f.d) body.appendChild(el('p', { class: 'tx-desc' }, f.d));
    if (f.w) body.appendChild(el('p', { class: 'text-muted tx-cite' }, 'In their own words: ' + f.w));
    const js = el('div', { class: 'tx-journals' });
    js.appendChild(el('p', { class: 'tx-label' }, 'Its journals'));
    const ul = el('ul');
    f.j.forEach(([ji, papers]) => {
      const li = el('li');
      const b = el('button', { type: 'button', class: 'tx-catlink tx-jname', title: 'Its row in the table below' }, jname(ji));
      b.addEventListener('click', () => showRow(ji));
      li.appendChild(b);
      const host = hostText(ji);
      if (host) li.appendChild(el('span', { class: 'text-muted' }, ', ' + host));
      li.appendChild(el('span', { class: 'tx-counts' }, ' · ' + num(papers) + ' paper' + (papers === 1 ? '' : 's')));
      ul.appendChild(li);
    });
    js.appendChild(ul);
    body.appendChild(js);
    d.appendChild(body);
    groupBox.set(f.n, d);
    return d;
  }

  function renderGroups(a) {
    const box = $('txGroups');
    groupBox.clear();
    const wrap = el('div', { class: 'tx-tree' });
    wrap.appendChild(el('p', { class: 'tx-label' }, (a.k.length === 1 ? 'Its one group: open it' : 'Its ' + a.k.length + ' groups: open one') + ' for its definition, its journals\' own words and its journals'));
    a.k.forEach((f) => wrap.appendChild(groupDetails(f)));
    box.replaceChildren(wrap);
  }

  // a group picked in the tree: its drop-down opens (and its higher-level group's, in the All view) and comes into view
  function openGroup(name) {
    const d = groupBox.get(name);
    if (!d) return;
    for (let n = d; n; n = n.parentElement && n.parentElement.closest('details')) n.open = true;
    document.querySelectorAll('#txGroups .tx-here').forEach((n) => n.classList.remove('tx-here'));
    d.classList.add('tx-here');
    d.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  // ---- the trees (Highcharts treegraph). (2026-10-28, audit R39/R41; the owner, 2026-10-26, of the Insights tree: "my
  // cursor gets stuck in it" and "the lines are too thick it makes the chart seem toy looking") thin links, and the
  // tooltip does not follow a moving finger, so a swipe over a tree scrolls the page; a tap shows the tooltip.
  const INK = '#0b0b0b', TOP = '#104281', FIELD = '#2770cb', JOUR = '#5f9be3';
  let lastTouch = 0, armed = null;   // a tap shows the tooltip; a second tap on the same node follows it

  function tipHTML(p, all) {
    const c = p.custom || {};
    const s = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
    if (c.kind === 'root') return '<div class="tx-tip"><b>' + esc(p.name) + '</b><div class="tx-tip-k">Every higher-level group</div><div>' +
      s(T.areas.length, 'higher-level group') + ' · ' + s(c.groups, 'group') + ' · ' + s(c.journals, 'specialty journal') + '</div><div>' + esc(counts(c.c)) + '</div></div>';
    if (c.kind === 'category') return '<div class="tx-tip"><b>' + esc(p.name) + '</b><div class="tx-tip-k">Higher-level group</div>' +
      (all ? '<div>' + s(c.a.k.length, 'group') + ' · ' + s(c.a.k.reduce((n, f) => n + f.j.length, 0), 'specialty journal') + '</div>' : '') +
      '<div>' + esc(counts(c.a.c)) + '</div>' + (all ? '<div class="tx-tip-h">' + (touchy() ? 'Tap' : 'Click') + ' to fold or unfold its groups</div>' : '') + '</div>';
    if (c.kind === 'field') return '<div class="tx-tip"><b>' + esc(p.name) + '</b><div class="tx-tip-k">Group in ' + esc(c.up) + '</div><div>' +
      s(c.f.j.length, 'specialty journal') + ' · ' + esc(counts(c.f.c)) + '</div>' + (c.f.d ? '<div class="tx-tip-d">' + esc(clip(c.f.d, 260)) + '</div>' : '') +
      '<div class="tx-tip-h">' + (all ? (touchy() ? 'Tap' : 'Click') + ' to show or hide its journals' : verb() + ' for its definition and journals below') + '</div></div>';
    const [basis, words, , , , wl] = placed(c.ji);
    const sc = wlScore(c.ji);
    return '<div class="tx-tip"><b>' + esc(p.name) + '</b><div class="tx-tip-k">' + esc(c.up) + ' &rarr; ' + esc(c.cat) + '</div>' +
      (hostText(c.ji) ? '<div>' + esc(hostText(c.ji)) + '</div>' : '') + '<div>' + (sc != null && sc >= 0 ? 'W&amp;L score ' + sc : 'Not scored by W&amp;L') + ' · ' +
      esc(counts(c.c)) + '</div><div class="tx-tip-d">Placed: ' + esc(ruleText(basis)) + (words ? ' (' + esc(clip(words, 140)) + ')' : '') + '</div>' +
      (wl ? '<div class="tx-tip-h">W&amp;L subject: ' + esc(wl) + '</div>' : '') + (c.cnt ? '' : '<div class="tx-tip-h">General scope: puts no author in a bucket</div>') +
      '<div class="tx-tip-h">' + verb() + ' for its row in the table below</div></div>';
  }

  // what a click does: a journal goes to its row in the table, a group (one-group view) to its drop-down below; in the
  // All view a click on a group or higher-level group folds it (allowFolding, below). On a touch screen the first tap only
  // shows the tooltip.
  function onNodeClick(e) {
    const c = this.custom || {};
    const go = c.kind === 'journal' || (c.kind === 'field' && current !== ALL);
    if (!go) return false;
    const tap = (e && e.pointerType === 'touch') || Date.now() - lastTouch < 900;
    if (tap && armed !== this.id) { armed = this.id; return false; }
    armed = null;
    if (c.kind === 'journal') showRow(c.ji); else openGroup(c.f.n);
    return false;
  }

  // the options both trees share
  function treeChart(box, opts) {
    box.ontouchstart = () => { lastTouch = Date.now(); };
    return Highcharts.chart(box, {
      chart: { height: opts.height, width: opts.width || null, backgroundColor: 'transparent', spacing: [8, 4, 8, 4], marginLeft: opts.narrow ? 6 : 16,
        marginRight: opts.marginRight || (opts.narrow ? 150 : 360), style: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' } },
      title: { text: null }, credits: { enabled: false }, exporting: { enabled: false },
      accessibility: { enabled: true, description: opts.label },
      tooltip: { useHTML: true, outside: false, followTouchMove: false, backgroundColor: 'rgba(255,255,255,0.97)', borderColor: 'rgba(11,11,11,0.10)', borderRadius: 8,
        shadow: { opacity: 0.08 }, style: { fontSize: '12.5px', color: '#52514e' }, formatter() { return tipHTML(this.point || this, opts.all); } },
      series: [Object.assign({
        type: 'treegraph', data: opts.data, turboThreshold: 0, cursor: 'pointer', animation: { duration: reducedMotion() ? 0 : 300 },
        fillSpace: true, reversed: true, collapseButton: { enabled: false },
        marker: { symbol: 'circle', lineWidth: 1.5, lineColor: '#ffffff' },
        link: { type: 'curved', color: '#b9cfe9', lineWidth: 1 },
        states: { hover: { link: { color: FIELD } }, inactive: { opacity: 0.4, link: { opacity: 0.3 } } },
        point: { events: { click: onNodeClick } },
      }, opts.series)],
    });
  }

  function drawTree(a) {
    const box = $('txChart');
    if (chart) { chart.destroy(); chart = null; }
    if (typeof Highcharts === 'undefined') { box.replaceChildren(el('p', { class: 'tx-none' }, 'The chart library did not load; the table below has every journal.')); return; }
    const W = box.clientWidth || 700;
    const narrow = W < 560;
    const pts = [{ id: 'c', name: a.n, color: INK, marker: { radius: narrow ? 8 : 10, fillColor: INK }, custom: { kind: 'category', a: a } }];
    let rows = 0;
    a.k.forEach((f, fi) => {
      pts.push({ id: 'f' + fi, parent: 'c', name: f.n, color: FIELD, marker: { radius: narrow ? 5 : 6, fillColor: FIELD }, custom: { kind: 'field', f: f, up: a.n } });
      f.j.forEach(([ji, papers, since, faculty, cnt]) => {
        rows++;
        pts.push({ id: 'j' + ji, parent: 'f' + fi, name: jname(ji), color: JOUR, marker: { radius: 3.5, fillColor: JOUR },
          custom: { kind: 'journal', ji: ji, c: [papers, since, faculty], cnt: cnt, up: f.n, cat: a.n } });
      });
    });
    chart = treeChart(box, {
      height: Math.max(220, rows * (narrow ? 20 : 22) + 40), narrow: narrow, data: pts, all: false,
      label: a.n + ': its groups and every specialty journal in them. The groups under the chart and the table below list the same journals with what each placement rests on.',
      series: {
        dataLabels: { enabled: true, crop: false, overflow: 'allow', align: 'left', x: 8, useHTML: false,
          style: { fontSize: narrow ? '10.5px' : '12px', fontWeight: '400', color: '#52514e', textOutline: '3px #ffffff', whiteSpace: 'nowrap' },
          formatter() {
            const c = this.point.custom || {};
            if (c.kind === 'category') return '';
            if (c.kind === 'field') return clip(this.point.name, narrow ? 16 : 40);
            return clip(this.point.name, narrow ? 24 : 52);
          } },
        levels: [
          { level: 1, dataLabels: { enabled: true, align: 'left', x: -6, y: -16, verticalAlign: 'bottom', formatter() { return clip(a.n, narrow ? 18 : 40); },
            style: { fontSize: '13px', fontWeight: '700', color: INK, textOutline: '3px #ffffff' } } },
          { level: 2, dataLabels: { style: { fontWeight: '600', color: INK } } },
        ],
      },
    });
  }

  // ---- the All view (2026-10-28, audit R51; the owner, 2026-10-23: "can also have a full visualization of this
  // taxonomy on the explanation"): one tree of every higher-level group and its groups; a click on a group opens its
  // journals. On a phone the root is left out so the two columns get the width.
  const isFolded = (id, kind) => (allFold.has(id) ? allFold.get(id) : kind === 'field');
  function allRows() {
    return T.areas.reduce((n, a, ai) => n + (isFolded('a' + ai, 'category') ? 1
      : a.k.reduce((m, f, fi) => m + (isFolded('a' + ai + 'f' + fi, 'field') ? 1 : Math.max(1, f.j.length)), 0)), 0);
  }
  const anyOpen = () => T.areas.some((a, ai) => !isFolded('a' + ai, 'category') && a.k.some((f, fi) => !isFolded('a' + ai + 'f' + fi, 'field')));
  const allHeight = (narrow) => Math.max(220, allRows() * (narrow ? 19 : 21) + 40);

  // Highcharts folds any treegraph node on click; here only the All view's groups and higher-level groups fold (a
  // one-group tree hid its journals with no sign of it), and the chart grows or shrinks to the rows it shows
  function allowFolding() {
    const P = Highcharts.seriesTypes.treegraph && Highcharts.seriesTypes.treegraph.prototype.pointClass;
    if (!P || P.prototype.lsrFold) return;
    P.prototype.lsrFold = true;
    Highcharts.wrap(P.prototype, 'toggleCollapse', function (proceed, state) {
      const c = this.custom || {};
      if (!c.fold) return;
      const next = state == null ? !this.collapsed : !!state;
      allFold.set(this.id, next);
      const ch = this.series.chart;
      if (ch.lsrNarrow) { setTimeout(drawAll, 0); return; }   // a phone draws it again: the labels get the room that is left
      this.update({ collapsed: next }, false, undefined, false);
      ch.setSize(undefined, allHeight(ch.lsrNarrow), reducedMotion() ? false : { duration: 250 });
    });
  }

  function drawAll() {
    const box = $('txChart');
    if (chart) { chart.destroy(); chart = null; }
    if (typeof Highcharts === 'undefined') { box.replaceChildren(el('p', { class: 'tx-none' }, 'The chart library did not load; the groups below and the table list every journal.')); return; }
    const W = box.clientWidth || 700;
    const narrow = W < 560;
    const pts = [];
    const groups = T.areas.reduce((n, a) => n + a.k.length, 0), journals = T.areas.reduce((n, a) => n + a.k.reduce((m, f) => m + f.j.length, 0), 0);
    const tc = T.counts || {};
    if (!narrow) pts.push({ id: 'r', name: 'Specialty journals', color: INK, marker: { radius: 8, fillColor: INK },
      custom: { kind: 'root', groups: groups, journals: journals, c: [tc.faculty_papers, tc.faculty_papers_2016_on, tc.faculty] } });
    // the fold button sits on the node itself (+ folded, - open on hover); set by level, since a point's own
    // collapseButton option would overwrite the button Highcharts keeps under the same name
    const btn = (r, color) => ({ collapseButton: { enabled: true, onlyOnHover: true, x: -r, y: 0, width: 14, height: 14, lineWidth: 1, lineColor: color,
      fillColor: '#ffffff', style: { color: color, fontSize: '11px', fontWeight: '600' } } });
    const lv = narrow ? 0 : 1;   // the root's level, when it is drawn
    // a phone with a group open: three columns do not fit in 375px, so the tree is drawn 600px wide and scrolls
    // sideways inside its box (the page itself does not), starting at the groups' column
    const deep0 = anyOpen();
    const wide = narrow && deep0;
    const CW = wide ? 600 : W, MR = wide ? 190 : narrow ? 150 : 360;
    // on a phone the higher-level groups' names wrap to two lines in the room before the next column
    const wrapW = Math.max(56, Math.round((CW - 14 - MR) / (deep0 ? 2 : 1)) - 34);
    const topLabel = narrow ? { style: { fontWeight: '700', color: INK, width: wrapW + 'px', whiteSpace: 'normal', textOverflow: 'ellipsis' } }
      : { style: { fontWeight: '700', color: INK } };
    T.areas.forEach((a, ai) => {
      const aid = 'a' + ai;
      pts.push({ id: aid, parent: narrow ? undefined : 'r', name: a.n, color: TOP, collapsed: isFolded(aid, 'category'), marker: { radius: 6, fillColor: TOP },
        dataLabels: topLabel, custom: { kind: 'category', a: a, fold: true } });
      a.k.forEach((f, fi) => {
        const fid = aid + 'f' + fi;
        pts.push({ id: fid, parent: aid, name: f.n, color: FIELD, collapsed: isFolded(fid, 'field'), marker: { radius: 5, fillColor: FIELD },
          dataLabels: { style: { fontWeight: '500', color: INK } }, custom: { kind: 'field', f: f, up: a.n, fold: true } });
        f.j.forEach(([ji, papers, since, faculty, cnt]) => pts.push({ id: 'j' + ji, parent: fid, name: jname(ji), color: JOUR, marker: { radius: 3.5, fillColor: JOUR },
          custom: { kind: 'journal', ji: ji, c: [papers, since, faculty], cnt: cnt, up: f.n, cat: a.n } }));
      });
    });
    chart = treeChart(box, {
      height: allHeight(narrow), width: wide ? CW : null, marginRight: MR, narrow: narrow, data: pts, all: true,
      label: 'Every higher-level group and its groups; each group opens to its specialty journals. The groups under the chart and the table below list every journal.',
      series: {
        dataLabels: { enabled: true, crop: false, overflow: 'allow', align: 'left', x: 9, useHTML: false,
          style: { fontSize: narrow ? '10.5px' : '12px', fontWeight: '400', color: '#52514e', textOutline: '3px #ffffff', whiteSpace: 'nowrap' },
          formatter() {
            const c = this.point.custom || {};
            const deep = anyOpen();   // a fourth column (the journals) is showing: the inner labels get shorter
            if (c.kind === 'root') return 'Specialty journals';
            if (c.kind === 'category') return narrow ? this.point.name : clip(this.point.name, deep ? 30 : 44);
            if (c.kind === 'field') return clip(this.point.name, narrow ? (deep ? 26 : 22) : (deep ? 26 : 52)) + ' · ' + c.f.j.length;
            return clip(this.point.name, narrow ? 30 : 52);
          } },
        levels: (narrow ? [] : [{ level: 1, collapseButton: { enabled: false }, dataLabels: { align: 'left', x: -6, y: -14, verticalAlign: 'bottom',
          style: { fontSize: '13px', fontWeight: '700', color: INK, textOutline: '3px #ffffff' } } }]).concat(
          [Object.assign({ level: lv + 1 }, btn(6, TOP)), Object.assign({ level: lv + 2 }, btn(5, FIELD))]),
      },
    });
    chart.lsrNarrow = narrow;
    if (wide) {   // (Highcharts sets its box to overflow: hidden)
      box.style.overflowX = 'auto';
      box.scrollLeft = Math.max(0, Math.round(chart.plotLeft + chart.plotWidth / 2 - 14));
    }
  }

  // the All view's caption, the whole classification as drop-downs (higher-level group, then group, then journals) and
  // the size of each higher-level group's bucket of authors
  function renderAll() {
    const groups = T.areas.reduce((n, a) => n + a.k.length, 0), journals = T.areas.reduce((n, a) => n + a.k.reduce((m, f) => m + f.j.length, 0), 0);
    const tc = T.counts || {};
    $('txName').textContent = 'All higher-level groups';
    $('txDesc').textContent = 'Every higher-level group and its groups in one tree. ' + (touchy() ? 'Tap' : 'Click') + ' a group (+) to show its journals, or a higher-level group to fold it; ' +
      (touchy() ? 'tap a journal twice' : 'click a journal') + ' for its row in the table below.';
    $('txCounts').textContent = num(journals) + ' specialty journals in ' + groups + ' groups and ' + T.areas.length + ' higher-level groups · ' +
      counts([tc.faculty_papers, tc.faculty_papers_2016_on, tc.faculty]);
    $('txSrc').replaceChildren();
    drawAll();
    const box = $('txGroups');
    groupBox.clear();
    const wrap = el('div', { class: 'tx-tree' });
    wrap.appendChild(el('p', { class: 'tx-label' }, 'Every higher-level group: open one for its groups, and a group for its definition, its journals\' own words and its journals'));
    T.areas.forEach((a) => {
      const d = el('details', { class: 'tx-node tx-l0' });
      const s = el('summary');
      const n = a.k.reduce((m, f) => m + f.j.length, 0);
      s.appendChild(el('span', { class: 'tx-name' }, a.n));
      s.appendChild(el('span', { class: 'tx-counts' }, '· ' + a.k.length + ' group' + (a.k.length === 1 ? '' : 's') + ' · ' + n + ' journal' + (n === 1 ? '' : 's')));
      d.appendChild(s);
      const body = el('div', { class: 'tx-body' });
      if (a.d) body.appendChild(el('p', { class: 'tx-desc' }, a.d));
      const kids = el('div', { class: 'tx-kids' });
      a.k.forEach((f) => kids.appendChild(groupDetails(f)));
      body.appendChild(kids);
      d.appendChild(body);
      wrap.appendChild(d);
    });
    box.replaceChildren(wrap);
    const bb = $('txBucket');
    bb.replaceChildren(el('p', { class: 'tx-label' }, 'One bucket of authors per higher-level group: the current faculty with an article in its journals (a person can be in several). Pick one for its list:'));
    const ul = el('ul', { class: 'tx-bucket tx-plain' });
    T.areas.forEach((a, i) => {
      const li = el('li');
      const b = el('button', { type: 'button', class: 'tx-catlink' }, a.n);
      b.addEventListener('click', () => { pick(i); $('txFig').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
      li.appendChild(b);
      const k = (a.b || [0])[0];
      li.appendChild(el('span', { class: 'text-muted' }, ' · ' + (k ? num(k) + ' current faculty' : 'no bucket (no subject focus)')));
      ul.appendChild(li);
    });
    bb.appendChild(ul);
  }

  // the category's bucket of authors: everyone with an article in its journals (a person can be in several)
  function renderBucket(a) {
    const box = $('txBucket');
    box.replaceChildren();
    const [n, top] = a.b || [0, []];
    if (!n) { box.appendChild(el('p', { class: 'tx-none' }, 'No one is placed in this higher-level group: its journals have no subject focus.')); return; }
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
      const td2 = el('td', { 'data-h': 'Group', title: f.d || '' }, f.n);
      const td3 = el('td', { 'data-h': 'Higher-level group' });
      const go = el('button', { type: 'button', class: 'tx-catlink' }, a.n);
      go.addEventListener('click', () => { pick(ai); $('txFig').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); });
      td3.appendChild(go);
      if (!cnt) td3.appendChild(el('div', { class: 'text-muted' }, 'puts no author in a bucket'));
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
      if (W && Math.abs(W - drawnW) > 24) { drawnW = W; if (current === ALL) drawAll(); else drawTree(T.areas[current]); }
    }, 150);
  }

  if (window.LSR.crunch) window.LSR.crunch.show('Loading the subject areas');
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
    const isAll = fold(want) === 'all';   // taxonomy.html#all opens the All view
    const at = T.areas.findIndex((a) => fold(a.n) === fold(want));
    if (isAll) current = ALL; else if (at >= 0) current = at;
    $('loading').remove();
    document.querySelectorAll('.ins-section').forEach((s) => { s.hidden = false; });
    if (typeof Highcharts !== 'undefined') allowFolding();
    renderPicker();
    try { drawnW = $('txChart').clientWidth; renderCategory(); } catch (e) { $('txChart').replaceChildren(el('p', { class: 'tx-none' }, 'The chart could not be drawn (' + e.message + '); the table below has every journal.')); }
    renderTable();
    renderSources(tree.sources || []);
    window.addEventListener('resize', onResize);
    if (want && at < 0 && !isAll && !['tree', 'mapping', 'how', 'sources'].includes(want)) { $('find').value = want; $('find').dispatchEvent(new Event('input')); $('mapping').scrollIntoView(); }
    else if (location.hash && at < 0 && !isAll) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
    if (window.LSR.crunch) window.LSR.crunch.hide();
  }).catch((e) => {
    if (window.LSR.crunch) window.LSR.crunch.hide(0);
    $('loading').textContent = 'The subject areas could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
