/**
 * Excellence in Action — Apps Script web app entry point.
 *
 * doGet() renders Index.html as an HtmlService template. Apps Script has
 * no static-file serving, so every CSS/JS file that was a separate
 * <link>/<script src="..."> in the static build is instead its own
 * .html file (wrapped in <style>/<script> tags) and pulled in via the
 * include() helper below, using the same
 * <?!= include('Filename'); ?> pattern Apps Script projects use in
 * place of <link>/<script src>.
 */
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Excellence in Action')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://www.google.com/images/icons/product/apps_script-16.png');
}

/** Used by Index.html's <?!= include('Filename'); ?> calls. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
