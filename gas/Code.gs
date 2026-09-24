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
 * Every server function the page calls re-derives the visitor's school
 * from their session (requireActiveUser_()), never from a client-supplied
 * argument — anyone on the domain can call google.script.run functions
 * straight from the browser console with whatever arguments they like.
 */

/**
 * Every ID/secret/email the app needs lives in Script Properties (Project
 * Settings > Script Properties in the Apps Script editor), never hardcoded
 * here. See HANDOFF.md for the full list of keys and where each comes from.
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
var TABS = {
  USERS: 'Users', SCHOOLS: 'Schools', RATINGS: 'Ratings', EVIDENCE: 'EvidenceLog',
  HISTORY: 'History', EVIDENCE_VERSIONS: 'EvidenceVersions'
};

// Columns added after launch always go at the end, so existing rows keep
// working (ensureSheet_() labels the new headers on existing tabs).
// RestoreCount / LastHistoryId / LastHistoryRow are history bookkeeping —
// see "School history" below.
var RATINGS_HEADERS = ['SchoolName', 'RatingsJSON', 'LastUpdatedBy', 'LastUpdatedAt',
  'RestoreCount', 'LastHistoryId', 'LastHistoryRow'];
// Rows saved before Title existed have none, and the client shows
// "Evidence <number>" for them. VersionId points at this entry's current
// row in EvidenceVersions.
var EVIDENCE_HEADERS = ['EntryId', 'SchoolName', 'ThemeId', 'EntryNumber', 'Type', 'Date', 'Text',
  'Attachments', 'CreatedBy', 'CreatedAt', 'UpdatedAt', 'Title', 'VersionId'];
var EVIDENCE_VERSION_HEADERS = ['VersionId', 'EntryId', 'SchoolName', 'ThemeId', 'EntryNumber', 'Type',
  'Date', 'Title', 'Text', 'Attachments', 'SavedBy', 'SavedAt'];
var HISTORY_HEADERS = ['HistoryId', 'SchoolName', 'Kind', 'Label', 'Actor', 'ActorName',
  'StartedAt', 'UpdatedAt', 'ChangeCount', 'ChangesJSON', 'SnapshotJSON'];

/** { HeaderName: 1-based column } for a headers array. */
function columns_(headers) {
  var map = {};
  headers.forEach(function (h, i) { map[h] = i + 1; });
  return map;
}
var RATINGS_COL = columns_(RATINGS_HEADERS);
var EVIDENCE_COL = columns_(EVIDENCE_HEADERS);
var HISTORY_COL = columns_(HISTORY_HEADERS);

var GRADE_KEYS = ['ungraded', 'pre-delivering', 'delivering', 'sustaining', 'excelling'];

var ARCHIVE_FOLDER_NAME = 'ARCHIVE';
var ARCHIVED_PREFIX = 'ARCHIVED – ';
var MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
var MAX_EVIDENCE_TEXT = 20000;
var MAX_EVIDENCE_TITLE = 150; // matches Script_App.html

function doGet(e) {
  if (isOAuthRedirect_(e)) return handleOAuthRedirect_(e);
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

// ===========================================================================
// Users / Schools lookup
// ===========================================================================

function activeEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
}

function shortHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value))
    .slice(0, 12)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

/**
 * Looks up the signed-in visitor on the Users tab (columns, in order:
 * Email, Name, SchoolName, CrestURL, Active). Never throws on an unknown
 * email — just comes back with found: false:
 *   { email, found, active, name, schoolName, crestUrl }
 */
function getCurrentUserAccess() {
  var email = activeEmail_();
  var result = { email: email, found: false, active: false, name: '', schoolName: '', crestUrl: '' };
  if (!email) return result;

  var ss = SpreadsheetApp.openById(requireProp_('USERS_SHEET_ID'));
  var sheet = ss.getSheetByName(TABS.USERS) || ss.getSheets()[0];
  var rows = sheet.getDataRange().getValues();
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
 * The gate for every google.script.run entry point. Cached for 5 minutes
 * so a burst of saves doesn't re-read the Users sheet each time (so a
 * deactivation takes up to 5 minutes to bite for someone mid-session).
 */
function requireActiveUser_() {
  var email = activeEmail_();
  if (!email) throw new Error('Could not identify your Google account. Reload the page and try again.');
  var cache = CacheService.getScriptCache();
  var key = 'eia.access.' + shortHash_(email);
  var cached = cache.get(key);
  var access = cached ? JSON.parse(cached) : getCurrentUserAccess();
  if (!access.found || !access.active || !access.schoolName) {
    throw new Error('Your account does not have access to Excellence in Action.');
  }
  if (!cached) cache.put(key, JSON.stringify(access), 300);
  return access;
}

/** Folder ID from a Drive folder URL (or a bare ID), or '' if unparseable. */
function parseDriveId_(value) {
  var v = String(value || '').trim();
  var m = v.match(/\/folders\/([A-Za-z0-9_-]+)/) || v.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(v) ? v : '';
}

function readSchoolsTab_() {
  var sheet = SpreadsheetApp.openById(requireProp_('USERS_SHEET_ID')).getSheetByName(TABS.SCHOOLS);
  if (!sheet) throw new Error('The Users spreadsheet has no "' + TABS.SCHOOLS + '" tab.');
  var rows = sheet.getDataRange().getValues();
  var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var nameCol = header.indexOf('schoolname');
  var folderCol = header.indexOf('evidencefolder');
  if (nameCol < 0 || folderCol < 0) {
    throw new Error('The "' + TABS.SCHOOLS + '" tab needs "SchoolName" and "EvidenceFolder" header columns.');
  }
  return rows.slice(1).map(function (row) {
    return { schoolName: String(row[nameCol] || '').trim(), folderValue: String(row[folderCol] || '').trim() };
  }).filter(function (r) { return r.schoolName; });
}

function getSchoolFolderId_(schoolName) {
  var cache = CacheService.getScriptCache();
  var key = 'eia.folder.' + shortHash_(schoolName.toLowerCase());
  var cached = cache.get(key);
  if (cached) return cached;
  var match = readSchoolsTab_().filter(function (r) {
    return r.schoolName.toLowerCase() === schoolName.toLowerCase();
  })[0];
  var folderId = match ? parseDriveId_(match.folderValue) : '';
  if (!folderId) {
    throw new Error('Your school\'s evidence folder hasn\'t been set up yet. Please let the Excellence in Action team know.');
  }
  cache.put(key, folderId, 600);
  return folderId;
}

// ===========================================================================
// Ratings + Evidence persistence
// ===========================================================================
//
// Two tabs in the DATA_SHEET_ID spreadsheet (separate from the Users sheet):
//   - Ratings: one row per school; RatingsJSON holds every Theme's saved
//     state as {"<themeId>": {"grade", "rubric": [...]}, ...}.
//   - EvidenceLog: one row per evidence entry, across all schools/themes.
//     Attachments is a JSON array of {fileId, name, mimeType, url}; every
//     fileId is a copy this app made inside the school's EvidenceFolder.
//   - History / EvidenceVersions: see "School history" below.
//
// All writes take the script lock so concurrent saves never interleave.
// A ratings save only sends the themes that changed, and they're merged
// into the school's saved ratings, so two people editing different themes
// don't overwrite each other. The same theme is still last-write-wins.

// Opened once per server call: a save touches several tabs.
var dataSpreadsheet_ = null;

