# To do

Work that has been agreed but not built yet, and things worth knowing that are
not obvious from the code. Newest first.

## How this is worked

**One branch per task, named in the table below, all cut from `main`.** A branch
is created when its task starts, not before, so `main` is always the thing that
builds and installs. Merging back into `main` is a squash, so `main`'s history
stays a readable list of features rather than a record of every commit.

The first four share a dependency: highlights, drawings, pins and bookmarks all
need a toolbar in the reader, and marks and pins both need the coordinate
mapping in `src/annotations.ts`. That work should land on `feature/marks` first
and the others build on it.

| Branch | Task |
| --- | --- |
| `feature/bulk-add` | Bulk add of patterns. Independent; good first task. |
| `feature/yarn-stash` | Yarn stash tab. Land before plans: plans want stash yarns. |
| `feature/plans` | Plans tab: what, when, and with what yarn. Needs the stash. |
| `feature/finished-gallery` | Gallery of finished projects. |
| `feature/inspiration-board` | Infinite pan/zoom inspiration board. |
| `feature/marks` | Highlights, notes and drawings. Start here: the others need it. |
| `feature/pins` | Cropped image pins, up to five per pattern. |
| `feature/bookmarks` | Bookmarks and the document index. |
| `feature/export` | Page-range PDF export. Independent of the other three. |
| `feature/raglan-calculator` | Raglan calculator. Has open questions below. |
| `feature/colourwork-designer` | Schematic colourwork designer. Open questions below. |
| `feature/lopapeysa` | Round yoke calculator. Probably a mode of the raglan one. |
| `feature/native-file-drop` | Native file drop, so dropping a large PDF is as fast as Browse. |
| `feature/undo-delete` | A way to recover a removed pattern. |
| `feature/keyboard-config` | ~~Make the row keys configurable.~~ Done: chosen count keys, and a key per counter. |
| `feature/updates` | In-app update check with beta toggle. |

## Status

| Area | State |
| --- | --- |
| Library, filters, search, row counter, highlight line | shipped |
| Covers, AI metadata, settings | shipped |
| Remove a pattern | shipped |
| Yarn weight filter | shipped |
| Scroll-in-release bug, large-file speed, scanned-PDF AI | shipped |
| Row keys: line and counter in step, one band per press | shipped |
| Named counters, multiple at once, with a click | shipped |
| Highlights, notes, drawings, pins | shipped |
| PDF zoom: fit-width default, +/-, Ctrl+wheel | shipped |
| Contents (outline) and bookmarks panel, PDF search, PDF links | built |
| Library cards one fixed size, more per row on a wider window | built |
| Highlight line off by default | built |
| Count keys chosen by the reader; a key per counter | built |
| Turning a PDF page (per page, remembered) | built |
| PDF export | **backend only, no UI** |
| Raglan calculator, colourwork designer, lopapeysa | not started |
| Bulk add | built |
| In-app update check | built |
| Yarn stash | built |
| Needle and hook inventory, with what each is on and a Free filter | built |
| Projects: needles, hooks, cables and yarn in use; finishing releases them and records leftovers | built |
| Yarn photo by paste or drop; weight cheat sheet; weight from the ball band; cone counts (2/28) | built |
| A page per project: cover, dates, and a Miro-like board of notes, pictures, links, patterns, yarn, needles and colours | built |
| Plans, finished gallery, inspiration board | not started |

## Tabs: stash, plans, gallery, board

A design note that applies to all of these: `src/main.ts` today swaps exactly
two screens (library and reader). Four new top-level areas means real
navigation — a tab bar beside or above the library — so whichever of these
lands first also builds the shell the others reuse.

Done: the tab bar now exists in `src/main.ts` (Patterns and Stash), built
with the yarn stash; the remaining tabs add a button and a `show…` method.

