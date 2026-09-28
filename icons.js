/*!
 * Excellence in Action — line icon set
 * Framework-agnostic vanilla JS. No dependencies.
 *
 * Every icon is drawn on a 100x100 grid as un-filled strokes only, split
 * into named PARTS (e.g. intervention = shield + hand + heart). Each part
 * takes its colour from its own CSS custom property, so the same markup
 * can be white on a coloured wedge, full colour on a card, or all black —
 * decided by CSS (or by the `colors` option), never by editing the icon.
 *
 * Usage:
 *   EIAIcons.svg('intervention');                       // <svg> string
 *   EIAIcons.svg('intervention', { size: 44, colors: { heart: '#c6302c' } });
 *   EIAIcons.group('intervention', 44);                 // <g> centred on 0,0,
 *                                                       // for use inside another <svg>
 *   EIAIcons.names();                                   // ['intervention', ...]
 *
 * Colour variables (set on the icon, or on any ancestor):
 *   --ei-icon-<part>   colour of one part, e.g. --ei-icon-heart
 *   --ei-icon-color    fallback for every part without its own variable
 *                      (itself falls back to currentColor)
 *   --ei-icon-stroke   stroke width in icon units (default 4 of 100)
 *
 * The SVG must be inlined into the page (not <img src>) for CSS to reach
 * the parts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.EIAIcons = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  var GRID = 100;

  // Parts are listed back-to-front (later parts draw on top).
  var ICONS = {
    differentiation: [
      ['circle', 'M56.8 25.6a18.4 18.4 0 1 0 36.7 0a18.4 18.4 0 1 0 -36.7 0ZM63.3 25.6a11.9 11.9 0 1 0 23.8 0a11.9 11.9 0 1 0 -23.8 0ZM8.6 76.6a18.4 18.4 0 1 0 36.7 0a18.4 18.4 0 1 0 -36.7 0ZM15.1 76.6a11.9 11.9 0 1 0 23.8 0a11.9 11.9 0 1 0 -23.8 0Z'],
      ['diamond', 'M27 5L47.6 25.6L27 46.2L6.4 25.6ZM27 16.1L36.4 25.6L27 35.1L17.5 25.6Z'],
      ['star', 'M75.2 58.2L80.8 69.4L93.2 71.2L84.2 80L86.3 92.4L75.2 86.6L64.1 92.4L66.2 80L57.2 71.2L69.6 69.4ZM75.2 72L76.7 75L80 75.5L77.6 77.9L78.2 81.2L75.2 79.6L72.2 81.2L72.8 77.9L70.4 75.5L73.7 75Z']
    ],
    intervention: [
      ['shield', 'M93.4 35.5C92 42.7 89.1 49.9 85.3 55.3C80.9 61.5 74.2 67.2 65.8 71.3C57.6 67.2 50.9 61.5 46.5 55.3C42.7 49.9 39.8 42.7 38.4 35.5C37.1 29 37.1 22.6 37.4 18.7C37.4 17.5 37.5 16.2 37.8 13.9C41.2 13.3 43.8 12.8 46.7 12.1C51.9 10.8 58.7 8.8 65.9 5C73.2 8.8 79.9 10.8 85.1 12.1C88.1 12.8 90.6 13.3 94 13.9C94.2 16.2 94.4 17.5 94.4 18.7C94.7 22.6 94.7 29 93.4 35.5Z'],
      ['hand', 'M19.4 93.7C17.6 94.8 15.4 95.2 14.4 94.9C13.1 94.4 11 92.4 9.3 89.6L7.8 87.1C6.1 84.3 5.3 81.5 5.5 80.2C5.7 79.1 7 77.4 8.8 76.3L12.9 73.8L23.5 91.2L19.4 93.7ZM91.1 82.7L60.8 94.6C56.2 95.9 48.7 93.8 42.7 92C37.6 90.5 33.9 89.2 31.2 90L23.5 91.2L13 73.7L23.4 69.7C30.2 67 35 68.3 41.6 70.5C45.6 71.9 50.5 73.5 57.4 74.6C63.3 75.6 65.8 79.9 66.2 81C66.6 82.3 66.2 84.7 65.6 85.4C64.8 86.2 63.1 86.5 60.2 85.7L58.5 85.3L45.3 84.7L58.6 85.3C59.3 85.5 59.8 85.6 60.2 85.8C61.6 86.1 62.5 86.4 63.5 86.4C64.6 86.4 64.7 86.4 65.6 85.5C66.6 84.5 66.7 83.9 66.4 81.3L88.3 74.1C89.2 73.8 91.4 74.5 92.2 75.3C93 76.2 93.7 78.5 93.5 79.7C93.3 80.7 91.9 82.3 91.1 82.7Z'],
      ['heart', 'M82.5 28.9C80.5 18.5 70.3 18.5 65.9 28.2C61.6 18.5 51.4 18.5 49.4 28.9C47.5 38.3 65.9 51.5 65.9 51.5S84.3 38.3 82.5 28.9Z']
    ]
  };

  function partMarkup(part) {
    var name = part[0];
    return '<path class="ei-part ei-' + name + '" d="' + part[1] + '" fill="none"' +
      ' stroke-linecap="round" stroke-linejoin="round"' +
      ' style="stroke:var(--ei-icon-' + name + ',var(--ei-icon-color,currentColor));' +
      'stroke-width:var(--ei-icon-stroke,4)"/>';
  }

  function inner(name) {
    var parts = ICONS[name];
    if (!parts) throw new Error('EIAIcons: unknown icon "' + name + '"');
    return parts.map(partMarkup).join('');
  }

  // Optional per-call colours, e.g. { heart: '#c6302c', hand: '#fff' } or
  // { all: '#fff' } — written as inline custom properties on the element.
  function colorVars(colors, stroke) {
    var s = '';
    if (colors) {
      Object.keys(colors).forEach(function (k) {
        s += '--ei-icon-' + (k === 'all' ? 'color' : k) + ':' + colors[k] + ';';
      });
    }
    if (stroke != null) s += '--ei-icon-stroke:' + stroke + ';';
    return s;
  }

  function svg(name, opts) {
    opts = opts || {};
    var size = opts.size ? ' width="' + opts.size + '" height="' + opts.size + '"' : '';
    var vars = colorVars(opts.colors, opts.stroke);
    return '<svg class="ei-icon' + (opts.className ? ' ' + opts.className : '') + '"' +
      ' xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + GRID + ' ' + GRID + '"' + size +
      (vars ? ' style="' + vars + '"' : '') +
      (opts.title ? ' role="img" aria-label="' + opts.title + '"' : ' aria-hidden="true"') +
      '>' + inner(name) + '</svg>';
  }

  // A <g> centred on the origin and scaled to `size` units, for dropping
  // into an existing <svg> (the wheel draws its icons around 0,0).
  function group(name, size, opts) {
    size = size || GRID;
    opts = opts || {};
    var vars = colorVars(opts.colors, opts.stroke);
    return '<g class="ei-icon" transform="scale(' + (size / GRID) + ') translate(-' + (GRID / 2) + ',-' + (GRID / 2) + ')"' +
      (vars ? ' style="' + vars + '"' : '') + '>' + inner(name) + '</g>';
  }

  return {
    svg: svg,
    group: group,
    names: function () { return Object.keys(ICONS); },
    parts: function (name) { return ICONS[name].map(function (p) { return p[0]; }); }
  };
});
