// Law School Rankings: the masthead line (version, data timestamp) and the footer, shared by every page
(function () {
  'use strict';
  const MAINTAINER_EMAIL = 'nathan.reitinger@law.northwestern.edu';   // the owner asked for an email button (2026-10-24)
  const REPO = 'https://github.com/nathanReitinger/lawRankings';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const utc = (t) => t.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

  // "Volume 2.1.0" on the left; on the right the Unix time of the last substantive data update
  function stampMasthead(m) {
    document.getElementById('mhVolume').textContent = m.version;
    const st = document.getElementById('mhStamp');
    st.textContent = m.data_updated || '';
    if (m.data_updated) st.title = 'Last substantive data update: ' + utc(new Date(m.data_updated * 1000)) + ' (Unix time ' + m.data_updated + ')';
  }

  function siteFooter(m) {
    const t = m.data_updated ? new Date(m.data_updated * 1000) : null;
    return '<p>Volume ' + esc(m.version) + (t ? ' · data updated ' + esc(t.toISOString().slice(0, 10)) + ' (' + m.data_updated + ')' : '') +
      ' · <a href="history.html">version history</a> · <a href="faq.html">about &amp; method</a></p>' +
      '<div class="foot-actions">' +
      '<a class="btn-line" href="mailto:' + MAINTAINER_EMAIL + '?subject=' + encodeURIComponent('Law School Rankings: I noticed a flaw') + '">Notice a flaw? Email Nathan</a>' +
      '<a class="btn-line" href="' + REPO + '/tree/main/faculty" target="_blank" rel="noopener">Faculty list</a>' +
      '<a class="btn-line" href="' + REPO + '/edit/main/faculty/edits.csv" target="_blank" rel="noopener">Add or fix a faculty member (pull request)</a>' +
      '</div>' +
      '<p>Created and maintained by <a href="https://www.law.northwestern.edu/faculty/profiles/NathanReitinger/">Nathan Reitinger</a> · Northwestern Pritzker School of Law</p>' +
      '<p class="text-muted">Modeled on <a href="https://csrankings.org/">CSrankings</a>.</p>';
  }

  window.LSR = { stampMasthead: stampMasthead, siteFooter: siteFooter, email: MAINTAINER_EMAIL, repo: REPO };
})();