**Bulk add.** Point at a folder (or multi-select files) and every PDF/EPUB in
it joins the library, using the path-based copy that Browse already has, so
bulk add is never slower than adding one file. Needs: a summary at the end
(added / skipped as duplicates / rejected), duplicates detected by content
rather than name, and progress you can cancel. Open question: recursive into
subfolders, or one folder flat?

**Yarn stash.** Every yarn you own: name, brand, colour, weight (the same
family table as the library filter, so "could I knit this in something I
have?" becomes a real query), metreage/yardage per ball, balls or grams in
stash, where it lives, and a photo. Open questions: partial balls (weigh them?
grams left?), and does a yarn get lots (same yarn bought twice, different
dye lots) as first-class things or just a note?

**Plans.** A queue of what to knit next: a pattern from the library (or a free
text entry, because some plans have no pattern yet), a yarn from the stash
(optional), a target date or season, and an order. Drag to reorder; marking
one started/finished should move the pattern's own status along. Open
question: dates as exact days, or coarse ("autumn", "before the baby comes")?
Now that Projects exist, a plan is a project that has not started: the queue
could be projects with a "planned" status, sharing the same pattern, yarn and
needle choices, rather than a separate kind of thing.

**Finished gallery.** Cards with photos of finished objects: the pattern it
came from (linked back into the library), the yarn used, needle size,
start/finish dates, and notes on modifications. Multiple photos per object.
Open question: does finishing a plan or flipping a pattern's status to
"finished" offer to create a gallery entry, or is the gallery purely manual?

**Inspiration board.** An infinite pan/zoom canvas: images, text notes, links
to patterns, and colour swatches dropped anywhere and arranged freely, with
several named boards. Stored as items with x/y/scale so a board survives
restarts. This is the most novel UI of the set — no precedent in the codebase
for a free canvas, so it is worth doing after one of the tab screens exists.
Open question: images pasted from the clipboard too, or only from disk?

## More ideas, not yet agreed

Candidates, roughly most useful first. Pick from these when the list above
runs out; none is agreed yet.

- ~~**Needle and hook inventory**~~ — built: the Needles & hooks tab. Still
  open: when plans exist, a plan could say "needs a 4 mm circular you don't
  own" by checking it against the tools that are free.
- **Gauge swatch log** — swatch results per yarn + needle, because the
  calculators (raglan, yoke, colourwork) all want a gauge and your real
  knitted gauge beats the ball band's.
- **Shopping list** — yarn a plan needs that the stash can't cover. Falls out
  of plans + stash almost for free.
- **Project journal** — dated entries on a pattern while you knit it: what
  you changed, where you stopped, what you'd do differently. The gallery
  entry then writes itself.
- **Recipient measurements** — named sets of measurements (you, family,
  friends) feeding the calculators and gift plans.
- **Ravelry import** — their export is a CSV/JSON of your library and stash;
  a one-shot importer would seed both tabs.
- **Backup/export** — the library folder is already self-contained; a one
  click "back up to zip" would make that promise real.

## The big one: annotations, pins, bookmarks, export

Highlights, notes, drawings and pins are done and shipped, toolbar included —
see §1 and §2. Bookmarks/index and PDF export still have a **finished, tested
backend** — tables, migrations, CRUD, and 16 Tauri commands, all covered by
tests — but **no frontend at all**. The commands are registered and callable;
nothing calls them yet.

The reader toolbar the first two build on already exists; §3 and §4 hang off
the same one.

Start here:

- `src-tauri/src/annotations.rs` — the 16 commands. Read this first; it is the
  contract.
- `src-tauri/src/db/mod.rs` — schema and CRUD for `annotations`, `bookmarks`,
  `pins`.
- `src-tauri/src/export.rs` — the hand-written PDF writer, independently
  verified with pypdf via `check-export.py`.

### 1. Highlights, notes, drawings

All three, on both PDF and EPUB. The geometry is stored as a **JSON string** in
Rust and interpreted by the frontend; the split matters:

- **PDF** — normalised `0..1` page coordinates, so an annotation stays put
  across zoom and window sizes.
- **EPUB** — quote text plus an occurrence index rather than coordinates,
  because the text reflows and coordinates would be meaningless. Quote plus
  occurrence is what survives a reflow.

Notes planned: first two files to write.

- `src/annotations.ts` — coordinate mapping both ways. PDF: client rect ↔
  normalised page coords. EPUB: quote + occurrence → `Range` rects inside the
  chapter iframes, which are same-origin because they are sandboxed with
  `sandbox="allow-same-origin"`.
- `src/reader/marks.ts` — text selection → highlight, the note dialog, and a
  freehand drawing layer using pointer capture.

Built on `feature/marks`. Done: PDF rects, EPUB quote + occurrence, notes that
open for editing (emptying one removes it), freehand drawings, Select as the
default tool, a colour picker, and `H` for highlight. Merged to `main`.

**Changed since, at the user's request:** the Highlighter is now a pen, not
select-then-mark — a broad translucent stroke dragged over the page, which
works over charts with no text as well as over words. Stored as a `highlight`
whose geometry is points instead of rectangles (`isMarkerStroke` in
`marks.ts`), so no backend change, and older text highlights still display.
The `H` shortcut is gone: no marking action has a key.

Shipped but found broken by real use, and fixed:

- **Every mark operation only worked on the page at the top of the pane.**
  The mark layer was one overlay outside the document, and everything in it —
  painting, hit-testing, highlighting a selection, dropping a note, starting a
  stroke — used `currentPage()`, which is the page whose top has scrolled past
  the top of the pane. With two pages on screen (constantly, on a maximized
  window) a selection on the lower one was silently refused, its marks were
  not drawn at all, and notes and strokes started there were filed against
  the page above. Marks also sat still while the page scrolled under them
  until scrolling stopped. And since the overlay was outside the scroller, a
  click on a mark never reached the scroller's handlers, so notes could not
  be opened and highlighted words could not be selected again. Rewritten the
  way Shelfmind does it: one layer per page, inside the page (or over the
  frame, for an EPUB chapter), marks in percentages of it, and the page for
  each action taken from under the pointer. Pins had the same `currentPage()`
  bug for the page a crop was filed under.
- **The Highlight toolbar button did nothing.** It only armed a visual "tool"
  state; `MarkLayer.pointerDown()` had no case for `"highlight"` at all, and
  nothing else called `highlightSelection()`. Only the `H` key ever worked.
  Clicking it now acts on the current selection immediately, same as `H`.
- **The row highlight-line silently ate every selection made near it.** Its
  whole coloured band was `pointer-events: auto` so it could be dragged
  anywhere along its length, and it sits above the text layer in z-index — so
  a drag meant to select text at (or near) the current row was captured as
  "move the line" instead, and nothing was ever selected. Since the line is
  where a reader is most likely to be trying to highlight from, this made
  highlighting look completely dead. Fixed by moving all pointer handling to
  the small grip alone (`src/reader/highlight.ts`, `.highlight-line` /
  `.highlight-grip` in `styles.css`) — the band now lets clicks pass through
  to whatever is under it.
- **A PDF wider than ~1100px silently broke selection accuracy.** `pdf.ts`
  computed the render scale from the full pane width, but `.pdf-pages` capped
  the *visible* width at 1100px and `.pdf-canvas{max-width:100%}` shrank the
  canvas to fit — so the invisible text layer, sized for the uncapped scale,
  drifted away from the glyphs actually on screen. Worse at a larger window,
  worst once zoom (below) could push a page past the pane on purpose. Fixed
  by making `pdf.ts` the single source of truth for the render width (capped
  there, before height is computed from it) and removing the CSS clamps that
  were fighting it. This was also why a maximized window looked visibly
  wrong/stretched: canvas width and height stopped agreeing once only the
  width was being squeezed by CSS.
- Added real **PDF zoom** (`pdf.ts`, `.zoom-tools` in the reader bar): fit
  width is still the default, `+`/`-`/fit buttons with a percentage readout,
  `Ctrl` + `=`/`-`/`0`, `Ctrl`+wheel. Horizontal scroll now works so a
  zoomed-in page isn't clipped. EPUB has no zoom UI — it reflows to the pane
  instead, so there is nothing for it to do.
- Toolbar is icons now (➤ 🖊 🅣 ✏️ 📌 ↶ 🗑) instead of text labels, to stop it
  eating so much of the reader bar.
- Added **Undo** (removes the last mark made, no confirmation) and **Clear**
  (removes every mark on the pattern, one confirmation) to `MarkLayer`,
  greyed out when there is nothing to act on.
- **A mark stayed exactly where it was drawn after the window resized**,
  including maximizing it, while the page itself reflowed to a new width
  under it — so an existing highlight was left sitting over blank pane,
  nowhere near the words it was made on. `PdfView` already re-rendered every
  page on both a zoom *and* a plain window resize, but only zoom told the
  mark layer to repaint; resize did not, on the leftover assumption (still
  the doc comment on `RenderedDoc.onReflow` until this was noticed) that a
  PDF's pages never change size on their own. They do now, on either trigger,
  so `onReflow` fires for both. Verified by actually maximizing the harness's
  real OS window over CDP with a mark already on screen — a plain resize
  event dispatched in JS would not have caught this, since it is the
  *debounced re-render that follows a real resize* that was never reported,
  not the resize event itself.

### 2. Pins

A cropped image of a region of the page, up to **5** per pattern. The limit is
enforced in the backend with a clear error; the UI must not be the thing that
stops at five.

- `src/reader/pins.ts` — drag to select a region, crop to JPEG on a canvas,
  then floating cards that can be dragged, resized, and hidden.

Built on `feature/pins`. Done for PDFs, as chosen: drag a box, crop to JPEG,
cards that drag, resize, rename, hide and delete, named from the words under the
crop, cascading so they do not stack, limit of 5 enforced in the backend with the
button greying out first. EPUB is refused with a reason rather than faked.

Not done, and would need a command: bringing a card to the front. `update_pin`
only carries a placement, so `z` cannot be changed from the frontend. Cards stack
in the order they were made.

Found broken by real use, and fixed: `grab()` (drag/resize) took pointer
capture and listened on `this.scroller`, a *sibling* of the card, not an
ancestor — relying on capture to retarget events there for the whole drag
rather than on the element that actually received the press. Rewritten to
capture and listen on `e.currentTarget` instead (the bar or the grip), which
needs no retargeting to work. Also added the guard a card's own buttons
needed: pressing Hide/Rename/Remove bubbled through the bar's own `pointerdown`
first, arming a drag before the click ever ran — now `bar` ignores a press
that started on a `button`. Both fixes follow the same pattern an Electron
reference app (Shelfmind) already uses for the same kind of floating panel.

Also: hiding a pin now collapses it to just its number (1–5) instead of
leaving the full title bar on screen — that bar was the one thing hiding a
pin was supposed to get out of the way of. Click the number to bring it back.

### 3. Bookmarks and the index

- Add, delete, rename, reorder. Reordering renumbers.
- **Index where one exists:** a PDF's own outline via `getOutline()`; an EPUB's
  spine. Where there is no outline, say so rather than showing an empty panel.
- `src/reader/bookmarks.ts` plus an index panel.

### 4. Page-range PDF export

Pick pages from a multi-pattern EPUB, save as PDF. The writer is done and
tested; the page picker is not.

- `src/views/export.ts` — the picker, range selection, render the chosen pages
  to canvas, call `save_export_pdf`.

## Smaller things

- **Native drag-and-drop of files.** Adding by drag still sends the file's bytes
  across the app boundary, which is slow for a large PDF. The Browse button
  avoids this by passing a path. A native drop handler would fix the drop path
  too. Not done because a dropped file is only ever handed to the webview as
  contents, with no path available.
- **Restore a removed pattern.** `delete_pattern` is immediate and there is no
  undo. A trash or a confirm-with-undo would be kinder, since it also deletes
  the file from disk.
- ~~**Make the row keys configurable.**~~ Done: the count keys are chosen in
  the counter panel (stored as the `count_keys` setting), and each counter can
  have its own key (`counters.hotkey`). Keys are physical codes (`e.code`).
- **The rest of Shelfmind's pattern reader.** Already here: marks (pen
  highlighter, notes, pen, undo, clear), pins with live panels and chips, zoom,
  contents and bookmarks, search, links. Still to bring over: zoom remembered
  per pattern; page-by-page (swipe) mode; a light/dark reader theme; two PDFs
  side by side; a Select tool that moves and resizes marks; an eraser; typed
  text on the page; undo per page; library tabs with folder re-import; lists;
  "Open in the default PDF app" (the backend `open_pattern_file` exists, no
  button yet); a missing-file state on cards; clicker extras.

