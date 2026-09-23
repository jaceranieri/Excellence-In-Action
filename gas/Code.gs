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
var TABS = { USERS: 'Users', SCHOOLS: 'Schools', RATINGS: 'Ratings', EVIDENCE: 'EvidenceLog' };

var RATINGS_HEADERS = ['SchoolName', 'RatingsJSON', 'LastUpdatedBy', 'LastUpdatedAt'];
var EVIDENCE_HEADERS = ['EntryId', 'SchoolName', 'ThemeId', 'EntryNumber', 'Type', 'Date', 'Text', 'Attachments', 'CreatedBy', 'CreatedAt', 'UpdatedAt'];

var ARCHIVE_FOLDER_NAME = 'ARCHIVE';
var ARCHIVED_PREFIX = 'ARCHIVED – ';
var MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
var MAX_EVIDENCE_TEXT = 20000;

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
//
// All writes take the script lock so concurrent saves never interleave.
// Ratings are last-write-wins per school (see HANDOFF.md).

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
        text: row[6],
        attachments: parseAttachments_(row[7])
      };
    });
}

/**
 * Loads the visitor's school's saved state. A school with no Ratings row
 * yet gets {} back and the client keeps ELEMENT_THEMES' defaults.
 * Returns { ratings: {<themeId>: {grade, rubric}}, evidence: [entries] }.
 */
function getSchoolState() {
  var access = requireActiveUser_();
  var ratingsSheet = ensureSheet_(TABS.RATINGS, RATINGS_HEADERS);
  var ratings = {};
  var rowIdx = findRowByValue_(ratingsSheet, 1, access.schoolName);
  if (rowIdx > 0) {
    var raw = ratingsSheet.getRange(rowIdx, 2).getValue();
    try { ratings = raw ? JSON.parse(raw) : {}; } catch (e) { ratings = {}; }
  }
  return { ratings: ratings, evidence: readSchoolEvidence_(access.schoolName) };
}

