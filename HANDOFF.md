# Handoff — Excellence in Action Wheel (Google Apps Script build)

Written for whoever (or whichever Claude Code session) picks this up next.
This is a status snapshot — read it first for orientation, then skim the
git log (`git log --oneline`) for the full blow-by-blow, since almost
every commit message documents a real bug that was found and fixed, not
just a style tweak.

## Current status (as of 23 Sep 2026)

**Branch:** the repo's default branch is `claude/code-project-setup-1qbwa6`
(there is no `main`). The evidence-folder and Drive work landed there in
[PR #3](https://github.com/jaceranieri/Excellence-In-Action/pull/3).
PR #3's description is out of date: it still mentions the OAuth2
library, which the final commit removed. Trust the code and this file.

**Confirmed working on the live deployment (reported by the project
owner):**
- Login gate and per-school access from the Users sheet.
- Evidence files copied into each school's EvidenceFolder, with
  view-only sharing for staff at the same school.
- Connecting Google Drive through the `/exec` redirect, including for a
  staff member using several Chrome profiles. That flow replaced the
  OAuth2 library's `/usercallback`, which failed for non-owners with
  "The state token is invalid or has expired". See "Visitor Drive
  authorization" below.
- Picking and uploading files through the Picker.

**Shipped in the last commit (`548dcc4`), not yet confirmed live:**
- Background save: Submit closes the draft at once, the entry shows
  "Copying files…", and failures show "Not saved" with Try again / Edit /
  Discard.
- Batched Drive copies (`copyPickedFiles_()` / `runDriveBatch_()`), with
  retries for temporary errors.
- Picker tabs: Recent, My Drive, Shared drives, Upload.
- Error messages now include the Drive status and reason code.
- To deploy: paste `Code.gs`, `Script_App.html` and
  `Stylesheet_ThemeModal.html`, then publish a new version. No Script
  Property or Cloud Console changes are needed.

**Shipped after that (evidence titles + toasts), not yet confirmed live:**
- Evidence now has a required **Evidence title** (a few words) and a
  **Details** box (the full description, stored in the old `Text`
  column). The title replaces "Evidence N" in the list. Entries saved
  before this have no title and still show "Evidence N".
- The title is stored in a new **`Title` column at the end of
  EvidenceLog** (column L). `ensureSheet_()` adds the missing header to
  the existing tab on first use, so no manual sheet edit is needed.
- Attachment names are always one line, cut off with "…". The full
  name is in the tooltip.
- Evidence saves report progress in bottom-left **toasts**
  (`createToast()` in `Script_App.html`): "Copying N files to your
  school's evidence folder…", then "Evidence copied…" or "Evidence not
  saved". Toasts sit outside the modal, so they keep updating after it
  closes. Error toasts stay until dismissed, or until Discard is clicked.
  Ratings saves use the same toast system and no longer have their own
  pill.
- To deploy: paste `Code.gs`, `Script_App.html` and
  `Stylesheet_ThemeModal.html`, then publish a new version.

**School history (all 3 steps done), not yet confirmed live:**
The plan agreed with the project owner:
- Each school gets a history of every change, with whole-school restore
  to any point. Everyone at the school can view and restore.
- One person's changes are grouped into one entry until 30 minutes
  idle. People can also save named checkpoints.
- A restore brings evidence back fully: deleted entries return, with
  their files moved out of ARCHIVE, and later entries are archived.
- History is kept forever and opens from a History button in the banner.
- Step 1 (done): record history on every save.
- Step 2 (done, server only): restore with a preview, checkpoints, and
  the listing functions the panel needs.
- Step 3 (done): the History button and panel
  (`Script_History.html`, `Stylesheet_History.html`).

What step 1 changed:
- Every ratings and evidence change is written to the new **History**
  tab, grouped as above. Each evidence save also writes a permanent row
  to the new **EvidenceVersions** tab. See "School history" below.
- **Ratings saves now send only the themes that changed**, and
  `saveRatings()` merges them into the school's row. Two people editing
  different themes at the same time no longer overwrite each other
  (this was open item 5).
- **Restore counter:** every save carries the page's `stateVersion`. A
  save from a page loaded before a restore is refused, and the page
  reloads and says so. Restores don't exist until step 2, so for now
  the counter stays at 0.
- **Editing evidence that someone else deleted** used to quietly re-add
  it as a new entry. It now shows "deleted by someone else" with Try
  again (save it as new) or Discard.
- Toasts moved to the bottom-left, so an error toast no longer covers
  the modal's Submit / Add Evidence buttons.
- To deploy: paste `Code.gs`, `Script_App.html` and
  `Stylesheet_ThemeModal.html`, then publish a new version. The new tabs
  and columns create themselves.

What step 2 added (all in `Code.gs`; see "School history" below):
- `getSchoolHistory(offset, limit)`, `getHistoryEntryChanges(id)`,
  `saveCheckpoint(label, stateVersion)`, `previewRestore(id)` and
  `restoreToPoint(id, stateVersion)`.
- A `Summary` column at the end of History, with the counts the
  collapsed list shows. Rows written by step 1 have none; it's worked
  out from their changes when listed.

What step 3 added:
- A **History** button in the banner, next to the avatar (icon-only
  under 560px). It opens a side panel. See "School history" below.
- **Text is stored exactly as typed.** Sheets used to run evidence text
  starting with "=" as a formula, and turn text like "0012" into
  numbers. Every user-typed value is now written with a leading
  apostrophe (`asText_()` in `Code.gs`). Values already damaged before
  this can't be recovered.

**Neubrutalism restyle of the main screen, not yet confirmed live** (from
the project owner's mockup):
- **Container:** everything sits in a central white container with a
  black outline and no shadow (`#app-root`).
- **Header** at the top of the container, with a black rule under it:
  - left: the login page's "Excellence in *Action*" branding;
  - middle: the school crest (its name as text if there's no crest, or
    the image fails to load);
  - right: Last Updated, a round History button, and the avatar.
- **Avatar colour:** a bright colour picked from the person's email, so
  it's the same on every visit (`avatarColourFor()` in
  `Script_LoginGate.html`).
- **Last Updated:** the school's latest change of any kind, e.g.
  "Jason Ranieri 10.12.26".
  - Stored on the Ratings row (`LastUpdatedBy`, `LastUpdatedAt`, and a
    new `LastUpdatedByName` column) whenever ratings, evidence or a
    restore changes. Checkpoints don't count.
  - `getSchoolState()` returns it. The page updates it straight away
    after its own saves.
  - Rows from before this have no name; the Users tab is used to find
    one.
- **Element header:** the icon circle is filled with the Element's
  wheel colour, with a black border. The title is black, larger and
  left-aligned.
- **Theme cards:**
  - Filled with the overall grade's colour; Ungraded cards are light
    grey `#E9EAEE` with a black title.
  - Black border and hard black shadow.
  - Grade name in small black text, top left; evidence count in a
    black pill with a paperclip, top right.
  - Title left-aligned at the bottom (white; black on Ungraded).
- **Brighter grade palette everywhere** (`GRADES`): Pre-Delivering
  `#FF5F5E`, Delivering `#FF914D`, Sustaining `#F5B400`, Excelling
  `#02BF63`. Cards, the wheel's indicator ring, the grade dropdown and
  the modal badge all use it.
- **Theme modal** (second mockup):
  - A black outline only, and no darkened background behind it. The
    overlay is still there, transparent, so a click outside closes it.
  - Title centred in a header with a black rule under it, like the main
    banner.
  - Grade badge and its dropdown have a black border and hard black
    shadow.
  - Evidence entries show their attachment count in the same black
    paperclip pill as the cards (`.evidence-accordion-pill`).
  - Add Evidence is a black button. The evidence form (inputs, Attach
    Files / Cancel / Submit) got black outlines to match, with Submit
    in black.
- **History panel:**
  - Its own card (black outline, rounded, header rule level with the
    main banner's).
  - When the window is at least 1648px wide, the main container slides
    left and the panel sits beside it (`layoutSidePanel()`,
    `body.side-panel-alongside`). Otherwise it overlaps the container's
    right side.
  - No dimming. A click anywhere outside it closes it, except on the
    History button (which toggles it) and toasts.
  - Save checkpoint is a large sky-blue button (`#38B6FF`) with a black
    outline and shadow. The timeline itself is unchanged.
- **Not restyled:** the login page.
- **No dark mode:** the old dark-mode overrides were removed from the
  cards, banner, Theme modal and History panel, because the new design
  is always light.
- **Static build:** `example.html` mirrors all of this except the parts
  that need the server (crest, Last Updated, History). It loads the
  Winter Day font from `fonts/`.

**Rubric, toasts, Element resources and team messages, not yet confirmed
live:**
- **Rubric:** a selected cell has a light tint of its level's grade
  colour, a black outline and a hard black shadow (`--level-rgb`, set
  per cell by `renderRubricGrid()`). The column heading no longer
  highlights the theme's grade; the Grade badge shows that.
  - On phones, criterion groups are separated by extra space instead of
    the old divider border.
- **Toasts** are coloured by status, with black text, border and hard
  shadow: sky blue while working, green done, red error, yellow
  information.
- **Element resources:** link buttons under the selected Element's
  Theme cards, from the Users spreadsheet's new **Resources** tab. See
  "Element resources and team messages" below.
- **Team messages** from the Users spreadsheet's new **Messages** tab:
  - The newest active message shows in a box at the top of the main
    screen, with an optional call-to-action button.
  - Its × hides it for that person on every device (stored in Script
    Properties).
  - A **bell** between History and the avatar opens a Messages panel,
    built like the History panel, listing every message. Its red badge
    counts active messages not yet hidden.
- **Layout change:** `.stage-area` now aligns to the top instead of
  centring vertically, and `.main-layout` has a `min-height` rather
  than a fixed `height`. The cards column (with resources) can be taller
  than the wheel, and the container clips overflow; see "Layout system".
- **Side panels:** the History and Messages panels share
  `layoutSidePanel()` and `isSidePanelButton()` (in
  `Script_History.html`). Only one is open at a time.
  - When overlapping the container (windows under 1648px wide), a panel
    starts below the banner, so its buttons stay usable.
  - The body class is now `side-panel-alongside`.
- **Phone header:** Last Updated moves to the second row, beside the
  crest, to make room for the bell.

**To deploy everything (evidence titles, school history, restyle,
resources and messages):**
1. In the Apps Script editor, create four new HTML files named exactly
   `Script_History`, `Stylesheet_History`, `Script_Messages` and
   `Stylesheet_Messages`. Paste in the matching `gas/*.html` files.
2. Replace `Code.gs`, `Index.html`, `Script_App.html`,
   `Script_LoginGate.html`, `Stylesheet_AppBanner.html`,
   `Stylesheet_ThemeCards.html` and `Stylesheet_ThemeModal.html` with
   the repo versions.
3. Deploy → Manage deployments → Edit → New version.
4. Tabs create themselves:
   - on the data spreadsheet, History, EvidenceVersions and the new
     columns appear on the first change;
   - on the Users spreadsheet, Resources and Messages appear with their
     header rows the first time anyone opens the app (or when you run
     `checkSetup`).

**Open items / next steps:**
1. **"Untitled document" copy error:** one staff member couldn't
   attach a file with that name. The root cause is unknown; nothing in
   the code treats the name specially, and a mocked copy of it works.
   The new retries may fix it. If it recurs, get the red error text
   (which now includes a Drive code) or the matching entry in Apps
   Script → Executions.
2. **Check the Picker tabs live:** confirm Recent lists newest files
   first, and that the tab labels appear. `DocsView.setLabel` is only
   called when the Picker build supports it.
3. **`REVIEW_GROUP_EMAIL`:** it was a placeholder
   (`testgroup@syd.catholic.edu.au`). Confirm the real reviewers' Group
   is set. It gets Viewer on every school folder.
4. **Copy ownership:** all copies are owned by the script owner's
   account. They count against that account's Drive storage, and every
   file depends on that one account staying active. Moving the
   EvidenceFolders into a Shared Drive would remove both risks. The code
   already passes `supportsAllDrives` everywhere, but it hasn't been
   tried.
5. **Check school history live:** make changes, save a checkpoint,
   restore to it (with evidence that has files), then undo the restore.
   Confirm the files move out of and back into ARCHIVE.

## What this is

A Sydney Catholic Schools "Excellence in Action" self-review tool: an
interactive 9-wedge SVG wheel (3 categories × 3 Elements each), Theme
cards with a rubric/grade/evidence modal, now deployed as a **Google Apps
Script web app** with a Users-sheet-backed login gate. There are two
parallel builds in this repo — keep reading, this matters.

## The two builds — and why changes must go into both

- **Root-level files** (`example.html`, `excellence-wheel.js/css`,
  `theme-cards.css`, `theme-modal.css`, `theme-dots.css`,
  `app-banner.css`) — a static build you can open directly or serve with
  any static file server. No login, no backend. This is also the file
  set a Claude Design/chat session would have originally produced.
- **`gas/`** — the Google Apps Script deployment. Apps Script's
  `HtmlService` has no static-file serving, so every CSS/JS file above
  is duplicated into its own `.html` partial here (wrapped in
  `<style>`/`<script>` tags) and pulled into `Index.html` via
  `<?!= include('Filename'); ?>`. `gas/Index.html` also has the login
  gate, which `example.html` doesn't (both now share the `#app-root`
  container and `.stage-area`).

**Whenever you change shared layout/logic** (the wheel+cards sizing,
`onSelect` behavior, banner styling, theme-cards grid, etc.), the same
edit needs to go into **both** the root file and its `gas/` counterpart.
This has been a repeated source of near-misses — see "Testing gotcha"
below for why local testing kept missing bugs that only showed up in the
real GAS deployment.

| Root file | GAS partial |
|---|---|
| `excellence-wheel.js` | `gas/Script_ExcellenceWheel.html` |
| `theme-cards.css` | `gas/Stylesheet_ThemeCards.html` |
| `theme-modal.css` | `gas/Stylesheet_ThemeModal.html` |
| `theme-dots.css` | `gas/Stylesheet_ThemeDots.html` |
| `app-banner.css` | `gas/Stylesheet_AppBanner.html` |
| `example.html`'s `<style>`/inline `<script>` | `gas/Index.html`'s `<style>` / `gas/Script_App.html` |
| — (no static equivalent) | `gas/Script_LoginGate.html`, `gas/Stylesheet_LoginGate.html`, `gas/Script_History.html`, `gas/Stylesheet_History.html`, `gas/Code.gs`, `gas/appsscript.json` |

**One deliberate exception to "mirror every shared edit":** the Ratings/
Evidence persistence code added to `gas/Script_App.html` (autosave,
`applySchoolState`, the Picker attach flow, the `google.script.run` calls)
has **no** counterpart in `example.html` — there's no backend for a
static page to persist to. Only the `id` field added to every
`ELEMENT_THEMES` theme was backfilled into both files; everything else
persistence-related is `gas/`-only. Shared *rendering* logic (rubric
grid, cards, modal markup) still needs mirroring as before.

`excellence-wheel-preview.html` is a **stale, hand-generated single-file
bundle** from an early round (before the GAS build existed) — do not
trust it as current, it hasn't been regenerated since. `EIA.json` +
`import-eia.py` are the one-time data-import pipeline documented inline
in `import-eia.py` itself; not run by the app.

## Login gate + access control (`gas/` only)

- **Users sheet**: `https://docs.google.com/spreadsheets/d/1OQXaRVUJopdjr4OWQbOvNLjoq-_bwaiNS3Rfu1-C62I/`
  — columns `Email, Name, SchoolName, CrestURL, Active`. The sheet ID is
  the `USERS_SHEET_ID` Script Property (Project Settings → Script
  Properties in the Apps Script editor — not hardcoded in `Code.gs`).
- `Code.gs`'s `getCurrentUserAccess()` reads `Session.getActiveUser().getEmail()`
  and looks it up (case-insensitive) against the **Users** tab (falling
  back to the first tab). Returns `{email, found, active, name, schoolName, crestUrl}`.
  The same spreadsheet's **Schools** tab maps each school to its evidence
  folder — see "Attachments" below. Its **Resources** and **Messages**
  tabs hold the Element links and team messages (see "Element resources
  and team messages").
- **Deployment settings matter**: `appsscript.json` has
  `"executeAs": "USER_DEPLOYING"` (i.e. "Execute as: Me") and
  `"access": "DOMAIN"`. This combination is deliberate and documented in
  `Code.gs`'s top comment — it's what lets `Session.getActiveUser()`
  correctly return the *visitor's* email while the script itself still
  reads the Users sheet with the *developer's* permissions (so the sheet
  never needs to be individually shared with every visitor). **Do not
  change `executeAs` to `USER_ACCESSING`** — that would break the sheet
  read for anyone not explicitly shared on it.
- Three-state login screen (`gas/Script_LoginGate.html` +
  `Stylesheet_LoginGate.html`): loading spinner → "Welcome, {name}!" with
  a crest-branded Continue button (found + Active=TRUE) → "Insufficient
  Access" notice (not found, or Active=FALSE). The insufficient-access
  "Request Access from your Principal" button is **static/non-functional
  by design** (a deliberate decision, not an oversight — see git log
  "Add Users-sheet login gate").
- On Continue, `enterApp()` fills in the real banner (crest image or
  school name, user's initials and avatar colour) and reveals `#app-root`,
  then calls `window.onAppEntered(access)` (defined in `Script_App.html`)
  — this is what kicks off loading the school's saved ratings/evidence.

## Ratings + Evidence persistence (`gas/` only)

Every Theme's grade, rubric-cell selections, and evidence entries now
persist to a **separate** spreadsheet from the Users sheet:
`https://docs.google.com/spreadsheets/d/15l-HVd1MtjN3uc-jnXDEQSNMDHDN1NTJMSa3v78ptfQ/`
(the `DATA_SHEET_ID` Script Property). Tabs are created automatically on
first write if they don't already exist (`ensureSheet_()`). Columns added
later always go at the end, and `ensureSheet_()` labels them on existing
tabs.

- **Ratings** — one row per school: `SchoolName, RatingsJSON,
  LastUpdatedBy, LastUpdatedAt, RestoreCount, LastHistoryId,
  LastHistoryRow`. `RatingsJSON` is
  `{"<themeId>": {"grade": "sustaining", "rubric": [<selected level per
  rubric row, in array order, or null>, ...]}, ...}` for every theme.
  The last three columns are history bookkeeping (see "School history").
- **EvidenceLog** — one row per evidence entry (not per school):
  `EntryId, SchoolName, ThemeId, EntryNumber, Type, Date, Text,
  Attachments, CreatedBy, CreatedAt, UpdatedAt, Title, VersionId`.
  `Text` holds the Details. `VersionId` is the entry's current row in
  EvidenceVersions.
- **History** and **EvidenceVersions** — see "School history" below. `Attachments` is a JSON
  array of `{fileId, name, mimeType, url}`, each a copy inside the
  school's evidence folder. `EntryId` (a UUID,
  generated server-side in `saveEvidenceEntry()`) is the real identity for
  edits/deletes — `EntryNumber` is only the theme-scoped display number
  the UI shows for an entry with no title ("Evidence 1", "Evidence 2", ...).

**Theme ids**: every theme in `ELEMENT_THEMES` now carries a stable `id`
field (e.g. `"L_CPP_CBR"`), derived from the common `_`-joined prefix of
its rubric rows' own ids in `EIA.json` (see `theme_id()` in
`import-eia.py`, and the same logic re-run manually to backfill the field
into `gas/Script_App.html` and `example.html`'s already-hand-edited
`ELEMENT_THEMES`). This is the persistent key into both sheets above —
it's what survives a future rubric wording edit or theme reorder, unlike
array position or title text.