## Knitting tools: calculators and a chart designer

Agreed as a group, none started. They share a lot: a set of measurements, a
gauge, and arithmetic that produces stitch and row counts. Worth building on one
shared "project" model rather than three separate screens — a raglan you have
already sized should be able to become a colourwork chart.

Open questions, so they can be answered before any of it is built:

**Raglan calculator.** You enter measurements and gauge, it works out the
stitches and rows and the raglan increases.

- Which measurements? The usual set is neck, chest/bust, underarm, sleeve
  length, upper arm, and back length — but a drop-shoulder or seamless yoke
  needs different ones. Which construction(s) should it assume?
- Should it be **top-down or bottom-up**? A top-down raglan is worked from the
  neck and increases as you go, which changes every number. Both, or one?
- What are the increase rules? A 4x2, 3x2 or 2x2 every 4/6/8 rows is a
  convention, not a rule, and people have strong opinions. Make the increase
  and the rate configurable, with a sensible default?
- Should it cast on or knit the neck? Circular or flat?
- **Yarn substitution and magic-loop alternates** — in scope, or out?

**Schematic colourwork designer.** A pixel-art grid you draw in, where one
square is one stitch.

- Size: one square = one stitch, as stated. Rows the same?
- Every 10 stitches and 10 rows get a heavier margin, as stated — and a heavier
  line again every 50? Worth confirming, since counting large colourwork
  charts is where the mistakes happen.
