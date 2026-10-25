// Law School Rankings: Who works on what (2026-10-25, the owner: "I can really tell what someone does by
// publications in specialty journals. I want to highlight that. And show examples."). From data/data.json: each
// specialty journal's field (journals[j][3][0][0]), and each credited article's authors.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('en-US');
  const EXAMPLES = ['Technology law & policy', 'Intellectual property', 'Criminal procedure', 'Environmental law', 'Health care law & policy',
                    'Corporate law & governance', 'Human rights', 'Income & business taxation'];
  const PAGE = 40;

  let DATA, META, fieldOf, groupOfField;
  const st = { field: null, from: 0, to: 0, region: 'us', skip: true, shown: PAGE, person: null };
  let counts = null;     // field -> Map(person -> {n, journals: Map(j -> n)}); person -> specialty total

  const isUS = (person) => DATA.people[person][1].some((s) => DATA.schools[s][1]);
  const schoolsOf = (person) => DATA.people[person][1].map((s) => DATA.schools[s][0]).join(' · ');
  const nameLink = (person) => {
    const p = DATA.people[person];
    return p[3] ? '<a href="' + esc(p[3]) + '" target="_blank" rel="noopener" title="Faculty page">' + esc(p[0]) + '</a>' : esc(p[0]);
  };

  // every specialty-journal article in the window, per field and person (co-authored articles count whole)
  function compute() {
    const P = DATA.papers, C = DATA.credits;
    const byField = new Map();
    const total = new Map();
    for (let i = 0; i < C.paper.length; i++) {
      const p = C.paper[i];
      const f = fieldOf[P.journal[p]];
      if (f === undefined) continue;
      const y = P.year[p];
      if (y < st.from || y > st.to || (st.skip && P.minor[p])) continue;
      const person = C.person[i];
      if (st.region === 'us' && !isUS(person)) continue;
      if (!byField.has(f)) byField.set(f, new Map());
      const m = byField.get(f);
      let r = m.get(person);
      if (!r) { r = { n: 0, journals: new Map() }; m.set(person, r); }
      r.n++;
      r.journals.set(P.journal[p], (r.journals.get(P.journal[p]) || 0) + 1);
      total.set(person, (total.get(person) || 0) + 1);
    }
    counts = { byField: byField, total: total };
  }

  function ranked(f) {
    const m = counts.byField.get(f);
    if (!m) return [];
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n || (b[1].n / counts.total.get(b[0])) - (a[1].n / counts.total.get(a[0])) ||
      DATA.people[a[0]][0].localeCompare(DATA.people[b[0]][0]));
  }

  // the top k journals; "…" when there are more (review: a cut list must not read as the whole)
  const journalList = (journals, k) => {
    const all = [...journals.entries()].sort((a, b) => b[1] - a[1] || DATA.journals[a[0]][0].localeCompare(DATA.journals[b[0]][0]));
    return all.slice(0, k).map(([j, n]) => esc(DATA.journals[j][0]) + (n > 1 ? ' (' + n + ')' : '')).join(', ') + (all.length > k ? ', …' : '');
  };

  function renderExamples() {
    const box = $('examples');
    box.replaceChildren();
    EXAMPLES.forEach((name) => {
      const f = DATA.subjects.indexOf(name);
      if (f < 0) return;
      const top = ranked(f)[0];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'sc-card' + (f === st.field ? ' on' : '');
      if (!top) {
        card.innerHTML = '<span class="sc-card-field">' + esc(name) + '</span><span class="sc-card-who">No articles in these years</span>';
      } else {
        const [person, r] = top;
        const tied = ranked(f).filter(([, x]) => x.n === r.n).length - 1;     // (review) a tie at the top is said
        card.innerHTML = '<span class="sc-card-field">' + esc(name) + '</span>' +
          '<span class="sc-card-who">' + esc(DATA.people[person][0]) + (tied ? ' <small>(tied with ' + tied + ' other' + (tied === 1 ? '' : 's') + ')</small>' : '') + '</span>' +
          '<span class="sc-card-school">' + esc(schoolsOf(person)) + '</span>' +
          '<span class="sc-card-n"><b>' + r.n + '</b> article' + (r.n === 1 ? '' : 's') + ' in ' + journalList(r.journals, 2) + '</span>';
      }
      card.addEventListener('click', () => { setField(f); $('fieldHead').scrollIntoView({ behavior: 'smooth' }); });
      box.appendChild(card);
    });
  }

  function renderField() {
    const f = st.field;
    $('fieldArea').textContent = groupOfField[f] || '';
    $('fieldName').textContent = DATA.subjects[f];
    const rows = ranked(f);
    const journals = DATA.journals.map((j, ji) => ji).filter((ji) => fieldOf[ji] === f);
    const lede = $('fieldLede');
    lede.replaceChildren();
    const nArticles = new Set();
    // distinct articles in the field's journals in the window (for the lede)
    const P = DATA.papers, C = DATA.credits;
    for (let i = 0; i < C.paper.length; i++) {
      const p = C.paper[i];
      if (fieldOf[P.journal[p]] === f && P.year[p] >= st.from && P.year[p] <= st.to && !(st.skip && P.minor[p]) &&
          (st.region !== 'us' || isUS(C.person[i]))) nArticles.add(p);
    }
    lede.append(num(rows.length) + ' faculty published ' + num(nArticles.size) + ' article' + (nArticles.size === 1 ? '' : 's') + ' in this field\'s ' +
      journals.length + ' specialty journal' + (journals.length === 1 ? '' : 's') + ' from ' + st.from + ' to ' + st.to + ' (' +
      journals.slice(0, 4).map((ji) => DATA.journals[ji][0]).join(', ') + (journals.length > 4 ? ', …' : '') + ').');
    const t = $('table');
    if (!rows.length) {
      t.innerHTML = '<tbody><tr><td class="sc-empty">No articles in this field\'s journals in these years.</td></tr></tbody>';
      $('more').hidden = true;
      return;
    }
    const max = rows[0][1].n;
    let html = '<thead><tr><th class="num">#</th><th>Faculty member</th><th class="num" title="Articles in this field\'s specialty journals">Articles</th>' +
      '<th class="num sc-focus" title="Share of the person\'s specialty-journal articles that are in this field">Focus</th><th class="sc-j">Journals</th></tr></thead><tbody>';
    let rank = 0, prev = null;
    rows.slice(0, st.shown).forEach(([person, r], i) => {
      if (r.n !== prev) { rank = i + 1; prev = r.n; }
      const focus = r.n / (counts.total.get(person) || 1);
      html += '<tr' + (person === st.person ? ' class="sc-me"' : '') + '><td class="num">' + rank + '</td>' +
        '<td><div class="sc-name">' + nameLink(person) + '</div><div class="sc-school">' + esc(schoolsOf(person)) + '</div>' +
        '<div class="sc-j-inline">' + journalList(r.journals, 3) + '</div></td>' +
        '<td class="num"><span class="sc-bar" style="width:' + Math.max(4, Math.round(64 * r.n / max)) + 'px"></span>' + r.n + '</td>' +
        '<td class="num sc-focus">' + Math.round(100 * focus) + '%</td>' +
        '<td class="sc-j">' + journalList(r.journals, 3) + '</td></tr>';
    });
    t.innerHTML = html + '</tbody>';
    $('more').hidden = rows.length <= st.shown;
    $('more').textContent = 'Show more (' + num(rows.length - st.shown) + ' more)';
  }

  function renderPerson() {
    const box = $('person');
    const person = st.person;
    if (person == null) { box.innerHTML = '<p class="text-muted">Type a name above.</p>'; return; }
    const P = DATA.papers, C = DATA.credits;
    const fields = new Map();
    let flagship = 0, specialty = 0, other = 0;
    for (let i = 0; i < C.paper.length; i++) {
      if (C.person[i] !== person) continue;
      const p = C.paper[i];
      if (P.year[p] < st.from || P.year[p] > st.to || (st.skip && P.minor[p])) continue;
      const ji = P.journal[p];
      const f = fieldOf[ji];
      if (f !== undefined) {
        specialty++;
        if (!fields.has(f)) fields.set(f, new Map());
        fields.get(f).set(ji, (fields.get(f).get(ji) || 0) + 1);
      } else if (DATA.journals[ji][2] !== null && DATA.journals[ji][2] !== undefined) flagship++;     // flagship and other general, as the rankings page's bar
      else other++;
    }
    const list = [...fields.entries()].map(([f, m]) => [f, [...m.values()].reduce((a, b) => a + b, 0), m])
      .sort((a, b) => b[1] - a[1] || DATA.subjects[a[0]].localeCompare(DATA.subjects[b[0]]));
    const p = DATA.people[person];
    let html = '<div class="sc-person-card"><div class="sc-person-name">' + nameLink(person) + '</div><div class="sc-school">' + esc(schoolsOf(person)) +
      (p[3] ? ' · <a href="' + esc(p[3]) + '" target="_blank" rel="noopener">faculty page</a>' : '') + '</div>';
    if (!list.length) {
      // (review) "try other years" only when there are field articles in other years
      const elsewhere = (p[6] || 0) > 0;
      html += '<p>No specialty-journal articles from ' + st.from + ' to ' + st.to + (flagship ? '; ' + flagship + ' in flagship law reviews' : '') + '. ' +
        (elsewhere ? 'Try a wider range of years.' : 'They publish in flagship and general journals only, so their field cannot be read from specialty journals.') + '</p>';
    } else {
      const second = list[1] && list[1][1] >= 0.5 * list[0][1] ? list[1] : null;
      html += '<p class="sc-person-lede">Works on <b>' + esc(DATA.subjects[list[0][0]]) + '</b>' +
        (second ? ' and <b>' + esc(DATA.subjects[second[0]]) + '</b>' : '') + ' (' + (list[0][1] + (second ? second[1] : 0)) + ' of ' + specialty +
        ' specialty-journal article' + (specialty === 1 ? '' : 's') + ' from ' + st.from + ' to ' + st.to + ')' +
        (flagship ? ', besides ' + flagship + ' in flagship law reviews' : '') + '.</p><ul class="sc-person-fields">';
      const max = list[0][1];
      list.forEach(([f, n, m]) => {
        html += '<li><span class="sc-bar" style="width:' + Math.max(4, Math.round(90 * n / max)) + 'px"></span><b>' + esc(DATA.subjects[f]) + '</b> ' + n +
          ' <span class="text-muted">· ' + journalList(m, 3) + '</span> <a href="#f=' + encodeURIComponent(DATA.subjects[f]) + '" data-field="' + f + '" class="works-more">who else</a></li>';
      });
      html += '</ul>';
    }
    box.innerHTML = html + '</div>';
    box.querySelectorAll('a[data-field]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      setField(+a.dataset.field);
      $('fieldHead').scrollIntoView({ behavior: 'smooth' });
    }));
  }

  function setField(f) {
    st.field = f;
    st.shown = PAGE;
    $('field').value = String(f);
    saveHash();
    renderField();
    renderExamples();
  }

  function saveHash() {
    const h = 'f=' + encodeURIComponent(DATA.subjects[st.field]) + (st.person != null ? '&p=' + encodeURIComponent(DATA.people[st.person][0]) : '') +
      '&y=' + st.from + '-' + st.to + '&r=' + st.region + '&m=' + (st.skip ? 1 : 0);
    try { history.replaceState(null, '', '#' + h); } catch (e) { /* file:// */ }
  }

  function renderAll() {
    compute();
    renderExamples();
    renderField();
    renderPerson();
  }

  function setup() {
    // the journals that define a field (build_data.py: data.field_of), as for the tags on the rankings page
    fieldOf = {};
    DATA.journals.forEach((j, ji) => {
      const f = DATA.field_of ? DATA.field_of[ji] : (j[3] && j[3].length ? j[3][0][0] : -1);
      if (f >= 0) fieldOf[ji] = f;
    });
    groupOfField = {};
    Object.entries(META.group_subjects || {}).forEach(([g, subs]) => subs.forEach((s) => { groupOfField[DATA.subjects.indexOf(s)] = g; }));
    // fields grouped by area, as on the rankings page
    const sel = $('field');
    Object.entries(META.group_subjects || {}).forEach(([g, subs]) => {
      const og = document.createElement('optgroup');
      og.label = g;
      subs.forEach((s) => { const i = DATA.subjects.indexOf(s); if (i >= 0) og.appendChild(new Option(s, String(i))); });
      sel.appendChild(og);
    });
    const maxY = Math.min(new Date().getFullYear(), META.years.max);
    st.to = maxY;
    st.from = maxY - 10;
    for (let y = maxY; y >= Math.max(META.years.min, 1950); y--) { $('from').add(new Option(y, y)); $('to').add(new Option(y, y)); }
    $('from').value = st.from;
    $('to').value = st.to;
    // the people list for the look-up (US faculty with articles first is not needed: names are unique enough with the school)
    const dl = $('peopleList');
    const opts = DATA.people.map((p, i) => [p[0] + ' — ' + p[1].map((s) => DATA.schools[s][0]).join(' · '), i]).sort((a, b) => a[0].localeCompare(b[0]));
    const byLabel = new Map(opts);
    opts.forEach(([label]) => { const o = document.createElement('option'); o.value = label; dl.appendChild(o); });
    const byName = new Map();
    DATA.people.forEach((p, i) => { if (!byName.has(p[0].toLowerCase())) byName.set(p[0].toLowerCase(), i); });
    const pick = () => {
      const v = $('who').value.trim();
      const i = byLabel.has(v) ? byLabel.get(v) : byName.get(v.toLowerCase());
      if (i !== undefined) { st.person = i; saveHash(); renderPerson(); }
    };
    $('who').addEventListener('change', pick);
    $('who').addEventListener('input', () => { if (byLabel.has($('who').value.trim())) pick(); });

    // the field from the link (#f=...&p=...), else the first example
    const hash = new URLSearchParams(location.hash.slice(1));
    const want = DATA.subjects.indexOf(hash.get('f') || '');
    st.field = want >= 0 ? want : DATA.subjects.indexOf(EXAMPLES[0]) >= 0 ? DATA.subjects.indexOf(EXAMPLES[0]) : 0;
    if (hash.get('p')) { const i = byName.get(hash.get('p').toLowerCase()); if (i !== undefined) { st.person = i; $('who').value = DATA.people[i][0]; } }
    // years, schools and short pieces from the link (the rankings page's "others" links carry its filters)
    const yr = /^(\d{4})-(\d{4})$/.exec(hash.get('y') || '');
    if (yr) {
      st.from = Math.max(META.years.min, Math.min(maxY, +yr[1]));
      st.to = Math.max(st.from, Math.min(maxY, +yr[2]));
      $('from').value = st.from; $('to').value = st.to;
    }
    if (hash.get('r') === 'all' || hash.get('r') === 'us') { st.region = hash.get('r'); $('region').value = st.region; }
    if (hash.get('m') === '0' || hash.get('m') === '1') { st.skip = hash.get('m') === '1'; $('skip').checked = st.skip; }
    sel.value = String(st.field);
    sel.addEventListener('change', () => setField(+sel.value));
    const years = () => {
      let a = +$('from').value, b = +$('to').value;
      if (a > b) { const t = a; a = b; b = t; $('from').value = a; $('to').value = b; }
      st.from = a; st.to = b; st.shown = PAGE;
      renderAll();
    };
    $('from').addEventListener('change', years);
    $('to').addEventListener('change', years);
    $('region').addEventListener('change', () => { st.region = $('region').value; st.shown = PAGE; renderAll(); });
    $('skip').addEventListener('change', () => { st.skip = $('skip').checked; renderAll(); });
    $('more').addEventListener('click', () => { st.shown += PAGE; renderField(); });
    window.addEventListener('hashchange', () => {
      const h = new URLSearchParams(location.hash.slice(1));
      const f = DATA.subjects.indexOf(h.get('f') || '');
      if (f >= 0 && f !== st.field) setField(f);
    });
  }

  Promise.all(['data/data.json', 'data/meta.json'].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(u + ': ' + r.status);
    return r.json();
  }))).then(([data, meta]) => {
    DATA = data; META = meta;
    window.LSR.stampMasthead(meta);
    $('footer').innerHTML = window.LSR.siteFooter(meta);
    setup();
    $('loading').remove();
    $('main').hidden = false;
    renderAll();
    if (location.hash.includes('f=')) $('fieldHead').scrollIntoView();
  }).catch((e) => {
    $('loading').textContent = 'The data could not be loaded (' + e.message + '). Try reloading the page.';
  });
})();