function ensureSheet_(tabName, headers) {
  var ss = dataSpreadsheet_ || (dataSpreadsheet_ = SpreadsheetApp.openById(requireProp_('DATA_SHEET_ID')));
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < headers.length) {
    // Tab created before a column was added: label the new header cells.
    var have = sheet.getLastColumn();
    sheet.getRange(1, have + 1, 1, headers.length - have).setValues([headers.slice(have)]);
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

function parseAttachments_(raw) {
  try { return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
}

function readSchoolEvidence_(schoolName) {
  var sheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, EVIDENCE_HEADERS.length).getValues()
    .filter(function (row) { return String(row[1]) === schoolName; })
    .map(function (row) {
      return {
        entryId: row[0],
        themeId: row[2],
        number: row[3],
        type: row[4],
        date: row[5],
        title: String(row[11] || ''),
        text: row[6],
        attachments: parseAttachments_(row[7])
      };
    });
}

/**
 * The school's Ratings row, which also carries its history bookkeeping:
 *   { sheet, row, ratings, restoreCount, lastHistoryId, lastHistoryRow }
 * With `create`, a school with no row yet gets one; otherwise row is -1.
 */
function readSchoolRow_(schoolName, create) {
  var sheet = ensureSheet_(TABS.RATINGS, RATINGS_HEADERS);
  var row = findRowByValue_(sheet, RATINGS_COL.SchoolName, schoolName);
  if (row < 0 && create) {
    sheet.appendRow([schoolName, '{}', '', '', 0, '', '']);
    row = sheet.getLastRow();
  }
  var state = { sheet: sheet, row: row, ratings: {}, restoreCount: 0, lastHistoryId: '', lastHistoryRow: 0 };
  if (row < 0) return state;
  var v = sheet.getRange(row, 1, 1, RATINGS_HEADERS.length).getValues()[0];
  try { state.ratings = v[RATINGS_COL.RatingsJSON - 1] ? JSON.parse(v[RATINGS_COL.RatingsJSON - 1]) : {}; } catch (e) { state.ratings = {}; }
  state.restoreCount = parseInt(v[RATINGS_COL.RestoreCount - 1], 10) || 0;
  state.lastHistoryId = String(v[RATINGS_COL.LastHistoryId - 1] || '');
  state.lastHistoryRow = parseInt(v[RATINGS_COL.LastHistoryRow - 1], 10) || 0;
  return state;
}

/**
 * True when a save comes from a page loaded before the school was last
 * restored to an earlier point, so it must not be applied on top of the
 * restore. Pages from before this check existed send no version at all;
 * they're only refused once the school has actually been restored.
 */
function isStaleSave_(state, clientVersion) {
  if (clientVersion === undefined || clientVersion === null || clientVersion === '') return state.restoreCount > 0;
  return Number(clientVersion) !== state.restoreCount;
}

/**
 * Loads the visitor's school's saved state. A school with no Ratings row
 * yet gets {} back and the client keeps ELEMENT_THEMES' defaults.
 * Returns { ratings: {<themeId>: {grade, rubric}}, evidence: [entries],
 * stateVersion } — the page sends stateVersion back with every save.
 */
function getSchoolState() {
  var access = requireActiveUser_();
  var state = readSchoolRow_(access.schoolName, false);
  return {
    ratings: state.ratings,
    evidence: readSchoolEvidence_(access.schoolName),
    stateVersion: state.restoreCount
  };
}

/** Throws unless `obj` is {themeId: {grade, rubric: [level|null, ...]}}. */
function sanitizeRatings_(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid ratings.');
  var out = {};
  Object.keys(obj).forEach(function (themeId) {
    var r = obj[themeId];
    if (!/^[A-Za-z0-9_]+$/.test(themeId) || !r || typeof r !== 'object') throw new Error('Invalid ratings.');
    var grade = GRADE_KEYS.indexOf(r.grade) >= 0 ? r.grade : 'ungraded';
    var rubric = Array.isArray(r.rubric) ? r.rubric.slice(0, 100) : [];
    out[themeId] = {
      grade: grade,
      rubric: rubric.map(function (level) { return GRADE_KEYS.indexOf(level) > 0 ? level : null; })
    };
  });
  return out;
}

/**
 * Merges the changed themes (`changesJson`, {themeId: {grade, rubric}})
 * into the school's saved ratings and records the change in its history.
 * Returns { ok: true } or { ok: false, stale: true } (see isStaleSave_()).
 * Pages from before per-theme saves send every theme; that still works.
 */
function saveRatings(changesJson, stateVersion) {
  var access = requireActiveUser_();
  var changed = sanitizeRatings_(JSON.parse(changesJson));
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = readSchoolRow_(access.schoolName, true);
    if (isStaleSave_(state, stateVersion)) return { ok: false, stale: true };
    var before = state.ratings;
    var after = {};
    Object.keys(before).forEach(function (id) { after[id] = before[id]; });
    Object.keys(changed).forEach(function (id) { after[id] = changed[id]; });
    var changes = diffRatings_(before, after, Object.keys(changed));
    if (!changes.length) return { ok: true };

    ensureHistoryBaseline_(access, state);
    state.sheet.getRange(state.row, RATINGS_COL.RatingsJSON, 1, 3)
      .setValues([[JSON.stringify(after), access.email, new Date().toISOString()]]);
    recordHistory_(access, state, changes, after);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Rebuilds the attachment list from Drive itself, keeping only files that
 * really sit in this school's evidence folder. The client's name/url are
 * never trusted — a url rendered into other staff members' pages must not
 * be attacker-controlled, and a fileId from another school's folder must
 * not be attachable (or later archivable) from this one.
 */
function normalizeAttachments_(list, folderId) {
  var seen = {};
  var out = [];
  (list || []).forEach(function (a) {
    var id = String((a && a.fileId) || '');
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id) || seen[id]) return;
    seen[id] = true;
    try {
      var file = DriveApp.getFileById(id);
      if (!isInFolder_(file, folderId)) return;
      out.push({ fileId: id, name: file.getName(), mimeType: file.getMimeType(), url: file.getUrl() });
    } catch (e) {
      console.warn('Dropping unreadable attachment ' + id + ': ' + e);
    }
  });
  return out;
}

/**
 * Saves a new evidence entry (no entryId) or updates one of the visitor's
 * school's entries. entry.attachments mixes two kinds:
 *   { fileId }            already in the school folder (from a saved entry)
 *   { pickedId, name }    picked in Google Picker, copied into the folder now
 * All copies are made before anything is written. If any copy fails, the
 * ones that worked are trashed and nothing is saved, so the visitor can
 * fix the problem and submit again. Attachments dropped from a saved entry
 * are archived. Every save also writes a row to EvidenceVersions and is
 * recorded in the school's history. Returns
 *   { ok: true, entryId, attachments }
 *   { ok: false, errors: [{ pickedId, error }], needsAuth }
 *   { ok: false, stale: true }  page is older than the school's last restore
 *   { ok: false, gone: true }   the entry being edited no longer exists
 */