/** Overwrites the school's whole RatingsJSON blob (last-write-wins). */
function saveRatings(ratingsJson) {
  var access = requireActiveUser_();
  JSON.parse(ratingsJson); // reject garbage before it reaches the sheet
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ensureSheet_(TABS.RATINGS, RATINGS_HEADERS);
    var rowIdx = findRowByValue_(sheet, 1, access.schoolName);
    var now = new Date().toISOString();
    if (rowIdx > 0) {
      sheet.getRange(rowIdx, 2, 1, 3).setValues([[ratingsJson, access.email, now]]);
    } else {
      sheet.appendRow([access.schoolName, ratingsJson, access.email, now]);
    }
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
 * Adds a new evidence entry (no entryId) or overwrites the visitor's
 * school's existing one in place. When editing, any attachment that was on
 * the saved entry but is no longer in `entry.attachments` gets archived.
 * Returns { entryId, attachments } — the normalized attachments are what
 * the client should display from now on.
 */
function saveEvidenceEntry(themeId, entry) {
  var access = requireActiveUser_();
  if (!/^[A-Za-z0-9_]+$/.test(String(themeId || ''))) throw new Error('Invalid theme.');
  entry = entry || {};
  // Looked up lazily so text-only evidence still saves for a school whose
  // EvidenceFolder hasn't been set up yet.
  var folderId = null;
  function schoolFolderId() { return folderId || (folderId = getSchoolFolderId_(access.schoolName)); }
  var attachments = (entry.attachments || []).length ? normalizeAttachments_(entry.attachments, schoolFolderId()) : [];
  var attachmentsJson = JSON.stringify(attachments);
  var text = String(entry.text || '').slice(0, MAX_EVIDENCE_TEXT);
  var number = parseInt(entry.number, 10) || 0;
  var type = String(entry.type || 'note').slice(0, 40);
  var date = String(entry.date || '').slice(0, 20);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
    var now = new Date().toISOString();
    var rowIdx = -1;
    if (entry.entryId) {
      var candidate = findRowByValue_(sheet, 1, entry.entryId);
      if (candidate > 0 && String(sheet.getRange(candidate, 2).getValue()) === access.schoolName) {
        rowIdx = candidate;
      }
    }
    if (rowIdx > 0) {
      var keptIds = {};
      attachments.forEach(function (a) { keptIds[a.fileId] = true; });
      var removed = parseAttachments_(sheet.getRange(rowIdx, 8).getValue())
        .filter(function (a) { return a && a.fileId && !keptIds[a.fileId]; });
      if (removed.length) archiveEvidenceFiles_(removed, schoolFolderId());
      sheet.getRange(rowIdx, 5, 1, 4).setValues([[type, date, text, attachmentsJson]]);
      sheet.getRange(rowIdx, 11).setValue(now);
      return { entryId: entry.entryId, attachments: attachments, ok: true };
    }
    var entryId = Utilities.getUuid();
    sheet.appendRow([entryId, access.schoolName, themeId, number, type, date, text, attachmentsJson, access.email, now, now]);
    return { entryId: entryId, attachments: attachments, ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Deletes one of the visitor's school's evidence rows and archives its files. */
function deleteEvidenceEntry(entryId) {
  var access = requireActiveUser_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = ensureSheet_(TABS.EVIDENCE, EVIDENCE_HEADERS);
    var rowIdx = findRowByValue_(sheet, 1, entryId);
    if (rowIdx < 0 || String(sheet.getRange(rowIdx, 2).getValue()) !== access.schoolName) return { ok: false };
    var attachments = parseAttachments_(sheet.getRange(rowIdx, 8).getValue());
    if (attachments.length) archiveEvidenceFiles_(attachments, getSchoolFolderId_(access.schoolName));
    sheet.deleteRow(rowIdx);
    return { ok: true };
  } finally {
    lock.releaseLock();
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
function driveRest_(token, method, path, query, body) {
  var params = { supportsAllDrives: 'true' };
  Object.keys(query || {}).forEach(function (k) { params[k] = query[k]; });
  var url = 'https://www.googleapis.com/drive/v3/' + path + '?' + Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var options = { method: method, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  if (body) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  if (code >= 400) {
    var detail = json && json.error;
    var err = new Error('Drive API ' + method.toUpperCase() + ' ' + path + ' failed (' + code + '): ' + ((detail && detail.message) || text));
    err.status = code;
    err.reason = (detail && detail.errors && detail.errors[0] && detail.errors[0].reason) || '';
    throw err;
  }
  return json;
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
  return 'Couldn\'t copy this file into your school\'s evidence folder. Please try again.';
}

/**
 * Copies a file the visitor picked in Google Picker into their school's
 * EvidenceFolder, owned by the script owner (so staff get view-only via
 * the folder, and the owner keeps edit).
 *
 * The script owner can't read the visitor's file, and the visitor's
 * drive.file token can't change sharing on a file the app didn't create —
 * so the hop goes through a temporary copy the visitor's token *does*
 * create (and may therefore share):
 *   1. visitor token: copy picked file -> temp file in their My Drive
 *   2. visitor token: share temp file with the script owner (no email)
 *   3. script owner:  copy temp file -> school folder (final, owner-owned)
 *   4. visitor token: delete the temp file
 * Every read of the source happens with the visitor's own token, so this
 * can only ever copy files the visitor could already open themselves.
 */
function attachDriveFile(pickedFileId, themeId, themeTitle) {
  var access = requireActiveUser_();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(pickedFileId || ''))) return { ok: false, error: 'Invalid file.' };
  if (!/^[A-Za-z0-9_]+$/.test(String(themeId || ''))) return { ok: false, error: 'Invalid theme.' };
  var folderId;
  try {
    folderId = getSchoolFolderId_(access.schoolName);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  var service = getVisitorDriveService_(access.email);
  if (!service.hasAccess()) return { ok: false, needsAuth: true, error: 'Please reconnect Google Drive, then attach the file again.' };
  var token = service.getAccessToken();

  var src;
  try {
    src = driveRest_(token, 'get', 'files/' + pickedFileId, { fields: 'id,name,mimeType,size,capabilities(canCopy)' });
  } catch (e) {
    if (e.status === 401) {
      service.reset();
      return { ok: false, needsAuth: true, error: 'Your Google Drive connection expired. Click Attach Files to reconnect.' };
    }
    console.error(e);
    return { ok: false, error: friendlyAttachError_(e) };
  }
  if (src.mimeType === 'application/vnd.google-apps.folder') return { ok: false, error: 'Folders can\'t be attached — pick the files inside instead.' };
  if (src.mimeType === 'application/vnd.google-apps.shortcut') return { ok: false, error: 'That\'s a shortcut — open its folder and pick the original file instead.' };
  if (src.size && Number(src.size) > MAX_ATTACHMENT_BYTES) return { ok: false, error: '"' + src.name + '" is larger than 25 MB, so it can\'t be attached.' };
  if (src.capabilities && src.capabilities.canCopy === false) return { ok: false, error: friendlyAttachError_({ status: 403, reason: 'cannotCopy', message: '' }) };

  var ownerEmail = Session.getEffectiveUser().getEmail();
  var tempId = null;
  try {
    tempId = driveRest_(token, 'post', 'files/' + pickedFileId + '/copy', { fields: 'id' },
      { name: 'Excellence in Action (temporary) – ' + src.name, parents: ['root'] }).id;
    driveRest_(token, 'post', 'files/' + tempId + '/permissions', { sendNotificationEmail: 'false', fields: 'id' },
      { role: 'writer', type: 'user', emailAddress: ownerEmail });

    var finalName = buildEvidenceFileName_(themeId, themeTitle, src.name);
    var folder = DriveApp.getFolderById(folderId);
    var copy;
    try {
      copy = DriveApp.getFileById(tempId).makeCopy(finalName, folder);
    } catch (firstErr) {
      Utilities.sleep(1500); // the share in step 2 can take a moment to propagate
      copy = DriveApp.getFileById(tempId).makeCopy(finalName, folder);
    }
    copy.setDescription([
      'Excellence in Action evidence',
      'Theme: ' + themeId + (themeTitle ? ' – ' + String(themeTitle).trim() : ''),
      'School: ' + access.schoolName,
      'Attached by: ' + access.email,
      'Attached at: ' + new Date().toISOString(),
      'Original file: ' + src.name
    ].join('\n'));
    return {
      ok: true,
      attachment: { fileId: copy.getId(), name: copy.getName(), mimeType: copy.getMimeType(), url: copy.getUrl() }
    };
  } catch (e) {
    console.error(e);
    return { ok: false, error: friendlyAttachError_(e) };
  } finally {
    if (tempId) {
      try { driveRest_(token, 'delete', 'files/' + tempId); } catch (cleanupErr) { console.error('Temp copy cleanup failed: ' + cleanupErr); }
    }
  }
}

/**
 * Trashes copies the visitor attached while composing but never submitted
 * (they cancelled, closed the modal, or removed the file before saving).
 * These never became evidence, so they go to Trash, not ARCHIVE. Only
 * touches files in the school folder that this visitor attached and that
 * no saved evidence entry references.
 */
function discardStagedAttachments(fileIds) {
  var access = requireActiveUser_();
  var folderId = getSchoolFolderId_(access.schoolName);
  var referenced = {};
  readSchoolEvidence_(access.schoolName).forEach(function (entry) {
    (entry.attachments || []).forEach(function (a) { if (a && a.fileId) referenced[a.fileId] = true; });
  });
  var marker = 'Attached by: ' + access.email + '\n';
  (fileIds || []).forEach(function (id) {
    id = String(id || '');
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id) || referenced[id]) return;
    try {
      var file = DriveApp.getFileById(id);
      if (!isInFolder_(file, folderId)) return;
      if (String(file.getDescription() || '').indexOf(marker) < 0) return;
      file.setTrashed(true);
    } catch (e) {
      console.error('Failed to discard ' + id + ': ' + e);
    }
  });
  return { ok: true };
}

// ===========================================================================
// Visitor Google Drive authorization (for the Picker + reading picked files)
// ===========================================================================
//
// Why a separate OAuth flow at all: this app runs as its owner, so
// ScriptApp.getOAuthToken() is always the owner's token — it can't show a
// visitor their own Drive. Google Identity Services' client-side token
// flow can't be used either, since Apps Script serves the page from a
// *.googleusercontent.com origin Google refuses to register. So the
// "OAuth2 for Apps Script" library runs a server-side Authorization Code
// flow via a /usercallback redirect.
//
// Tokens are stored in Script Properties keyed by the *visitor's email*
// (hashed), not in UserProperties. In an "Execute as: Me" web app,
// UserProperties belongs to the script owner, not the visitor — so a
// UserProperties store ends up sharing one Drive token between everyone.
//
// Scope is drive.file (only files the visitor picks or the app creates),
// plus userinfo.email so the callback can confirm the visitor authorised
// the same account they're signed in to the app with.
//
// Multiple signed-in Google accounts: login_hint + hd steer Google's
// account chooser to the right account. The /usercallback page itself is
// served under whichever account the browser treats as its default,
// which fails for a DOMAIN-only web app when that default is a personal
// account. The domain-scoped redirect URI (/a/macros/<domain>/...) makes
// Google serve it under the domain account instead. Set Script Property
// DRIVE_OAUTH_REDIRECT_MODE=standard to fall back to the plain URI.

var DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';

function scriptOwnerDomain_() {
  return String(Session.getEffectiveUser().getEmail() || '').split('@')[1] || '';
}

function standardRedirectUri_() {
  return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
}

function domainRedirectUri_() {
  return 'https://script.google.com/a/macros/' + scriptOwnerDomain_() + '/d/' + ScriptApp.getScriptId() + '/usercallback';
}

/** Script Properties store that drops the id_token to keep each entry small. */
function slimTokenStore_() {
  var props = PropertiesService.getScriptProperties();
  return {
    getProperty: function (key) { return props.getProperty(key); },
    setProperty: function (key, value) {
      try {
        var token = JSON.parse(value);
        if (token && typeof token === 'object') {
          delete token.id_token;
          value = JSON.stringify(token);
        }
      } catch (e) { /* not JSON — store as-is */ }
      props.setProperty(key, value);
    },
    deleteProperty: function (key) { props.deleteProperty(key); }
  };
}

function getVisitorDriveService_(email) {
  var service = OAuth2.createService('drive_' + shortHash_(email))
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(requireProp_('DRIVE_OAUTH_CLIENT_ID'))
    .setClientSecret(requireProp_('DRIVE_OAUTH_CLIENT_SECRET'))
    .setCallbackFunction('driveAuthCallback')
    .setPropertyStore(slimTokenStore_())
    .setScope(DRIVE_SCOPES)
    .setParam('access_type', 'offline')
    .setParam('prompt', 'consent')
    .setParam('login_hint', email);
  var domain = email.split('@')[1];
  if (domain) service.setParam('hd', domain);
  if (String(prop_('DRIVE_OAUTH_REDIRECT_MODE') || 'domain').toLowerCase() !== 'standard') {
    if (typeof service.setRedirectUri !== 'function') {
      throw new Error('The OAuth2 library is too old — update it to the latest version under Libraries in the Apps Script editor.');
    }
    service.setRedirectUri(domainRedirectUri_());
  }
  return service;
}

function authErrorKey_(email) {
  return 'eia.driveAuthError.' + shortHash_(email);
}

/** Email the token was issued to, or '' if Google didn't say. */
function tokenEmail_(accessToken) {
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(accessToken), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return '';
  try { return String(JSON.parse(res.getContentText()).email || '').toLowerCase(); } catch (e) { return ''; }
}

function callbackPage_(heading, message) {
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  return HtmlService.createHtmlOutput(
    '<div style="font-family:Figtree,Segoe UI,Arial,sans-serif;max-width:420px;margin:48px auto;padding:0 20px;color:#2a2c38">' +
    '<h2 style="font-size:20px;margin:0 0 12px">' + esc(heading) + '</h2>' +
    '<p style="font-size:14px;line-height:1.5;margin:0">' + esc(message) + '</p></div>'
  ).setTitle('Excellence in Action — Google Drive');
}

/**
 * OAuth2 library's redirect target. The visitor's email travels inside the
 * signed state token (set in getPickerAuth), so the token is stored for
 * the right visitor even if this page runs under a different signed-in
 * account.
 */
function driveAuthCallback(request) {
  var email = String((request.parameter && request.parameter.eiaEmail) || '').toLowerCase();
  if (!email) return callbackPage_('Something went wrong', 'Close this window and click Attach Files again.');
  var service = getVisitorDriveService_(email);
  var props = PropertiesService.getScriptProperties();
  var granted = false;
  try {
    granted = service.handleCallback(request);
  } catch (e) {
    console.error('Drive auth callback failed: ' + e);
  }
  if (!granted) {
    return callbackPage_('Google Drive wasn\'t connected', 'Access wasn\'t granted. Close this window and click Attach Files to try again.');
  }
  var tokenEmail = tokenEmail_(service.getAccessToken());
  if (tokenEmail && tokenEmail !== email) {
    service.reset();
    var msg = 'You connected Google Drive as ' + tokenEmail + ', but you\'re signed in to Excellence in Action as ' + email +
      '. Click Attach Files again and choose ' + email + ' when Google asks which account to use.';
    props.setProperty(authErrorKey_(email), msg);
    return callbackPage_('Wrong Google account', msg);
  }
  props.deleteProperty(authErrorKey_(email));
  return callbackPage_('Google Drive connected', 'You can close this window and go back to Excellence in Action.');
}

function projectNumber_() {
  var n = requireProp_('DRIVE_OAUTH_CLIENT_ID').split('-')[0];
  return /^\d+$/.test(n) ? n : '';
}

/** Refresh early so the Picker never gets handed a token about to expire. */
function ensureFreshToken_(service) {
  var token = service.getToken();
  if (!token || !token.refresh_token) return;
  var grantedAt = Number(token.granted_time || 0);
  var expiresIn = Number(token.expires_in || 0);
  if (grantedAt && expiresIn && grantedAt + expiresIn - Date.now() / 1000 < 600) service.refresh();
}

/**
 * Called by the page before opening the Picker, and polled while the
 * visitor completes the consent popup. Returns either
 *   { authorized: true, accessToken, apiKey, appId }
 * or
 *   { authorized: false, authorizationUrl, authError }
 * authError is set (once) when the callback rejected a wrong-account grant.
 */
function getPickerAuth() {
  var access = requireActiveUser_();
  var service = getVisitorDriveService_(access.email);
  var props = PropertiesService.getScriptProperties();
  var authError = props.getProperty(authErrorKey_(access.email)) || '';
  if (authError) props.deleteProperty(authErrorKey_(access.email));
  if (!service.hasAccess()) {
    return {
      authorized: false,
      authorizationUrl: service.getAuthorizationUrl({ eiaEmail: access.email }),
      authError: authError
    };
  }
  ensureFreshToken_(service);
  return {
    authorized: true,
    accessToken: service.getAccessToken(),
    apiKey: requireProp_('PICKER_API_KEY'),
    appId: projectNumber_()
  };
}

// ===========================================================================
// Editor-only utilities (run from the Apps Script editor's Run menu)
// ===========================================================================

/** Logs both redirect URIs — add BOTH to the OAuth client in Cloud Console. */
function logDriveRedirectUri() {
  Logger.log('Domain redirect URI (used by default): ' + domainRedirectUri_());
  Logger.log('Standard redirect URI (fallback):       ' + standardRedirectUri_());
}

/**
 * Deletes Drive tokens left by the old per-UserProperties implementation.
 * Run once after deploying this version.
 */
function resetLegacyDriveTokens() {
  var props = PropertiesService.getUserProperties();
  ['oauth2.drive', 'oauth2.drive_v2'].forEach(function (k) { props.deleteProperty(k); });
  Logger.log('Legacy Drive tokens removed.');
}

/**
 * Checks Script Properties, the Schools tab, and that the script owner can
 * add files to (and share) every school's evidence folder. Also triggers
 * the owner's own authorization prompt for any new scopes.
 */
function checkSetup() {
  var ok = true;
  function log(pass, msg) { if (!pass) ok = false; Logger.log((pass ? 'OK    ' : 'FIX   ') + msg); }

  ['USERS_SHEET_ID', 'DATA_SHEET_ID', 'PICKER_API_KEY', 'DRIVE_OAUTH_CLIENT_ID', 'DRIVE_OAUTH_CLIENT_SECRET'].forEach(function (k) {
    log(!!prop_(k), 'Script Property ' + k);
  });
  log(true, 'Script Property REVIEW_GROUP_EMAIL (optional): ' + (prop_('REVIEW_GROUP_EMAIL') || '(not set)'));
  log(typeof OAuth2 !== 'undefined', 'OAuth2 library added');
  log(!!projectNumber_(), 'DRIVE_OAUTH_CLIENT_ID looks like <project number>-....apps.googleusercontent.com');

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
  logDriveRedirectUri();
  Logger.log(ok ? 'All checks passed.' : 'Some checks need fixing (see FIX lines above).');
}
