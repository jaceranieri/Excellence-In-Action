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
  USERS_SHEET_ID: '1OQXaRVUJopdjr4OWQbOvNLjoq-_bwaiNS3Rfu1-C62I',
  // Ratings + EvidenceLog live in their own spreadsheet, separate from
  // the Users sheet above.
  // From https://docs.google.com/spreadsheets/d/15l-HVd1MtjN3uc-jnXDEQSNMDHDN1NTJMSa3v78ptfQ/edit
  DATA_SHEET_ID: '15l-HVd1MtjN3uc-jnXDEQSNMDHDN1NTJMSa3v78ptfQ',
  RATINGS_TAB: 'Ratings',
  EVIDENCE_TAB: 'EvidenceLog',
  // Placeholder — replace with the real reviewers' Google Group before
  // going live. Every Drive file attached to evidence is explicitly
  // shared (Reader) with this address, regardless of whose Drive it
  // lives in, so reviewers outside the uploading school can open it.
  REVIEW_GROUP_EMAIL: 'testgroup@syd.catholic.edu.au',
  // Google Cloud API key restricted to the Google Picker API, used
  // client-side by google.picker.PickerBuilder — see getPickerConfig().
  PICKER_API_KEY: 'REPLACE_WITH_PICKER_API_KEY',
  // OAuth 2.0 "Web application" Client ID (Google Cloud Console ->
  // Credentials), used client-side by Google Identity Services
  // (google.accounts.oauth2.initTokenClient) to get a token for the
  // *visiting* user — deliberately NOT ScriptApp.getOAuthToken(), which
  // would return the developer's own token since this app executes as
  // "Me" (see getPickerConfig()'s doc comment for why that matters).
  PICKER_OAUTH_CLIENT_ID: 'REPLACE_WITH_OAUTH_CLIENT_ID'
};

var RATINGS_HEADERS = ['SchoolName', 'RatingsJSON', 'LastUpdatedBy', 'LastUpdatedAt'];
var EVIDENCE_HEADERS = ['EntryId', 'SchoolName', 'ThemeId', 'EntryNumber', 'Type', 'Date', 'Text', 'Attachments', 'CreatedBy', 'CreatedAt', 'UpdatedAt'];

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

/**
 * Ratings + Evidence persistence.
 *
 * Two tabs in CONFIG.DATA_SHEET_ID (a spreadsheet separate from the Users
 * sheet):
 *   - Ratings: one row per school. RatingsJSON holds every Theme's saved
 *     state as {"<themeId>": {"grade": "sustaining", "rubric": [<selected
 *     level per rubric row, in order, or null>]}, ...}.
 *   - EvidenceLog: one row per evidence entry (append-only, edited/deleted
 *     in place by EntryId), across all schools/themes.
 *
 * All writes take the script lock so two visitors saving at once (e.g. two
 * staff at the same school) never interleave and corrupt a row — see
 * HANDOFF.md for why last-write-wins (not field-level merge) is the
 * accepted tradeoff for v1.
 */

/** Gets a tab by name, creating it with headers if it doesn't exist yet. */
function ensureSheet_(tabName, headers) {
  var ss = SpreadsheetApp.openById(CONFIG.DATA_SHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Row index (1-based, sheet-relative) of the first match in `col`, or -1. */
function findRowByValue_(sheet, colIndex1Based, value) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var values = sheet.getRange(2, colIndex1Based, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(value)) return i + 2;
  }
  return -1;
}

/**
 * Loads this school's saved state. Called once on enterApp(); a school
 * with no Ratings row yet (first-ever visit) gets {} back and the client
 * falls back to ELEMENT_THEMES' built-in defaults.
 * Returns { ratings: {<themeId>: {grade, rubric}}, evidence: [entries] }.
 */
