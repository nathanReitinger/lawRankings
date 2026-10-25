// Law School Rankings: the Subject areas page. The tree and its sources from data/taxonomy.json (build_data.py, from
// the subject-area research); which specialty journals sit in each field from data/data.json, as on the rankings page.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
  const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const el = (tag, attrs, text) => {
    const e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (text != null) e.textContent = text;
    return e;
  };
  const fmtDate = (iso) => (iso ? new Date(String(iso).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '?');
  const LEVEL = ['area', 'field', 'topic', 'sub-topic'];

  let journalsByField = new Map();
  const nodes = [];      // {el, text, parent}

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

  function journalBlock(field) {
    const js = journalsByField.get(field);
    const wrap = el('div', { class: 'tx-journals' });
    if (!js || !js.length) { wrap.appendChild(el('p', { class: 'tx-none' }, 'No specialty journal is placed in this field yet.')); return { wrap: wrap, text: '' }; }
    // in the field's own order (W&L combined score, best first), as "count each group's top N" counts them
    wrap.appendChild(el('p', { class: 'tx-label' }, js.length + ' specialty journal' + (js.length === 1 ? '' : 's') + ', by W&L score'));
    const ul = el('ul');
    js.forEach((j, i) => {
      const li = el('li');
      li.appendChild(el('span', { class: 'tx-rank' }, (i + 1) + '.'));
      li.appendChild(el('span', null, ' ' + j.name));
      if (j.host) li.appendChild(el('span', { class: 'text-muted' }, ' — ' + j.host));
      li.appendChild(el('span', { class: 'tx-counts' }, j.score >= 0 ? '  W&L score ' + j.score : '  not scored by W&L'));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return { wrap: wrap, text: js.map((j) => j.name + ' ' + j.host).join(' ') };
  }

  function render(n, depth, parent, withJournals) {
    const d = el('details', { class: 'tx-node tx-l' + depth });
    const sum = el('summary');
    sum.appendChild(el('span', { class: 'tx-name' }, n.n));
    sum.appendChild(counts(n.c));
    d.appendChild(sum);
    const body = el('div', { class: 'tx-body' });
    if (n.d) body.appendChild(el('p', { class: 'tx-desc' }, n.d));
    if (n.x && n.x.length) body.appendChild(el('p', { class: 'tx-also' }, 'Also listed under: ' + n.x.join('; ')));
    let jtext = '';
    if (withJournals && depth === 1) { const jb = journalBlock(n.n); body.appendChild(jb.wrap); jtext = jb.text; }
    body.appendChild(sourcesBlock(n.s));
    const rec = { el: d, text: fold(n.n + ' ' + (n.d || '') + ' ' + jtext), parent: parent, kids: [] };
    if (parent) parent.kids.push(rec);
    nodes.push(rec);
    if (n.k && n.k.length) {
      const kids = el('div', { class: 'tx-kids' });
      kids.appendChild(el('p', { class: 'tx-label' }, n.k.length + ' ' + LEVEL[Math.min(depth + 1, 3)] + (n.k.length === 1 ? '' : 's')));
      n.k.forEach((k) => kids.appendChild(render(k, depth + 1, rec, withJournals)));
      body.appendChild(kids);
    }
    d.appendChild(body);
    return d;
  }

  function filter(q) {
    q = fold(q.trim());
    let hits = 0;
    const match = new Map();
    // a node shows when it or anything under it matches; it opens when something under it matches
    const visit = (r) => {
      let any = !q || r.text.includes(q);
      if (q && r.text.includes(q)) hits++;
      let below = false;
      r.kids.forEach((k) => { if (visit(k)) below = true; });
      match.set(r, any || below);
      r.el.hidden = !(any || below);
      if (q) r.el.open = below;
      return any || below;
    };
    nodes.filter((r) => !r.parent).forEach(visit);
    $('findNote').textContent = q ? hits + ' match' + (hits === 1 ? '' : 'es') : '';
    if (!q) nodes.forEach((r) => { r.el.hidden = false; });
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
    // field name -> its specialty journals, best W&L score first, with the publishing school (or press)
    data.journals.forEach((j) => {
      (j[3] || []).forEach(([fi, wl, score]) => {
        const field = data.subjects[fi];
        const host = j[5] ? (j[5][0] || j[5][3] || '') : '';
        if (!journalsByField.has(field)) journalsByField.set(field, []);
        journalsByField.get(field).push({ name: j[0], wl: wl, score: score == null ? -1 : score, host: host });
      });
    });
    journalsByField.forEach((v) => v.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)));
    $('snapshot').textContent = 'research tree of ' + fmtDate(tree.generated);
    document.querySelectorAll('.snap').forEach((s) => { s.textContent = fmtDate(tree.generated); });
    const areas = $('areas');
    tree.areas.forEach((a) => areas.appendChild(render(a, 0, null, true)));
    const app = $('approaches');
    // the approaches' children are subject fields (where the approach concentrates), not the place of journals
    (tree.approaches || []).forEach((a) => app.appendChild(render(a, 0, null, false)));
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
    $('closeAll').addEventListener('click', () => nodes.forEach((r) => { r.el.open = false; }));
    $('loading').remove();
    document.querySelectorAll('.ins-section').forEach((s) => { s.hidden = false; });
    const want = decodeURIComponent((location.hash || '').slice(1));
    if (want && !['tree', 'how', 'sources'].includes(want)) { $('find').value = want; filter(want); $('tree').scrollIntoView(); }
    else if (location.hash) { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); }
  }).catch((e) => {
    $('loading').textContent = 'The tree could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