- How many colours, and does it need **names** so the chart can carry a legend?
  A chart without a key is not usable, so this probably is not optional.
- Export? PNG and PDF at minimum, scaled so one square is a real size — a
  chart you cannot print at the right gauge is no use. At minimum, an export
  the user can print.
- Does it stay a picture, or should it also produce **written instructions**
  ("row 7: kfb, kfb, *p1, k3, *p2, ...")?

**Lopapeysa.** The same thing for a round yoke instead of a raglan: increases
in groups rather than on a raglan line. As a mode of the raglan calculator, or
its own tool? It shares almost all the measurements and the arithmetic, so
folding it in is probably right — but the increase *rules* differ enough that
forcing one model on both could get ugly.

## Gotchas worth remembering

- **pdf.js does not turn its own text and link layers.** Given a rotated
  viewport, the canvas paints turned, but `TextLayer` and `AnnotationLayer`
  lay themselves out upright at the page's upright size, set
  `data-main-rotation`, and leave the turn to rules in pdf.js's viewer
  stylesheet, which this app does not load. Without those rules (now in
  `styles.css`) a turned page shows sideways words over a picture they no
  longer match, so selection and search hits land in the wrong place, with no
  error anywhere. Marks and pins are stored upright and turned on the way to
  the screen (`src/reader/rotation.ts`), so turning a page never moves them.

