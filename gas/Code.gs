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
 *
 * Access control: the web app is deployed with "Execute as: Me" and
 * "Who has access: Anyone within [your Workspace domain]" (see
 * appsscript.json). That combination is what makes
 * Session.getActiveUser().getEmail() below return the actual visitor's
 * email — while the script itself still runs with the developer's own
 * permissions, so it can read the Users sheet for every visitor without
 * that sheet needing to be individually shared with each of them.
 * (Switching executeAs to "User accessing the web app" would break
 * that — the Users sheet read would then run as the visitor, who
 * likely has no access to it at all.)
 *
 * The domain restriction alone only proves "some SCS staff member," so
 * getCurrentUserAccess() cross-checks that email against the Users
 * sheet for the real per-school gate: found + Active=TRUE to get in,
 * anything else shows the "insufficient access" screen client-side.
 */

var CONFIG = {
  // From https://docs.google.com/spreadsheets/d/1OQXaRVUJopdjr4OWQbOvNLjoq-_bwaiNS3Rfu1-C62I/edit
  USERS_SHEET_ID: '1OQXaRVUJopdjr4OWQbOvNLjoq-_bwaiNS3Rfu1-C62I'
};

function doGet(e) {
  var access = getCurrentUserAccess();
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.access = access;
  return tpl.evaluate()
    .setTitle('Excellence in Action')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://www.google.com/images/icons/product/apps_script-16.png');
}

/** Used by Index.html's <?!= include('Filename'); ?> calls. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Looks up the signed-in visitor against the Users sheet (columns, in
 * order: Email, Name, SchoolName, CrestURL, Active). Always reads the
 * sheet's first tab, whatever it's named, so renaming the tab doesn't
 * break this.
 *
 * Returns a plain object — safe to JSON-serialize straight into the
 * page — never throws on a missing/unknown email, just comes back with
 * found: false:
 *   { email, found, active, name, schoolName, crestUrl }
 */
function getCurrentUserAccess() {
  var email = String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
  var result = { email: email, found: false, active: false, name: '', schoolName: '', crestUrl: '' };
  if (!email) return result;

  var sheet = SpreadsheetApp.openById(CONFIG.USERS_SHEET_ID).getSheets()[0];
  var rows = sheet.getDataRange().getValues();
  // rows[0] is the header row (Email, Name, SchoolName, CrestURL, Active).
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var rowEmail = String(row[0] || '').toLowerCase().trim();
    if (rowEmail && rowEmail === email) {
      result.found = true;
      result.name = String(row[1] || '').trim();
      result.schoolName = String(row[2] || '').trim();
      result.crestUrl = String(row[3] || '').trim();
      result.active = row[4] === true || String(row[4]).trim().toUpperCase() === 'TRUE';
      break;
    }
  }
  return result;
}
