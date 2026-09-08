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

`excellence-wheel-preview.html` is a **stale, hand-generated single-file
bundle** from an early round (before the GAS build existed) — do not
trust it as current, it hasn't been regenerated since. `EIA.json` +
`import-eia.py` are the one-time data-import pipeline documented inline
in `import-eia.py` itself; not run by the app.

## Login gate + access control (`gas/` only)

- **Users sheet**: `https://docs.google.com/spreadsheets/d/1OQXaRVUJopdjr4OWQbOvNLjoq-_bwaiNS3Rfu1-C62I/`
  — columns `Email, Name, SchoolName, CrestURL, Active`. The sheet ID is
  hardcoded in `gas/Code.gs`'s `CONFIG.USERS_SHEET_ID`.
- `Code.gs`'s `getCurrentUserAccess()` reads `Session.getActiveUser().getEmail()`
  and looks it up (case-insensitive) against the sheet's **first tab**
  (whatever it's named). Returns `{email, found, active, name, schoolName, crestUrl}`.
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
  school name, user's initials in the avatar) and reveals `#app-root`.

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

- **No Ratings/Evidence persistence yet.** Grades and evidence are still
  client-side, in-memory `ELEMENT_THEMES` state that resets on reload —
  same as the original static build. The decision from the "wire up the
  backend" round was: **one shared spreadsheet for all schools**
  (Ratings + EvidenceLog sheets, each row tagged with `SchoolName`), not
  one spreadsheet per school. Nothing has been built for this yet beyond
  that decision — it's the natural next step.
- **"Request Access from your Principal" button is intentionally
  static** — no email/notification wired up, per an explicit decision
  during the login-gate round.
- **Winter Day font (login gate's "Action" text)** loads from
  `fonts.cdnfonts.com`, which could not be verified from this
  environment (network egress to font CDNs is blocked in the sandboxed
  dev environment) — falls back to Pacifico → generic cursive if it
  fails. Confirm it actually renders in a real deployment.
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
3. Commit and push to `claude/code-project-setup-1qbwa6` (the working
   branch this whole project has been built on).
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