function saveEvidenceEntry(themeId, entry) {
  var access = requireActiveUser_();
  if (!/^[A-Za-z0-9_]+$/.test(String(themeId || ''))) throw new Error('Invalid theme.');
  entry = entry || {};
  var list = entry.attachments || [];

  // Checked again under the lock below; checking first as well means
  // files aren't copied for a save that's going to be refused.
  if (isStaleSave_(readSchoolRow_(access.schoolName, false), entry.stateVersion)) return { ok: false, stale: true };
  var evidenceSheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
  if (entry.entryId && schoolEvidenceRow_(evidenceSheet, entry.entryId, access.schoolName) < 0) {
    return { ok: false, gone: true };
  }
  // Looked up lazily so text-only evidence still saves for a school whose
  // EvidenceFolder hasn't been set up yet.
  var folderId = null;
  function schoolFolderId() { return folderId || (folderId = getSchoolFolderId_(access.schoolName)); }

  var existing = list.filter(function (a) { return a && a.fileId && !a.pickedId; });
  var picks = list.filter(function (a) { return a && a.pickedId; });
  var kept = existing.length ? normalizeAttachments_(existing, schoolFolderId()) : [];

  var copied = [];
  if (picks.length) {
    var token = getVisitorAccessToken_(access.email);
    if (!token) {
      return { ok: false, needsAuth: true, errors: picks.map(function (p) {
        return { pickedId: p.pickedId, error: 'Reconnect Google Drive (click Attach Files), then submit again.' };
      }) };
    }
    var seen = {};
    var pickedIds = picks.map(function (p) { return String(p.pickedId); })
      .filter(function (id) { return seen[id] ? false : (seen[id] = true); });
    var result = copyPickedFiles_(token, pickedIds, access, schoolFolderId(), themeId, entry.themeTitle);
    copied = result.copied;
    if (result.errors.length) {
      trashFiles_(copied);
      return { ok: false, errors: result.errors, needsAuth: result.needsAuth };
    }
  }

  var attachments = kept.concat(copied);
  var attachmentsJson = JSON.stringify(attachments);
  var title = String(entry.title || '').trim().slice(0, MAX_EVIDENCE_TITLE);
  var text = String(entry.text || '').slice(0, MAX_EVIDENCE_TEXT);
  var number = parseInt(entry.number, 10) || 0;
  var type = String(entry.type || 'note').slice(0, 40);
  var date = String(entry.date || '').slice(0, 20);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var state = readSchoolRow_(access.schoolName, true);
    if (isStaleSave_(state, entry.stateVersion)) {
      trashFiles_(copied);
      return { ok: false, stale: true };
    }
    var sheet = evidenceSheet;
    var now = new Date().toISOString();
    var rowIdx = -1;
    if (entry.entryId) {
      rowIdx = schoolEvidenceRow_(sheet, entry.entryId, access.schoolName);
      if (rowIdx < 0) {
        trashFiles_(copied);
        return { ok: false, gone: true };
      }
    }
    ensureHistoryBaseline_(access, state);
    var versionId = newVersionId_();
    var change;
    var entryId;
    if (rowIdx > 0) {
      var old = sheet.getRange(rowIdx, 1, 1, EVIDENCE_HEADERS.length).getValues()[0];
      var oldAttachments = parseAttachments_(old[EVIDENCE_COL.Attachments - 1]);
      var keptIds = {};
      attachments.forEach(function (a) { keptIds[a.fileId] = true; });
      var removed = oldAttachments.filter(function (a) { return a && a.fileId && !keptIds[a.fileId]; });
      if (removed.length) archiveEvidenceFiles_(removed, schoolFolderId());
      entryId = entry.entryId;
      themeId = String(old[EVIDENCE_COL.ThemeId - 1]);
      number = parseInt(old[EVIDENCE_COL.EntryNumber - 1], 10) || 0;
      appendEvidenceVersion_(versionId, entryId, access, themeId, number, type, date, title, text, attachmentsJson, now);
      sheet.getRange(rowIdx, EVIDENCE_COL.Type, 1, 4).setValues([[type, date, text, attachmentsJson]]);
      sheet.getRange(rowIdx, EVIDENCE_COL.UpdatedAt, 1, 3).setValues([[now, title, versionId]]);
      change = evidenceEditChange_(themeId, entryId, number, old, title, text, oldAttachments, attachments);
    } else {
      entryId = Utilities.getUuid();
      appendEvidenceVersion_(versionId, entryId, access, themeId, number, type, date, title, text, attachmentsJson, now);
      sheet.appendRow([entryId, access.schoolName, themeId, number, type, date, text, attachmentsJson,
        access.email, now, now, title, versionId]);
      change = { t: 'evidence-add', theme: themeId, entry: entryId, number: number, title: title, files: attachments.length };
    }
    recordHistory_(access, state, change ? [change] : [], state.ratings);
    return { ok: true, entryId: entryId, attachments: attachments };
  } catch (e) {
    trashFiles_(copied); // never leave copies behind for an entry that didn't save
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Row of `entryId` in EvidenceLog if it belongs to `schoolName`, else -1. */
function schoolEvidenceRow_(sheet, entryId, schoolName) {
  var row = findRowByValue_(sheet, EVIDENCE_COL.EntryId, entryId);
  if (row < 0 || String(sheet.getRange(row, EVIDENCE_COL.SchoolName).getValue()) !== schoolName) return -1;
  return row;
}

/** The history change for an edit, or null if nothing actually changed. */
function evidenceEditChange_(themeId, entryId, number, oldRow, title, text, oldAttachments, attachments) {
  var fields = [];
  if (String(oldRow[EVIDENCE_COL.Title - 1] || '') !== title) fields.push('title');
  if (String(oldRow[EVIDENCE_COL.Text - 1] || '') !== text) fields.push('details');
  var oldIds = {};
  oldAttachments.forEach(function (a) { if (a && a.fileId) oldIds[a.fileId] = true; });
  var newIds = {};
  attachments.forEach(function (a) { newIds[a.fileId] = true; });
  var filesAdded = attachments.filter(function (a) { return !oldIds[a.fileId]; }).length;
  var filesRemoved = Object.keys(oldIds).filter(function (id) { return !newIds[id]; }).length;
  if (!fields.length && !filesAdded && !filesRemoved) return null;
  return { t: 'evidence-edit', theme: themeId, entry: entryId, number: number, title: title,
    fields: fields, filesAdded: filesAdded, filesRemoved: filesRemoved };
}

/**
 * Deletes one of the visitor's school's evidence rows, archives its files
 * and records the deletion in the school's history. Its EvidenceVersions
 * rows stay, so a restore can bring it back.
 * Returns { ok }, or { ok: false, stale: true } (see isStaleSave_()).
 */
function deleteEvidenceEntry(entryId, stateVersion) {
  var access = requireActiveUser_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = readSchoolRow_(access.schoolName, true);
    if (isStaleSave_(state, stateVersion)) return { ok: false, stale: true };
    var sheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
    var rowIdx = schoolEvidenceRow_(sheet, entryId, access.schoolName);
    if (rowIdx < 0) return { ok: false };
    ensureHistoryBaseline_(access, state);
    var old = sheet.getRange(rowIdx, 1, 1, EVIDENCE_HEADERS.length).getValues()[0];
    var attachments = parseAttachments_(old[EVIDENCE_COL.Attachments - 1]);
    if (attachments.length) archiveEvidenceFiles_(attachments, getSchoolFolderId_(access.schoolName));
    sheet.deleteRow(rowIdx);
    recordHistory_(access, state, [{
      t: 'evidence-delete', theme: String(old[EVIDENCE_COL.ThemeId - 1]), entry: entryId,
      number: parseInt(old[EVIDENCE_COL.EntryNumber - 1], 10) || 0,
      title: String(old[EVIDENCE_COL.Title - 1] || ''), files: attachments.length
    }], state.ratings);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// ===========================================================================
// School history
// ===========================================================================
//
// Every ratings or evidence change is recorded on the History tab, one row
// per history entry:
//   - Kind: 'baseline' (the school's state when history started — written
//     just before its first recorded change), 'auto' (a group of changes),
//     and later 'checkpoint' / 'restore'.
//   - ChangesJSON: what changed, as a list of
//       { t: 'grade',  theme, from, to }
//       { t: 'rubric', theme, row, from, to }          (row is 0-based)
//       { t: 'evidence-add',    theme, entry, number, title, files }
//       { t: 'evidence-edit',   theme, entry, number, title, fields, filesAdded, filesRemoved }
//       { t: 'evidence-delete', theme, entry, number, title, files }
//     capped at MAX_HISTORY_CHANGES (ChangeCount keeps the true total).
//   - SnapshotJSON: the whole school's state once the entry's changes were
//     made — { ratings, evidence: [versionId, ...] }. That's what a
//     restore puts back.
//
// Grouping: a change joins the school's latest entry if it's an 'auto'
// entry by the same person, last updated within HISTORY_GROUP_MINUTES.
// Otherwise it starts a new entry. Opposite changes within one entry
// cancel out (a rubric cell clicked on and off again leaves no trace).
//
// Evidence in a snapshot is a list of EvidenceVersions ids: every save of
// an entry writes a new, never-changed version row, and EvidenceLog's
// VersionId column says which version is current. Short ids keep even a
// large school's snapshot far below Sheets' 50,000-character cell limit.
//
// RestoreCount (on the school's Ratings row) goes up by one on every
// restore. Pages send the value they loaded with each save, and saves from
// pages older than the last restore are refused (isStaleSave_()).
//
// History bookkeeping never blocks a save: if writing history fails, the
// change is still saved, the error is logged, and the change is folded
// into the next entry's snapshot instead.

var HISTORY_GROUP_MINUTES = 30;
var MAX_HISTORY_CHANGES = 200;

function newVersionId_() {
  return 'v' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}

function appendEvidenceVersion_(versionId, entryId, access, themeId, number, type, date, title, text, attachmentsJson, savedAt) {
  ensureSheet_(TABS.EVIDENCE_VERSIONS, EVIDENCE_VERSION_HEADERS).appendRow([
    versionId, entryId, access.schoolName, themeId, number, type, date, title, text, attachmentsJson,
    access.email, savedAt]);
}

/**
 * Current version ids of every one of the school's evidence entries.
 * Entries saved before history existed have no version yet; one is
 * written for each of them first.
 */
function currentEvidenceVersionIds_(schoolName) {
  var sheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var schools = sheet.getRange(2, EVIDENCE_COL.SchoolName, last - 1, 1).getValues();
  var versions = sheet.getRange(2, EVIDENCE_COL.VersionId, last - 1, 1).getValues();
  var ids = [];
  var missing = [];
  for (var i = 0; i < schools.length; i++) {
    if (String(schools[i][0]) !== schoolName) continue;
    var v = String(versions[i][0] || '');
    if (v) ids.push(v); else missing.push(i + 2);
  }
  if (missing.length) {
    var versionSheet = ensureSheet_(TABS.EVIDENCE_VERSIONS, EVIDENCE_VERSION_HEADERS);
    var rows = missing.map(function (rowIdx) {
      var r = sheet.getRange(rowIdx, 1, 1, EVIDENCE_HEADERS.length).getValues()[0];
      var versionId = newVersionId_();
      sheet.getRange(rowIdx, EVIDENCE_COL.VersionId).setValue(versionId);
      ids.push(versionId);
      return [versionId, r[EVIDENCE_COL.EntryId - 1], schoolName, r[EVIDENCE_COL.ThemeId - 1],
        r[EVIDENCE_COL.EntryNumber - 1], r[EVIDENCE_COL.Type - 1], r[EVIDENCE_COL.Date - 1],
        r[EVIDENCE_COL.Title - 1], r[EVIDENCE_COL.Text - 1], r[EVIDENCE_COL.Attachments - 1],
        r[EVIDENCE_COL.CreatedBy - 1], r[EVIDENCE_COL.UpdatedAt - 1] || r[EVIDENCE_COL.CreatedAt - 1]];
    });
    versionSheet.getRange(versionSheet.getLastRow() + 1, 1, rows.length, EVIDENCE_VERSION_HEADERS.length).setValues(rows);
  }
  return ids;
}

/** grade/rubric changes between two ratings blobs, for the given themes. */
function diffRatings_(before, after, themeIds) {
  var out = [];
  themeIds.forEach(function (id) {
    var b = before[id] || {};
    var a = after[id] || {};
    var bGrade = b.grade || 'ungraded';
    var aGrade = a.grade || 'ungraded';
    if (bGrade !== aGrade) out.push({ t: 'grade', theme: id, from: bGrade, to: aGrade });
    var bRubric = b.rubric || [];
    var aRubric = a.rubric || [];
    for (var i = 0; i < Math.max(bRubric.length, aRubric.length); i++) {
      var from = bRubric[i] || null;
      var to = aRubric[i] || null;
      if (from !== to) out.push({ t: 'rubric', theme: id, row: i, from: from, to: to });
    }
  });
  return out;
}

/**
 * Adds `incoming` changes to an entry's existing list, collapsing repeats:
 * a later grade/rubric change to the same cell updates the earlier one
 * (and disappears if it's back where it started); edits to evidence added
 * in the same entry fold into the add; deleting it drops both.
 */
function mergeChanges_(existing, incoming) {
  var list = existing.slice();
  function findIndex(pred) {
    for (var i = 0; i < list.length; i++) if (pred(list[i])) return i;
    return -1;
  }
  incoming.forEach(function (c) {
    var i;
    if (c.t === 'grade' || c.t === 'rubric') {
      i = findIndex(function (e) { return e.t === c.t && e.theme === c.theme && e.row === c.row; });
      if (i < 0) { list.push(c); return; }
      list[i] = Object.assign({}, list[i], { to: c.to });
      if (list[i].from === list[i].to) list.splice(i, 1);
      return;
    }
    var addIdx = findIndex(function (e) { return e.t === 'evidence-add' && e.entry === c.entry; });
    var editIdx = findIndex(function (e) { return e.t === 'evidence-edit' && e.entry === c.entry; });
    if (c.t === 'evidence-edit') {
      if (addIdx >= 0) {
        list[addIdx] = Object.assign({}, list[addIdx], {
          title: c.title, files: list[addIdx].files + c.filesAdded - c.filesRemoved });
      } else if (editIdx >= 0) {
        var prev = list[editIdx];
        var fields = prev.fields.slice();
        c.fields.forEach(function (f) { if (fields.indexOf(f) < 0) fields.push(f); });
        list[editIdx] = Object.assign({}, prev, { title: c.title, fields: fields,
          filesAdded: prev.filesAdded + c.filesAdded, filesRemoved: prev.filesRemoved + c.filesRemoved });
      } else {
        list.push(c);
      }
      return;
    }
    if (c.t === 'evidence-delete') {
      if (editIdx >= 0) list.splice(editIdx, 1);
      addIdx = findIndex(function (e) { return e.t === 'evidence-add' && e.entry === c.entry; });
      if (addIdx >= 0) { list.splice(addIdx, 1); return; }
    }
    list.push(c);
  });
  return list;
}

/** The school's latest history row, or null: { row, kind, actor, updatedAt (ms), changeCount, changes }. */
function latestHistoryEntry_(sheet, state) {
  if (!state.lastHistoryId) return null;
  var row = state.lastHistoryRow;
  // The row number is a hint (someone may have sorted the tab by hand);
  // the id is what's trusted.
  if (!(row >= 2 && row <= sheet.getLastRow() &&
        String(sheet.getRange(row, HISTORY_COL.HistoryId).getValue()) === state.lastHistoryId)) {
    row = findRowByValue_(sheet, HISTORY_COL.HistoryId, state.lastHistoryId);
  }
  if (row < 0) return null;
  var v = sheet.getRange(row, 1, 1, HISTORY_HEADERS.length).getValues()[0];
  var changes;
  try { changes = JSON.parse(v[HISTORY_COL.ChangesJSON - 1] || '[]'); } catch (e) { changes = []; }
  var updated = v[HISTORY_COL.UpdatedAt - 1]; // Sheets may have turned the ISO text into a Date
  return {
    row: row,
    kind: String(v[HISTORY_COL.Kind - 1]),
    actor: String(v[HISTORY_COL.Actor - 1]),
    updatedAt: updated instanceof Date ? updated.getTime() : Date.parse(String(updated)),
    changeCount: parseInt(v[HISTORY_COL.ChangeCount - 1], 10) || 0,
    changes: changes
  };
}

function appendHistoryRow_(sheet, access, state, kind, label, changes, changeCount, snapshot) {
  var id = Utilities.getUuid();
  var now = new Date().toISOString();
  sheet.appendRow([id, access.schoolName, kind, label, access.email, access.name, now, now,
    changeCount, JSON.stringify(changes), JSON.stringify(snapshot)]);
  var row = sheet.getLastRow();
  state.sheet.getRange(state.row, RATINGS_COL.LastHistoryId, 1, 2).setValues([[id, row]]);
  state.lastHistoryId = id;
  state.lastHistoryRow = row;
  return id;
}

/**
 * Before a school's first recorded change, saves its current state as the
 * 'baseline' entry, so there's always a point to restore to from the day
 * history started. Call it before making the change.
 */
function ensureHistoryBaseline_(access, state) {
  if (state.lastHistoryId) return;
  try {
    var sheet = ensureSheet_(TABS.HISTORY, HISTORY_HEADERS);
    var snapshot = { ratings: state.ratings, evidence: currentEvidenceVersionIds_(access.schoolName) };
    appendHistoryRow_(sheet, { schoolName: access.schoolName, email: '', name: '' }, state,
      'baseline', 'History started', [], 0, snapshot);
  } catch (e) {
    console.error('Could not write history baseline for ' + access.schoolName + ': ' + (e && e.stack || e));
  }
}

/**
 * Records `changes` (already made) in the school's history, with a
 * snapshot of the school's state after them. `ratings` is the school's
 * ratings after the change.
 */
function recordHistory_(access, state, changes, ratings) {
  if (!changes.length) return;
  try {
    var sheet = ensureSheet_(TABS.HISTORY, HISTORY_HEADERS);
    var snapshot = { ratings: ratings, evidence: currentEvidenceVersionIds_(access.schoolName) };
    var latest = latestHistoryEntry_(sheet, state);
    var now = new Date();
    if (latest && latest.kind === 'auto' && latest.actor === access.email &&
        now.getTime() - latest.updatedAt <= HISTORY_GROUP_MINUTES * 60 * 1000) {
      var stored = latest.changes.length;
      var merged = mergeChanges_(latest.changes, changes);
      var overflow = Math.max(0, latest.changeCount - stored); // changes already past the cap
      var count = merged.length + overflow;
      if (merged.length > MAX_HISTORY_CHANGES) merged = merged.slice(0, MAX_HISTORY_CHANGES);
      sheet.getRange(latest.row, HISTORY_COL.UpdatedAt, 1, 4).setValues([[
        now.toISOString(), count, JSON.stringify(merged), JSON.stringify(snapshot)]]);
      return;
    }
    appendHistoryRow_(sheet, access, state, 'auto', '', changes.slice(0, MAX_HISTORY_CHANGES),
      changes.length, snapshot);
  } catch (e) {
    console.error('Could not record history for ' + access.schoolName + ': ' + (e && e.stack || e));
  }
}

// ===========================================================================
// Evidence files: school folder, archive, sharing
// ===========================================================================

function isInFolder_(file, folderId) {
  var parents = file.getParents();
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) return true;
  }
  return false;
}

