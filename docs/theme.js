// Law School Rankings: the theme (2026-11-01, the owner: "Add night mode for mobile. Allow auto switch or user to set
// it. Add themes like I've done in other projects too. That was things like Solarized or paper or other themes"), as in
// the owner's sign-up sheet app (its theme-init.js and theme.js). Loaded in each page's <head>, before the stylesheets
// paint, so a page never shows the wrong colors first: <html data-theme="<name>" data-mode="light|dark">, from the
// visitor's choice (localStorage 'lsr.theme'), or with no choice White, and Dark while the device is set to dark
// (following the device while the page is open). The colors themselves are in theme.css. The Theme window, opened from
// the masthead's "theme" button (masthead.js), is built here on first use.
// For the charts: LSRTheme.color('--name') reads a color of the theme in use, and the 'lsr-theme' event on document
// fires after the theme changes, so a page can draw its charts again.
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'lsr.theme';
  // name -> [label, light or dark, page color (for the phone browser's own bars)]
  var THEMES = {
    light: ['White', 'light', '#ffffff'],
    paper: ['Paper', 'light', '#faf8f3'],
    'solarized-light': ['Solarized', 'light', '#fdf6e3'],
    'contrast-light': ['High contrast', 'light', '#ffffff'],
    dark: ['Dark', 'dark', '#151515'],
    black: ['Darkest', 'dark', '#000000'],
    'solarized-dark': ['Solarized dark', 'dark', '#002b36'],
    'contrast-dark': ['High contrast dark', 'dark', '#000000'],
  };
  var ORDER = ['light', 'paper', 'solarized-light', 'contrast-light', 'dark', 'black', 'solarized-dark', 'contrast-dark'];
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var chosen = null;
  try { chosen = localStorage.getItem(KEY); } catch (e) { /* storage blocked: the automatic theme */ }
  if (!THEMES[chosen]) chosen = null;
  var shown = null;

  function current() { return chosen || (mq && mq.matches ? 'dark' : 'light'); }
  function tint(color) {
    var m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    m.content = color;
  }
  function paint() {
    var t = current();
    root.setAttribute('data-theme', t);
    root.setAttribute('data-mode', THEMES[t][1]);
    if (chosen) root.removeAttribute('data-theme-auto'); else root.setAttribute('data-theme-auto', '');
    tint(THEMES[t][2]);
    if (shown !== null && shown !== t) {
      try { document.dispatchEvent(new CustomEvent('lsr-theme', { detail: { theme: t, mode: THEMES[t][1] } })); } catch (e) { /* an old browser */ }
    }
    shown = t;
    mark();
  }
  paint();
  // the device going dark at night (or back) changes the page while it is open, when no theme was chosen
  if (mq) {
    var follow = function () { if (!chosen) paint(); };
    if (mq.addEventListener) mq.addEventListener('change', follow); else if (mq.addListener) mq.addListener(follow);
  }
  // a choice made in another tab of the site
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    chosen = THEMES[e.newValue] ? e.newValue : null;
    paint();
  });

  function choose(name) {
    chosen = THEMES[name] ? name : null;
    try { if (chosen) localStorage.setItem(KEY, chosen); else localStorage.removeItem(KEY); } catch (e) { /* this page only */ }
    paint();
  }

  ////////////////////////////////////////////////////////////////////////// the Theme window

  var dialog = null, opener = null;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  // a small picture of the theme: the page, a bar of the info panel, a line of text, a link and two bars of a chart
  function preview(name) {
    return '<span class="th-prev" data-p="' + name + '" aria-hidden="true"><span class="th-p-bar"></span>' +
      '<span class="th-p-line"></span><span class="th-p-line th-p-short"></span>' +
      '<span class="th-p-bars"><i></i><i></i></span></span>';
  }
  function build() {
    dialog = document.createElement('div');
    dialog.className = 'th-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'thTitle');
    var cards = ORDER.map(function (n) {
      return '<label class="th-card"><input type="radio" name="lsr-theme" value="' + n + '">' + preview(n) +
        '<span class="th-name">' + esc(THEMES[n][0]) + '</span></label>';
    }).join('');
    dialog.innerHTML = '<div class="th-panel">' +
      '<div class="th-top"><h2 id="thTitle">Theme</h2><button type="button" class="th-x" aria-label="Close">&times;</button></div>' +
      '<fieldset class="th-group"><legend class="th-sr">Theme</legend>' +
      '<label class="th-card th-auto"><input type="radio" name="lsr-theme" value="auto">' +
      '<span class="th-prev th-prev-auto" aria-hidden="true"><span class="th-half" data-p="light"></span><span class="th-half" data-p="dark"></span></span>' +
      '<span class="th-auto-text"><span class="th-name">Automatic</span><span class="th-hint">White, or Dark while this device is set to dark</span></span></label>' +
      '<div class="th-cards">' + cards + '</div></fieldset>' +
      '<p class="th-note">Kept on this device for every page of the site.</p></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('change', function (e) { if (e.target.name === 'lsr-theme') choose(e.target.value === 'auto' ? null : e.target.value); });
    dialog.querySelector('.th-x').addEventListener('click', close);
    dialog.addEventListener('click', function (e) { if (e.target === dialog) close(); });
    dialog.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      // focus stays in the window: the close button and the checked choice
      var f = [dialog.querySelector('.th-x'), dialog.querySelector('input:checked') || dialog.querySelector('input')];
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    });
  }
  function mark() {
    if (!dialog) return;
    var v = chosen || 'auto';
    Array.prototype.forEach.call(dialog.querySelectorAll('input[name="lsr-theme"]'), function (i) { i.checked = i.value === v; });
  }
  function open(btn) {
    opener = btn || null;
    if (!dialog) build();
    mark();
    dialog.classList.add('on');
    root.classList.add('th-open');
    Array.prototype.forEach.call(document.body.children, function (el) { if (el !== dialog) el.inert = true; });
    var c = dialog.querySelector('input:checked');
    (c || dialog.querySelector('.th-x')).focus();
    if (opener) opener.setAttribute('aria-expanded', 'true');
  }
  function close() {
    if (!dialog) return;
    dialog.classList.remove('on');
    root.classList.remove('th-open');
    Array.prototype.forEach.call(document.body.children, function (el) { el.inert = false; });
    if (opener) { opener.setAttribute('aria-expanded', 'false'); opener.focus(); }
  }

  function color(name, fallback) {
    var v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback || '';
  }

  // Highcharts' own colors for the text, rules and tooltips of every chart, set from the theme in use; under White,
  // Highcharts' own values as they were before the first call, so White draws exactly as before. A page calls this
  // before it draws (and draws again on 'lsr-theme'): it changes only charts made after it.
  var HC_PATHS = ['chart.backgroundColor', 'title.style.color', 'subtitle.style.color', 'caption.style.color',
    'xAxis.labels.style.color', 'xAxis.title.style.color', 'xAxis.lineColor', 'xAxis.tickColor', 'xAxis.gridLineColor', 'xAxis.minorGridLineColor',
    'yAxis.labels.style.color', 'yAxis.title.style.color', 'yAxis.lineColor', 'yAxis.tickColor', 'yAxis.gridLineColor', 'yAxis.minorGridLineColor',
    'colorAxis.labels.style.color', 'colorAxis.gridLineColor',
    'legend.itemStyle.color', 'legend.itemHoverStyle.color', 'legend.itemHiddenStyle.color', 'legend.title.style.color',
    'tooltip.backgroundColor', 'tooltip.borderColor', 'tooltip.style.color',
    'plotOptions.series.dataLabels.style.color', 'drilldown.activeAxisLabelStyle.color', 'drilldown.activeDataLabelStyle.color',
    'loading.style.backgroundColor', 'noData.style.color'];
  var hcBase = null;
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split('.'), last = ks.pop(); ks.forEach(function (k) { o = o[k] = o[k] || {}; }); o[last] = v; }
  function highcharts(H) {
    if (!H || !H.setOptions || !H.getOptions) return;
    if (!hcBase) {
      var g = H.getOptions();
      hcBase = {};
      HC_PATHS.forEach(function (p) { hcBase[p] = getPath(g, p); });
    }
    var want = {};
    if (current() === 'light') {
      // a value Highcharts did not have is taken out again (getOptions() is Highcharts' own defaults object)
      var g0 = H.getOptions();
      HC_PATHS.forEach(function (p) {
        if (hcBase[p] !== undefined) { setPath(want, p, hcBase[p]); return; }
        var ks = p.split('.'), last = ks.pop(), o = getPath(g0, ks.join('.'));
        if (o && typeof o === 'object') delete o[last];
      });
    } else {
      var ink = color('--chart-ink'), ink2 = color('--chart-ink-2'), muted = color('--chart-muted'), axis = color('--chart-axis'), grid = color('--chart-grid');
      var v = {
        'chart.backgroundColor': 'transparent', 'title.style.color': ink, 'subtitle.style.color': ink2, 'caption.style.color': ink2,
        'xAxis.labels.style.color': ink2, 'xAxis.title.style.color': ink2, 'xAxis.lineColor': axis, 'xAxis.tickColor': axis, 'xAxis.gridLineColor': grid, 'xAxis.minorGridLineColor': grid,
        'yAxis.labels.style.color': ink2, 'yAxis.title.style.color': ink2, 'yAxis.lineColor': axis, 'yAxis.tickColor': axis, 'yAxis.gridLineColor': grid, 'yAxis.minorGridLineColor': grid,
        'colorAxis.labels.style.color': ink2, 'colorAxis.gridLineColor': grid,
        'legend.itemStyle.color': ink, 'legend.itemHoverStyle.color': color('--text-strong', ink), 'legend.itemHiddenStyle.color': muted, 'legend.title.style.color': ink,
        'tooltip.backgroundColor': color('--chart-tooltip'), 'tooltip.borderColor': color('--chart-axis'), 'tooltip.style.color': ink,
        'plotOptions.series.dataLabels.style.color': ink, 'drilldown.activeAxisLabelStyle.color': color('--link'), 'drilldown.activeDataLabelStyle.color': color('--link'),
        'loading.style.backgroundColor': color('--bg'), 'noData.style.color': ink2,
      };
      HC_PATHS.forEach(function (p) { setPath(want, p, v[p]); });
    }
    H.setOptions(want);
  }

  window.LSRTheme = {
    // the theme in use ('dark', 'paper', ...), its mode ('light' or 'dark'), and whether the visitor chose it
    get: function () { return { theme: current(), mode: THEMES[current()][1], chosen: !!chosen }; },
    // a color of the theme in use, from theme.css ('--chart-ink'), or the fallback when it is not set
    color: color,
    highcharts: highcharts,
    set: choose,
    open: open,
    close: close,
    themes: ORDER.map(function (n) { return [n, THEMES[n][0], THEMES[n][1]]; }),
  };
})();