**Load flow**: `Script_App.html`'s `window.onAppEntered(access)` calls
`Code.gs`'s `getSchoolState()`, which returns
`{ratings, evidence, stateVersion}` for the visitor's school.
`applySchoolState()` resets every theme to its default, then applies
it onto `ELEMENT_THEMES` in place. Runs right after the login gate's
Continue click, and again whenever a save is refused because the school
was restored (`reloadAfterRestore()`).

**Save flow — Ratings**: any rubric-cell click or grade-dropdown change
calls `scheduleSaveRatings()`, which debounces ~1.5s (so clicking through
several rubric rows collapses into one save) before calling `Code.gs`'s
`saveRatings()` with only the themes changed since the last save
(`dirtyThemeIds`). The server merges them into the school's saved
ratings, so different themes never overwrite each other; the same theme
is still last-write-wins. Also flushed on tab-hide/`beforeunload`. A
bottom-left toast ("Saving ratings…/Ratings saved/Ratings didn't save —
retrying") reflects this.

**Save flow — Evidence**: Submit closes the draft immediately. The entry
appears (opened) with a pulsing "Copying files…" / "Saving…" status, and
Edit/Delete are hidden, while `Code.gs`'s `saveEvidenceEntry()` runs in
the background (append if new, update in place by `EntryId` if editing).
Once a `google.script.run` call is sent, the server finishes it even if
the modal or tab is closed. A toast for each save shows its progress
and result, even after the modal is closed. `beforeunload` still warns while a save is
in flight, because a failure can't be shown after the tab is gone.

If a save fails, nothing is stored on the server, and the entry stays in
the list marked "Not saved" with an explanation:
- **Try again** is offered only when no individual file failed.
- **Edit** reopens the draft with the failed files in red.
- **Discard** removes a never-saved entry. For a failed edit of a saved
  entry, it reverts to the saved version (`entry.lastSaved`).

Deleting calls `deleteEvidenceEntry()`.

**Attachments — copied into each school's evidence folder.** Evidence
never links to a staff member's own file. Picking a file in the Google
Picker (tabs: Google Drive, Shared drives, Upload) only **stages** it.
On **Submit**, `saveEvidenceEntry()` copies the staged files into that
school's **EvidenceFolder** (`copyPickedFiles_()`), and the entry links to
the copies. Each copy step runs for all files at once
(`UrlFetchApp.fetchAll`, via `runDriveBatch_()`), so a submit costs about
five round trips to Drive however many files it has. Temporary Drive
errors (429/5xx) are retried twice with backoff. A 404 on the owner-copy
step is also retried, because it usually means the share hasn't
propagated yet.

Picker tabs:
- **Recent**: all files, no folders.
- **My Drive**: browsed from the root folder, instead of a flat list of
  every folder the visitor can access.
- **Shared drives**
- **Upload**

All tabs use list view. `DocsView.setLabel` is used when the Picker
build supports it.

Error messages for unexpected failures include the Drive status and
reason code (e.g. "Drive error 500 backendError"). The Executions log
has the matching `console.error` line, with the file ID and name. If any copy fails, the copies that worked are trashed,
nothing is saved, and the draft stays open with the failing files marked
in red. Cancelling a draft never touches Drive.

- **Where the folder comes from:** the Users spreadsheet's **Schools**
  tab. Columns are found by header name: `SchoolName` (must match the
  Users tab's SchoolName) and `EvidenceFolder` (a folder URL or bare
  ID). The Users tab is read by name (`Users`), falling back to the first
  tab.
- **Who owns the copies:** the script owner (the account the web app
  "Executes as"). The owner needs **Editor** on every school's folder,
  and the folder owner must allow editors to share (the Drive default).
  The copies count against the owner's Drive storage.
- **Who can see them:** after login the page calls
  `ensureSchoolFolderAccess()`, which gives the visitor **Viewer** on
  their school's folder (and `REVIEW_GROUP_EMAIL`, if set), with no
  notification email. Copies inherit the folder's sharing, so staff get
  view-only and the owner keeps edit. Anyone given **Editor** on a
  school folder directly in Drive also gets edit on its copies; the app
  can't restrict inherited access in My Drive. Staff can also browse the
  folder in Drive, including ARCHIVE.
- **File naming:** `<ThemeId> – <Theme title> – <original name>`, for
  example `L_IC_PLD – Professional Learning Design – Staff survey.pdf`.
  The file's Drive description records the theme, school, who attached
  it and when, and the original name.
- **How the copy works:** the owner can't read the visitor's file, and
  the visitor's `drive.file` token can't change sharing on a file the
  app didn't create. So `copyPickedFiles_()` goes through a temporary
  copy: the visitor's token copies the picked file into their My Drive
  and shares it with the owner (no email). The owner's identity then
  copies it into the school folder, and the visitor's token deletes the
  temporary copy. Every read of the source uses the visitor's own token,
  so the app can only ever copy files the visitor could already open.
- **Limits:** 25 MB per file (`MAX_ATTACHMENT_BYTES`). This is checked
  as soon as the file is picked, then again on Submit. Google Docs,
  Sheets and Slides have no size and are always allowed. Files whose
  owner disabled copying, folders and shortcuts are rejected with a
  plain-English message.
- **Removing evidence:** deleting an entry, or removing an attachment
  from a saved entry and saving, moves the file into
  `<school folder>/ARCHIVE` and renames it `ARCHIVED – <name>`
  (`archiveEvidenceFiles_()`).
- **The server doesn't trust the browser:** every `google.script.run`
  function works out the visitor's school from their session
  (`requireActiveUser_()`), never from an argument.
  `saveEvidenceEntry()` rebuilds each attachment's name and url from
  Drive, and drops any file not in that school's folder.

**Visitor Drive authorization.** The Picker needs the *visitor's* own
token. `ScriptApp.getOAuthToken()` is always the owner's, and Google
Identity Services can't be used because Apps Script serves the page from
a `*.googleusercontent.com` origin Google refuses to register. So the app
runs a standard OAuth 2.0 Authorization Code flow itself, in the
"Visitor Google Drive authorization" section of `Code.gs`. There is no
OAuth2 library.

- **Redirect lands on the web app's own `/exec` URL** (`WEB_APP_URL`),
  and `doGet()` handles it (`handleOAuthRedirect_()`).
  - **Why not the library:** the earlier version used the OAuth2
    library's `/usercallback` endpoint. Apps Script ties that endpoint's
    state token to the account that created it, which is the script
    owner in an "Execute as: Me" app. It then checks the token as
    whoever lands on the callback. So visitors hit "The state token is
    invalid or has expired" after clicking Allow. Don't go back to it.
  - **How the state is checked now:** `doGet()` runs under the same
    deployment and identity as the rest of the app. The state is a
    random value stored in `CacheService` for 15 minutes and usable
    once, mapped to the visitor's email.
- **Account checks:** the consent URL carries `login_hint` and `hd`.
  After the redirect, the email in Google's `id_token` must match the
  email the state was issued for. The Drive permission must also be
  ticked, because Google's consent screen lets people untick individual
  permissions. If either check fails, the token is revoked and the page
  explains what to do.
- **Multiple profiles and accounts:** the popup opens in the same Chrome
  profile as the app. The domain-scoped `/a/macros/<domain>/s/.../exec`
  URL also makes Google serve the redirect under the school account when
  a profile has several accounts signed in.
- **Token storage:** tokens are kept per visitor in Script Properties
  (`eia.driveToken.<hash>`: access token, refresh token and expiry).
  UserProperties won't work here: in an Execute-as-me app it belongs to
  the owner. Tokens refresh silently; a revoked or expired grant
  (`invalid_grant`) just prompts a reconnect.
- **Scope:** `openid email drive.file`. `drive.file` only covers files
  the visitor picks. It needs the Picker's `setAppId()`, which is the
  Cloud project number taken from the prefix of `DRIVE_OAUTH_CLIENT_ID`.
- **Pop-up handling:** the page fetches auth status as soon as compose
  opens, so an Attach Files click can open the consent window
  synchronously; browsers block `window.open()` inside async callbacks.
  It then polls `getPickerAuth()` every 2.5s rather than watching
  `popup.closed`, which Google's sign-in pages break. When access comes
  through, the Picker opens automatically.

**All config lives in Script Properties** (Project Settings → Script
Properties), read via `requireProp_()`:

| Script Property | Value |
|---|---|
| `USERS_SHEET_ID` | `1OQXaRVUJopdjr4OWQbOvNLjoq-_bwaiNS3Rfu1-C62I` (Users + Schools tabs) |
| `DATA_SHEET_ID` | `15l-HVd1MtjN3uc-jnXDEQSNMDHDN1NTJMSa3v78ptfQ` |
| `WEB_APP_URL` | the deployment's exact Web app URL from Deploy → Manage deployments (`https://script.google.com/a/macros/<domain>/s/<id>/exec`) |
| `PICKER_API_KEY` | Cloud Console API key, restricted to the Google Picker API |
| `DRIVE_OAUTH_CLIENT_ID` | Cloud Console OAuth client (Web application) |
| `DRIVE_OAUTH_CLIENT_SECRET` | same client's secret |
| `REVIEW_GROUP_EMAIL` | *optional*: a Google Group given Viewer on every school folder |

`eia.dismissedMessages.<hash>` keys hold which team messages each person
has hidden; deleting one just shows them their messages again.
`eia.driveToken.<hash>` and `eia.driveAuthError.<hash>` keys also appear
in Script Properties. They're per-visitor Drive tokens and one-shot error
messages. Leave them alone; deleting one just makes that visitor
reconnect.

**Setup / upgrade checklist:**

1. In the GCP project linked to the script, make sure both the **Google
   Picker API** and the **Google Drive API** are enabled.
2. OAuth consent screen: **User type Internal**. Add the scopes
   `openid`, `.../auth/userinfo.email` and `.../auth/drive.file` if the
   console asks.
3. Set the `WEB_APP_URL` Script Property to the Web app URL exactly as
   Deploy → Manage deployments shows it. It doesn't change when you
   publish a new version of the same deployment.
4. OAuth client `ExcellenceInActionOAuth_v2` → **Authorized redirect
   URIs** → add that same URL (`logDriveRedirectUri` prints it). The old
   `/usercallback` URIs can be removed.
5. Remove the OAuth2 library under Libraries; the code no longer uses
   it.
6. Paste the updated `Code.gs`, `Script_App.html` and
   `Stylesheet_ThemeModal.html`.
7. Run **`checkSetup`** from the editor (it also prompts for any new
   owner scopes), then **`resetLegacyDriveTokens`** once.
8. Deploy → Manage deployments → Edit → **New version**.
9. Test as a non-owner account, including one using multiple Chrome
   profiles:
   - Add Evidence → Attach Files → Connect Google Drive → Allow. The
     Picker should open by itself.
   - Pick files. They show "Copied … when you submit".
   - Submit. The button reads "Copying files…", then the entry appears
     with links to the copies.

**Worth knowing:**
- See "Current status" at the top for what's confirmed live and what's
  still open.
- A console line `[Violation] Permissions policy violation: unload is not
  allowed in this document` appears when the Picker opens. It comes from
  Google's own Picker/gapi scripts, is harmless, and isn't ours to fix.
- `RATINGS_HEADERS` / `EVIDENCE_HEADERS` / `HISTORY_HEADERS` /
  `EVIDENCE_VERSION_HEADERS` in `Code.gs` are the source of
  truth for column order. `ensureSheet_()` writes headers when it
  creates a tab, and labels any columns added at the end since.

## School history (`gas/` only)

Status and the agreed plan are under "Current status" at the top. The
design notes are at the "School history" section of `Code.gs`. In brief:

- **History tab**, one row per history entry: `HistoryId, SchoolName,
  Kind, Label, Actor, ActorName, StartedAt, UpdatedAt, ChangeCount,
  ChangesJSON, SnapshotJSON, Summary`. `Summary` holds counts
  (`{ratings, added, edited, deleted}`) so listing never reads the
  larger JSON columns.
  - `Kind` is `baseline`, `auto`, and later `checkpoint` / `restore`.
  - `ChangesJSON` lists what changed (grade, rubric cell, evidence
    add/edit/delete), capped at 200 per entry.
  - `SnapshotJSON` is the whole school's state after the entry:
    `{ratings, evidence: [versionId, ...]}`. That's what a restore puts
    back.
- **Baseline:** just before a school's first recorded change, its
  current state is saved as a `baseline` entry ("History started").
  Evidence saved before history existed gets its first EvidenceVersions
  row at that point.
- **Grouping:** a change joins the school's latest entry if that is an
  `auto` entry by the same person, updated within 30 minutes
  (`HISTORY_GROUP_MINUTES`). Changes that cancel out are dropped: a
  cell clicked on and off again, or evidence added then deleted.
- **EvidenceVersions tab**, one never-changed row per evidence save:
  `VersionId, EntryId, SchoolName, ThemeId, EntryNumber, Type, Date,
  Title, Text, Attachments, SavedBy, SavedAt`. Snapshots refer to these
  16-character ids, so a school with 36 themes and 500 evidence entries
  has a ~13 KB snapshot (a cell holds 50,000 characters).
- **Finding the latest entry:** the Ratings row's `LastHistoryId` /
  `LastHistoryRow` point at it. The row is only a hint. If the History
  tab has been sorted by hand, it's found by id instead.
- **Restore counter:** `RestoreCount` on the Ratings row. Pages send it
  as `stateVersion`, and `isStaleSave_()` refuses saves from a page
  older than the last restore. Pages from before this change send no
  version; they're only refused once the school has been restored.
- **History never blocks a save:** if writing history fails, the save
  still goes through and the error is logged
  (`Could not record history…` in Executions).
- **Don't delete rows** on History or EvidenceVersions by hand. Old
  snapshots point at version rows, and a restore refuses to run if any
  are missing (otherwise it would archive live evidence).

**The History panel** (`Script_History.html`, styled by
`Stylesheet_History.html`) opens from the banner's History button. It
uses `Script_App.html`'s globals (listed at the top of the file). Its
state object is `historyUi`, not `history`: a top-level `var history`
would be `window.history`, which can't be replaced.
- **The list:** newest first, 50 at a time ("Show older").
  - Each entry shows who, when and a summary. For a session of changes,
    "when" is a time range.
  - "Show changes" fetches the entry's change list, grouped by theme.
  - The latest entry is marked "Current" and has no restore button.
- **Save checkpoint:** asks for a name (up to 80 characters).
- **Restore to this point:**
  - Shows a preview: a summary, "Show details", and a warning that the
    whole school changes.
  - After Restore, a toast tracks progress. The page reloads the
    school's state, and any files that couldn't come back are listed in
    their own toast.
  - Restore entries say what the restore did: "brought back",
    "archived", "returned to an earlier version".
- **Pending saves come first:** opening the panel, saving a checkpoint
  and previewing a restore wait for pending rating saves
  (`whenRatingsSaved()` in `Script_App.html`). A restore isn't offered
  while evidence is still saving.

**Restore** (`restoreToPoint()`; `previewRestore()` runs the same plan
without changing anything):
- **What changes:** the whole school goes back to the entry's snapshot.
  - Ratings are replaced.
  - Evidence deleted since then comes back, with its files moved out
    of ARCHIVE (or the bin) and the "ARCHIVED – " prefix removed.
  - Evidence edited since then goes back to that version.
  - Evidence added since then is archived, like a normal delete.
- **Files first:** file moves happen before any sheet write. If Drive
  fails part-way, the sheets are untouched and running the restore
  again finishes it. Files already in the right place are left alone.
  Only files in the school folder or its ARCHIVE are touched.
- **Files gone for good** (deleted from the bin) are skipped and listed
  in `missingFiles`. The entry is saved without them as a new version.
- **Its own history entry:** the restore is recorded as a `restore`
  entry labelled "Restored to …", so it can be undone by restoring to
  the entry before it. A restore that changes nothing isn't recorded.
- **Other pages:** `RestoreCount` goes up by one. Pages still showing
  the old state have their next save refused and reload.
- **Lock:** it holds the script lock throughout. Saves by other people
  wait up to 30 s, and fail with a retry if a large restore takes
  longer.
- **Checkpoints** (`saveCheckpoint()`) save the current state under a
  name of up to 80 characters. They never absorb later changes.

## Element resources and team messages (`gas/` only)

Both are edited by hand in the **Users spreadsheet**. Code.gs's
`getSiteContent()` reads them once when the page loads; people see
changes on their next visit. Columns are found by header name, in any
order. Links must start with `http://` or `https://`; others are ignored.

**Resources tab**, one row per link: `Element, Label, URL`.
- `Element` is the Element's name as the app shows it (e.g. "Data
  Analysis and Decision Making"). Case, spacing and "&" vs "and" don't
  matter. The wheel id (e.g. `data-analysis`) also works.
- Links show in row order as buttons under the Theme cards, headed
  "Element Resources". An Element with no rows shows nothing.

**Messages tab**, one row per message: `Title, Message, ButtonLabel,
ButtonURL, Active, Posted`.
- `ButtonLabel`/`ButtonURL` are the optional call-to-action button (the
  label defaults to "Open link").
- `Active` (a checkbox, or TRUE/yes) shows the message at the top of
  everyone's main screen. Only the newest active message that the person
  hasn't hidden shows; hiding it brings up the next.
- `Posted` (a date) orders messages, newest first. Without dates, lower
  rows count as newer.
- The Messages panel (the bell) lists every row, active or not, and
  "Mark as read" hides one, like the ×.
- A message's id is a hash of its title and text, so editing the
  wording shows it again to people who had hidden it. To retract a
  message completely, delete its row.
- Code: `Script_Messages.html` / `Stylesheet_Messages.html`. The panel
  reuses the History panel's card styles.

## Layout system — read this before touching sizing

This went through many iterations; the current state is the result of
actually finding and fixing real bugs, not aesthetic guesses. Don't
revert to an earlier-sounding approach without understanding why it was
changed.

- **Fixed pixel sizes per breakpoint, not fluid scaling.**
  - Desktop (≥1280px): wheel 520px, cards column 480px, 56px gap. The
    wheel was 580px before the central container existed; this is the
    size that fits inside the 1160px container.
  - Compact (900–1279px): 380/380/32px gap.
  - Stacked (<900px): column layout, with `min(x, 100%)` only as an
    overflow safety net.
  This was a deliberate choice over `clamp()`/`vw` continuous scaling —
  see git log "Switch to fixed per-breakpoint sizing."
- **`#wheel-host { margin: 0; }` is load-bearing.** `excellence-wheel.js`
  adds an `ew-host` class to its container, and `excellence-wheel.css`'s
  `.ew-host { margin: 0 auto; }` will silently re-apply auto-margins
  unless overridden. Auto margins on a flex item absorb *all* the row's
  leftover space into themselves, which pushed the cards column
  hundreds of pixels away from the wheel on wide screens — a real,
  confirmed bug (see git log "Fix wheel/cards separation..."). If the
  cards ever drift away from the wheel again, check this first.
- **`.main-layout` has a `min-height` per tier** (the wheel's height,
  e.g. 520px) and `.stage-area` aligns its content to the top.
  - This was a fixed `height` with vertical centring. A changing height
    would have moved the wheel whenever the number of card rows changed.
  - It had to change: the cards column (cards plus Element resources)
    can now be much taller than the wheel, and `#app-root` clips
    overflow (`overflow: hidden`, for its rounded corners).
  - With top alignment, the row can grow without the wheel ever moving.
    Don't go back to centring without solving both problems.
- **`.main-layout.is-empty`**: before any Element is ever selected, the
  wheel sits alone, centered on the whole row (`#detail` collapsed to
  zero width/opacity). The wheel's `onSelect` callback in
  `Script_App.html`/`example.html` removes this class permanently on the
  first real selection — it never comes back, even on later
  deselection. The width/gap/opacity transitions on `#detail` and
  `.main-layout` are what make this an animated slide rather than a
  jump.
- **`#app-root` must be `display: flex` (with a matching
  `#app-root[hidden] { display: none }` override)**, not a plain
  `<div>`. A plain block's children (the banner especially, which has no
  `margin: auto` of its own) just left-align inside it instead of
  centering — this was a real, shipped bug (see git log "Fix banner
  mis-centering bug"). Any time you add a new wrapper div around
  page-level content in `gas/Index.html`, ask whether it needs the same
  treatment.
- **`#app-root` is the central container:** `width: min(1160px, 100%)`,
  a white fill and a black outline. The banner spans its full width at
  the top, and `.stage-area` below has its own padding. The banner is a
  three-column grid (`1fr auto 1fr`), so the crest stays centred however
  wide the two sides are. Under 640px the crest moves to a second row.
  `example.html` has the same `#app-root` wrapper.
- **`html { overflow-y: scroll; scrollbar-gutter: stable; }`** is there
  to stop the vertical scrollbar's appearance/disappearance (as page
  height crosses the viewport height) from shifting the whole
  horizontally-centered layout sideways. Don't remove it.