/** Callers hold the script lock, so two archives can't both create ARCHIVE. */
function getOrCreateArchiveFolder_(schoolFolder) {
  var existing = schoolFolder.getFoldersByName(ARCHIVE_FOLDER_NAME);
  return existing.hasNext() ? existing.next() : schoolFolder.createFolder(ARCHIVE_FOLDER_NAME);
}

/**
 * Moves each attachment's file into <school folder>/ARCHIVE and prefixes
 * its name with "ARCHIVED – ". Files not directly in the school folder
 * (already archived, or not this school's) are left alone.
 */
function archiveEvidenceFiles_(attachments, folderId) {
  if (!attachments || !attachments.length) return;
  var schoolFolder = DriveApp.getFolderById(folderId);
  var archive = null;
  attachments.forEach(function (a) {
    try {
      var file = DriveApp.getFileById(a.fileId);
      if (!isInFolder_(file, folderId)) return;
      archive = archive || getOrCreateArchiveFolder_(schoolFolder);
      var name = file.getName();
      if (name.indexOf('ARCHIVED') !== 0) file.setName(ARCHIVED_PREFIX + name);
      file.moveTo(archive);
    } catch (e) {
      console.error('Failed to archive ' + a.fileId + ': ' + e);
    }
  });
}

/**
 * Minimal Drive v3 REST client. Used with the visitor's token (to read and
 * copy the file they picked) and with the script's own token (for sharing
 * calls, where DriveApp can't suppress Google's notification emails).
 */