- **A hidden tab has no `requestAnimationFrame`.** The browser harness reports
  a tab as focused while `document.visibilityState` is `hidden`, so rAF never
  fires. pdf.js yields between paint chunks on rAF, so `page.render().promise`
  never settles and anything awaiting it hangs forever. This cost a long
  debugging session: the reader appeared to lose its counter and highlight line
  for no reason, and the pages had visibly painted, which is what made it look
  impossible. The fix was to stop awaiting the first paint. When something
  mysteriously never completes in the harness, check
  `document.visibilityState` and whether rAF fires before reading any app code.
- **A `ResizeObserver` never fires in a hidden tab either**, for the same reason:
  its notifications are delivered during the rendering steps, which do not run.
  `MutationObserver` does fire, so anything that must be provable in the harness
  has to be driven by a mutation. This is why an EPUB frame is re-fitted from a
  mutation on its document (with a `ResizeObserver` alongside it) rather than
  from size alone.
- **An observer only watches elements in its own document.** A `ResizeObserver`
  made in the app watching a chapter's `<body>` inside an iframe does nothing at
  all — silently, with no error. Build it from the iframe's own window
  (`frame.contentWindow.ResizeObserver`) instead. Same for `MutationObserver`.
- **Do not wait for a canvas paint to build a PDF's text layer.** The text layer
  is invisible and positioned in CSS pixels, so it is independent of the paint,
  and tying it to one means a page's words are not selectable until the picture
  happens to finish — or ever, if the paint does not settle.
