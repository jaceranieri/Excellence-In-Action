# Handoff — Excellence in Action Wheel (Google Apps Script build)

Written for whoever (or whichever Claude Code session) picks this up next.
This is a status snapshot — read it first for orientation, then skim the
git log (`git log --oneline`) for the full blow-by-blow, since almost
every commit message documents a real bug that was found and fixed, not
just a style tweak.

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
  gate wrapper (`#app-root`, `.stage-area`) that `example.html` doesn't.

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
| — (no static equivalent) | `gas/Script_LoginGate.html`, `gas/Stylesheet_LoginGate.html`, `gas/Code.gs`, `gas/appsscript.json` |

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
  folder — see "Attachments" below.
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
- On Continue, `enterApp()` fills in the real banner (crest image,
  school name, user's initials in the avatar) and reveals `#app-root`,
  then calls `window.onAppEntered(access)` (defined in `Script_App.html`)
  — this is what kicks off loading the school's saved ratings/evidence.

## Ratings + Evidence persistence (`gas/` only)

Every Theme's grade, rubric-cell selections, and evidence entries now
persist to a **separate** spreadsheet from the Users sheet:
`https://docs.google.com/spreadsheets/d/15l-HVd1MtjN3uc-jnXDEQSNMDHDN1NTJMSa3v78ptfQ/`
(the `DATA_SHEET_ID` Script Property). Two tabs, created automatically on
first write if they don't already exist (`ensureSheet_()`):

- **Ratings** — one row per school: `SchoolName, RatingsJSON,
  LastUpdatedBy, LastUpdatedAt`. `RatingsJSON` is
  `{"<themeId>": {"grade": "sustaining", "rubric": [<selected level per
  rubric row, in array order, or null>, ...]}, ...}` for every theme.
  Saved as one whole-row overwrite per save (last-write-wins — see below).
- **EvidenceLog** — one row per evidence entry (not per school):
  `EntryId, SchoolName, ThemeId, EntryNumber, Type, Date, Text,
  Attachments, CreatedBy, CreatedAt, UpdatedAt`. `Attachments` is a JSON
  array of `{fileId, name, mimeType, url}`, each a copy inside the
  school's evidence folder. `EntryId` (a UUID,
  generated server-side in `saveEvidenceEntry()`) is the real identity for
  edits/deletes — `EntryNumber` is only the theme-scoped display number
  the UI has always shown ("Evidence 1", "Evidence 2", ...).

**Theme ids**: every theme in `ELEMENT_THEMES` now carries a stable `id`
field (e.g. `"L_CPP_CBR"`), derived from the common `_`-joined prefix of
its rubric rows' own ids in `EIA.json` (see `theme_id()` in
`import-eia.py`, and the same logic re-run manually to backfill the field
into `gas/Script_App.html` and `example.html`'s already-hand-edited
`ELEMENT_THEMES`). This is the persistent key into both sheets above —
it's what survives a future rubric wording edit or theme reorder, unlike
array position or title text.

**Load flow**: `Script_App.html`'s `window.onAppEntered(access)` calls
`Code.gs`'s `getSchoolState(schoolName)`, which returns
`{ratings, evidence}` for that school; `applySchoolState()` merges it
onto `ELEMENT_THEMES` in place (a theme with no saved row keeps its
built-in "ungraded, nothing selected" default). Runs once, right after
the login gate's Continue click.

**Save flow — Ratings**: any rubric-cell click or grade-dropdown change
calls `scheduleSaveRatings()`, which debounces ~1.5s (so clicking through
several rubric rows collapses into one save) before calling `Code.gs`'s
`saveRatings()` with the *entire* ratings blob for every theme, not just
what changed. Also flushed on tab-hide/`beforeunload`. A small
bottom-right "Saving…/Saved/Save failed — retrying" badge
(`showSaveStatus()`) reflects this. **This is last-write-wins, not a
field-level merge** — two staff at the same school saving within the same
debounce window can clobber each other's change to a *different* theme.
Accepted tradeoff for v1 (see the original planning conversation); if
concurrent same-school editing turns out to be common in practice, the
fix is a read-modify-write per-theme-key merge inside `saveRatings()`
rather than a whole-row overwrite.