function driveRequest_(token, method, path, query, body) {
  var params = { supportsAllDrives: 'true' };
  Object.keys(query || {}).forEach(function (k) { params[k] = query[k]; });
  var request = {
    url: 'https://www.googleapis.com/drive/v3/' + path + '?' + Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&'),
    method: method,
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  };
  if (body) {
    request.contentType = 'application/json';
    request.payload = JSON.stringify(body);
  }
  return request;
}

/** Parsed JSON body, or throws an Error carrying the HTTP status and Drive's reason code. */
function parseDriveResponse_(res) {
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  if (code >= 400) {
    var detail = json && json.error;
    var err = new Error('Drive API failed (' + code + '): ' + ((detail && detail.message) || text));
    err.status = code;
    err.reason = (detail && detail.errors && detail.errors[0] && detail.errors[0].reason) || '';
    throw err;
  }
  return json;
}

/** Single Drive v3 REST call (see driveRequest_ for batched use). */
function driveRest_(token, method, path, query, body) {
  var request = driveRequest_(token, method, path, query, body);
  var url = request.url;
  delete request.url;
  return parseDriveResponse_(UrlFetchApp.fetch(url, request));
}

function listPermissionEmails_(token, fileId) {
  var emails = {};
  var pageToken = '';
  do {
    var q = { fields: 'nextPageToken,permissions(emailAddress)', pageSize: '100' };
    if (pageToken) q.pageToken = pageToken;
    var res = driveRest_(token, 'get', 'files/' + fileId + '/permissions', q);
    (res.permissions || []).forEach(function (p) {
      if (p.emailAddress) emails[p.emailAddress.toLowerCase()] = true;
    });
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return emails;
}

/**
 * Makes sure the visitor (and the review group, if REVIEW_GROUP_EMAIL is
 * set) can view their school's evidence folder. Copies inherit the
 * folder's sharing, so this one grant is what lets every staff member at a
 * school open every piece of that school's evidence — without the app
 * sharing files one by one, and without anyone being given edit. Called by
 * the page, fire-and-forget, right after login. Cached for 6 hours.
 */
function ensureSchoolFolderAccess() {
  var access = requireActiveUser_();
  var folderId = getSchoolFolderId_(access.schoolName);
  var cache = CacheService.getScriptCache();
  var key = 'eia.folderaccess.' + shortHash_(folderId + '|' + access.email);
  if (cache.get(key)) return { ok: true };

  var token = ScriptApp.getOAuthToken();
  var existing = listPermissionEmails_(token, folderId);
  var owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var targets = [{ type: 'user', email: access.email }];
  var group = String(prop_('REVIEW_GROUP_EMAIL') || '').toLowerCase().trim();
  if (group) targets.push({ type: 'group', email: group });
  targets.forEach(function (t) {
    if (existing[t.email] || t.email === owner) return;
    driveRest_(token, 'post', 'files/' + folderId + '/permissions',
      { sendNotificationEmail: 'false', fields: 'id' },
      { role: 'reader', type: t.type, emailAddress: t.email });
  });
  cache.put(key, '1', 21600);
  return { ok: true };
}

function buildEvidenceFileName_(themeId, themeTitle, originalName) {
  var title = String(themeTitle || '').replace(/\s+/g, ' ').trim();
  if (title.length > 60) title = title.slice(0, 59).trim() + '…';
  var original = String(originalName || 'Untitled').replace(/\s+/g, ' ').trim();
  return themeId + (title ? ' – ' + title : '') + ' – ' + original;
}

function friendlyAttachError_(e) {
  if (e && e.status === 404) {
    return 'Couldn\'t open that file. Make sure you picked it in the Google Drive window using your school account.';
  }
  if (e && e.status === 403 && /cannotCopy|copyRequiresWriterPermission/i.test(e.reason + ' ' + e.message)) {
    return 'The owner of this file has turned off copying, so it can\'t be attached. Ask them for a copy, or attach your own version.';
  }
  if (e && e.status === 403 && /storageQuotaExceeded/i.test(e.reason)) {
    return 'Your Google Drive is full, so the file couldn\'t be copied.';
  }
  if (e && e.reason === 'folder') return 'Folders can\'t be attached — pick the files inside instead.';
  if (e && e.reason === 'shortcut') return 'That\'s a shortcut — open its folder and pick the original file instead.';
  if (e && e.reason === 'tooLarge') return 'Larger than 25 MB, so it can\'t be attached.';
  // Include the code so a staff member's report can be matched to the Executions log.
  return 'Couldn\'t copy this file into your school\'s evidence folder (Drive error ' +
    ((e && e.status) || '?') + (e && e.reason ? ' ' + e.reason : '') + '). Please try again.';
}

/**
 * Copies the files the visitor picked in Google Picker into their school's
 * EvidenceFolder, owned by the script owner (so staff get view-only via
 * the folder, and the owner keeps edit).
 *
 * The script owner can't read the visitor's files, and the visitor's
 * drive.file token can't change sharing on a file the app didn't create —
 * so the hop goes through a temporary copy the visitor's token *does*
 * create (and may therefore share):
 *   1. visitor token: read each picked file's metadata (checks)
 *   2. visitor token: copy it -> temp file in their My Drive
 *   3. visitor token: share the temp file with the script owner (no email)
 *   4. owner token:   copy temp -> school folder (final name + description)
 *   5. visitor token: delete the temp file
 * Every read of a source happens with the visitor's own token, so this can
 * only ever copy files the visitor could already open themselves.
 *
 * Each step runs for all files at once (UrlFetchApp.fetchAll), so a batch
 * costs about five round trips to Drive however many files there are.
 * Returns { copied: [attachment], errors: [{pickedId, error}], needsAuth }.
 */
function copyPickedFiles_(token, pickedIds, access, folderId, themeId, themeTitle) {
  var ownerToken = ScriptApp.getOAuthToken();
  var ownerEmail = Session.getEffectiveUser().getEmail();
  var items = pickedIds.map(function (id) { return { pickedId: id }; });
  var errors = [];
  var needsAuth = false;

  function fail(item, e) {
    item.failed = true;
    if (e && e.status === 401) needsAuth = true;
    console.error('Evidence copy failed for ' + item.pickedId + ' (' + (item.name || '?') + '): ' + (e && e.message));
    errors.push({ pickedId: item.pickedId, error: e && e.status === 401
      ? 'Your Google Drive connection expired. Reconnect Google Drive, then save again.'
      : friendlyAttachError_(e) });
  }
  function live() { return items.filter(function (it) { return !it.failed; }); }

  items.forEach(function (it) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(it.pickedId)) fail(it, { status: 400, reason: 'invalid', message: 'Invalid file id' });
  });

  try {
    // 1. Metadata + checks
    runDriveBatch_(live(), function (it) {
      return driveRequest_(token, 'get', 'files/' + it.pickedId, { fields: 'id,name,mimeType,size,capabilities(canCopy)' });
    }, function (it, src) {
      it.name = src.name;
      if (src.mimeType === 'application/vnd.google-apps.folder') return fail(it, { status: 400, reason: 'folder', message: 'folder' });
      if (src.mimeType === 'application/vnd.google-apps.shortcut') return fail(it, { status: 400, reason: 'shortcut', message: 'shortcut' });
      if (src.size && Number(src.size) > MAX_ATTACHMENT_BYTES) return fail(it, { status: 400, reason: 'tooLarge', message: 'too large' });
      if (src.capabilities && src.capabilities.canCopy === false) return fail(it, { status: 403, reason: 'cannotCopy', message: 'cannotCopy' });
    }, fail);
    if (needsAuth) clearDriveToken_(access.email);

    // 2. Temp copy in the visitor's My Drive
    runDriveBatch_(live(), function (it) {
      return driveRequest_(token, 'post', 'files/' + it.pickedId + '/copy', { fields: 'id' },
        { name: 'Excellence in Action (temporary) – ' + it.name, parents: ['root'] });
    }, function (it, res) { it.tempId = res.id; }, fail);

    // 3. Share the temp copy with the script owner
    runDriveBatch_(live(), function (it) {
      return driveRequest_(token, 'post', 'files/' + it.tempId + '/permissions', { sendNotificationEmail: 'false', fields: 'id' },
        { role: 'writer', type: 'user', emailAddress: ownerEmail });
    }, function () {}, fail);

    // 4. Owner copies it into the school folder. A 404 here usually means
    //    step 3's share hasn't propagated yet, so it's retried too.
    var now = new Date().toISOString();
    runDriveBatch_(live(), function (it) {
      return driveRequest_(ownerToken, 'post', 'files/' + it.tempId + '/copy', { fields: 'id,name,mimeType,webViewLink' }, {
        name: buildEvidenceFileName_(themeId, themeTitle, it.name),
        parents: [folderId],
        description: [
          'Excellence in Action evidence',
          'Theme: ' + themeId + (themeTitle ? ' – ' + String(themeTitle).trim() : ''),
          'School: ' + access.schoolName,
          'Attached by: ' + access.email,
          'Attached at: ' + now,
          'Original file: ' + it.name
        ].join('\n')
      });
    }, function (it, res) {
      it.attachment = { fileId: res.id, name: res.name, mimeType: res.mimeType, url: res.webViewLink };
    }, fail, [404]);
  } finally {
    // 5. Remove the temp copies, whatever happened above.
    var temps = items.filter(function (it) { return it.tempId; });
    if (temps.length) {
      try {
        UrlFetchApp.fetchAll(temps.map(function (it) { return driveRequest_(token, 'delete', 'files/' + it.tempId); }));
      } catch (cleanupErr) {
        console.error('Temp copy cleanup failed: ' + cleanupErr);
      }
    }
  }

  return {
    copied: items.filter(function (it) { return it.attachment && !it.failed; }).map(function (it) { return it.attachment; }),
    errors: errors,
    needsAuth: needsAuth
  };
}