function getSchoolState(schoolName) {
  var ratingsSheet = ensureSheet_(CONFIG.RATINGS_TAB, RATINGS_HEADERS);
  var evidenceSheet = ensureSheet_(CONFIG.EVIDENCE_TAB, EVIDENCE_HEADERS);

  var ratings = {};
  var rowIdx = findRowByValue_(ratingsSheet, 1, schoolName);
  if (rowIdx > 0) {
    var raw = ratingsSheet.getRange(rowIdx, 2).getValue();
    try { ratings = raw ? JSON.parse(raw) : {}; } catch (e) { ratings = {}; }
  }

  var evidence = [];
  var lastRow = evidenceSheet.getLastRow();
  if (lastRow >= 2) {
    var rows = evidenceSheet.getRange(2, 1, lastRow - 1, EVIDENCE_HEADERS.length).getValues();
    rows.forEach(function (row) {
      if (String(row[1]) !== schoolName) return;
      var attachments = [];
      try { attachments = row[7] ? JSON.parse(row[7]) : []; } catch (e) { attachments = []; }
      evidence.push({
        entryId: row[0],
        themeId: row[2],
        number: row[3],
        type: row[4],
        date: row[5],
        text: row[6],
        attachments: attachments
      });
    });
  }

  return { ratings: ratings, evidence: evidence };
}

/**
 * Overwrites the school's whole RatingsJSON blob (last-write-wins — see
 * the doc comment above). ratingsJson is the client's full
 * {themeId: {grade, rubric}} map for every theme, JSON-stringified.
 */
function saveRatings(schoolName, ratingsJson, userEmail) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ensureSheet_(CONFIG.RATINGS_TAB, RATINGS_HEADERS);
    var rowIdx = findRowByValue_(sheet, 1, schoolName);
    var now = new Date().toISOString();
    if (rowIdx > 0) {
      sheet.getRange(rowIdx, 2, 1, 3).setValues([[ratingsJson, userEmail, now]]);
    } else {
      sheet.appendRow([schoolName, ratingsJson, userEmail, now]);
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Adds a new evidence entry (entry.entryId absent/empty) or overwrites an
 * existing one in place (entry.entryId set, matched against EntryId+
 * SchoolName so one school can't overwrite another's row by guessing an
 * id). Returns the saved entry, entryId included, so the client can learn
 * the generated id for a brand-new entry.
 */
function saveEvidenceEntry(schoolName, themeId, entry, userEmail) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ensureSheet_(CONFIG.EVIDENCE_TAB, EVIDENCE_HEADERS);
    var now = new Date().toISOString();
    var attachmentsJson = JSON.stringify(entry.attachments || []);
    var rowIdx = -1;
    if (entry.entryId) {
      var candidate = findRowByValue_(sheet, 1, entry.entryId);
      if (candidate > 0 && String(sheet.getRange(candidate, 2).getValue()) === schoolName) {
        rowIdx = candidate;
      }
    }
    if (rowIdx > 0) {
      sheet.getRange(rowIdx, 5, 1, 4).setValues([[entry.type, entry.date, entry.text, attachmentsJson]]);
      sheet.getRange(rowIdx, 11).setValue(now);
      return { entryId: entry.entryId, ok: true };
    }
    var entryId = Utilities.getUuid();
    sheet.appendRow([
      entryId, schoolName, themeId, entry.number, entry.type, entry.date,
      entry.text, attachmentsJson, userEmail, now, now
    ]);
    return { entryId: entryId, ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Deletes one evidence row, verifying it belongs to `schoolName` first. */
function deleteEvidenceEntry(entryId, schoolName) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ensureSheet_(CONFIG.EVIDENCE_TAB, EVIDENCE_HEADERS);
    var rowIdx = findRowByValue_(sheet, 1, entryId);
    if (rowIdx > 0 && String(sheet.getRange(rowIdx, 2).getValue()) === schoolName) {
      sheet.deleteRow(rowIdx);
      return { ok: true };
    }
    return { ok: false };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Static config the client needs to run the Google Picker + share
 * attached files as the *visiting* user — NOT as this app's own
 * "Execute as: Me" identity. Deliberately does not hand back
 * ScriptApp.getOAuthToken(): since every google.script.run call executes
 * as the developer regardless of who's visiting, that token would
 * authenticate the Picker as the developer, uploading/sharing into the
 * developer's own Drive instead of the visitor's — the opposite of what
 * we want. Instead the client uses Google Identity Services
 * (google.accounts.oauth2.initTokenClient) with the clientId below to get
 * a token tied to the browser's own signed-in Google session, entirely
 * independent of this script's execution identity. See
 * CONFIG.PICKER_OAUTH_CLIENT_ID's comment above for the Cloud Console
 * setup this requires.
 */
function getPickerConfig() {
  return {
    apiKey: CONFIG.PICKER_API_KEY,
    clientId: CONFIG.PICKER_OAUTH_CLIENT_ID,
    reviewGroupEmail: CONFIG.REVIEW_GROUP_EMAIL
  };
}