**Save flow — Evidence**: submitting the compose form calls `Code.gs`'s
`saveEvidenceEntry()` (append if new, update-in-place by `EntryId` if
editing); the returned `entryId` is stored back onto the client-side
entry object. Deleting calls `deleteEvidenceEntry()` — entries that were
never successfully saved (no `entryId` yet, e.g. a save that's still
in-flight or failed) are only removed client-side, since there's nothing
to delete server-side.

**Attachments — copied into each school's evidence folder.** Evidence
never links to a staff member's own file. When someone picks a file in
the Google Picker (tabs: Google Drive, Shared drives, Upload), the server
(`Code.gs`'s `attachDriveFile()`) copies it into that school's
**EvidenceFolder**, and the evidence entry links to the copy.

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
  app didn't create. So `attachDriveFile()` goes through a temporary
  copy: the visitor's token copies the picked file into their My Drive
  and shares it with the owner (no email). The owner's identity then
  copies it into the school folder, and the visitor's token deletes the
  temporary copy. Every read of the source uses the visitor's own token,
  so the app can only ever copy files the visitor could already open.
- **Limits:** 25 MB per file (`MAX_ATTACHMENT_BYTES`; Google Docs,
  Sheets and Slides have no size and are always allowed). Files whose
  owner disabled copying, folders and shortcuts are rejected with a
  plain-English message.
- **Removing evidence:** deleting an entry, or removing an attachment
  from a saved entry and saving, moves the file into
  `<school folder>/ARCHIVE` and renames it `ARCHIVED – <name>`
  (`archiveEvidenceFiles_()`). Copies attached during a compose that was
  cancelled or closed never became evidence, so they go to Drive's
  Trash instead (`discardStagedAttachments()`).
- **The server doesn't trust the browser:** every `google.script.run`
  function works out the visitor's school from their session
  (`requireActiveUser_()`), never from an argument.
  `saveEvidenceEntry()` rebuilds each attachment's name and url from
  Drive, and drops any file not in that school's folder.

**Visitor Drive authorization.** The Picker needs the *visitor's* own
token. `ScriptApp.getOAuthToken()` is always the owner's, and Google
Identity Services can't be used because Apps Script serves the page from
a `*.googleusercontent.com` origin Google refuses to register. So the
["OAuth2 for Apps Script"](https://github.com/googleworkspace/apps-script-oauth2)
library runs a server-side Authorization Code flow
(`getVisitorDriveService_()`, `getPickerAuth()`, `driveAuthCallback()`).
Details that matter:

- **Tokens are keyed by visitor email, in Script Properties.** The
  earlier version used `PropertiesService.getUserProperties()`. In an
  "Execute as: Me" web app that store most likely belongs to the owner,
  not the visitor, so one Drive token ended up shared between everyone.
  Run `resetLegacyDriveTokens()` once to delete the old token.
- **Scope is `drive.file` plus `userinfo.email`,** not full `drive`.
  The copy-into-folder design no longer changes sharing on visitors'
  own files, so the narrow scope is enough. `drive.file` requires the
  Picker's `setAppId()` (the Cloud project number, taken from the prefix
  of `DRIVE_OAUTH_CLIENT_ID`). Without it, picked files 404.
- **Multiple signed-in Google accounts:**
  - The consent URL carries `login_hint` (the visitor's email) and `hd`
    (their domain), so Google preselects the right account.
  - The callback checks, via `tokeninfo`, that the account that granted
    access is the one signed in to the app. If it isn't, the grant is
    rejected and the page shows why.
  - The visitor's email travels inside the signed state token, so the
    token is stored for the right person even if the callback page runs
    under another signed-in account.
  - The redirect URI uses the domain-scoped form
    `https://script.google.com/a/macros/<domain>/d/<SCRIPT_ID>/usercallback`
    so Google serves the callback under the school account rather than
    the browser's default (often personal) account. **This form is
    untested against a live deployment.** If the consent popup ends on a
    Google error page, set Script Property
    `DRIVE_OAUTH_REDIRECT_MODE=standard` to fall back to
    `https://script.google.com/macros/d/<SCRIPT_ID>/usercallback`.
    Register both URIs in Cloud Console so switching needs no console
    change.
- **Pop-up handling:** the page fetches auth status as soon as compose
  opens, so an Attach Files click can open the consent window
  synchronously. Browsers block `window.open()` inside async callbacks.
  It then polls `getPickerAuth()` every 2.5s (up to 3 minutes) rather
  than watching `popup.closed`, which Google's sign-in pages break.
- **Token lifetime:** tokens are requested with `access_type=offline`,
  so visitors authorise once and tokens refresh silently.
  `getPickerAuth()` refreshes any token with under 10 minutes left
  before handing it to the Picker.

**All config lives in Script Properties** (Project Settings → Script
Properties), read via `requireProp_()`:

| Script Property | Value |
|---|---|
| `USERS_SHEET_ID` | `1OQXaRVUJopdjr4OWQbOvNLjoq-_bwaiNS3Rfu1-C62I` (Users + Schools tabs) |
| `DATA_SHEET_ID` | `15l-HVd1MtjN3uc-jnXDEQSNMDHDN1NTJMSa3v78ptfQ` |
| `PICKER_API_KEY` | Cloud Console API key, restricted to the Google Picker API |
| `DRIVE_OAUTH_CLIENT_ID` | Cloud Console OAuth client (Web application) |
| `DRIVE_OAUTH_CLIENT_SECRET` | same client's secret |
| `REVIEW_GROUP_EMAIL` | *optional*: a Google Group given Viewer on every school folder |
| `DRIVE_OAUTH_REDIRECT_MODE` | *optional*: `standard` to use the non-domain callback URI (see above) |

Token entries (`oauth2.drive_<hash>`) and `eia.driveAuthError.<hash>`
keys also appear in Script Properties. Those are per-visitor Drive
tokens and one-shot error messages; leave them alone. Deleting one just
makes that visitor re-authorise.

**Setup / upgrade checklist:**

1. In the GCP project linked to the script, make sure both the **Google
   Picker API** and the **Google Drive API** are enabled (APIs &
   Services → Library).
2. OAuth consent screen: **User type Internal**. Add the scopes
   `.../auth/drive.file` and `.../auth/userinfo.email` if the console
   asks.
3. OAuth client `ExcellenceInActionOAuth_v2` (Web application):
   - Leave "Authorized JavaScript origins" empty.
   - Under **Authorized redirect URIs**, add both URIs printed by
     running `logDriveRedirectUri` in the editor (View → Logs).
   - Leave the auto-created "Apps Script" OAuth client alone. Apps
     Script manages it for its own authorization.
4. In the editor, update the OAuth2 library (Libraries → OAuth2 →
   latest version). The domain redirect needs `setRedirectUri()`.
5. Paste the updated `Code.gs`, `Script_App.html`,
   `Stylesheet_ThemeModal.html` and `Index.html`.
6. Run **`checkSetup`** from the editor. It prompts you to authorise the
   new scopes, then logs OK/FIX for:
   - every Script Property
   - the Schools tab
   - for each school, whether the folder opens, whether you can add
     files, and whether you can share it.
7. Run **`resetLegacyDriveTokens`** once.
8. Deploy → Manage deployments → Edit → **New version**.
9. Test with a second account, ideally one signed in alongside a
   personal Gmail:
   - Attach Files → consent window → pick a file → it shows
     "Copying…", then its new name.
   - Submit, then open the link as a colleague at the same school: it
     should be view-only.
   - Delete the entry and check the file moved to ARCHIVE with the
     prefix.
   - Cancel a compose with an attached file and check the copy went to
     Trash.

**Not yet done / worth knowing:**
- None of this has run against a live deployment. The flow was tested
  locally in headless Chromium with a mocked `google.script.run` and
  Picker (attach, copying/error states, submit, cancel/discard,
  edit/archive, delete, consent-window polling). The Drive, OAuth and
  Sheets calls themselves still need the live test above.
- `RATINGS_HEADERS` / `EVIDENCE_HEADERS` in `Code.gs` are the source of
  truth for column order. `ensureSheet_()` only writes headers when it
  creates a tab.
- Tab close or crash mid-compose can leave an unsubmitted copy in the
  school folder. It's harmless, just clutter.

## Layout system — read this before touching sizing

This went through many iterations; the current state is the result of
actually finding and fixing real bugs, not aesthetic guesses. Don't
revert to an earlier-sounding approach without understanding why it was
changed.

- **Fixed pixel sizes per breakpoint, not fluid scaling.** Desktop
  (≥1280px): wheel 580px, cards column 580px, 56px gap. Compact
  (900–1279px): 380/380/32px gap. Stacked (<900px): column layout,
  `min(x, 100%)` as an overflow safety net only. This was a deliberate
  choice over `clamp()`/`vw` continuous scaling — see git log "Switch to
  fixed per-breakpoint sizing."
- **`#wheel-host { margin: 0; }` is load-bearing.** `excellence-wheel.js`
  adds an `ew-host` class to its container, and `excellence-wheel.css`'s
  `.ew-host { margin: 0 auto; }` will silently re-apply auto-margins
  unless overridden. Auto margins on a flex item absorb *all* the row's
  leftover space into themselves, which pushed the cards column
  hundreds of pixels away from the wheel on wide screens — a real,
  confirmed bug (see git log "Fix wheel/cards separation..."). If the
  cards ever drift away from the wheel again, check this first.
- **`.main-layout` has a fixed `height` per tier** (matching
  `#wheel-host`'s own height, e.g. 580px), not `height: auto`. The
  cards column's height varies with how many Theme-card rows an Element
  has; if `.main-layout`'s height is left auto, `.stage-area`'s vertical
  centering (based on the tallest child) shifts the *wheel* up/down
  every time you select an Element with a different row count, even
  though the wheel's own size never changes. Overflow is left at its
  default (visible) so taller card content just extends past the box's
  bottom without affecting the centering math.
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
- **The banner is intentionally decoupled** from the wheel+cards row's
  width — its own `width: min(960px, 100%)` in `app-banner.css`, never
  tied to a shared variable. Don't reintroduce a shared `--stage-max-width`
  between them; that was tried and explicitly reverted.
- **`html { overflow-y: scroll; scrollbar-gutter: stable; }`** is there
  to stop the vertical scrollbar's appearance/disappearance (as page
  height crosses the viewport height) from shifting the whole
  horizontally-centered layout sideways. Don't remove it.

## Testing gotcha — read before saying "verified locally"

`example.html` has **no** `#app-root`/login-gate wrapper, so testing
against it will not catch bugs that only exist in `gas/Index.html`'s
extra wrapper structure (this is exactly how the banner mis-centering
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
   `main`.
4. Tell the user which `gas/*.html`/`.gs` files changed — they paste the
   updated file contents into their existing Apps Script project's
   matching files (same names, no extensions in the Apps Script editor)
   and redeploy via **Deploy → Manage deployments → Edit → New version**.

## Quick file-by-file reference

| File | What it is |
|---|---|
| `gas/Code.gs` | `doGet()`, `include()` helper, `getCurrentUserAccess()` |
| `gas/appsscript.json` | Manifest — `executeAs: USER_DEPLOYING`, `access: DOMAIN` |
| `gas/Index.html` | Page shell: login gate markup, `#app-root`, `.stage-area`/`.main-layout`, all the page-level `<style>` |
| `gas/Script_LoginGate.html` | 3-state login gate logic, `enterApp()` |
| `gas/Script_App.html` | All app logic + `ELEMENT_THEMES` data (mirrors `example.html`'s inline script) |
| `gas/Script_ExcellenceWheel.html` | Wheel component (mirrors `excellence-wheel.js`) |
| `gas/Stylesheet_*.html` | Wrapped copies of the root `.css` files, plus `Stylesheet_LoginGate.html` (GAS-only) |
| `EIA.json` | Source rubric data |
| `import-eia.py` | One-time transform: `EIA.json` → `ELEMENT_THEMES` JS literal |