var TRANSIENT_DRIVE_STATUSES = [429, 500, 502, 503, 504];

/**
 * Runs one request per item in parallel, retrying transient failures (and
 * any `extraRetryStatuses`) up to twice with a short backoff.
 */
function runDriveBatch_(items, buildRequest, onSuccess, onFailure, extraRetryStatuses) {
  var retryable = TRANSIENT_DRIVE_STATUSES.concat(extraRetryStatuses || []);
  var pending = items.slice();
  for (var attempt = 0; pending.length && attempt < 3; attempt++) {
    if (attempt) Utilities.sleep(800 * attempt);
    var responses = UrlFetchApp.fetchAll(pending.map(buildRequest));
    var retry = [];
    pending.forEach(function (it, i) {
      try {
        onSuccess(it, parseDriveResponse_(responses[i]));
      } catch (e) {
        if (attempt < 2 && retryable.indexOf(e.status) >= 0) retry.push(it);
        else onFailure(it, e);
      }
    });
    pending = retry;
  }
}

/** Trashes copies made for an entry that then failed to save. */
function trashFiles_(attachments) {
  (attachments || []).forEach(function (a) {
    try { DriveApp.getFileById(a.fileId).setTrashed(true); } catch (e) { console.error('Failed to trash ' + a.fileId + ': ' + e); }
  });
}

