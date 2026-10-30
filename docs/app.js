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
  const SOURCE_SHORT = { usnews: 'U.S. News rank', peer: 'TaxProf peer rank' };   // (audit) every label names its rank
  const HOST_TIERS = ['any', '25', '50', '100'];
  const PER_PROF_MIN = 10;          // the per-professor option ranks schools with at least this many people listed
  const DEFAULT_BANDS = ['1', '2'];                                     // = main law reviews of the US News top 25
  const STORAGE_KEY = 'lawRankings.v4';
  const DEFAULT_YEARS = 20;          // the default window's year labels (2026-10-29)
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
  const bandLabel = (b) => (b.other ? b.label : (SOURCE_SHORT[state.src] || 'U.S. News rank') + ' ' + b.range);

  ////////////////////////////////////////////// state: URL hash > localStorage > defaults

  function defaultState() {
    // (2026-10-29, the owner: "set default time to 20 years back from whatever date it is now") twenty year labels
    // ending at the visitor's current year, or at the latest year in the data if the clock runs ahead of it (before:
    // ten labels ending at the build's default_to, the latest well-collected year)
    const to = Math.max(META.years.min, Math.min(new Date().getFullYear(), META.years.max));
    return { bands: DEFAULT_BANDS.slice(), groups: {}, cutoff: '10', from: Math.max(META.years.min, to - (DEFAULT_YEARS - 1)), to: to, region: 'us', minor: false, src: 'usnews', host: 'any',
             perProf: false, noHome: false };
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
    delete out.v;
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
    // (2026-10-27) the two options need their data (build 2.18.1 on); off when it is missing
    out.perProf = !!out.perProf && !!DATA.school_faculty;
    out.noHome = !!out.noHome && !!DATA.journal_school;
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
      from: years[0], to: years[1], region: h.get('r'), minor: h.get('m') === '1', src: h.get('k') || 'usnews', host: h.get('h') || 'any',
      perProf: h.get('p') === '1', noHome: h.get('o') === '1' };
  }

  function saveState(persist) {
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
    if (state.perProf) h.set('p', '1');
    if (state.noHome) h.set('o', '1');
    history.replaceState(null, '', '#' + h.toString());
    if (persist === false) return;   // (review) a view opened from a link or a reloaded tab is not the visitor's own choice
    // (stress test, 2026-10-24) the untouched default view was stored on the first visit, so that visitor's year
    // window never moved on with new data: only a view that differs from the default is stored, and a window that
    // ends at the latest year is stored as "the latest N years"
    const d = defaultState();
    const same = JSON.stringify(cleanState(state)) === JSON.stringify(d);
    if (same) { try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* private mode */ } return; }
    store(STORAGE_KEY, JSON.stringify(Object.assign({}, state, { v: 6 }, state.to === d.to ? { latest: state.to - state.from } : {})));
  }

  // a stored view: a window that ended at the latest year then ends at the latest year now
  function restoreSaved(saved) {
    if (!saved || typeof saved !== 'object') return null;
    // (2026-10-26) the default window was eleven year labels before; a view stored then as "the latest 11" is now the latest 10
    if (!saved.v && saved.latest === 10) saved = Object.assign({}, saved, { latest: 9 });
    // 2.0.0 and earlier (before 2026-10-24 23:39) stored every view, the default 2016-2026 included, without 'latest'
    if (!saved.v && saved.latest == null && +saved.from === 2016 && +saved.to === 2026) saved = Object.assign({}, saved, { latest: 9 });
    // (2026-10-29) the default window was ten year labels before; a view stored then as "the latest 10" is now the latest 20
    if (saved.v === 5 && saved.latest === 9) saved = Object.assign({}, saved, { latest: DEFAULT_YEARS - 1 });
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
    const own = state.noHome ? DATA.journal_school : null;   // per journal, the schools that publish it
    const nYears = state.to - state.from + 1;               // (2026-10-28) per-year counts, for the "By year" strips
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
        if (own && own[P.journal[p]].includes(s)) continue;   // the option: not in the school's own journals
        let e = bySchool.get(s);
        if (!e) { e = { areas: new Float64Array(A), faculty: new Map(), years: new Float64Array(nYears) }; bySchool.set(s, e); }
        let f = e.faculty.get(person);
        if (!f) { f = { adj: 0, papers: [], byArea: new Float64Array(A), years: new Float64Array(nYears) }; e.faculty.set(person, f); }
        f.adj += w;
        f.papers.push(p);
        e.years[y - state.from] += w;
        f.years[y - state.from] += w;
        for (const a of as) { e.areas[a] += w; f.byArea[a] += w; }
      }
    }
    const rows = [];
    bySchool.forEach((e, s) => {
      let prod = 1;
      e.areas.forEach((c) => { prod *= c + 1; });
      const score = snap(Math.pow(prod, 1 / A));
      if (!state.perProf) { rows.push({ school: s, score: score, faculty: e.faculty, years: e.years }); return; }
      // (2026-10-27) per professor: the count (the geometric mean less the one added to each area) over the people on
      // the school's faculty list; a list shorter than PER_PROF_MIN is too small to divide by
      const listed = DATA.school_faculty[s] || 0;
      if (listed >= PER_PROF_MIN) rows.push({ school: s, score: snap((score - 1) / listed), faculty: e.faculty, listed: listed, years: e.years });
    });
    rows.sort((a, b) => b.score - a.score || DATA.schools[a.school][0].localeCompare(DATA.schools[b.school][0]));
    return { areas, rows, jAreas };
  }

  ////////////////////////////////////////////// filter panel

  // (review) the arrows that open a tier's, a higher-level group's or a group's list are buttons, so a keyboard or
  // screen reader reaches them; the inline style takes away the browser's button look (.hovertip gives the rest)
  const TOGGLE_STYLE = ' style="border:0;background:none;padding:0;font-family:inherit;line-height:inherit"';
  function buildPanel() {
    const gen = $('generalBody');
    BANDS.forEach((b) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><button type="button" class="hovertip list-toggle"' + TOGGLE_STYLE + ' data-band-toggle="' + b.id + '" title="Show/hide journals" aria-label="Show or hide the journals" aria-expanded="false" aria-controls="bandList' + b.id + '">&#9658;</button> <label for="band' + b.id + '" id="bandLabel' + b.id + '">' + esc(bandLabel(b)) + '</label>' +
        '<div class="sub-list" id="bandList' + b.id + '" hidden></div></td>' +
        '<td class="chk"><input type="checkbox" id="band' + b.id + '" data-band="' + b.id + '"></td>';
      gen.appendChild(tr);
    });
    // (2026-10-29, the owner: "make the peer rank selector an optional feature. like add it as a check box") the
    // TaxProf peer rank is a switch under Options, off by default, shown when the data have it
    if (sources().includes('peer')) $('peerRow').hidden = false;
    const spec = $('specialtyBody');
    DATA.groups.forEach((g, gi) => {
      const subs = groupSubjects[g] || [];
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><button type="button" class="hovertip list-toggle"' + TOGGLE_STYLE + ' data-group-toggle="' + gi + '" title="Show/hide groups" aria-label="Show or hide the groups" aria-expanded="false" aria-controls="grpList' + gi + '">&#9658;</button> <label for="grp' + gi + '">' + esc(g) + '</label>' +
        '<div class="sub-list" id="grpList' + gi + '" hidden><p>groups (open a group for its journals)</p><table><tbody>' +
        subs.map((s, si) => '<tr><td><button type="button" class="hovertip list-toggle"' + TOGGLE_STYLE + ' data-field-toggle="' + gi + '_' + si + '" title="Show/hide journals" aria-label="Show or hide the journals" aria-expanded="false" aria-controls="fieldList' + gi + '_' + si + '">&#9658;</button> ' +
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
      } else if (t.id === 'betaTitles') {
        setBeta(t.checked);
        return;
      } else if (t.id === 'skipMinor') {
        state.minor = t.checked;
      } else if (t.id === 'perProf') {
        state.perProf = t.checked;
      } else if (t.id === 'noHome') {
        state.noHome = t.checked;
      } else if (t.id === 'cutoff') {
        state.cutoff = t.value;
      } else if (t.id === 'usePeer') {
        state.src = t.checked ? 'peer' : 'usnews';
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
    arrow.setAttribute('aria-expanded', String(show));
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
    return head + (ids.length ? ids.map((ji) => '<div class="jrnl">' + line(ji) + '</div>').join('') : '<div class="jrnl">no journals listed</div>');
  }

  // (2026-10-29, the owner: "call it TaxProf peer rank") the peer-reputation ranks are named for where they are published
  const SOURCE_NAME = { usnews: 'U.S. News overall rank', peer: 'TaxProf peer rank' };
  function sourceName() {
    const s = (DATA.rank_sources || []).find((x) => x[0] === state.src);
    return s ? (SOURCE_NAME[s[0]] || s[1]) + (s[2] ? ' (' + s[2] + ')' : '') : 'U.S. News rank';
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
      const host = school ? esc(school) + ' <span class="text-muted">(' + (SOURCE_SHORT[state.src] || 'U.S. News rank') + ' ' + (r > 0 ? '#' + r : 'unranked') + ')</span>'
        : (publisher ? '<span class="text-muted">' + esc(publisher) + '</span>' : '<span class="text-muted">publisher not recorded yet</span>');
      return '<div class="jrnl' + (hostOk(ji) ? '' : ' not-counted') + '">' + wl + ' · ' + esc(j[0]) + ' — ' + host + '</div>';
    };
    return '<p>in order of W&amp;L score; host school and its rank</p>' + (ids.length ? ids.map((ji, i) => line(ji, i)).join('') : '<div class="jrnl">no journals listed</div>');
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
    $('usePeer').checked = state.src === 'peer';
    $('rankSourceName').textContent = sourceName();
    $('hostTier').value = state.host;
    $('hostRankName').textContent = state.src === 'peer' ? 'TaxProf peer' : 'U.S. News';
    $('introRankName').innerHTML = state.src === 'peer' ? 'TaxProf peer rank' : '<i>U.S. News</i> rank';
    BANDS.forEach((b) => { const l = $('bandLabel' + b.id); if (l) l.textContent = bandLabel(b); });
    $('skipMinor').checked = state.minor;
    $('perProf').checked = state.perProf;
    $('noHome').checked = state.noHome;
    $('perProf').disabled = !DATA.school_faculty;
    $('noHome').disabled = !DATA.journal_school;
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

  // ---- BETA (2026-10-26, the owner: "the title area classification mark as a beta function. so the website doesn't
  // operate using that by default but a user can see what it would look like"): with the switch on, a person's tags
  // and "Subject areas" line show the categories a title model gives their articles in any journal (data/beta.json,
  // build_data.beta_title_areas), marked as beta. Off by default; the choice is remembered on this browser.
  let BETA = null, betaOn = false;
  function setBeta(on) {
    betaOn = on;
    try { localStorage.setItem('lsr.beta', on ? '1' : ''); } catch (e) { /* private mode */ }
    if (on && !BETA) {
      fetch('data/beta.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((b) => { BETA = b; renderRanking(); })
        .catch(() => { betaOn = false; $('betaTitles').checked = false; });
      return;
    }
    renderRanking();
  }
  const betaNote = () => (BETA && BETA.model && BETA.model.accuracy != null
    ? 'title model accuracy on journals held out of training: ' + Math.round(BETA.model.accuracy * 100) + '%; most-common-category baseline: ' + Math.round(BETA.model.baseline_accuracy * 100) + '%'
    : 'a beta model');
  function betaTags(person) {
    const b = (BETA && BETA.people[person]) || [];
    return b.map(([g, n]) => areaTag(g, n, 'Beta: ' + n + ' of their titles (collected journals) classified as ' + DATA.groups[g] + '; ' + betaNote() +
      '. Opens ' + DATA.groups[g] + ' on the Subject areas page.', areaHref(g), 'c-beta')).join('');
  }

  function renderRanking() {
    const win = $('rankingWindow');
    const { areas, rows } = current;
    const nAreas = areas.length;
    $('summary').textContent = nAreas ? rows.length + ' schools · ' + areas.map((a) => a.label).join(' + ') +
      (state.perProf ? ' · per professor' : '') + (state.noHome ? ' · own journals left out' : '') : '';
    $('drawerDone').textContent = rows.length ? 'Show ' + rows.length + ' schools' : 'Show rankings';
    if (!nAreas) {
      win.innerHTML = '<p class="empty-note">No journals selected.' +
        ' <a href="#" id="resetDefaults">Restore the default selection</a>.</p>';
      $('resetDefaults').addEventListener('click', (e) => { e.preventDefault(); state = defaultState(); update(); });
      return;
    }
    if (!rows.length) {
      win.innerHTML = '<p class="empty-note">No faculty articles match these filters.</p>';
      return;
    }
    let html = '<table class="ranking"><thead><tr><th class="num rank-cell">#</th><th>Institution</th>' +
      (state.perProf
        ? '<th class="num"><abbr title="The count (geometric mean, across the selected areas, of the adjusted article counts plus one, less one) divided by the number of people on the school\'s faculty list">Per prof.</abbr></th>' +
          '<th class="num"><abbr title="Faculty with at least one counted article, of the people on the school\'s faculty list">Faculty</abbr></th>'
        : '<th class="num"><abbr title="Geometric mean, across the selected areas, of the adjusted article counts plus one">Count</abbr></th>' +
          '<th class="num"><abbr title="Faculty with at least one counted article">Faculty</abbr></th>') +
      '<th class="spark-col"><abbr title="Counted articles (adjusted for co-authors) in each of the selected years, oldest on the left">By year</abbr></th></tr></thead><tbody>';
    destroyTrends();
    let rank = 0;
    rows.forEach((r, i) => {
      const open = openSchools.has(r.school);
      if (i === 0 || r.score !== rows[i - 1].score) rank = i + 1;   // tied schools share a rank, as on CSrankings
      html += '<tr class="school' + (i % 2 ? '' : ' alt') + '" data-school="' + r.school + '" tabindex="0" aria-expanded="' + open + '">' +
        '<td class="num rank-cell">' + rank + '</td>' +
        '<td><span class="hovertip">' + (open ? '&#9660;' : '&#9658;') + '</span>&nbsp;' + esc(DATA.schools[r.school][0]) + schoolTagsHtml(r.school, 3) + '</td>' +
        '<td class="num">' + (state.perProf ? r.score.toFixed(2) : one(r.score)) + '</td><td class="num">' + r.faculty.size + (state.perProf ? ' / ' + r.listed : '') + '</td>' +
        '<td class="spark-col">' + sparkHtml(r.years, DATA.schools[r.school][0]) + '</td></tr>';
      if (open) html += facultyRows(r);
    });
    win.innerHTML = html + '</tbody></table>';
    win.querySelectorAll('tr.person-detail').forEach(fillDetail);
    drawPending(win);
  }

  ////////////////////////////////////////////// recent trends (2026-10-28, the owner: "Have general school publication tag
  // areas too (based on specialty) and also have a time chart broken down by selected filters and when publication
  // counts occurred. I want to spot recent trends like a school or person that published in top reviews recently but
  // didn't used to")

  // a row's counted articles per selected year as a small line, oldest on the left, scaled to the row's own busiest
  // year, the last year marked (the exact numbers in its tooltip; the owner, 2026-10-28: "line chart not bar")
  function sparkHtml(years, who) {
    if (!years || !years.length) return '';
    const max = Math.max(...years);
    if (!(max > 0)) return '';
    const tip = who + ', counted articles per year (adjusted for co-authors): ' +
      [...years].map((v, i) => (state.from + i) + ' ' + one(v)).join(', ');
    const W = 54, H = 16, n = years.length;
    const x = (i) => (n === 1 ? W / 2 : 1.5 + (i * (W - 3)) / (n - 1)), y = (v) => (H - 1.5 - (v / max) * (H - 3));
    const pts = [...years].map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
    return '<span class="spark" title="' + esc(tip) + '" role="img" aria-label="' + esc(tip) + '"><svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<line x1="0" y1="' + (H - 0.5) + '" x2="' + W + '" y2="' + (H - 0.5) + '" class="spark-base"/>' +
      '<polyline points="' + pts + '" class="spark-line"/><circle cx="' + x(n - 1).toFixed(1) + '" cy="' + y(years[n - 1]).toFixed(1) + '" r="1.8" class="spark-end"/></svg></span>';
  }

  // a school's subject areas: the higher-level groups of the specialty journals its current faculty published in, in the
  // selected years, each with its number of articles (a co-authored article once); computed for every school in one
  // pass and kept until the years or the short-piece switch change. As for a person, only specialty journals speak to
  // a subject, and journals whose scope is law or policy generally count toward none.
  let schoolAreaCache = { key: '', map: null };
  // (2026-10-29, the owner: "get link to every area tag. it needs to have a clear link from journal to higher-level
  // tag") an area tag links to its higher-level group on the Subject areas page, carrying the journals behind the tag
  // (journal id:articles) and whose they are, so that page can show each journal, its group and the tag in one line:
  // taxonomy.html?j=7:2,194:1&w=<whose>#<higher-level group>
  function areaHref(g, journals, who) {
    const q = [];
    if (journals && journals.length) q.push('j=' + journals.map(([ji, k]) => ji + ':' + k).join(','));
    if (who) q.push('w=' + encodeURIComponent(who));
    return 'taxonomy.html' + (q.length ? '?' + q.join('&') : '') + '#' + encodeURIComponent(DATA.groups[g]);
  }
  function areaTag(g, n, title, href, cls) {
    return '<a class="' + (cls || 'c-specialty') + ' area-tag" href="' + esc(href) + '" title="' + esc(title) + '">' +
      esc(shortName(DATA.groups[g])) + '<span class="tag-n">' + n + '</span></a>';
  }
  // the journals behind a person's tag, all years (build_data.py: people[i][5], [[field, articles, [[journal, articles]]]])
  const personAreaJournals = (person, g) => (DATA.people[person][5] || []).filter(([f]) => areaOfField(f) === g)
    .flatMap(([, , js]) => js || []).sort((a, b) => b[1] - a[1]);
  // the journals of a set of articles, most articles first
  function journalsOf(papers) {
    const m = new Map();
    papers.forEach((p) => { const ji = DATA.papers.journal[p]; m.set(ji, (m.get(ji) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }
  function schoolAreas(s) {
    const key = state.from + '-' + state.to + '-' + (state.minor ? 1 : 0);
    if (schoolAreaCache.key !== key) {
      const P = DATA.papers, C = DATA.credits, map = new Map();
      for (let k = 0; k < C.paper.length; k++) {
        const p = C.paper[k], y = P.year[p];
        if (y < state.from || y > state.to || (state.minor && P.minor[p])) continue;
        const f = fieldOfJournal(P.journal[p]);
        if (f < 0) continue;
        const g = areaOfField(f);
        if (g < 0) continue;
        for (const sc of DATA.people[C.person[k]][1]) {
          if (!map.has(sc)) map.set(sc, new Map());
          const m = map.get(sc);
          if (!m.has(g)) m.set(g, new Set());
          m.get(g).add(p);
        }
      }
      schoolAreaCache = { key: key, map: map };
    }
    const m = schoolAreaCache.map.get(s);
    if (!m) return [];
    return [...m.entries()].map(([g, set]) => [g, set.size, set]).sort((a, b) => b[1] - a[1] || DATA.groups[a[0]].localeCompare(DATA.groups[b[0]]));
  }
  function schoolTagsHtml(s, top) {
    const all = schoolAreas(s);
    if (!all.length) return '';
    const name = DATA.schools[s][0];
    const when = state.from + '–' + state.to;
    return ' <span class="areaname school-tags">' + all.slice(0, top).map(([g, n, set]) => areaTag(g, n,
      name + ': ' + n + ' specialty-journal article' + (n === 1 ? '' : 's') + ' by its current faculty in ' + DATA.groups[g] + ', ' + when +
      '. Opens ' + DATA.groups[g] + ' on the Subject areas page, with these journals.', areaHref(g, journalsOf(set), name + ', ' + when))).join('') + '</span>';
  }
  // the articles of a school's current faculty in the chosen years (short pieces as the switch says), each once, with
  // the share of its authors who are on that faculty (for the bars' adjusted counts)
  function schoolPapers(s) {
    const P = DATA.papers, share = new Map();
    peopleAt(s).forEach((person) => (personPapers.get(person) || []).forEach((p) => {
      if (P.year[p] < state.from || P.year[p] > state.to || (state.minor && P.minor[p])) return;
      share.set(p, (share.get(p) || 0) + 1 / P.authors[p]);
    }));
    return share;
  }
  // (2026-10-29, the owner: "don't include this below the chart, just include a quick description of it" and "include
  // the specialty area graph, to show where scholars at that school mostly publish. like the bar chart") the trend chart,
  // a line on what it plots, and the school's bars, as a person's drop-down has
  function schoolSummaryHtml(s) {
    const share = schoolPapers(s);
    return '<div class="school-summary">' + trendBox({ school: s }) +
      '<p class="detail-note trend-desc">Counted articles per year by its current faculty in the selected journals, each split between its co-authors.' +
      (state.from > trendStart() && state.from <= trendEnd() ? ' The shaded band marks the selected years.' : '') +
      (trendEnd() < state.to ? ' The lines end at ' + trendEnd() + ', the last full year.' : '') + '</p>' +
      authorBars([...share.keys()], { title: 'Where its faculty publish', weight: (p) => share.get(p), who: DATA.schools[s][0] }) + '</div>';
  }

  // the chart under an opened school or person: their counted articles per year in the selected journals, one line per
  // selected area (at most five, the smaller ones folded into one) and their total, over the twenty years up to the
  // window's end, or the whole window if it is longer (the selected years shaded), so a recent rise shows against what
  // came before. Highcharts is loaded the first time one is opened, not with the page.
  const TREND_COLORS = ['#377eb8', '#ff7f00', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const trendCharts = new Set();
  let trendSeq = 0, hcLoad = null;
  // the chart's first year: twenty years up to the window's end, or the window's start if earlier; the selected years
  // are shaded only when they start after it (schoolSummaryHtml mentions the band only then)
  // (2026-10-29, the owner: "Cut the prediction trend line at the year prior. Don't hardcode that value because what if
  // it is 2027") the chart ends at the last full year: the year before the visitor's current year (or the window's last
  // year, when that is earlier); the current year's volumes are still coming out
  function trendEnd() { return Math.max(META.years.min, Math.min(state.to, new Date().getFullYear() - 1)); }
  // (2026-10-29, the owner: "draw a line of best fit. Use mse error or whatever you think is best but make an informed
  // decision about it and don't just pick one") a Theil-Sen line: the slope is the median of the slopes between each
  // pair of years, the line passes through the median of (count - slope * year). Picked by a test on the site's own
  // yearly counts, 2007-2025 (360 institutions; 500 people sampled), fitting each candidate on the earlier years and
  // scoring it on the next one to three (error scaled to each series, MASE): least squares (MSE) and Theil-Sen came out
  // about level (median 0.955 vs 0.960 for institutions, 0.921 vs 0.878 for people), Huber, least absolute deviations,
  // Siegel's repeated medians and a Poisson curve behind; Theil-Sen's slope moved about half as much as least squares'
  // when any one year was left out (median swing 0.018 vs 0.043 of the series' level, people), so one unusual year (a
  // symposium issue) tilts it little. A flat average of the earlier years beat every line in that test, so the line
  // describes the years shown and is not drawn past the last full year.
  function senLine(ys) {
    const med = (a) => { const b = a.slice().sort((x, y) => x - y), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
    const sl = [];
    for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) sl.push((ys[j] - ys[i]) / (j - i));
    const slope = med(sl);
    return { slope: slope, at0: med(ys.map((y, i) => y - slope * i)) };
  }
  function trendStart() { return Math.max(META.years.min, Math.min(state.from, state.to - 19)); }
  function trendBox(who) {
    const id = 'trend' + (++trendSeq);
    return '<div class="trend-chart" id="' + id + '" data-trend="' + esc(JSON.stringify(who)) + '"><p class="detail-note">Loading the chart…</p></div>';
  }
  function loadScript(src) {
    return new Promise((ok, fail) => { const t = document.createElement('script'); t.src = src; t.onload = ok; t.onerror = fail; document.head.appendChild(t); });
  }
  function highcharts() {
    if (!hcLoad) {
      const base = 'https://cdnjs.cloudflare.com/ajax/libs/highcharts/12.1.2/';
      // (review) the accessibility module is an extra: a blocked or failed load of it does not stop the charts; and a
      // failed load is not kept, so the next school or person opened tries again
      hcLoad = (window.Highcharts ? Promise.resolve() : loadScript(base + 'highcharts.js').then(() => loadScript(base + 'modules/accessibility.js').catch(() => null)))
        .then(() => {
          window.Highcharts.setOptions({ credits: { enabled: false }, tooltip: { followTouchMove: false },
            chart: { style: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif' } } });
          return window.Highcharts;
        })
        .catch((e) => { hcLoad = null; throw e; });
    }
    return hcLoad;
  }
  let schoolPeople = null;
  function peopleAt(s) {
    if (!schoolPeople) {
      schoolPeople = new Map();
      DATA.people.forEach((p, i) => p[1].forEach((sc) => { if (!schoolPeople.has(sc)) schoolPeople.set(sc, []); schoolPeople.get(sc).push(i); }));
    }
    return schoolPeople.get(s) || [];
  }
  // adjusted counts per year and selected area, by the ranking's own rules (selected journals, short pieces, own journals);
  // out.total counts each article once, as compute()'s By year strip does (a journal can sit in two selected areas)
  function yearlyCounts(people, school, y0, y1) {
    const P = DATA.papers, jAreas = current.jAreas, own = state.noHome ? DATA.journal_school : null;
    const out = current.areas.map(() => new Float64Array(y1 - y0 + 1));
    const total = new Float64Array(y1 - y0 + 1);
    people.forEach((person) => (personPapers.get(person) || []).forEach((p) => {
      const y = P.year[p];
      if (y < y0 || y > y1 || (state.minor && P.minor[p])) return;
      const ji = P.journal[p], as = jAreas[ji];
      if (!as.length || (own && own[ji].includes(school))) return;
      const w = 1 / P.authors[p];
      total[y - y0] += w;
      as.forEach((a) => { out[a][y - y0] += w; });
    }));
    out.total = total;
    return out;
  }
  function destroyTrends(root) {
    trendCharts.forEach((c) => { if (!root || root.contains(c.renderTo)) { c.destroy(); trendCharts.delete(c); } });
  }
  function drawPending(root) {
    const boxes = [...root.querySelectorAll('.trend-chart:not([data-drawn])')];
    if (!boxes.length || !current.jAreas) return;
    highcharts().then((H) => boxes.forEach((box) => {
      if (!box.isConnected || box.dataset.drawn) return;
      box.dataset.drawn = '1';
      const who = JSON.parse(box.dataset.trend);
      const y1 = trendEnd(), y0 = trendStart();
      const counts = yearlyCounts(who.person != null ? [who.person] : peopleAt(who.school), who.school, y0, y1);
      const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
      const name = who.person != null ? DATA.people[who.person][0] : DATA.schools[who.school][0];
      // (review) one decimal, rounded as the By year strip rounds, so a year reads the same in the chart and the strip
      const r1 = (v) => +one(v);
      const lines = current.areas.map((a, i) => ({ name: a.label, raw: counts[i] })).filter((x) => x.raw.some((v) => v > 0));
      // (review) at most five area lines, each its own colour: Flagship and the biggest groups, in their usual order, and
      // the rest folded into one line (the total below still counts them all)
      const MAX_LINES = 5;
      let shown = lines;
      if (lines.length > MAX_LINES) {
        const sum = (x) => x.raw.reduce((t, v) => t + v, 0);
        const first = lines[0].name === 'Flagship' ? 1 : 0;
        const big = new Set(lines.slice(first).sort((a, b) => sum(b) - sum(a)).slice(0, MAX_LINES - 1 - first));
        const rest = lines.filter((x, j) => j >= first && !big.has(x));
        shown = lines.filter((x, j) => j < first || big.has(x)).concat([{ name: rest.length + ' other selected groups', color: '#999',
          raw: years.map((_, k) => rest.reduce((t, x) => t + x.raw[k], 0)) }]);
      }
      const series = shown.map((x, i) => ({ name: x.name, color: x.color || TREND_COLORS[i], data: [...x.raw].map(r1) }));
      // (the owner, 2026-10-28: "line chart not bar") one line per selected area, and their total when there are several:
      // each article once, as in the By year strip
      if (series.length > 1) series.unshift({ name: 'Total', color: '#333', lineWidth: 2.5, zIndex: 2, data: [...counts.total].map(r1) });
      box.innerHTML = '';
      if (!series.length) { box.innerHTML = '<p class="detail-note">No counted articles in ' + y0 + '–' + y1 + '.</p>'; return; }
      // the trend line of the total (each article once) over the years shown, from five years on
      if (years.length >= 5) {
        const t = senLine([...counts.total]), last = years.length - 1;
        const per = Math.round(t.slope * 10) / 10;
        series.push({ name: 'Trend line (Theil–Sen): ' + (per > 0 ? '+' : per < 0 ? '−' : '') + Math.abs(per).toFixed(1) + ' a year', color: '#111', dashStyle: 'Dash',
          lineWidth: 1.5, marker: { enabled: false }, enableMouseTracking: false, zIndex: 3, data: [[0, t.at0], [last, t.at0 + t.slope * last]] });
      }
      // (review) the legend gets its own room (a row per line on a phone, two to a row wider), so the plot keeps its height
      const legendRows = series.length > 1 ? (box.clientWidth < 500 ? series.length : Math.ceil(series.length / 2)) : 0;
      trendCharts.add(H.chart(box, {
        chart: { type: 'line', height: 190 + 18 * legendRows, spacing: [6, 4, 4, 0], backgroundColor: 'transparent' },
        title: { text: 'Counted articles per year, ' + y0 + '–' + y1, align: 'left', style: { fontSize: '12px', fontWeight: '600', color: '#333' } },
        subtitle: y1 < state.to ? { text: (y1 + 1 === state.to ? state.to : (y1 + 1) + '–' + state.to) + ' left out: volumes still coming out', align: 'left',
          style: { fontSize: '10.5px', color: '#777' } } : undefined,
        accessibility: { description: name + ': counted articles per year in the selected journals, adjusted for co-authors, ' + y0 + '–' + y1 + '.' },
        xAxis: { categories: years.map(String), tickInterval: years.length > 12 ? 2 : 1, labels: { style: { fontSize: '10px', color: '#666' } },
          // (review) the band covers whole years (half a category each side); its label only when the band has room for it
          plotBands: state.from > y0 && state.from <= y1 ? [{ from: state.from - y0 - 0.5, to: y1 - y0 + 0.5, color: 'rgba(55,126,184,0.07)',
            label: (y1 - state.from + 1) * box.clientWidth / years.length >= 80 ? { text: 'selected years', style: { fontSize: '10px', color: '#777' }, y: 12 } : undefined }] : [] },
        yAxis: { title: { text: null }, min: 0, allowDecimals: true, gridLineColor: '#eee', labels: { style: { fontSize: '10px', color: '#666' } } },
        legend: { enabled: series.length > 1, itemStyle: { fontSize: '11px', fontWeight: '400', color: '#333' }, margin: 4, padding: 2 },
        // (review) only the lines with articles that year, so the tooltip stays short
        tooltip: { shared: true, headerFormat: '<b>{point.key}</b><br>', pointFormatter: function () {
          return this.y ? '<span style="color:' + this.color + '">●</span> ' + esc(this.series.name) + ': <b>' + this.y.toFixed(1) + '</b><br/>' : ''; } },
        plotOptions: { line: { lineWidth: 2, marker: { radius: 2.5, symbol: 'circle' }, states: { hover: { lineWidth: 2.5 } } } },
        series: series,
      }));
    })).catch(() => boxes.forEach((box) => { box.innerHTML = '<p class="detail-note">The chart could not be loaded.</p>'; }));
  }

  function facultyRows(r) {
    const people = [...r.faculty].sort((a, b) => b[1].adj - a[1].adj || DATA.people[a[0]][0].localeCompare(DATA.people[b[0]][0]));
    let html = '<tr class="faculty"><td></td><td colspan="4">' + schoolSummaryHtml(r.school) +
      '<table class="faculty-table"><thead><tr><th class="indent"></th>' +
      '<th><abbr title="Click a name for their articles by journal and group">Faculty</abbr></th>' +
      '<th class="num"><abbr title="Articles counted in this ranking"># Pubs</abbr></th>' +
      '<th class="num"><abbr title="Each article counts 1, split between its co-authors">Adj. #</abbr></th>' +
      '<th class="spark-col"><abbr title="Their counted articles (adjusted for co-authors) in each of the selected years, oldest on the left">By year</abbr></th></tr></thead><tbody>';
    people.forEach(([person, f], i) => {
      const key = r.school + ':' + person;
      const open = openPeople.has(key);
      // what this person works on (2026-10-25, the owner: "I want zero inferences drawn ... a clear taxonomy ... that
      // pulls information from grouped specialty journals. That's it. If an author only published flagship, then no
      // inference is made. If they have multiple specialty then it might be multi tag"): every area of the specialty
      // journals they published in, all years, each with its count (build_data.py: people[i][4]); nothing for someone
      // with no specialty-journal article
      const tags = betaOn && BETA ? betaTags(person) : (DATA.people[person][4] || []).map(([g, n]) => areaTag(g, n,
        areaTitle(person, g, n) + '. Opens ' + DATA.groups[g] + ' on the Subject areas page, with these journals.',
        areaHref(g, personAreaJournals(person, g), DATA.people[person][0] + ', years collected'))).join('');
      html += '<tr class="person' + (i % 2 ? '' : ' alt') + '" data-key="' + key + '" data-person="' + person + '" tabindex="0" aria-expanded="' + open + '">' +
        '<td class="indent"><span class="hovertip">' + (open ? '&#9660;' : '&#9658;') + '</span></td>' +
        '<td>' + esc(DATA.people[person][0]) + ' <span class="areaname">' + tags + '</span>' +
        (DATA.people[person][3] ? ' <a class="bio-link" href="' + esc(DATA.people[person][3]) + '" target="_blank" rel="noopener" title="Faculty page">bio</a>' : '') + '</td>' +
        '<td class="num">' + f.papers.length + '</td>' +
        '<td class="num">' + one(f.adj) + '</td>' +
        '<td class="spark-col">' + sparkHtml(f.years, DATA.people[person][0]) + '</td></tr>';
      if (open) html += '<tr class="person-detail" data-key="' + key + '"><td colspan="5"></td></tr>';
    });
    return html + '</tbody></table></td></tr>';
  }

  function toggleSchool(tr) {
    const s = +tr.dataset.school;
    if (openSchools.has(s)) openSchools.delete(s); else openSchools.add(s);
    const r = current.rows.find((x) => x.school === s);
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('faculty')) { destroyTrends(next); next.remove(); }
    if (openSchools.has(s)) {
      tr.insertAdjacentHTML('afterend', facultyRows(r));
      tr.nextElementSibling.querySelectorAll('tr.person-detail').forEach(fillDetail);
      drawPending(tr.nextElementSibling);
    }
    tr.querySelector('.hovertip').innerHTML = openSchools.has(s) ? '&#9660;' : '&#9658;';
    tr.setAttribute('aria-expanded', openSchools.has(s));
  }

  function togglePerson(tr) {
    const key = tr.dataset.key;
    const next = tr.nextElementSibling;
    if (openPeople.has(key)) {
      openPeople.delete(key);
      if (next && next.classList.contains('person-detail')) { destroyTrends(next); next.remove(); }
    } else {
      openPeople.add(key);
      tr.insertAdjacentHTML('afterend', '<tr class="person-detail" data-key="' + key + '"><td colspan="5"></td></tr>');
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
    detailRow.firstElementChild.innerHTML = trendBox({ person: person, school: s }) + worksOn(person, forBars) + authorBars(forBars, { who: DATA.people[person][0] }) + note;
    drawPending(detailRow);
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
    return n + ' specialty-journal article' + (n === 1 ? '' : 's') + ' in ' + DATA.groups[g] + ', years collected: ' +
      fields.map(([fi, k]) => DATA.subjects[fi] + ' ' + k).join(', ');
  }
  // the field a journal's articles count toward (build_data.py: data.field_of; -1 none), as in the tags
  const fieldOfJournal = (ji) => (DATA.field_of ? DATA.field_of[ji] : (DATA.journals[ji][3] && DATA.journals[ji][3].length ? DATA.journals[ji][3][0][0] : -1));

  // the drop-down's "Subject areas, from specialty journals": their articles in specialty journals in the chosen years, as a small tree, area
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
    const b = betaOn && BETA ? (BETA.people[person] || []) : [];
    const areaLink = (g, js, whose) => '<a class="area-link" href="' + esc(areaHref(g, js, whose)) + '" title="' + esc('Opens ' + DATA.groups[g] +
      ' on the Subject areas page, with these journals') + '">' + esc(DATA.groups[g]) + '</a>';
    const tagLine = (all.length ? '<p class="works-tag">Years collected: ' + all.map(([g, n]) => '<b>' + areaLink(g, personAreaJournals(person, g), DATA.people[person][0] + ', years collected') +
      '</b> ' + n).join(' · ') + '</p>' : '') +
      (betaOn && BETA ? '<p class="works-beta"><span class="beta-badge">Beta</span> Title model categories, from their titles in the collected journals (flagship reviews included): ' +
        (b.length ? b.map(([g, n]) => esc(DATA.groups[g]) + ' ' + n).join(' · ') : 'no title at model probability ' + (BETA.min_p != null ? BETA.min_p : 0.5) + ' or above') + ' (' + esc(betaNote()) + ').</p>' : '');
    if (!areas.length) {
      return '<div class="works"><div class="bars-title">Subject areas, from specialty journals</div>' + tagLine + '<p class="detail-note">' + who +
        ': 0 specialty-journal articles in ' + state.from + '–' + state.to + (flagship ? ' (' + flagship + ' in flagship law reviews)' : '') +
        (all.length ? '' : '; 0 in the other years collected') + '.</p></div>';
    }
    const tree = areas.map(([g, a]) => '<li><b>' + (DATA.groups[g] ? areaLink(g, a.fields.flatMap(([, , js]) => js).sort((x, y) => y[1] - x[1]),
      DATA.people[person][0] + ', ' + state.from + '–' + state.to) : 'Other') + '</b> <span class="text-muted">' + a.n + '</span><ul>' +
      a.fields.sort((x, y) => y[1] - x[1] || DATA.subjects[x[0]].localeCompare(DATA.subjects[y[0]])).map(([f, n, js]) => '<li>' + esc(DATA.subjects[f]) +
        ' <span class="text-muted">' + n + '</span> · ' + js.map(([ji, k]) => esc(DATA.journals[ji][0]) + (k > 1 ? ' (' + k + ')' : '')).join(', ') + '</li>').join('') +
      '</ul></li>').join('');
    return '<div class="works"><div class="bars-title">Subject areas, from specialty journals (' + state.from + '–' + state.to + ')</div>' + tagLine +
      '<p class="works-lede">' + (state.minor ? '' : '<span class="text-muted">Short pieces included. </span>') + who + ': ' + specialty + ' specialty-journal article' +
      (specialty === 1 ? '' : 's') + (flagship ? '; ' + flagship + ' in flagship law reviews' : '') + '. Each journal sits in one group, each group in one higher-level group.</p>' +
      '<ul class="works-list works-tree">' + tree + '</ul></div>';
  }

  function catLabel(c) { return c === 0 ? 'Flagship law reviews' : c === -1 ? 'Online & other general' : DATA.groups[c - 1]; }
  function catShort(c) { return c === 0 ? 'flagship' : c === -1 ? 'other general' : shortName(DATA.groups[c - 1]); }

  // horizontal bars, most to least; empty categories are left out
  // opts (a school's bars): title, weight(p) = the share of the article's authors on its faculty, who = the school
  function authorBars(papers, opts) {
    const o = opts || {};
    const n = new Map(), adj = new Map(), byCat = new Map();
    papers.forEach((p) => {
      journalCats[DATA.papers.journal[p]].forEach((c) => {
        n.set(c, (n.get(c) || 0) + 1);
        adj.set(c, (adj.get(c) || 0) + (o.weight ? o.weight(p) : 1 / DATA.papers.authors[p]));
        if (c > 0) { if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(p); }
      });
    });
    const cats = [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a - b);   // most to least
    if (!cats.length) return '';
    const max = Math.max(...n.values());
    const title = (o.title || 'Where they publish') + ', ' + state.from + '–' + state.to;
    return '<div class="bars" aria-label="' + esc(title) + '">' +
      '<div class="bars-title">' + esc(title) + '</div>' +
      cats.map((c) => {
        const tip = catLabel(c) + ': ' + n.get(c) + ' article' + (n.get(c) === 1 ? '' : 's') + ' (adjusted for co-authors: ' + one(adj.get(c)) + ')';
        const label = c > 0 && o.who
          ? '<a class="area-link" href="' + esc(areaHref(c - 1, journalsOf(byCat.get(c)), o.who + ', ' + state.from + '–' + state.to)) + '">' + esc(catLabel(c)) + '</a>'
          : esc(catLabel(c));
        return '<div class="bar-row" title="' + esc(tip) + '"><span class="bar-label">' + label + '</span>' +
          '<span class="bar-track"><span class="bar ' + (c === 0 ? 'bg-general' : c === -1 ? 'bg-other' : 'bg-specialty') + '" style="width:' + (100 * n.get(c) / max).toFixed(1) + '%"></span></span>' +
          '<span class="bar-value">' + n.get(c) + '</span></div>';
      }).join('') + '</div>';
  }

  ////////////////////////////////////////////// page

  // (2026-10-25, the owner: "add in a spinner for crunching numbers") every recompute runs behind the spinner
  // (masthead.js: LSR.crunch); quick successive changes are computed once, with the newest state
  const crunch = (fn) => (window.LSR && window.LSR.crunch ? window.LSR.crunch.run(fn) : fn());
  function update(persist) {
    saveState(persist);
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
    DATA = window.LSR.unpack(data);       // (2026-10-26) the packed core; people's details come after the ranking
    META = meta;
    groupSubjects = META.group_subjects || {};
    // which bars a journal's articles count toward: flagship (any W&L General journal, main review or not) and each specialty group it is in
    journalCats = DATA.journals.map((j) => {
      // (audit) 0 = a school's main law review; -1 = online editions & other general journals (their own bar)
      const cats = j[2] === null || j[2] === undefined ? [] : j[2] === -1 ? [-1] : [0];
      // (audit) a general journal W&L also lists under a subject (Journal of Legal Analysis, Chicago Legal Forum) has its
      // own bar only, not a second one in a specialty group
      if (cats.length) return cats;
      return [...new Set(j[4].map(([g]) => g + 1))].sort((a, b) => a - b);
    });
    personPapers = new Map();
    DATA.credits.person.forEach((person, k) => {
      if (!personPapers.has(person)) personPapers.set(person, []);
      personPapers.get(person).push(DATA.credits.paper[k]);
    });
    let saved = null;
    try { saved = JSON.parse(recall(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    const fromHash = readHash();
    state = cleanState(fromHash || restoreSaved(saved));
    renderMeta();
    buildPanel();
    wire();
    update(!fromHash);
    loaded();
    // (2026-10-26, the owner: "use lazy loading so that the main ranking shows first") homepages and categories for
    // the faculty rows, once the ranking is on screen; an open school is drawn again when they arrive
    window.LSR.people(DATA).then(() => { if (openSchools.size) renderRanking(); });
    let wantBeta = false;
    try { wantBeta = localStorage.getItem('lsr.beta') === '1'; } catch (e) { wantBeta = false; }
    if (wantBeta) { $('betaTitles').checked = true; setBeta(true); }
  }).catch((err) => {
    loaded();
    $('rankingWindow').innerHTML = '<p class="empty-note">Could not load the data (' + esc(err.message) + ').</p>';
  });
})();