- **Never overwrite the screen element's class.** `.screen` carries the
  `flex`/`min-height` chain that lets a scrolling pane work. A view that writes
  over it makes the document grow to its full length instead of scrolling, and
  every functional test still passes. `harness/layout-checks.js` guards it.
- **Click handlers are ordered most-specific first.** The `data-delete` check
  has to come before the card's `[data-open]`, or clicking Remove opens the
  pattern instead. This bit once already.
- **Send file bytes as raw binary, never as a JSON array of numbers.** That
  costs about three characters per byte on both sides.
- **Build the harness as a production bundle** (`npm run harness:build &&
  npm run harness:serve`) before concluding a bug is dev-only. A bug that only
  appears after minification will not show up in the dev harness.
- **Screen capture of the Tauri webview does not work** on this multi-monitor
  setup. Use the browser harness.
- **`window.prompt`, `window.confirm` and `window.alert` do not work in a Tauri
  window**, and they fail in ways that look like nothing happening. `prompt`
  never returns and wedges the window permanently; `confirm` returns `undefined`
  rather than `true`/`false`, so `if (!confirm(...))` is always taken; `alert`
  does not show. All three work perfectly in a browser, so code using them passes
  every harness test and then does nothing in the app — this shipped broken once,
  and the whole marking toolbar was dead on arrival. Everything now goes through
  `src/dialogs.ts`, and `harness/no-dialogs.js` makes the harness refuse the
  three so it cannot pass there again.
- **Test the built app, not only the harness.** The harness agrees with itself:
  it is the same code in the same engine, so anything the host environment does
  differently is invisible to it. The built app can be driven for real by
  starting it with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  and talking CDP to `http://127.0.0.1:9222`. Use `Input.dispatchKeyEvent` for
  keys — a synthetic event dispatched on `document` takes a different
  propagation path and will not show whether a global handler would have run.
- **A `ResizeObserver` never fires in a hidden tab** and a `MutationObserver`
  does, so anything that must be provable in the harness has to be driven by a
  mutation. Related: an observer only watches elements in its own document, so
  one made in the app cannot watch a chapter inside an iframe — build it from
  the iframe's own window.