// ===========================================================================
// Visitor Google Drive authorization (for the Picker + reading picked files)
// ===========================================================================
//
// The Picker shows the *visitor's* Drive, so it needs the visitor's own
// OAuth token: ScriptApp.getOAuthToken() is always the owner's, and Google
// Identity Services can't be used because Apps Script serves the page from
// a *.googleusercontent.com origin Google refuses to register.
//
// This is a standard OAuth 2.0 Authorization Code flow whose redirect URI
// is this web app's own /exec URL (WEB_APP_URL), handled by doGet(). It
// deliberately does NOT use the OAuth2 library's /usercallback endpoint:
// Apps Script binds that endpoint's state token to the account that
// created it — the script owner, in an "Execute as: Me" app — and then
// validates it as whoever lands on the callback, so every visitor other
// than the owner can hit "The state token is invalid or has expired".
// doGet() runs under the same deployment and identity as the rest of the
// app, and the state here is a random one-time value held server-side.
//
// Account safety: the state value maps to the visitor's email, login_hint
// and hd point Google at that account, and the redirect handler checks the
// email in Google's id_token matches before storing anything. Tokens are
// stored per visitor in Script Properties (UserProperties belongs to the
// script owner in an Execute-as-me app, so it can't tell visitors apart).
//
// WEB_APP_URL must be the deployment's exact URL as shown under Deploy >
// Manage deployments — for a domain-only app that's the
// https://script.google.com/a/macros/<domain>/s/<id>/exec form, which also
// makes Google serve the redirect under the school account in browsers
// signed in to several accounts. It stays the same across "New version"
// redeploys of the same deployment.

var DRIVE_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
var OAUTH_STATE_TTL_SECONDS = 900;

function webAppUrl_() {
  var url = requireProp_('WEB_APP_URL').trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    throw new Error('Script Property WEB_APP_URL must be the web app\'s full .../exec URL from Deploy > Manage deployments.');
  }
  return url;
}

function driveTokenKey_(email) { return 'eia.driveToken.' + shortHash_(email); }
function authErrorKey_(email) { return 'eia.driveAuthError.' + shortHash_(email); }

function readDriveToken_(email) {
  var raw = PropertiesService.getScriptProperties().getProperty(driveTokenKey_(email));
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function writeDriveToken_(email, token) {
  PropertiesService.getScriptProperties().setProperty(driveTokenKey_(email), JSON.stringify(token));
}
function clearDriveToken_(email) {
  PropertiesService.getScriptProperties().deleteProperty(driveTokenKey_(email));
}

function tokenRequest_(payload) {
  payload.client_id = requireProp_('DRIVE_OAUTH_CLIENT_ID');
  payload.client_secret = requireProp_('DRIVE_OAUTH_CLIENT_SECRET');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', payload: payload, muteHttpExceptions: true });
  var json = {};
  try { json = JSON.parse(res.getContentText() || '{}'); } catch (e) { json = {}; }
  if (res.getResponseCode() !== 200) {
    var err = new Error('Google token request failed: ' + (json.error_description || json.error || res.getResponseCode()));
    err.oauthError = json.error || '';
    throw err;
  }
  return json;
}

/** A valid access token for this visitor (refreshed if close to expiry), or '' if they need to connect. */
function getVisitorAccessToken_(email) {
  var t = readDriveToken_(email);
  if (!t) return '';
  if (t.accessToken && t.expiresAt - Date.now() > 10 * 60 * 1000) return t.accessToken;
  if (!t.refreshToken) { clearDriveToken_(email); return ''; }
  try {
    var r = tokenRequest_({ refresh_token: t.refreshToken, grant_type: 'refresh_token' });
    t.accessToken = r.access_token;
    t.expiresAt = Date.now() + Number(r.expires_in || 3600) * 1000;
    writeDriveToken_(email, t);
    return t.accessToken;
  } catch (e) {
    if (e.oauthError === 'invalid_grant') { clearDriveToken_(email); return ''; } // revoked or expired
    throw e;
  }
}

function buildAuthorizationUrl_(email) {
  var state = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('eia.oauthState.' + state, email, OAUTH_STATE_TTL_SECONDS);
  var params = {
    client_id: requireProp_('DRIVE_OAUTH_CLIENT_ID'),
    redirect_uri: webAppUrl_(),
    response_type: 'code',
    scope: DRIVE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: email,
    state: state
  };
  var domain = email.split('@')[1];
  if (domain) params.hd = domain;
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
}

function isOAuthRedirect_(e) {
  var p = (e && e.parameter) || {};
  return !!(p.state && (p.code || p.error));
}

/** Email claim from an id_token received directly from Google's token endpoint over TLS. */
function idTokenEmail_(idToken) {
  try {
    var part = String(idToken || '').split('.')[1] || '';
    while (part.length % 4) part += '=';
    var claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(part)).getDataAsString());
    return String(claims.email || '').toLowerCase();
  } catch (e) {
    return '';
  }
}

function revokeToken_(token) {
  try {
    UrlFetchApp.fetch('https://oauth2.googleapis.com/revoke', { method: 'post', payload: { token: token }, muteHttpExceptions: true });
  } catch (e) { /* best effort */ }
}

