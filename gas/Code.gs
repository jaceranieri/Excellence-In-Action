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

/**
 * Every ID/secret/email the app needs lives in Script Properties (Project
 * Settings > Script Properties in the Apps Script editor), never hardcoded
 * here — this file gets pasted around and eyeballed, Script Properties
 * don't. See HANDOFF.md for the full list of keys to set and where each
 * value comes from.
 */
function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
function requireProp_(key) {
  var value = prop_(key);
  if (!value) {
    throw new Error('Missing Script Property "' + key + '" — set it under ' +
      'Project Settings > Script Properties in the Apps Script editor. See HANDOFF.md.');
  }
  return value;
}

// Sheet tab names are just structure, not secrets — fine to hardcode.
var TABS = { RATINGS: 'Ratings', EVIDENCE: 'EvidenceLog' };

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

  var sheet = SpreadsheetApp.openById(requireProp_('USERS_SHEET_ID')).getSheets()[0];
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
 * Two tabs in the "DATA_SHEET_ID" Script Property's spreadsheet (separate
 * from the Users sheet):
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
  var ss = SpreadsheetApp.openById(requireProp_('DATA_SHEET_ID'));
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
  var ratingsSheet = ensureSheet_(TABS.RATINGS, RATINGS_HEADERS);
  var evidenceSheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);

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
    var sheet = ensureSheet_(TABS.RATINGS, RATINGS_HEADERS);
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
    var sheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
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
    var sheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
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
 * Getting the Picker + file-sharing calls to run as the *visiting* user
 * (not this app's own "Execute as: Me" identity) needs a real per-user
 * OAuth token. Two approaches were tried/considered and don't work here:
 *   - ScriptApp.getOAuthToken() always returns the DEVELOPER's token,
 *     since the whole script (including every google.script.run call)
 *     executes as "Me" regardless of who's visiting.
 *   - Google Identity Services' client-side initTokenClient() (tried in
 *     an earlier round) requires registering the calling page's exact
 *     origin with Google — but Apps Script always serves a deployed web
 *     app's actual content from a per-deployment *.googleusercontent.com
 *     sandbox domain, which Google's OAuth console permanently forbids
 *     from being registered as an origin ("Invalid origin: Uses a
 *     forbidden domain"). This can't be worked around by picking a
 *     different origin — no origin on that domain is ever accepted.
 *
 * The actual fix: the "OAuth2 for Apps Script" library
 * (https://github.com/googleworkspace/apps-script-oauth2, add it via
 * Project Settings > Libraries using script ID
 * 1B7FSrk5Zi6L1rSxxTDgDEUsPzlukDsi4KGuTMorsTQHhGBzBkMun4iDF) does a full
 * OAuth2 Authorization Code redirect through
 * https://script.google.com/macros/d/{SCRIPT_ID}/usercallback — a URL
 * Google's console DOES accept as an Authorized redirect URI, unlike a
 * googleusercontent.com JS origin. It stores each visitor's own token in
 * PropertiesService.getUserProperties(), which (like
 * Session.getActiveUser() above) is scoped per browsing visitor
 * regardless of the script's own execute-as setting. See HANDOFF.md for
 * the full Cloud Console + Script Properties setup this requires.
 */
// Full `drive` scope, not the narrower `drive.file` this started with:
// drive.file only grants read/write on a picked file's own content, NOT
// the ability to change who else it's shared with — calling
// permissions.create on a file the visitor picked (but didn't create
// via this app) 403s under drive.file with "insufficientFilePermissions",
// which is exactly the "share the attachment with the review group"
// step this app needs to do. There's no scope narrower than full `drive`
// that still permits managing sharing on an arbitrary existing file.
// Since the OAuth consent screen is Internal (see HANDOFF.md), this
// doesn't trigger Google's app-verification review — it does mean
// visitors see a broader-sounding consent prompt ("See, edit, create,
// and delete all of your Google Drive files"), even though this app's
// own code only ever touches files someone explicitly attaches via the
// Picker.
function getDriveService_() {
  // Named 'drive_v2', not 'drive': the OAuth2 library stores each
  // visitor's granted token keyed by this service name in their own
  // UserProperties, and has no idea the *scope* requested under the old
  // name changed — a visitor who already authorized 'drive' (drive.file)
  // would keep using that stale, too-narrow token forever otherwise,
  // hitting the exact same 403. The name change forces everyone
  // (including whoever already authorized once) through a fresh
  // authorization under the new, broader scope.
  return OAuth2.createService('drive_v2')
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(requireProp_('DRIVE_OAUTH_CLIENT_ID'))
    .setClientSecret(requireProp_('DRIVE_OAUTH_CLIENT_SECRET'))
    .setCallbackFunction('driveAuthCallback')
    .setPropertyStore(PropertiesService.getUserProperties())
    .setScope('https://www.googleapis.com/auth/drive');
}

/** OAuth2 library's redirect target after the visitor grants/denies access. */
function driveAuthCallback(request) {
  var isAuthorized = getDriveService_().handleCallback(request);
  return HtmlService.createHtmlOutput(
    isAuthorized
      ? 'Drive access granted — you can close this tab and go back to Excellence in Action.'
      : 'Drive access was not granted. You can close this tab and try Attach Files again.'
  );
}

/**
 * Run once from the Apps Script editor (select this function in the
 * toolbar dropdown, click Run, then check View > Logs) to get the exact
 * redirect URI to paste into the OAuth Client's "Authorized redirect
 * URIs" in Cloud Console. See HANDOFF.md.
 */
function logDriveRedirectUri() {
  Logger.log(getDriveService_().getRedirectUri());
}

/**
 * Called by the client right before opening the Picker. If the visitor
 * hasn't granted Drive access yet (or a prior grant expired/was
 * revoked), returns an authorizationUrl for the client to open in a
 * popup; once they grant access there, calling this again returns the
 * real per-visitor access token plus what the client needs to build the
 * Picker itself.
 */
function getPickerAuth() {
  var service = getDriveService_();
  if (!service.hasAccess()) {
    return { authorized: false, authorizationUrl: service.getAuthorizationUrl() };
  }
  return {
    authorized: true,
    accessToken: service.getAccessToken(),
    apiKey: requireProp_('PICKER_API_KEY'),
    reviewGroupEmail: requireProp_('REVIEW_GROUP_EMAIL')
  };
}