- **A dialog must own the keyboard, not just the screen.** The reader and main
  both bind keys on the document, so a question would otherwise be answered
  twice: Escape closed the dialog *and* left the pattern. Note that
  `stopPropagation` is not enough when the other handler is a *bubble* listener
  on the same node — the stop-propagation flag is only read between nodes — so
  it needs `stopImmediatePropagation`. And do not register one listener per
  dialog: each one stopping propagation silences the others, including the one
  belonging to the dialog actually on screen. One listener and a stack.
- **PowerShell `Invoke-WebRequest` cannot download a GitHub release asset.** The
  download redirects to S3 and the connection is closed mid-transfer, with
  "The request was aborted". Use the asset API instead, which serves the bytes
  itself: `curl.exe -L -H "Accept: application/octet-stream"
  https://api.github.com/repos/OWNER/REPO/releases/assets/ID`. Uploading works
  fine from PowerShell; it is only the download that fails.
- **PowerShell `Set-Content -Encoding UTF8` writes a BOM** and has corrupted
  files here twice. Use `[IO.File]::WriteAllText` or the edit tool.
- **`cargo` is not on `PATH`.** Source `vcvars64.bat` and add
  `%USERPROFILE%\.cargo\bin` before any cargo command, including
  `npm run tauri build`.
- **Verify generated PDFs with an independent parser.** Structural tests missed
  two real bugs in the export writer. See `check-export.py`.
- The model server at `gen2.zeroval.eu` was returning **502 for every request**
  as of 26 Sep 2026, so the AI path could not be checked live. The user is
  verifying it themselves.
- **`currentPage()` means "the page at the top of the pane", not "the page
  the reader is looking at".** In a continuous scroll those differ whenever
  two pages are on screen. Anything acting on a page must find it from the
  pointer or the DOM node involved; `currentPage()` is only right for saving
  the reading position. Harness tests that always acted on page 1 at scroll 0
  could never see this.
- **The update check compared tags, and the tags lie about the version.** A
  beta is tagged in its cycle's name (`v0.3.0-beta.3`) while the build inside
  carries a plain bumped version (`0.3.2`), because Tauri's installers cannot
  hold a prerelease label. In semver `0.3.0-beta.3` < `0.3.1`, so every 0.3
  install saw every later beta as *older* and was offered nothing. The check
  now reads the version from the installer's file name, which Tauri writes
  from the build itself. Separately, a beta build is now always offered the
  next beta: with "Include beta releases" unticked (the default) it was
  otherwise stranded, since the only stable release is 0.1.0.
- **`element.click()` is not a click.** It fires the `click` handler but skips
  the `pointerdown`/`mouseup` the browser would otherwise dispatch, so it
  cannot prove a button actually works by mouse — testing the Highlight button
  this way passed while it was genuinely unclickable in real use. CDP's
  `Input.dispatchMouseEvent` is closer, but on this box it only produces real
  events when the target window is both foregrounded (`SetForegroundWindow`)
  *and* `document.visibilityState` reads `"visible"` — check that before
  trusting a "no events fired" result.
- **An overlay that is draggable across its whole area will eat input meant
  for whatever is under it**, at any real size. The row highlight-line was
  `pointer-events: auto` across its entire coloured band so it could be
  grabbed anywhere, which silently ate every text-selection drag started
  near the current row — exactly where a reader is most likely to be
  selecting from. Restricting pointer events to a small dedicated grip (and
  letting the rest of the band pass clicks through) is the fix, and was
  already the documented intent of the grip before this was noticed.
- **A size computed in JS and a size clamped in CSS have to be the same
  number, or something that depends on the JS size silently breaks.** `pdf.ts`
  sized the text layer from the pane's full width; `.pdf-canvas{max-width:
  100%}` then shrank what was actually painted to fit a narrower CSS cap. The
  canvas still looked fine (proportionally scaled) — it was the *invisible*
  text layer, sized for the wider number, that drifted out of alignment with
  the glyphs on screen. Keep one source of truth for a size like this; don't
  let a CSS clamp second-guess a JS layout decision another part of the code
  depends on.