function authResultPage_(heading, message, success) {
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Figtree,Segoe UI,Arial,sans-serif;max-width:420px;margin:48px auto;padding:0 20px;color:#2a2c38">' +
    '<h2 style="font-size:20px;margin:0 0 12px">' + esc(heading) + '</h2>' +
    '<p style="font-size:14px;line-height:1.5;margin:0">' + esc(message) + '</p></div>' +
    (success ? '<script>setTimeout(function () { try { window.top.close(); } catch (e) {} }, 1200);</script>' : '')
  ).setTitle('Excellence in Action — Google Drive');
}

/** Google redirects the consent window back to WEB_APP_URL?code=...&state=... */
function handleOAuthRedirect_(e) {
  var p = e.parameter;
  var cache = CacheService.getScriptCache();
  var stateKey = 'eia.oauthState.' + String(p.state).replace(/[^A-Za-z0-9]/g, '');
  var email = cache.get(stateKey);
  if (!email) {
    return authResultPage_('This link has expired', 'Close this window and click Attach Files again.');
  }
  cache.remove(stateKey); // one-time use
  var props = PropertiesService.getScriptProperties();

  if (p.error) {
    return authResultPage_('Google Drive wasn\'t connected', p.error === 'access_denied'
      ? 'Access wasn\'t granted. Close this window and click Attach Files if you\'d like to try again.'
      : 'Google reported a problem (' + p.error + '). Close this window and try again.');
  }

  var token;
  try {
    token = tokenRequest_({ code: p.code, redirect_uri: webAppUrl_(), grant_type: 'authorization_code' });
  } catch (err) {
    console.error(err);
    return authResultPage_('Google Drive wasn\'t connected', 'Something went wrong finishing the connection. Close this window and click Attach Files again.');
  }

  var tokenEmail = idTokenEmail_(token.id_token);
  if (tokenEmail !== email) {
    revokeToken_(token.access_token);
    var wrong = 'You connected Google Drive as ' + (tokenEmail || 'a different account') + ', but you\'re signed in to Excellence in Action as ' +
      email + '. Click Attach Files again and choose ' + email + ' when Google asks which account to use.';
    props.setProperty(authErrorKey_(email), wrong);
    return authResultPage_('Wrong Google account', wrong);
  }
  // Google's consent screen lets people untick individual permissions.
  if (String(token.scope || '').indexOf('https://www.googleapis.com/auth/drive.file') < 0) {
    revokeToken_(token.access_token);
    var unticked = 'Google Drive access wasn\'t ticked on the permissions screen. Click Attach Files again and tick the box that lets ' +
      'Excellence in Action see the Google Drive files you choose.';
    props.setProperty(authErrorKey_(email), unticked);
    return authResultPage_('One more step', unticked);
  }

  var previous = readDriveToken_(email);
  writeDriveToken_(email, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || (previous && previous.refreshToken) || '',
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
  });
  props.deleteProperty(authErrorKey_(email));
  return authResultPage_('Google Drive connected', 'You can close this window — Excellence in Action will carry on automatically.', true);
}

function projectNumber_() {
  var n = requireProp_('DRIVE_OAUTH_CLIENT_ID').split('-')[0];
  return /^\d+$/.test(n) ? n : '';
}

/**
 * Called by the page before opening the Picker, and polled while the
 * visitor completes the consent window. Returns either
 *   { authorized: true, accessToken, apiKey, appId }
 * or
 *   { authorized: false, authorizationUrl, authError }
 * authError is set (once) when the redirect handler rejected a grant.
 */
function getPickerAuth() {
  var access = requireActiveUser_();
  var props = PropertiesService.getScriptProperties();
  var authError = props.getProperty(authErrorKey_(access.email)) || '';
  if (authError) props.deleteProperty(authErrorKey_(access.email));
  var token = getVisitorAccessToken_(access.email);
  if (!token) {
    return { authorized: false, authorizationUrl: buildAuthorizationUrl_(access.email), authError: authError };
  }
  return {
    authorized: true,
    accessToken: token,
    apiKey: requireProp_('PICKER_API_KEY'),
    appId: projectNumber_()
  };
}

// ===========================================================================
// Editor-only utilities (run from the Apps Script editor's Run menu)
// ===========================================================================

/** Logs the redirect URI to add to the OAuth client in Cloud Console. */
function logDriveRedirectUri() {
  Logger.log('Authorized redirect URI to register: ' + webAppUrl_());
}

/** Deletes Drive tokens left by earlier implementations. Run once after deploying. */
function resetLegacyDriveTokens() {
  var userProps = PropertiesService.getUserProperties();
  ['oauth2.drive', 'oauth2.drive_v2'].forEach(function (k) { userProps.deleteProperty(k); });
  var scriptProps = PropertiesService.getScriptProperties();
  var removed = 0;
  scriptProps.getKeys().forEach(function (k) {
    if (k.indexOf('oauth2.drive_') === 0) { scriptProps.deleteProperty(k); removed++; }
  });
  Logger.log('Legacy Drive tokens removed (' + removed + ' per-visitor entries).');
}

/**
 * Checks Script Properties, the Schools tab, and that the script owner can
 * add files to (and share) every school's evidence folder. Also triggers
 * the owner's own authorization prompt for any new scopes.
 */
function checkSetup() {
  var ok = true;
  function log(pass, msg) { if (!pass) ok = false; Logger.log((pass ? 'OK    ' : 'FIX   ') + msg); }

  ['USERS_SHEET_ID', 'DATA_SHEET_ID', 'WEB_APP_URL', 'PICKER_API_KEY', 'DRIVE_OAUTH_CLIENT_ID', 'DRIVE_OAUTH_CLIENT_SECRET'].forEach(function (k) {
    log(!!prop_(k), 'Script Property ' + k);
  });
  log(true, 'Script Property REVIEW_GROUP_EMAIL (optional): ' + (prop_('REVIEW_GROUP_EMAIL') || '(not set)'));
  try {
    webAppUrl_();
    log(true, 'WEB_APP_URL looks like a deployment URL');
  } catch (e) {
    log(false, e.message);
  }
  log(!!(prop_('DRIVE_OAUTH_CLIENT_ID') && projectNumber_()), 'DRIVE_OAUTH_CLIENT_ID looks like <project number>-....apps.googleusercontent.com');

  var schools = [];
  try {
    schools = readSchoolsTab_();
    log(true, 'Schools tab: ' + schools.length + ' schools');
  } catch (e) {
    log(false, e.message);
  }
  var token = ScriptApp.getOAuthToken();
  schools.forEach(function (s) {
    var id = parseDriveId_(s.folderValue);
    if (!id) { log(false, s.schoolName + ': EvidenceFolder is empty or not a folder link'); return; }
    try {
      var f = driveRest_(token, 'get', 'files/' + id, { fields: 'name,mimeType,capabilities(canAddChildren,canShare)' });
      log(f.mimeType === 'application/vnd.google-apps.folder', s.schoolName + ': "' + f.name + '" is a folder');
      log(!!(f.capabilities && f.capabilities.canAddChildren), s.schoolName + ': can add files');
      log(!!(f.capabilities && f.capabilities.canShare), s.schoolName + ': can share (needed to give staff view access)');
    } catch (e) {
      log(false, s.schoolName + ': cannot open EvidenceFolder (' + (e.status || '') + ') — is it shared with you as Editor?');
    }
  });
  if (prop_('WEB_APP_URL')) logDriveRedirectUri();
  Logger.log(ok ? 'All checks passed.' : 'Some checks need fixing (see FIX lines above).');
}
