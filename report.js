/*!
 * Export report — a print-ready summary of the school's ratings, priorities
 * and evidence, saved as a PDF through the browser's print dialog.
 *
 * Opened from the banner's Export button (#report-open-btn). A full-screen
 * dialog shows the options and a live preview of the report; "Save as PDF"
 * calls window.print(), and report.css's @media print rules hide everything
 * but the report while the dialog is open.
 *
 * The report is built entirely from what the page already has loaded, so
 * it always matches what the person sees: ELEMENT_THEMES (grades, rubric
 * selections, evidence, priorities), GRADES, ExcellenceWheel.SEGMENTS and
 * the live wheel (cloned for the wheel picture). Nothing is sent to the
 * server.
 *
 * Shared by both builds: this file is report.js in the static build and
 * gas/Script_Report.html (wrapped in <script>) in the GAS build. Keep the
 * two identical. GAS-only globals (SCHOOL_NAME, USER_NAME, LAST_UPDATED,
 * SCHOOL_STATE_LOADED, isPractice, createToast) are all optional here.
 *
 * Agreed content: every rubric row shows only its selected level and that
 * level's wording ("Not rated" otherwise); evidence shows titles only.
 */
(function () {
  var openBtn = document.getElementById('report-open-btn');
  if (!openBtn || typeof ELEMENT_THEMES === 'undefined' || typeof ExcellenceWheel === 'undefined') return;

  var GRADE_ORDER = ['excelling', 'sustaining', 'delivering', 'pre-delivering', 'ungraded'];
  var CATEGORY_ORDER = ['leading', 'teaching', 'learning'];
  var UNGRADED_FILL = '#E9EAEE';

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Top-level `var`s in the app's scripts are properties of window.
  function optionalGlobal(name) { return window[name]; }

  function toast(state, title, detail, ms) {
    if (typeof createToast === 'function') createToast().update(state, title, detail || '', ms);
    else window.alert(title + (detail ? '\n\n' + detail : ''));
  }

  function gradeInfo(key) {
    var g = (typeof GRADES !== 'undefined' && GRADES[key]) || null;
    return {
      key: key,
      label: g ? g.label : 'Ungraded',
      fill: key === 'ungraded' || !g ? UNGRADED_FILL : g.color
    };
  }

  function schoolName() {
    var name = optionalGlobal('SCHOOL_NAME');
    if (name) return String(name);
    var el = document.querySelector('.app-banner-school-name');
    return el ? el.textContent.trim() : '';
  }

  function segmentsInWheelOrder() {
    return ExcellenceWheel.SEGMENTS.slice().sort(function (a, b) {
      return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    });
  }

  function elementTitle(seg) {
    var data = ELEMENT_THEMES[seg.id];
    return (data && data.title) || seg.lines.join(' ');
  }

  // Evidence as last saved to the school. Entries still being saved for
  // the first time (no entryId yet) are left out, and an entry with an
  // unsaved edit shows its saved title.
  function savedEvidence(theme) {
    return (theme.evidence || []).filter(function (e) { return e && e.entryId; })
      .slice().sort(function (a, b) { return (a.number || 0) - (b.number || 0); })
      .map(function (e) {
        var title = e.lastSaved ? e.lastSaved.title : e.title;
        return { title: title || ('Evidence ' + (e.number || '')).trim() };
      });
  }

  function formatLongDate(d) {
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  // ------------------------------------------------------------------
  // Which Themes the report covers
  // ------------------------------------------------------------------

  // [{ seg, title, themes: [theme] }] in wheel order, for these options.
  function collect(opts) {
    var groups = [];
    segmentsInWheelOrder().forEach(function (seg) {
      if (opts.scope !== 'all' && opts.scope !== 'priorities' && opts.scope !== seg.id) return;
      var data = ELEMENT_THEMES[seg.id];
      var themes = ((data && data.themes) || []).filter(function (t) {
        if (opts.scope === 'priorities' && !t.priority) return false;
        return true;
      });
      if (themes.length) groups.push({ seg: seg, title: elementTitle(seg), themes: themes });
    });
    return groups;
  }

  function scopeLabel(opts) {
    if (opts.scope === 'all') return 'Whole school';
    if (opts.scope === 'priorities') return 'Our school priorities';
    var seg = ExcellenceWheel.SEGMENTS.filter(function (s) { return s.id === opts.scope; })[0];
    return seg ? elementTitle(seg) : '';
  }

  // ------------------------------------------------------------------
  // Pieces
  // ------------------------------------------------------------------

  function gradeChip(key, small) {
    var g = gradeInfo(key || 'ungraded');
    return '<span class="report-grade' + (small ? ' is-small' : '') + '" style="--grade-fill:' + g.fill + '">' +
      esc(g.label) + '</span>';
  }

  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.7 6.3.9-4.55 4.43 1.07 6.27L12 17.1l-5.62 2.96 1.07-6.27L2.9 9.4l6.3-.9L12 2.8z"/></svg>';

  function priorityBadge() {
    return '<span class="report-priority">' + STAR_SVG + 'Priority</span>';
  }

  function elementIcon(seg) {
    if (typeof EIAIcons === 'undefined' || EIAIcons.names().indexOf(seg.icon) === -1) return '';
    var colors = { all: '#000000' };
    var accent = ExcellenceWheel.CATEGORY_STYLE[seg.category].accent;
    EIAIcons.accent(seg.icon).forEach(function (part) { colors[part] = accent; });
    return '<span class="report-element-icon" aria-hidden="true">' + EIAIcons.svg(seg.icon, { colors: colors }) + '</span>';
  }

  function categoryLabel(seg) {
    var style = ExcellenceWheel.CATEGORY_STYLE[seg.category];
    return '<span class="report-category" style="--category-color:' + style.wedge + '">' + esc(style.label) + '</span>';
  }

  // A copy of the live wheel in its resting state (nothing selected,
  // hovered or highlighted, no entrance animation). Its ids are renamed so
  // the copy's clip paths and text paths don't point at the live wheel's,
  // which is hidden while printing.
  function wheelPicture() {
    var live = typeof wheel !== 'undefined' && wheel && wheel.getSvgRoot && wheel.getSvgRoot();
    if (!live) return '';
    var svg = live.cloneNode(true);
    svg.classList.remove('ew-has-highlight');
    ['is-dimmed', 'is-selected', 'is-highlighted', 'is-entering', 'is-priority'].forEach(function (cls) {
      svg.querySelectorAll('.' + cls).forEach(function (el) { el.classList.remove(cls); });
    });
    svg.querySelectorAll('[tabindex], [role], [aria-pressed], [aria-label]').forEach(function (el) {
      ['tabindex', 'role', 'aria-pressed', 'aria-label'].forEach(function (a) { el.removeAttribute(a); });
    });
    svg.querySelectorAll('[id]').forEach(function (el) { el.id = 'report-' + el.id; });
    svg.querySelectorAll('[href], [clip-path]').forEach(function (el) {
      var href = el.getAttribute('href');
      if (href && href.charAt(0) === '#') el.setAttribute('href', '#report-' + href.slice(1));
      var clip = el.getAttribute('clip-path');
      if (clip) el.setAttribute('clip-path', clip.replace('url(#', 'url(#report-'));
    });
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'The Excellence in Action wheel, with each Theme coloured by its grade');
    return '<div class="report-wheel">' + svg.outerHTML + '</div>';
  }

  function gradeBreakdown(themes) {
    var counts = {};
    GRADE_ORDER.forEach(function (k) { counts[k] = 0; });
    themes.forEach(function (t) { counts[GRADE_ORDER.indexOf(t.grade) >= 0 ? t.grade : 'ungraded']++; });
    var total = themes.length || 1;
    var bar = GRADE_ORDER.filter(function (k) { return counts[k]; }).map(function (k) {
      var g = gradeInfo(k);
      return '<span class="report-bar-part" style="flex-grow:' + counts[k] + ';--grade-fill:' + g.fill + '" title="' +
        esc(g.label + ': ' + counts[k]) + '"></span>';
    }).join('');
    var legend = GRADE_ORDER.map(function (k) {
      var g = gradeInfo(k);
      return '<li><span class="report-swatch" style="--grade-fill:' + g.fill + '"></span>' +
        '<span class="report-legend-label">' + esc(g.label) + '</span>' +
        '<span class="report-legend-count">' + counts[k] + '</span>' +
        '<span class="report-legend-pct">' + Math.round(counts[k] * 100 / total) + '%</span></li>';
    }).join('');
    return '<div class="report-breakdown">' +
      '<h3 class="report-subheading">Themes by grade</h3>' +
      '<div class="report-bar" aria-hidden="true">' + bar + '</div>' +
      '<ul class="report-legend">' + legend + '</ul>' +
    '</div>';
  }

  function stat(value, label) {
    return '<div class="report-stat"><span class="report-stat-value">' + value + '</span>' +
      '<span class="report-stat-label">' + esc(label) + '</span></div>';
  }

  // ------------------------------------------------------------------
  // Pages
  // ------------------------------------------------------------------

  function coverPage(opts, groups, allThemes) {
    var name = schoolName();
    var crest = document.querySelector('.app-banner-school img');
    var crestHtml = crest && crest.complete && crest.naturalWidth
      ? '<img class="report-crest" src="' + esc(crest.getAttribute('src')) + '" alt="' + esc(name) + '">'
      : '';
    var now = new Date();
    var meta = ['Made ' + formatLongDate(now) + (optionalGlobal('USER_NAME') ? ' by ' + esc(optionalGlobal('USER_NAME')) : '')];
    var last = optionalGlobal('LAST_UPDATED');
    if (last && last.at) {
      meta.push('Last updated ' + formatLongDate(new Date(last.at)) + (last.name ? ' by ' + esc(last.name) : ''));
    }
    var graded = allThemes.filter(function (t) { return t.grade && t.grade !== 'ungraded'; }).length;
    var evidence = allThemes.reduce(function (n, t) { return n + savedEvidence(t).length; }, 0);
    var priorities = allThemes.filter(function (t) { return t.priority; }).length;

    var priorityList = '';
    if (opts.scope !== 'priorities') {
      var items = [];
      groups.forEach(function (g) {
        g.themes.forEach(function (t) { if (t.priority) items.push({ theme: t, group: g }); });
      });
      priorityList = '<div class="report-priorities">' +
        '<h3 class="report-subheading">Our school priorities</h3>' +
        (items.length
          ? '<ul class="report-priority-list">' + items.map(function (it) {
              return '<li>' + STAR_SVG + '<span><span class="report-priority-element">' + esc(it.group.title) + '</span>' +
                esc(it.theme.title) + '</span>' + gradeChip(it.theme.grade, true) + '</li>';
            }).join('') + '</ul>'
          : '<p class="report-muted">No Themes have been flagged as a priority' +
            (opts.scope === 'all' ? '.' : ' in this Element.') + '</p>') +
      '</div>';
    }

    return '<section class="report-page report-cover">' +
      '<header class="report-masthead">' +
        '<div class="report-brand" aria-label="Excellence in Action">' +
          '<span class="report-brand-top">Excellence in</span><span class="report-brand-script">Action</span>' +
        '</div>' +
        crestHtml +
      '</header>' +
      '<div class="report-title-block">' +
        '<p class="report-kicker">School summary · ' + esc(scopeLabel(opts)) + '</p>' +
        '<h1 class="report-title">' + esc(name || 'Excellence in Action') + '</h1>' +
        '<p class="report-meta">' + meta.join('<span aria-hidden="true"> · </span>') + '</p>' +
      '</div>' +
      '<div class="report-overview">' +
        wheelPicture() +
        '<div class="report-overview-side">' +
          '<div class="report-stats">' +
            stat(graded + '<small>/' + allThemes.length + '</small>', 'Themes graded') +
            stat(evidence, 'Evidence entries') +
            stat(priorities, 'Priorities') +
          '</div>' +
          gradeBreakdown(allThemes) +
        '</div>' +
      '</div>' +
      priorityList +
    '</section>';
  }

  function glancePage(opts, groups) {
    var rows = groups.map(function (g) {
      var themes = g.themes.filter(function (t) { return opts.includeUngraded || t.grade !== 'ungraded'; });
      if (!themes.length) return '';
      return '<tbody>' +
        '<tr class="report-table-element"><th colspan="3" scope="colgroup">' +
          categoryLabel(g.seg) + '<span>' + esc(g.title) + '</span></th></tr>' +
        themes.map(function (t) {
          var n = savedEvidence(t).length;
          return '<tr>' +
            '<th scope="row">' + esc(t.title) + (t.priority ? ' <span class="report-star-inline" title="Priority">' + STAR_SVG + '</span>' : '') + '</th>' +
            '<td>' + gradeChip(t.grade, true) + '</td>' +
            '<td class="report-num">' + n + '</td>' +
          '</tr>';
        }).join('') +
      '</tbody>';
    }).join('');
    if (!rows) return '';
    return '<section class="report-page">' +
      '<h2 class="report-heading">At a glance</h2>' +
      '<table class="report-table">' +
        '<colgroup><col><col class="report-col-grade"><col class="report-col-num"></colgroup>' +
        '<thead><tr><th scope="col">Theme</th><th scope="col">Grade</th><th scope="col" class="report-num">Evidence</th></tr></thead>' +
        rows +
      '</table>' +
    '</section>';
  }

  function themeBlock(t) {
    var indicators = (t.rubric || []).map(function (row, i) {
      var level = row.selected;
      var text = level && row.cells ? row.cells[level] : '';
      return '<li class="report-indicator' + (level ? '' : ' is-unrated') + '">' +
        '<div class="report-indicator-head"><span class="report-indicator-label">Indicator ' + (i + 1) + '</span>' +
          (level ? gradeChip(level, true) : '<span class="report-muted">Not rated</span>') + '</div>' +
        (text ? '<p class="report-indicator-text">' + esc(String(text).trim()) + '</p>' : '') +
      '</li>';
    }).join('');
    var evidence = savedEvidence(t);
    return '<article class="report-theme">' +
      '<header class="report-theme-head">' +
        '<h3 class="report-theme-title">' + esc(t.title) + '</h3>' +
        '<div class="report-theme-badges">' + (t.priority ? priorityBadge() : '') + gradeChip(t.grade) + '</div>' +
      '</header>' +
      (indicators ? '<ol class="report-indicators">' + indicators + '</ol>' : '') +
      '<div class="report-evidence">' +
        '<h4 class="report-evidence-heading">Evidence <span class="report-count">' + evidence.length + '</span></h4>' +
        (evidence.length
          ? '<ul class="report-evidence-list">' + evidence.map(function (e) { return '<li>' + esc(e.title) + '</li>'; }).join('') + '</ul>'
          : '<p class="report-muted">No evidence recorded.</p>') +
      '</div>' +
    '</article>';
  }

  // One Element's Themes. Each Element starts a new page, except in the
  // priorities report (`flow`), where they follow on from each other:
  // most Elements there hold only one or two priorities.
  function elementPage(opts, g, flow) {
    var themes = g.themes.filter(function (t) { return opts.includeUngraded || t.grade !== 'ungraded'; });
    if (!themes.length) return '';
    return '<section class="' + (flow ? 'report-element is-flow' : 'report-page report-element') + '" style="--element-color:' +
        ExcellenceWheel.CATEGORY_STYLE[g.seg.category].wedge + '">' +
      '<header class="report-element-head">' + elementIcon(g.seg) +
        '<div>' + categoryLabel(g.seg) + '<h2 class="report-heading">' + esc(g.title) + '</h2></div>' +
      '</header>' +
      themes.map(themeBlock).join('') +
    '</section>';
  }

  function buildReport(opts) {
    var groups = collect(opts);
    var allThemes = [];
    groups.forEach(function (g) { allThemes = allThemes.concat(g.themes); });
    if (!allThemes.length) {
      return '<section class="report-page report-empty"><p>' +
        (opts.scope === 'priorities'
          ? 'No Themes have been flagged as a school priority yet. Star a Theme in its window to add it.'
          : 'There’s nothing to show for these options.') +
        '</p></section>';
    }
    var flow = opts.scope === 'priorities';
    var details = groups.map(function (g) { return elementPage(opts, g, flow); }).join('');
    if (details && flow) details = '<div class="report-page">' + details + '</div>';
    if (!details && !opts.includeUngraded) {
      details = '<section class="report-page report-empty"><p>No Themes have been graded yet. Tick “Include ungraded Themes” to list them all.</p></section>';
    }
    return coverPage(opts, groups, allThemes) + glancePage(opts, groups) + details;
  }

  // ------------------------------------------------------------------
  // Dialog
  // ------------------------------------------------------------------

  var elementOptions = segmentsInWheelOrder().map(function (seg) {
    return '<option value="' + esc(seg.id) + '">' + esc(elementTitle(seg)) + '</option>';
  }).join('');

  var overlay = document.createElement('div');
  overlay.className = 'report-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'report-dialog-title');
  overlay.innerHTML =
    '<div class="report-toolbar">' +
      '<div class="report-toolbar-inner">' +
        '<div class="report-toolbar-head">' +
          '<h2 class="report-dialog-title" id="report-dialog-title" tabindex="-1">Export report</h2>' +
          '<button type="button" class="report-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="report-options">' +
          '<label class="report-field"><span>Include</span>' +
            '<select class="report-scope">' +
              '<option value="all">Whole school</option>' +
              '<option value="priorities">Our priorities</option>' +
              '<optgroup label="One Element">' + elementOptions + '</optgroup>' +
            '</select>' +
          '</label>' +
          '<label class="report-check"><input type="checkbox" class="report-include-ungraded" checked>' +
            '<span>Include ungraded Themes</span></label>' +
          '<button type="button" class="report-print-btn">' +
            '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            'Save as PDF</button>' +
        '</div>' +
        '<p class="report-hint">In the print window, set the destination to <strong>Save as PDF</strong>. ' +
          'Turn on <strong>Background graphics</strong> if the grade colours are missing.</p>' +
      '</div>' +
    '</div>' +
    '<div class="report-preview"><div class="report-doc"></div></div>';
  document.body.appendChild(overlay);

  var docEl = overlay.querySelector('.report-doc');
  var scopeEl = overlay.querySelector('.report-scope');
  var ungradedEl = overlay.querySelector('.report-include-ungraded');
  var titleEl = overlay.querySelector('.report-dialog-title');

  // The page footer (@page margin boxes) carries the school's name. It
  // can't come from the report itself, so it's set as its own rule.
  var pageStyle = document.createElement('style');
  document.head.appendChild(pageStyle);

  function cssString(s) {
    return '"' + String(s).replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ') + '"';
  }

  function currentOptions() {
    return { scope: scopeEl.value, includeUngraded: ungradedEl.checked };
  }

  function render() {
    var opts = currentOptions();
    docEl.innerHTML = buildReport(opts);
    var footer = [schoolName(), 'Excellence in Action', scopeLabel(opts)].filter(Boolean).join(' · ');
    pageStyle.textContent = '@media print { @page { @bottom-left { content: ' + cssString(footer) + '; } } }';
  }

  var returnFocus = null;
  var savedTitle = '';

  function isOpen() { return !overlay.hidden; }

  function open() {
    if (typeof isPractice === 'function' && isPractice()) {
      toast('info', 'Finish the tour first', 'The report can’t show practice changes. Export once the tour has ended.', 5000);
      return;
    }
    if (optionalGlobal('SCHOOL_STATE_LOADED') === false) {
      toast('info', 'Your school’s data is still loading', 'Try again in a moment.', 4000);
      return;
    }
    if (typeof closeHistory === 'function') closeHistory(true);
    if (typeof closeMessages === 'function') closeMessages(true);
    returnFocus = document.activeElement;
    render();
    overlay.hidden = false;
    overlay.querySelector('.report-preview').scrollTop = 0;
    document.documentElement.classList.add('report-open');
    openBtn.setAttribute('aria-expanded', 'true');
    titleEl.focus();
  }

  function close() {
    if (!isOpen()) return;
    overlay.hidden = true;
    document.documentElement.classList.remove('report-open');
    openBtn.setAttribute('aria-expanded', 'false');
    docEl.innerHTML = '';
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  // Chrome names the PDF after the page title.
  function pdfTitle() {
    var d = new Date();
    var date = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    return [schoolName(), 'Excellence in Action', scopeLabel(currentOptions()), date].filter(Boolean).join(' - ');
  }

  function restoreTitle() {
    if (savedTitle) { document.title = savedTitle; savedTitle = ''; }
  }

  window.addEventListener('beforeprint', function () {
    if (!isOpen()) return;
    savedTitle = document.title || ' ';
    document.title = pdfTitle();
  });
  window.addEventListener('afterprint', restoreTitle);

  openBtn.addEventListener('click', function () { if (isOpen()) close(); else open(); });
  overlay.querySelector('.report-close').addEventListener('click', close);
  scopeEl.addEventListener('change', render);
  ungradedEl.addEventListener('change', render);
  overlay.querySelector('.report-print-btn').addEventListener('click', function () {
    render(); // picks up anything that changed while the dialog was open
    window.print();
  });

  document.addEventListener('keydown', function (e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // Keep Tab inside the dialog's controls.
    if (e.key === 'Tab') {
      var focusables = overlay.querySelectorAll('.report-toolbar button, .report-toolbar select, .report-toolbar input');
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleEl)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, true);

  window.openReport = open;
  window.closeReport = close;
  window.isReportOpen = isOpen;
})();
