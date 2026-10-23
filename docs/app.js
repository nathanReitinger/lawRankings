// Law School Rankings: everything is computed in the browser from data/*.json (written by build_data.py)
(function () {
  'use strict';

  const GENERAL_TIERS = [['3', 'Top 3'], ['10', 'Top 10'], ['25', 'Top 25'], ['50', 'Top 50'], ['all', 'All']];
  const SPECIALTY_TIERS = [['3', 'Top 3'], ['5', 'Top 5'], ['10', 'Top 10'], ['all', 'All']];
  const STORAGE_KEY = 'lawRankings.v2';
  const SELECTED = ['bg-green-200', 'text-green-900', 'border-green-300', 'shadow-md'];
  const UNSELECTED = ['bg-gray-100', 'text-gray-700', 'hover:bg-gray-200'];
  const desktop = window.matchMedia('(min-width: 768px)');

  let DATA, META, state;
  const titleChunks = {};   // chunk name -> Promise of title array
  const openSchools = new Set();

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const recall = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const fmtDate = (iso, opts) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' }) : '?';

  ////////////////////////////////////////////// state (URL hash > localStorage > defaults)

  function defaultState() {
    const to = Math.min(new Date().getFullYear(), META.years.max);
    return { general: '10', groups: [], subjects: [], tier: '10', from: to - 10, to: to, us: true, minor: false };
  }

  function cleanState(s) {
    const d = defaultState();
    const out = Object.assign({}, d, s || {});
    if (out.general !== null && !GENERAL_TIERS.some(([v]) => v === out.general)) out.general = d.general;
    if (!SPECIALTY_TIERS.some(([v]) => v === out.tier)) out.tier = d.tier;
    out.groups = (out.groups || []).filter((g) => DATA.groups.includes(g));
    out.subjects = (out.subjects || []).filter((g) => DATA.subjects.includes(g));
    out.from = clampYear(out.from, d.from);
    out.to = clampYear(out.to, d.to);
    if (out.from > out.to) [out.from, out.to] = [out.to, out.from];
    out.us = !!out.us;
    out.minor = !!out.minor;
    return out;
  }

  function clampYear(y, fallback) {
    y = parseInt(y, 10);
    if (isNaN(y)) return fallback;
    return Math.max(META.years.min, Math.min(META.years.max, y));
  }

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has('g')) return null;
    const split = (k) => (h.get(k) ? h.get(k).split('|') : []);
    const years = (h.get('y') || '').split('-');
    return {
      general: h.get('g') === 'none' ? null : h.get('g'),
      groups: split('grp'),
      subjects: split('sub'),
      tier: h.get('t'),
      from: years[0],
      to: years[1],
      us: h.get('us') !== '0',
      minor: h.get('minor') === '1',
    };
  }

  function saveState() {
    const h = new URLSearchParams();
    h.set('g', state.general || 'none');
    if (state.groups.length) h.set('grp', state.groups.join('|'));
    if (state.subjects.length) h.set('sub', state.subjects.join('|'));
    h.set('t', state.tier);
    h.set('y', state.from + '-' + state.to);
    h.set('us', state.us ? '1' : '0');
    if (state.minor) h.set('minor', '1');
    history.replaceState(null, '', '#' + h.toString());
    store(STORAGE_KEY, JSON.stringify(state));
  }

  ////////////////////////////////////////////// ranking

  // each selected category is an "area"; school score = geometric mean over areas of (adjusted count + 1), like CSrankings
  function areaList() {
    const areas = [];
    const n = state.tier === 'all' ? Infinity : +state.tier;
    const inTier = (r, cut) => cut === Infinity || (r >= 1 && r <= cut);
    if (state.general) {
      const cut = state.general === 'all' ? Infinity : +state.general;
      areas.push({ label: 'General ' + tierLabel(GENERAL_TIERS, state.general), test: (j) => j[2] !== null && inTier(j[2], cut) });
    }
    state.groups.forEach((name) => {
      const gi = DATA.groups.indexOf(name);
      areas.push({ label: name, test: (j) => j[4].some(([g, r]) => g === gi && inTier(r, n)) });
    });
    state.subjects.forEach((name) => {
      const si = DATA.subjects.indexOf(name);
      areas.push({ label: name, test: (j) => j[3].some(([s, r]) => s === si && inTier(r, n)) });
    });
    return areas;
  }

  function compute() {
    const areas = areaList();
    const A = areas.length;
    if (!A) return { areas, rows: [], journals: 0 };
    const jAreas = DATA.journals.map((j) => areas.reduce((acc, ar, i) => (ar.test(j) ? acc.concat(i) : acc), []));
    const P = DATA.papers, C = DATA.credits;
    const bySchool = new Map();
    for (let k = 0; k < C.paper.length; k++) {
      const p = C.paper[k];
      const y = P.year[p];
      if (y < state.from || y > state.to) continue;
      if (state.minor && P.minor[p]) continue;
      const as = jAreas[P.journal[p]];
      if (!as.length) continue;
      const person = C.person[k];
      const w = 1 / P.authors[p];
      for (const s of DATA.people[person][1]) {
        if (state.us && !DATA.schools[s][1]) continue;
        let e = bySchool.get(s);
        if (!e) { e = { areas: new Float64Array(A), faculty: new Map() }; bySchool.set(s, e); }
        for (const a of as) e.areas[a] += w;
        let f = e.faculty.get(person);
        if (!f) { f = { adj: 0, papers: [] }; e.faculty.set(person, f); }
        f.adj += w;
        f.papers.push(p);
      }
    }
    const rows = [];
    bySchool.forEach((e, s) => {
      let prod = 1;
      e.areas.forEach((c) => { prod *= c + 1; });
      rows.push({ school: s, score: Math.pow(prod, 1 / A), faculty: e.faculty });
    });
    rows.sort((a, b) => b.score - a.score || DATA.schools[a.school][0].localeCompare(DATA.schools[b.school][0]));
    return { areas, rows, journals: jAreas.filter((a) => a.length).length };
  }

  ////////////////////////////////////////////// rendering

  function tierLabel(tiers, v) { return (tiers.find(([x]) => x === v) || [, v])[1]; }

  function makeButton(label, onClick, extra) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.className = 'px-2 py-1 rounded-md border transition-colors duration-200 text-left inline-block ' + (extra || '');
    btn.addEventListener('click', onClick);
    return btn;
  }

  function paint(btn, on) {
    btn.classList.remove(...(on ? UNSELECTED : SELECTED));
    btn.classList.add(...(on ? SELECTED : UNSELECTED));
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function buildFilters() {
    const gen = $('generalButtons');
    GENERAL_TIERS.forEach(([v, label]) => {
      const b = makeButton(label, () => { state.general = state.general === v ? null : v; update(); }, 'text-sm');
      b.dataset.general = v;
      gen.appendChild(b);
    });

    const tiers = $('tierButtons');
    SPECIALTY_TIERS.forEach(([v, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ranking-button';
      b.textContent = label;
      b.dataset.tier = v;
      b.addEventListener('click', () => { state.tier = v; update(); });
      tiers.appendChild(b);
    });

    const toggle = (list, name) => {
      const i = state[list].indexOf(name);
      if (i >= 0) state[list].splice(i, 1); else state[list].push(name);
      update();
    };
    DATA.groups.forEach((g) => {
      const b = makeButton(g, () => toggle('groups', g), 'text-sm');
      b.dataset.group = g;
      $('groupButtons').appendChild(b);
    });
    DATA.subjects.forEach((s) => {
      const b = makeButton(s, () => toggle('subjects', s), 'text-xs');
      b.dataset.subject = s;
      $('subjectButtons').appendChild(b);
    });

    $('selectAllSpecialty').addEventListener('click', () => { state.groups = DATA.groups.slice(); update(); });
    $('clearFilters').addEventListener('click', () => { state.groups = []; state.subjects = []; update(); });

    ['fromYear', 'toYear'].forEach((id) => {
      const input = $(id);
      input.min = META.years.min;
      input.max = META.years.max;
      input.addEventListener('change', () => {
        state.from = clampYear($('fromYear').value, state.from);
        state.to = clampYear($('toYear').value, state.to);
        if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
        update();
      });
    });
    $('usOnly').addEventListener('change', (e) => { state.us = e.target.checked; update(); });
    $('skipMinor').addEventListener('change', (e) => { state.minor = e.target.checked; update(); });
  }

  function syncFilters() {
    document.querySelectorAll('[data-general]').forEach((b) => paint(b, b.dataset.general === state.general));
    document.querySelectorAll('[data-group]').forEach((b) => paint(b, state.groups.includes(b.dataset.group)));
    document.querySelectorAll('[data-subject]').forEach((b) => paint(b, state.subjects.includes(b.dataset.subject)));
    document.querySelectorAll('[data-tier]').forEach((b) => b.classList.toggle('selected', b.dataset.tier === state.tier));
    if (state.subjects.length) $('moreSubjects').open = true;
    $('fromYear').value = state.from;
    $('toYear').value = state.to;
    $('usOnly').checked = state.us;
    $('skipMinor').checked = state.minor;
  }

  function summaryText(result) {
    const parts = result.areas.map((a) => a.label);
    const spec = state.groups.length + state.subjects.length;
    if (spec) parts.push('specialty ' + tierLabel(SPECIALTY_TIERS, state.tier).toLowerCase());
    return { what: parts.join(' + ') || 'nothing selected', years: state.from + '–' + state.to };
  }

  function renderTable(result) {
    const container = $('school-table');
    const s = summaryText(result);
    $('mobileSummary').innerHTML = '<b>' + esc(s.what) + '</b><br>' + esc(s.years) + (state.us ? ' · US schools' : '');
    $('selectionSummary').textContent = result.areas.length
      ? s.what + ' · ' + s.years + ' · ' + result.journals + ' journals · ' + result.rows.length + ' schools'
      : '';
    $('showResults').textContent = result.rows.length ? 'Show ' + result.rows.length + ' schools' : 'Show results';

    if (!result.areas.length) {
      container.innerHTML = '<p class="p-4 font-crimson text-gray-600">Pick a General tier or at least one Specialty to rank schools.</p>';
      return;
    }
    if (!result.rows.length) {
      container.innerHTML = '<p class="p-4 font-crimson text-gray-600">No faculty publications match these filters.</p>';
      return;
    }

    let html = '<table class="table table-bordered table-hover school-table"><thead><tr>' +
      '<th>Rank</th><th>School</th><th>Score</th><th>Faculty #</th></tr></thead><tbody>';
    result.rows.forEach((r, i) => {
      const open = openSchools.has(r.school);
      html += '<tr class="school-row" tabindex="0" data-school="' + r.school + '" aria-expanded="' + open + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td><span class="arrow">' + (open ? '&#9660;' : '&#9654;') + '</span>' + esc(DATA.schools[r.school][0]) + '</td>' +
        '<td>' + r.score.toFixed(1) + '</td>' +
        '<td>' + r.faculty.size + '</td></tr>';
      if (open) html += facultyRow(r);
    });
    container.innerHTML = html + '</tbody></table>';
    container._rows = new Map(result.rows.map((r) => [r.school, r]));
    if (openSchools.size) fillTitles(container);
  }

  function facultyRow(r) {
    const people = [...r.faculty].sort((a, b) => b[1].adj - a[1].adj || DATA.people[a[0]][0].localeCompare(DATA.people[b[0]][0]));
    let html = '<tr class="faculty-accordion"><td colspan="4"><div class="faculty-content">' +
      '<table class="table table-bordered table-hover"><thead><tr><th>Faculty Member</th>' +
      '<th><span class="hidden md:inline">Publications</span><span class="md:hidden">Pubs</span></th>' +
      '<th><span class="hidden md:inline">Adjusted Count</span><span class="md:hidden">Adj.</span></th></tr></thead><tbody>';
    people.forEach(([person, f]) => {
      html += '<tr class="person-row" data-papers="' + f.papers.join(',') + '">' +
        '<td>' + esc(DATA.people[person][0]) +
        '<button type="button" class="tooltip-icon" aria-label="Show titles">i<span class="tooltip-text"><em>Loading titles…</em></span></button></td>' +
        '<td>' + f.papers.length + '</td><td>' + f.adj.toFixed(1) + '</td></tr>';
    });
    return html + '</tbody></table></div></td></tr>';
  }

  function toggleSchool(row) {
    const s = +row.dataset.school;
    const next = row.nextElementSibling;
    if (openSchools.has(s)) {
      openSchools.delete(s);
      if (next && next.classList.contains('faculty-accordion')) next.remove();
      row.querySelector('.arrow').innerHTML = '&#9654;';
      row.setAttribute('aria-expanded', 'false');
    } else {
      openSchools.add(s);
      row.insertAdjacentHTML('afterend', facultyRow($('school-table')._rows.get(s)));
      row.querySelector('.arrow').innerHTML = '&#9660;';
      row.setAttribute('aria-expanded', 'true');
      fillTitles(row.nextElementSibling);
    }
  }

  ////////////////////////////////////////////// titles (per-decade files, fetched on first use)

  function loadChunk(name) {
    if (!titleChunks[name]) {
      titleChunks[name] = fetch('data/titles/' + name + '.json').then((r) => {
        if (!r.ok) throw new Error('titles ' + name + ': ' + r.status);
        return r.json();
      });
    }
    return titleChunks[name];
  }

  function chunkOf(p) { return DATA.title_chunks.find(([, start, end]) => p >= start && p < end); }

  function titlesFor(papers) {
    const names = [...new Set(papers.map((p) => chunkOf(p)[0]))];
    return Promise.all(names.map(loadChunk)).then(() => Promise.all(papers.map((p) => {
      const [name, start] = chunkOf(p);
      return titleChunks[name].then((list) => list[p - start]);
    })));
  }

  function titleListHtml(papers, titles) {
    const items = papers.map((p, i) => ({ p, t: titles[i] }))
      .sort((a, b) => DATA.papers.year[b.p] - DATA.papers.year[a.p]);
    return '<ul class="title-list">' + items.map(({ p, t }) => {
      const j = DATA.journals[DATA.papers.journal[p]][0];
      const n = DATA.papers.authors[p];
      return '<li>' + esc(t) + ' <span class="title-meta">— ' + esc(j) + ', ' + DATA.papers.year[p] +
        (n > 1 ? ' (' + n + ' authors)' : '') + '</span></li>';
    }).join('') + '</ul>';
  }

  function fillTitles(scope) {
    scope.querySelectorAll('.person-row').forEach((tr) => {
      const papers = tr.dataset.papers.split(',').map(Number);
      titlesFor(papers).then((titles) => {
        tr.querySelector('.tooltip-text').innerHTML = titleListHtml(papers, titles);
      }).catch(() => {
        tr.querySelector('.tooltip-text').innerHTML = '<em>Could not load titles.</em>';
      });
    });
  }

  function toggleTitles(personRow) {
    const next = personRow.nextElementSibling;
    if (next && next.classList.contains('titles-row')) { next.remove(); return; }
    personRow.insertAdjacentHTML('afterend', '<tr class="titles-row"><td colspan="3"><em class="text-gray-500 text-sm">Loading titles…</em></td></tr>');
    const papers = personRow.dataset.papers.split(',').map(Number);
    titlesFor(papers).then((titles) => {
      personRow.nextElementSibling.firstElementChild.innerHTML = titleListHtml(papers, titles);
    });
  }

  ////////////////////////////////////////////// page

  function update() {
    saveState();
    syncFilters();
    renderTable(compute());
  }

  function renderDataAsOf() {
    const p = META.papers_collected, f = META.faculty_collected;
    $('dataAsOf').innerHTML =
      '<span class="font-semibold">Articles collected ' + esc(fmtDate(p.from)) + ' – ' + esc(fmtDate(p.to)) + '</span>' +
      ' · faculty lists ' + esc(fmtDate(f.to, { month: 'short', year: 'numeric' })) +
      ' · W&amp;L ranks ' + esc(META.rankings.edition) +
      ' · <a href="faq.html#data" class="text-blue-600 hover:underline">details</a>';
  }

  function wirePage() {
    $('school-table').addEventListener('click', (e) => {
      if (e.target.closest('.tooltip-icon')) { toggleTitles(e.target.closest('.person-row')); return; }
      const row = e.target.closest('.school-row');
      if (row) toggleSchool(row);
    });
    $('school-table').addEventListener('keydown', (e) => {
      const row = e.target.closest('.school-row');
      if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSchool(row); }
    });

    const setDrawer = (open) => document.body.classList.toggle('filters-open', open);
    $('openFilters').addEventListener('click', () => setDrawer(true));
    $('closeFilters').addEventListener('click', () => setDrawer(false));
    $('drawerBackdrop').addEventListener('click', () => setDrawer(false));
    $('showResults').addEventListener('click', () => { setDrawer(false); window.scrollTo({ top: 0 }); });

    // desktop: resizable filter pane, width remembered
    const leftPane = $('leftPane');
    const applyWidth = () => {
      if (desktop.matches) {
        leftPane.style.width = (recall('leftPaneWidth') || 250) + 'px';
        leftPane.style.minWidth = '180px';
      } else {
        leftPane.style.width = 'min(320px, 86vw)';
        leftPane.style.minWidth = '';
        document.body.classList.remove('filters-open');
      }
    };
    applyWidth();
    desktop.addEventListener('change', applyWidth);
    $('dragHandle').addEventListener('mousedown', (e) => {
      document.body.style.cursor = 'col-resize';
      const startX = e.clientX, startWidth = leftPane.offsetWidth;
      const onMove = (ev) => {
        const w = Math.max(200, startWidth + (ev.clientX - startX));
        leftPane.style.width = w + 'px';
        store('leftPaneWidth', w);
      };
      const onUp = () => {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
    window.addEventListener('hashchange', () => {
      const fromHash = readHash();
      if (fromHash) { state = cleanState(fromHash); syncFilters(); renderTable(compute()); }
    });
  }

  Promise.all([
    fetch('data/data.json').then((r) => r.json()),
    fetch('data/meta.json').then((r) => r.json()),
  ]).then(([data, meta]) => {
    DATA = data;
    META = meta;
    let saved = null;
    try { saved = JSON.parse(recall(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    state = cleanState(readHash() || saved);
    renderDataAsOf();
    buildFilters();
    wirePage();
    update();
    $('loadingSpinner').classList.add('hidden');
    // warm the titles for the default view so the first hover is instant
    const decades = DATA.title_chunks.filter(([name]) => name !== 'early' && +name + 9 >= state.from && +name <= state.to);
    decades.forEach(([name]) => loadChunk(name).catch(() => {}));
  }).catch((err) => {
    $('loadingSpinner').classList.add('hidden');
    $('school-table').innerHTML = '<p class="p-4 text-red-700">Could not load the data (' + esc(err.message) + ').</p>';
  });
})();