## Testing gotcha — read before saying "verified locally"

`example.html` now has the same `#app-root` container, but **no**
login gate, Last Updated, History or server, so testing against it will
not catch bugs that only exist in `gas/Index.html`'s extra structure (this is exactly how the banner mis-centering
bug shipped once before it was caught). To actually test the GAS build
end-to-end locally:

1. Resolve the `<?!= include('Name'); ?>` scriptlets by substituting each
   named partial's file contents (a `re.sub` over the include pattern
   works fine — see any recent session's scratch work for the exact
   snippet).
2. Replace the `<?!= JSON.stringify(access)... ?>` line with a fake
   access object literal (`{"email":"...","found":true,"active":true,"name":"...","schoolName":"...","crestUrl":"..."}`).
3. Serve the resolved HTML with `python3 -m http.server` and drive it
   with Playwright (`chromium_headless_shell` at
   `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`
   — the plain `chromium` binary's old-headless mode is removed in this
   environment's Chrome version, use the headless_shell binary instead).
4. Click `#login-gate-continue-btn` to get past the gate before
   measuring/screenshotting anything.

To exercise server-backed flows (evidence save, Drive connect, the
Picker) without Apps Script, load a small stub script before the app's
scripts. It should define:
- `google.script.run`: a chainable object whose `withSuccessHandler` /
  `withFailureHandler` return new wrappers, and whose other properties
  call fake server handlers after a `setTimeout`.
- `google.script.host.origin`
- `google.picker`: builder and view classes that record the callback so
  a test can call it with fake `docs`.
- `gapi.load`

Swap it in for the `apis.google.com/js/api.js` script tag. `Code.gs`
logic can be unit-tested in Node the same way: run it in a `vm` context
with stubbed `UrlFetchApp` / `ScriptApp` / `Session` / `Utilities`.

Measure actual `getBoundingClientRect()` / `getComputedStyle()` values
rather than trusting a screenshot alone — several of the bugs above
(the auto-margin issue especially) were invisible without checking
computed margins directly.

## Known limitations / explicitly deferred (not oversights)

- **Ratings/Evidence persistence and the evidence-folder copy flow are
  `gas/` only** — see "Ratings + Evidence persistence" above for the
  Script Properties, setup checklist and what still needs live testing.
  `example.html` (the static build) intentionally has NO persistence —
  it has no backend to persist to. Its `ELEMENT_THEMES` got the same
  `id` field added (for parity/future use) but nothing else; it stays a
  demo of default state only.
- **"Request Access from your Principal" button is intentionally
  static** — no email/notification wired up, per an explicit decision
  during the login-gate round.
- **Winter Day font (login gate's "Action" text)** is now embedded
  directly in `gas/Stylesheet_LoginGate.html` as a base64 `@font-face`
  (the real `.otf`, source kept at `fonts/WinterDayScript.otf` in the
  repo root) — no longer loaded from `fonts.cdnfonts.com`, which served
  a different version of the face than intended and couldn't be
  verified from this sandboxed dev environment anyway (no network
  egress to font CDNs here). Still worth a visual confirm on a real
  deployment, but there's no longer a CDN dependency to fail.
- Icons throughout are still the generic placeholder glyph
  (`placeholderIcon()` in `excellence-wheel.js`) — the original
  hand-built per-segment `ICONS` set is still in the file, unused,
  ready to swap back in per that file's own comments.
- The rubric grid's 4-col/1-col breakpoint is viewport-based (`@media`),
  not container-based — documented as a known simplification in the
  original README section of this project's history, still true.

## Deploying a change

1. Edit the relevant root file(s) **and** their `gas/` counterpart(s)
   (see the table above).
2. Test locally per "Testing gotcha" above if the change touches layout,
   the login flow, or anything in `#app-root`.
3. Commit and push to the session's working branch and open a PR into
   `claude/code-project-setup-1qbwa6` (the default branch).
4. Tell the user which `gas/*.html`/`.gs` files changed — they paste the
   updated file contents into their existing Apps Script project's
   matching files (same names, no extensions in the Apps Script editor)
   and redeploy via **Deploy → Manage deployments → Edit → New version**.

## Quick file-by-file reference

| File | What it is |
|---|---|
| `gas/Code.gs` | All server code:<br>• `doGet()`, which also handles the Drive OAuth redirect<br>• Users/Schools lookup and `requireActiveUser_()`<br>• Ratings and evidence persistence<br>• evidence-folder copy/archive (`copyPickedFiles_()`, `archiveEvidenceFiles_()`)<br>• visitor Drive auth (`getPickerAuth()`)<br>• editor utilities (`checkSetup()`, `resetLegacyDriveTokens()`, `logDriveRedirectUri()`) |
| `gas/appsscript.json` | Manifest — `executeAs: USER_DEPLOYING`, `access: DOMAIN` |
| `gas/Index.html` | Page shell: login gate markup, `#app-root`, `.stage-area`/`.main-layout`, all the page-level `<style>` |
| `gas/Script_LoginGate.html` | 3-state login gate logic, `enterApp()` |
| `gas/Script_App.html` | All app logic + `ELEMENT_THEMES` data (mirrors `example.html`'s inline script) |
| `gas/Script_ExcellenceWheel.html` | Wheel component (mirrors `excellence-wheel.js`) |
| `gas/Script_History.html` / `gas/Stylesheet_History.html` | School history panel, plus the shared side-panel layout (GAS only) |
| `gas/Script_Messages.html` / `gas/Stylesheet_Messages.html` | Team message box, bell badge and Messages panel (GAS only) |
| `gas/Stylesheet_*.html` | Wrapped copies of the root `.css` files, plus `Stylesheet_LoginGate.html` (GAS-only) |
| `EIA.json` | Source rubric data |
| `import-eia.py` | One-time transform: `EIA.json` → `ELEMENT_THEMES` JS literal |
