// Law School Rankings: rankings are computed in the browser from data/*.json (written by build_data.py)
(function () {
  'use strict';

  // Flagship law reviews are ranked by their school's rank, specialty journals by W&L rank. Flagship reviews come in
  // tiers of the school ranking chosen (2026-10-25: U.S. News overall, or U.S. News peer reputation from TaxProf
  // Blog), like CSrankings' venue groups; checked tiers form one "Flagship" area. DATA.journal_ranks[source][j]: the
  // school's rank (0 = unranked, -1 = not a main law review / no host school); j[2] is the U.S. News overall rank.
  const BANDS = [
    { id: '1', range: '1–3', lo: 1, hi: 3 },
    { id: '2', range: '4–25', lo: 4, hi: 25 },
    { id: '3', range: '26–50', lo: 26, hi: 50 },
    { id: '4', range: '51 and above', lo: 51, hi: Infinity },   // includes schools left unranked
    { id: '5', label: 'Online editions & other general journals', other: true },
  ];
  const SOURCE_SHORT = { usnews: 'US News', peer: 'Peer rank' };
  const HOST_TIERS = ['any', '25', '50', '100'];
  const DEFAULT_BANDS = ['1', '2'];                                     // = main law reviews of the US News top 25
  const STORAGE_KEY = 'lawRankings.v4';
  const MAINTAINER_EMAIL = 'nathan.reitinger@law.northwestern.edu';   // the owner asked for an email button (2026-10-24)
  const REPO = 'https://github.com/nathanReitinger/lawRankings';                                 // v4: tiers became US News tiers
  const COLORS = { general: '#377eb8', specialty: '#ff7f00' };   // flagship blue, specialty orange (CSrankings Set1)

  let DATA, META, state, groupSubjects;
  let journalCats, personPapers;   // journal -> [0 = flagship, 1+g = specialty group g]; person -> their papers
  let current = { areas: [], rows: [] };
  const openSchools = new Set();
  const openPeople = new Set();

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const recall = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const fmtDate = (iso, opts) => (iso ? new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' }) : '?');
  // (math check) sums of 1/n carry float noise: snap before comparing, round halves up when showing one decimal
  const snap = (x) => Math.round(x * 1e9) / 1e9;
  const one = (x) => (Math.round(snap(x) * 10 + 1e-7) / 10).toFixed(1);
  // (stress test, 2026-10-24) a group named in a link is looked up as an own key only: "#s=constructor" crashed the page
  const subjectsOf = (g) => (Object.prototype.hasOwnProperty.call(groupSubjects, g) ? groupSubjects[g] : null);
  const sources = () => (DATA.rank_sources || [['usnews', 'U.S. News overall rank', '']]).map((x) => x[0]);
  // the rank a journal is tiered or filtered by, under the chosen source: a flagship review's school rank, a
  // specialty journal's host school rank
  const rankOf = (ji) => (DATA.journal_ranks && DATA.journal_ranks[state.src] ? DATA.journal_ranks[state.src][ji] : DATA.journals[ji][2]);
  // (audit, 2026-10-25) a journal's flagship tier: general journals only (data built before host_ranks existed kept
  // each specialty journal's host-school rank in journal_ranks, which put specialty journals into the flagship tiers)
  const flagshipRank = (ji) => (DATA.journals[ji][2] === null || DATA.journals[ji][2] === undefined ? null
    : DATA.host_ranks ? rankOf(ji) : DATA.journals[ji][2]);
  // a specialty journal's host school's rank, for the host filter
  const hostRankOf = (ji) => (DATA.host_ranks ? (DATA.host_ranks[state.src] || DATA.host_ranks.usnews)[ji] : rankOf(ji));
  const bandLabel = (b) => (b.other ? b.label : (SOURCE_SHORT[state.src] || 'US News') + ' ' + b.range);

  ////////////////////////////////////////////// state: URL hash > localStorage > defaults

  function defaultState() {
    const to = Math.min(new Date().getFullYear(), META.years.max);
    return { bands: DEFAULT_BANDS.slice(), groups: {}, cutoff: '10', from: to - 10, to: to, region: 'us', minor: false, src: 'usnews', host: 'any' };
  }

  function clampYear(y, fallback) {
    y = parseInt(y, 10);
    return isNaN(y) ? fallback : Math.max(META.years.min, Math.min(META.years.max, y));
  }

  function cleanState(s) {
    const d = defaultState();
    const out = Object.assign({}, d, s || {});
    if (!out.groups || typeof out.groups !== 'object' || Array.isArray(out.groups)) out.groups = {};
    delete out.latest;                                   // a stored view's marker, not part of the state
    out.bands = (Array.isArray(out.bands) ? out.bands : d.bands).filter((b) => BANDS.some((x) => x.id === b));
    const groups = {};
    Object.entries(out.groups || {}).forEach(([g, subs]) => {
      if (!subjectsOf(g)) return;
      const ok = (Array.isArray(subs) ? subs : []).filter((x) => subjectsOf(g).includes(x));
      if (ok.length) groups[g] = ok;
    });
    out.groups = groups;
    if (!['3', '5', '10', '25', 'all'].includes(out.cutoff)) out.cutoff = d.cutoff;
    out.from = clampYear(out.from, d.from);
    out.to = clampYear(out.to, d.to);
    if (out.from > out.to) [out.from, out.to] = [out.to, out.from];
    out.region = out.region === 'all' ? 'all' : 'us';
    if (!sources().includes(out.src)) out.src = 'usnews';
    if (!HOST_TIERS.includes(out.host)) out.host = 'any';
    out.minor = !!out.minor;
    return out;
  }

  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has('f')) return null;
    const groups = {};
    (h.get('s') || '').split('|').filter(Boolean).forEach((part) => {
      const [g, subs] = part.split(':');
      groups[g] = subs ? subs.split(';') : (subjectsOf(g) || []).slice();
    });
    const years = (h.get('y') || '').split('-');
    return { bands: (h.get('f') || '').split('.').filter(Boolean), groups, cutoff: h.get('c'),
      from: years[0], to: years[1], region: h.get('r'), minor: h.get('m') === '1', src: h.get('k') || 'usnews', host: h.get('h') || 'any' };
  }

  function saveState() {
    const h = new URLSearchParams();
    h.set('f', state.bands.join('.') || 'none');
    const parts = Object.entries(state.groups).map(([g, subs]) =>
      subs.length === groupSubjects[g].length ? g : g + ':' + subs.join(';'));
    if (parts.length) h.set('s', parts.join('|'));
    h.set('c', state.cutoff);
    h.set('y', state.from + '-' + state.to);
    h.set('r', state.region);
    if (state.minor) h.set('m', '1');
    if (state.src !== 'usnews') h.set('k', state.src);
    if (state.host !== 'any') h.set('h', state.host);
    history.replaceState(null, '', '#' + h.toString());
    // (stress test, 2026-10-24) the untouched default view was stored on the first visit, so that visitor's year
    // window never moved on with new data: only a view that differs from the default is stored, and a window that
    // ends at the latest year is stored as "the latest N years"
    const d = defaultState();
    const same = JSON.stringify(cleanState(state)) === JSON.stringify(d);
    if (same) { try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* private mode */ } return; }
    store(STORAGE_KEY, JSON.stringify(Object.assign({}, state, state.to === d.to ? { latest: state.to - state.from } : {})));
  }

  // a stored view: a window that ended at the latest year then ends at the latest year now
  function restoreSaved(saved) {
    if (!saved || typeof saved !== 'object') return null;
    if (typeof saved.latest === 'number' && saved.latest >= 0) {
      const d = defaultState();
      saved = Object.assign({}, saved, { to: d.to, from: d.to - saved.latest });
    }
    return saved;
  }

  ////////////////////////////////////////////// ranking

  function inBand(usRank, band) {
    if (usRank === null || usRank === undefined) return false;
    if (band.other || usRank === -1) return !!band.other && usRank === -1;
    const r = usRank === 0 ? Infinity : usRank;
    return r >= band.lo && r <= band.hi;
  }

  // a specialty group's journals: in any checked subject, re-ranked by their best W&L score in those subjects
  function hostOk(ji) {
    if (state.host === 'any') return true;
    const r = hostRankOf(ji);
    return r > 0 && r <= +state.host;
  }

  function groupJournals(subjectIdx, cutoff) {
    const cands = [];
    DATA.journals.forEach((j, ji) => {
      if (!hostOk(ji)) return;           // 2026-10-25: only journals of schools ranked in the chosen range
      let member = false, best = null;
      for (const [s, , score] of j[3]) {
        if (!subjectIdx.has(s)) continue;
        member = true;
        if (score !== null && (best === null || score > best)) best = score;
      }
      if (member) cands.push([ji, best]);
    });
    if (cutoff === 'all') return new Set(cands.map((c) => c[0]));
    return new Set(cands.filter((c) => c[1] !== null).sort((a, b) => b[1] - a[1]).slice(0, +cutoff).map((c) => c[0]));
  }

  function areaList() {
    const list = [];
    if (state.bands.length) {
      const bands = BANDS.filter((b) => state.bands.includes(b.id));
      const set = new Set();
      DATA.journals.forEach((j, ji) => { if (bands.some((b) => inBand(flagshipRank(ji), b))) set.add(ji); });
      list.push({ label: 'Flagship', short: 'flagship', color: COLORS.general, cls: 'c-general', journals: set });
    }
    DATA.groups.forEach((g) => {
      const subs = state.groups[g];
      if (!subs || !subs.length) return;
      const idx = new Set(subs.map((s) => DATA.subjects.indexOf(s)).filter((i) => i >= 0));
      list.push({ label: g, short: shortName(g), color: COLORS.specialty, cls: 'c-specialty', journals: groupJournals(idx, state.cutoff) });
    });
    return list;
  }

  // (audit, 2026-10-25) short names for the fourteen areas the subject tree has now
  const AREA_SHORT = {
    'Constitutional & Public Law': 'con & public law', 'Courts, Litigation & Dispute Resolution': 'courts & litigation',
    'Criminal Law & Justice': 'criminal law', 'Business & Financial Law': 'business & finance', 'Tax, Trusts & Estates': 'tax & estates',
    'Property, Environment & Natural Resources': 'property & environment', 'International & Comparative Law': 'international',
    'Science, Technology & IP': 'tech & IP', 'Health Law & Bioethics': 'health law', 'Civil Rights, Equality & Family': 'civil rights & family',
    'Labor & Employment': 'labor & employment', 'Legal Profession & Education': 'profession & education',
    'Legal Theory, Humanities & Society': 'theory & society', 'Interdisciplinary Methods': 'methods', 'General & Policy Journals': 'general & policy', 'Other specialty journals': 'other specialty',
  };
  function shortName(g) {
    return AREA_SHORT[g] || g.toLowerCase();
  }

  function compute() {
    const areas = areaList();
    const A = areas.length;
    if (!A) return { areas, rows: [] };
    const jAreas = DATA.journals.map((j, ji) => areas.reduce((acc, ar, i) => (ar.journals.has(ji) ? acc.concat(i) : acc), []));
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
        if (state.region === 'us' && !DATA.schools[s][1]) continue;
        let e = bySchool.get(s);
        if (!e) { e = { areas: new Float64Array(A), faculty: new Map() }; bySchool.set(s, e); }
        let f = e.faculty.get(person);
        if (!f) { f = { adj: 0, papers: [], byArea: new Float64Array(A) }; e.faculty.set(person, f); }
        f.adj += w;
        f.papers.push(p);
        for (const a of as) { e.areas[a] += w; f.byArea[a] += w; }
      }
    }
    const rows = [];
    bySchool.forEach((e, s) => {
      let prod = 1;
      e.areas.forEach((c) => { prod *= c + 1; });
      rows.push({ school: s, score: snap(Math.pow(prod, 1 / A)), faculty: e.faculty });
    });
    rows.sort((a, b) => b.score - a.score || DATA.schools[a.school][0].localeCompare(DATA.schools[b.school][0]));
    return { areas, rows };
  }

  ////////////////////////////////////////////// filter panel

  function buildPanel() {
    const gen = $('generalBody');
    BANDS.forEach((b) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><span class="hovertip" data-band-toggle="' + b.id + '" title="Show/hide journals">&#9658;</span> <label for="band' + b.id + '" id="bandLabel' + b.id + '">' + esc(bandLabel(b)) + '</label>' +
        '<div class="sub-list" id="bandList' + b.id + '" hidden></div></td>' +
        '<td class="chk"><input type="checkbox" id="band' + b.id + '" data-band="' + b.id + '"></td>';
      gen.appendChild(tr);
    });
    (DATA.rank_sources || [['usnews', 'U.S. News overall rank', '']]).forEach(([id, label, ed]) =>
      $('rankSource').add(new Option(label.replace(/^U\.S\. News /, 'U.S. News ') + (ed ? ' (' + ed + ')' : ''), id)));
    const spec = $('specialtyBody');
    DATA.groups.forEach((g, gi) => {
      const subs = groupSubjects[g] || [];
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><span class="hovertip" data-group-toggle="' + gi + '" title="Show/hide fields">&#9658;</span> <label for="grp' + gi + '">' + esc(g) + '</label>' +
        '<div class="sub-list" id="grpList' + gi + '" hidden><p>fields (open one to see its journals)</p><table><tbody>' +
        subs.map((s, si) => '<tr><td><span class="hovertip" data-field-toggle="' + gi + '_' + si + '" title="Show/hide journals">&#9658;</span> ' +
          '<label for="sub' + gi + '_' + si + '">' + esc(s) + '</label> <small class="text-muted">(' + fieldJournalIds(s).length + ')</small>' +
          '<div class="sub-list" id="fieldList' + gi + '_' + si + '" data-field="' + esc(s) + '" hidden></div></td>' +
          '<td class="chk"><input type="checkbox" id="sub' + gi + '_' + si + '" data-group="' + esc(g) + '" data-subject="' + esc(s) + '"></td></tr>').join('') +
        '</tbody></table></div></td>' +
        '<td class="chk"><input type="checkbox" id="grp' + gi + '" data-group-parent="' + esc(g) + '"></td>';
      spec.appendChild(tr);
    });

    $('areaPanel').addEventListener('click', (e) => {
      const bt = e.target.closest('[data-band-toggle]');
      if (bt) { toggleList(bt, $('bandList' + bt.dataset.bandToggle), () => bandJournals(bt.dataset.bandToggle)); return; }
      const gt = e.target.closest('[data-group-toggle]');
      if (gt) { toggleList(gt, $('grpList' + gt.dataset.groupToggle)); return; }
      const ft = e.target.closest('[data-field-toggle]');
      if (ft) { const list = $('fieldList' + ft.dataset.fieldToggle); toggleList(ft, list, () => fieldJournals(list.dataset.field)); }
    });
    $('areaPanel').addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.band) {
        state.bands = t.checked ? state.bands.concat(t.dataset.band) : state.bands.filter((b) => b !== t.dataset.band);
        state.bands.sort();
      } else if (t.dataset.groupParent) {
        const g = t.dataset.groupParent;
        if (t.checked) state.groups[g] = groupSubjects[g].slice(); else delete state.groups[g];
      } else if (t.dataset.subject) {
        const g = t.dataset.group;
        const cur = new Set(state.groups[g] || []);
        if (t.checked) cur.add(t.dataset.subject); else cur.delete(t.dataset.subject);
        if (cur.size) state.groups[g] = groupSubjects[g].filter((s) => cur.has(s)); else delete state.groups[g];
      } else if (t.id === 'skipMinor') {
        state.minor = t.checked;
      } else if (t.id === 'cutoff') {
        state.cutoff = t.value;
      } else if (t.id === 'rankSource') {
        state.src = t.value;
      } else if (t.id === 'hostTier') {
        state.host = t.value;
      } else {
        return;
      }
      update();
    });

    const toggleGeneral = () => { state.bands = state.bands.length ? [] : DEFAULT_BANDS.slice(); update(); };
    const toggleSpecialty = () => {
      if (Object.keys(state.groups).length) state.groups = {};
      else DATA.groups.forEach((g) => { state.groups[g] = groupSubjects[g].slice(); });
      update();
    };
    $('toggleGeneral').addEventListener('click', toggleGeneral);
    $('pillGeneral').addEventListener('click', toggleGeneral);
    $('toggleSpecialty').addEventListener('click', toggleSpecialty);
    $('pillSpecialty').addEventListener('click', toggleSpecialty);

    for (let y = META.years.max; y >= META.years.min; y--) {
      $('fromYear').add(new Option(y, y));
      $('toYear').add(new Option(y, y));
    }
    ['fromYear', 'toYear'].forEach((id) => $(id).addEventListener('change', () => {
      state.from = clampYear($('fromYear').value, state.from);
      state.to = clampYear($('toYear').value, state.to);
      if (state.from > state.to) [state.from, state.to] = [state.to, state.from];
      update();
    }));
    $('region').addEventListener('change', (e) => { state.region = e.target.value; update(); });
  }

  function toggleList(arrow, list, fill) {
    const show = list.hidden;
    if (show && fill) list.innerHTML = fill();
    list.hidden = !show;
    arrow.innerHTML = show ? '&#9660;' : '&#9658;';
  }

  const KIND = { online: 'online edition', secondary: 'second journal', non_school: 'not a school\'s journal', foreign: 'outside the US', unmapped: 'school not identified yet' };

  function bandJournals(id) {
    const band = BANDS.find((b) => b.id === id);
    const ids = DATA.journals.map((j, ji) => ji).filter((ji) => inBand(flagshipRank(ji), band))
      .sort((a, b) => ((flagshipRank(a) || 999) - (flagshipRank(b) || 999)) || DATA.journals[a][0].localeCompare(DATA.journals[b][0]));
    const head = band.other
      ? '<p>general journals that are not a school\'s main law review</p>'
      : '<p>school\'s ' + esc(sourceName()) + '</p>';
    const line = (ji) => {
      const j = DATA.journals[ji];
      const [, , kind] = j[5] || ['', '', 'unmapped'];
      if (band.other) return esc(j[0]) + ' <span class="text-muted">(' + esc(KIND[kind] || kind) + ')</span>';
      const r = flagshipRank(ji);
      return (r > 0 ? '#' + r + ' ' : 'unranked ') + esc(j[0]);
    };
    return head + (ids.length ? ids.map((ji) => '<div class="jrnl">' + line(ji) + '</div>').join('') : '<div class="jrnl">none</div>');
  }

  function sourceName() {
    const s = (DATA.rank_sources || []).find((x) => x[0] === state.src);
    return s ? s[1].replace(/^U\.S\. News /, 'U.S. News ') + (s[2] ? ' (' + s[2] + ')' : '') : 'U.S. News rank';
  }

  // a field's journals: W&L rank, the journal, its host school and that school's rank (2026-10-25, the owner: "you
  // click on a topic to see which journals fit that category ... northwestern journal of technology and intellectual
  // property has northwestern usNews rank. And it is specialty law and technology")
  function fieldJournalIds(field) {
    const fi = DATA.subjects.indexOf(field);
    return DATA.journals.map((j, ji) => ji).filter((ji) => DATA.journals[ji][3].some(([s]) => s === fi));
  }

  function fieldJournals(field) {
    const ids = fieldJournalIds(field).sort((a, b) => ((DATA.journals[b][3][0][2] || 0) - (DATA.journals[a][3][0][2] || 0)) || DATA.journals[a][0].localeCompare(DATA.journals[b][0]));
    const line = (ji, i) => {
      const j = DATA.journals[ji];
      // (audit) the place in this field by W&L combined score, which is the order shown and what "top N" counts
      const wl = j[3][0][2] != null ? (i + 1) + '. W&amp;L score ' + j[3][0][2] : 'W&amp;L not scored';
      const [school, , , publisher] = j[5] || ['', '', '', ''];
      const r = hostRankOf(ji);
      const host = school ? esc(school) + ' <span class="text-muted">(' + (SOURCE_SHORT[state.src] || 'US News') + ' ' + (r > 0 ? '#' + r : 'unranked') + ')</span>'
        : (publisher ? '<span class="text-muted">' + esc(publisher) + '</span>' : '<span class="text-muted">publisher not recorded yet</span>');
      return '<div class="jrnl' + (hostOk(ji) ? '' : ' not-counted') + '">' + wl + ' · ' + esc(j[0]) + ' — ' + host + '</div>';
    };
    return '<p>in order of W&amp;L score; host school and its rank</p>' + (ids.length ? ids.map((ji, i) => line(ji, i)).join('') : '<div class="jrnl">none</div>');
  }

  function syncPanel() {
    document.querySelectorAll('[data-band]').forEach((c) => { c.checked = state.bands.includes(c.dataset.band); });
    document.querySelectorAll('[data-group-parent]').forEach((c) => {
      const g = c.dataset.groupParent, n = (state.groups[g] || []).length;
      c.checked = n > 0 && n === groupSubjects[g].length;
      c.indeterminate = n > 0 && n < groupSubjects[g].length;
    });
    document.querySelectorAll('[data-subject]').forEach((c) => { c.checked = (state.groups[c.dataset.group] || []).includes(c.dataset.subject); });
    $('cutoff').value = state.cutoff;
    $('rankSource').value = state.src;
    $('hostTier').value = state.host;
    BANDS.forEach((b) => { const l = $('bandLabel' + b.id); if (l) l.textContent = bandLabel(b); });
    $('skipMinor').checked = state.minor;
    $('fromYear').value = state.from;
    $('toYear').value = state.to;
    $('region').value = state.region;
    const nb = state.bands.length, ng = Object.keys(state.groups).length;
    setSel($('pillGeneral'), nb === 0 ? 'none' : nb === BANDS.length ? 'all' : 'partial');
    setSel($('toggleGeneral'), nb === 0 ? 'none' : nb === BANDS.length ? 'all' : 'partial');
    setSel($('pillSpecialty'), ng === 0 ? 'none' : ng === DATA.groups.length ? 'all' : 'partial');
    setSel($('toggleSpecialty'), ng === 0 ? 'none' : ng === DATA.groups.length ? 'all' : 'partial');
  }

  function setSel(el, which) {
    el.classList.remove('selection-none', 'selection-partial', 'selection-all');
    el.classList.add('selection-' + which);
  }

  ////////////////////////////////////////////// ranking table

  function renderRanking() {
    const win = $('rankingWindow');
    const { areas, rows } = current;
    const nAreas = areas.length;
    $('summary').textContent = nAreas ? rows.length + ' schools · ' + areas.map((a) => a.label).join(' + ') : '';
    $('drawerDone').textContent = rows.length ? 'Show ' + rows.length + ' schools' : 'Show rankings';
    if (!nAreas) {
      win.innerHTML = '<p class="empty-note">Select at least one group of journals on the left' +
        ' (<a href="#" id="resetDefaults">or go back to the default</a>).</p>';
      $('resetDefaults').addEventListener('click', (e) => { e.preventDefault(); state = defaultState(); update(); });
      return;
    }
    if (!rows.length) {
      win.innerHTML = '<p class="empty-note">No faculty articles match these filters.</p>';
      return;
    }
    let html = '<table class="ranking"><thead><tr><th class="num rank-cell">#</th><th>Institution</th>' +
      '<th class="num"><abbr title="Geometric mean, across the selected areas, of the adjusted article counts plus one">Count</abbr></th>' +
      '<th class="num"><abbr title="Faculty with at least one counted article">Faculty</abbr></th></tr></thead><tbody>';
    let rank = 0;
    rows.forEach((r, i) => {
      const open = openSchools.has(r.school);
      if (i === 0 || r.score !== rows[i - 1].score) rank = i + 1;   // tied schools share a rank, as on CSrankings
      html += '<tr class="school' + (i % 2 ? '' : ' alt') + '" data-school="' + r.school + '" tabindex="0" aria-expanded="' + open + '">' +
        '<td class="num rank-cell">' + rank + '</td>' +
        '<td><span class="hovertip">' + (open ? '&#9660;' : '&#9658;') + '</span>&nbsp;' + esc(DATA.schools[r.school][0]) + '</td>' +
        '<td class="num">' + one(r.score) + '</td><td class="num">' + r.faculty.size + '</td></tr>';
      if (open) html += facultyRows(r);
    });
    win.innerHTML = html + '</tbody></table>';
    win.querySelectorAll('tr.person-detail').forEach(fillDetail);
  }

  function facultyRows(r) {
    const people = [...r.faculty].sort((a, b) => b[1].adj - a[1].adj || DATA.people[a[0]][0].localeCompare(DATA.people[b[0]][0]));
    let html = '<tr class="faculty"><td></td><td colspan="3"><table class="faculty-table"><thead><tr><th class="indent"></th>' +
      '<th><abbr title="Click a name to see where they publish">Faculty</abbr></th>' +
      '<th class="num"><abbr title="Articles counted in this ranking"># Pubs</abbr></th>' +
      '<th class="num"><abbr title="Each article counts 1, split between its co-authors">Adj. #</abbr></th></tr></thead><tbody>';
    people.forEach(([person, f], i) => {
      const key = r.school + ':' + person;
      const open = openPeople.has(key);
      // what this person works on (2026-10-25, the owner: "I want zero inferences drawn ... a clear taxonomy ... that
      // pulls information from grouped specialty journals. That's it. If an author only published flagship, then no
      // inference is made. If they have multiple specialty then it might be multi tag"): every area of the specialty
      // journals they published in, all years, each with its count (build_data.py: people[i][4]); nothing for someone
      // with no specialty-journal article
      const tags = (DATA.people[person][4] || []).map(([g, n]) => '<span class="c-specialty" title="' + esc(areaTitle(person, g, n)) + '">' +
        esc(shortName(DATA.groups[g])) + '<span class="tag-n">' + n + '</span></span>').join('');
      html += '<tr class="person' + (i % 2 ? '' : ' alt') + '" data-key="' + key + '" data-person="' + person + '" tabindex="0" aria-expanded="' + open + '">' +
        '<td class="indent"><span class="hovertip">' + (open ? '&#9660;' : '&#9658;') + '</span></td>' +
        '<td>' + esc(DATA.people[person][0]) + ' <span class="areaname">' + tags + '</span>' +
        (DATA.people[person][3] ? ' <a class="bio-link" href="' + esc(DATA.people[person][3]) + '" target="_blank" rel="noopener" title="Faculty page">bio</a>' : '') + '</td>' +
        '<td class="num">' + f.papers.length + '</td>' +
        '<td class="num">' + one(f.adj) + '</td></tr>';
      if (open) html += '<tr class="person-detail" data-key="' + key + '"><td colspan="4"></td></tr>';
    });
    return html + '</tbody></table></td></tr>';
  }

  function toggleSchool(tr) {
    const s = +tr.dataset.school;
    if (openSchools.has(s)) openSchools.delete(s); else openSchools.add(s);
    const r = current.rows.find((x) => x.school === s);
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('faculty')) next.remove();
    if (openSchools.has(s)) {
      tr.insertAdjacentHTML('afterend', facultyRows(r));
      tr.nextElementSibling.querySelectorAll('tr.person-detail').forEach(fillDetail);
    }
    tr.querySelector('.hovertip').innerHTML = openSchools.has(s) ? '&#9660;' : '&#9658;';
    tr.setAttribute('aria-expanded', openSchools.has(s));
  }

  function togglePerson(tr) {
    const key = tr.dataset.key;
    const next = tr.nextElementSibling;
    if (openPeople.has(key)) {
      openPeople.delete(key);
      if (next && next.classList.contains('person-detail')) next.remove();
    } else {
      openPeople.add(key);
      tr.insertAdjacentHTML('afterend', '<tr class="person-detail" data-key="' + key + '"><td colspan="4"></td></tr>');
      fillDetail(tr.nextElementSibling);
    }
    tr.querySelector('.hovertip').innerHTML = openPeople.has(key) ? '&#9660;' : '&#9658;';
    tr.setAttribute('aria-expanded', openPeople.has(key));
  }

  // the drop-down under a faculty member: where they publish (bars, all their articles in the chosen years,
  // whatever journals are selected), and how many of those articles count in this ranking (no article list: the
  // owner, 2026-10-24, "i don't need paper links")
  function fillDetail(detailRow) {
    const [s, person] = detailRow.dataset.key.split(':').map(Number);
    const r = current.rows.find((x) => x.school === s);
    const f = r && r.faculty.get(person);
    if (!f) return;
    const P = DATA.papers;
    const papers = (personPapers.get(person) || []).filter((p) => P.year[p] >= state.from && P.year[p] <= state.to);
    const skipped = state.minor ? papers.filter((p) => P.minor[p]).length : 0;
    const forBars = papers.filter((p) => !(state.minor && P.minor[p]));   // bars respect "skip short pieces"
    const note = '<p class="detail-note">' + f.papers.length + ' of ' + papers.length + ' article' + (papers.length === 1 ? '' : 's') +
      ' (' + state.from + '–' + state.to + ') count in this ranking' +
      (papers.length > f.papers.length ? '; the others are outside the selected journals' + (skipped ? ' or skipped as short pieces (' + skipped + ')' : '') : '') +
      '.' + (DATA.people[person][3] ? ' <a href="' + esc(DATA.people[person][3]) + '" target="_blank" rel="noopener">Faculty page</a>' : '') + '</p>';
    detailRow.firstElementChild.innerHTML = worksOn(person, forBars) + authorBars(forBars) + note;
  }

  // the field a specialty journal sits in -> that field's area (each journal has one field, each field one area); built
  // on first use, once the data are in
  let areaMap = null;
  function areaOfField(f) {
    if (!areaMap) {
      areaMap = new Map();
      DATA.journals.forEach((j) => { if (j[3] && j[3].length && j[4] && j[4].length) areaMap.set(j[3][0][0], j[4][0][0]); });
    }
    return areaMap.has(f) ? areaMap.get(f) : -1;
  }
  // a tag's tooltip: the area's count and its fields, all years (build_data.py: people[i][5])
  function areaTitle(person, g, n) {
    const fields = (DATA.people[person][5] || []).filter(([fi]) => areaOfField(fi) === g);
    return n + ' specialty-journal article' + (n === 1 ? '' : 's') + ' in ' + DATA.groups[g] + ', all years: ' +
      fields.map(([fi, k]) => DATA.subjects[fi] + ' ' + k).join(', ');
  }
  // the field a journal's articles count toward (build_data.py: data.field_of; -1 none), as in the tags
  const fieldOfJournal = (ji) => (DATA.field_of ? DATA.field_of[ji] : (DATA.journals[ji][3] && DATA.journals[ji][3].length ? DATA.journals[ji][3][0][0] : -1));

  // the drop-down's "What they work on": their articles in specialty journals in the chosen years, as a small tree, area
  // > field > journals (each journal's own place in the taxonomy; nothing guessed), and flagship law reviews alongside
  function worksOn(person, papers) {
    const P = DATA.papers;
    const byField = new Map();
    let flagship = 0, specialty = 0;
    papers.forEach((p) => {
      const f = fieldOfJournal(P.journal[p]);
      if (f >= 0) {
        specialty++;
        if (!byField.has(f)) byField.set(f, new Map());
        const m = byField.get(f);
        m.set(P.journal[p], (m.get(P.journal[p]) || 0) + 1);
      }
      if (journalCats[P.journal[p]].includes(0)) flagship++;     // (review) the same set as the "Flagship" bar below
    });
    const byArea = new Map();
    byField.forEach((m, f) => {
      const g = areaOfField(f);
      const n = [...m.values()].reduce((a, b) => a + b, 0);
      if (!byArea.has(g)) byArea.set(g, { n: 0, fields: [] });
      const a = byArea.get(g);
      a.n += n;
      a.fields.push([f, n, [...m.entries()].sort((x, y) => y[1] - x[1] || DATA.journals[x[0]][0].localeCompare(DATA.journals[y[0]][0]))]);
    });
    const areas = [...byArea.entries()].sort((a, b) => b[1].n - a[1].n || (DATA.groups[a[0]] || '').localeCompare(DATA.groups[b[0]] || ''));
    const who = esc(DATA.people[person][0]);
    const all = DATA.people[person][4] || [];
    // (audit) the tags (all years) above the chosen years' tree, so the two cannot read as a contradiction
    const tagLine = all.length ? '<p class="works-tag">All years: ' + all.map(([g, n]) => '<b>' + esc(DATA.groups[g]) + '</b> ' + n).join(' · ') + '</p>' : '';
    if (!areas.length) {
      return '<div class="works"><div class="bars-title">What they work on, from specialty journals</div>' + tagLine + '<p class="detail-note">' + who +
        ' has no specialty-journal articles in ' + state.from + '–' + state.to + (flagship ? ' (' + flagship + ' in flagship law reviews)' : '') +
        (all.length ? '' : ', and none in any year, so no area is shown') + '.</p></div>';
    }
    const tree = areas.map(([g, a]) => '<li><b>' + esc(DATA.groups[g] || 'Other') + '</b> <span class="text-muted">' + a.n + '</span><ul>' +
      a.fields.sort((x, y) => y[1] - x[1] || DATA.subjects[x[0]].localeCompare(DATA.subjects[y[0]])).map(([f, n, js]) => '<li>' + esc(DATA.subjects[f]) +
        ' <span class="text-muted">' + n + '</span> · ' + js.map(([ji, k]) => esc(DATA.journals[ji][0]) + (k > 1 ? ' (' + k + ')' : '')).join(', ') + '</li>').join('') +
      '</ul></li>').join('');
    return '<div class="works"><div class="bars-title">What they work on, from specialty journals (' + state.from + '–' + state.to + ')</div>' + tagLine +
      '<p class="works-lede">' + (state.minor ? '' : '<span class="text-muted">Short pieces included. </span>') + who + ': ' + specialty + ' specialty-journal article' +
      (specialty === 1 ? '' : 's') + (flagship ? ', besides ' + flagship + ' in flagship law reviews' : '') + '. Each journal sits in one field, each field in one area.</p>' +
      '<ul class="works-list works-tree">' + tree + '</ul></div>';
  }

  function catLabel(c) { return c === 0 ? 'Flagship law reviews' : c === -1 ? 'Online & other general' : DATA.groups[c - 1]; }
  function catShort(c) { return c === 0 ? 'flagship' : c === -1 ? 'other general' : shortName(DATA.groups[c - 1]); }

  // horizontal bars, most to least; empty categories are left out
  function authorBars(papers) {
    const n = new Map(), adj = new Map();
    papers.forEach((p) => {
      journalCats[DATA.papers.journal[p]].forEach((c) => {
        n.set(c, (n.get(c) || 0) + 1);
        adj.set(c, (adj.get(c) || 0) + 1 / DATA.papers.authors[p]);
      });
    });
    const cats = [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a - b);   // most to least
    if (!cats.length) return '';
    const max = Math.max(...n.values());
    return '<div class="bars" role="img" aria-label="Articles by journal group, ' + state.from + '–' + state.to + '">' +
      '<div class="bars-title">Articles by journal group, ' + state.from + '–' + state.to + '</div>' +
      cats.map((c) => {
        const tip = catLabel(c) + ': ' + n.get(c) + ' article' + (n.get(c) === 1 ? '' : 's') + ' (adjusted for co-authors: ' + one(adj.get(c)) + ')';
        return '<div class="bar-row" title="' + esc(tip) + '"><span class="bar-label">' + esc(catLabel(c)) + '</span>' +
          '<span class="bar-track"><span class="bar ' + (c === 0 ? 'bg-general' : c === -1 ? 'bg-other' : 'bg-specialty') + '" style="width:' + (100 * n.get(c) / max).toFixed(1) + '%"></span></span>' +
          '<span class="bar-value">' + n.get(c) + '</span></div>';
      }).join('') + '</div>';
  }

  ////////////////////////////////////////////// page

  // (2026-10-25, the owner: "add in a spinner for crunching numbers") every recompute runs behind the spinner
  // (masthead.js: LSR.crunch); quick successive changes are computed once, with the newest state
  const crunch = (fn) => (window.LSR && window.LSR.crunch ? window.LSR.crunch.run(fn) : fn());
  function update() {
    saveState();
    syncPanel();
    renderDataLine();                       // the rank source may have changed
    crunch(() => { current = compute(); renderRanking(); });
  }

  function renderDataLine() {
    const p = META.papers_collected, f = META.faculty_collected;
    $('dataLine').innerHTML = '<b>Data:</b> articles collected ' + esc(fmtDate(p.from)) + ' – ' + esc(fmtDate(p.to)) +
      ' (' + p.journals + ' journals) · faculty lists ' + esc(fmtDate(f.to)) +
      ' · ranks: ' + esc(sourceName()) + ' (flagship), W&amp;L ' + esc(META.rankings.edition) + ' (specialty)' +
      ' · <a href="faq.html#data">details</a>';
  }

  function renderMeta() {
    window.LSR.stampMasthead(META);
    renderDataLine();
    $('footer').innerHTML = window.LSR.siteFooter(META);
  }

  function wire() {
    const win = $('rankingWindow');
    const act = (e) => {
      if (e.target.closest('a')) return;
      const person = e.target.closest('tr.person');
      if (person) { togglePerson(person); return; }
      const school = e.target.closest('tr.school');
      if (school) toggleSchool(school);
    };
    win.addEventListener('click', act);
    win.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { if (e.target.matches('tr.person, tr.school')) { e.preventDefault(); act(e); } } });

    const setDrawer = (open) => document.body.classList.toggle('filters-open', open);
    $('openFilters').addEventListener('click', () => setDrawer(true));
    $('closeFilters').addEventListener('click', () => setDrawer(false));
    $('drawerBackdrop').addEventListener('click', () => setDrawer(false));
    $('drawerDone').addEventListener('click', () => { setDrawer(false); window.scrollTo({ top: $('rankingWindow').offsetTop - 60 }); });

    const sticky = () => document.documentElement.style.setProperty('--controls-h', $('controlsSticky').offsetHeight + 'px');
    sticky();
    window.addEventListener('resize', sticky);
    // (stress test, 2026-10-24) the bar grows when its summary wraps after a recompute; the header then hid under it
    if (window.ResizeObserver) new ResizeObserver(sticky).observe($('controlsSticky'));
    window.addEventListener('hashchange', () => {
      const h = readHash();
      if (h) { state = cleanState(h); syncPanel(); crunch(() => { current = compute(); renderRanking(); }); }
    });
  }

  if (window.LSR && window.LSR.crunch) window.LSR.crunch.show('Loading the data');
  const loaded = () => { if (window.LSR && window.LSR.crunch) window.LSR.crunch.hide(); };
  Promise.all([
    fetch('data/data.json').then((r) => r.json()),
    fetch('data/meta.json').then((r) => r.json()),
  ]).then(([data, meta]) => {
    DATA = data;
    META = meta;
    groupSubjects = META.group_subjects || {};
    // which bars a journal's articles count toward: flagship (any W&L General journal, main review or not) and each specialty group it is in
    journalCats = DATA.journals.map((j) => {
      // (audit) 0 = a school's main law review; -1 = online editions & other general journals (their own bar)
      const cats = j[2] === null || j[2] === undefined ? [] : j[2] === -1 ? [-1] : [0];
      return cats.concat([...new Set(j[4].map(([g]) => g + 1))].sort((a, b) => a - b));
    });
    personPapers = new Map();
    DATA.credits.person.forEach((person, k) => {
      if (!personPapers.has(person)) personPapers.set(person, []);
      personPapers.get(person).push(DATA.credits.paper[k]);
    });
    let saved = null;
    try { saved = JSON.parse(recall(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    state = cleanState(readHash() || restoreSaved(saved));
    renderMeta();
    buildPanel();
    wire();
    update();
    loaded();
  }).catch((err) => {
    loaded();
    $('rankingWindow').innerHTML = '<p class="empty-note">Could not load the data (' + esc(err.message) + ').</p>';
  });
})();
