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
| `feature/marks` | Highlights, notes and drawings. Start here: the others need it. |
| `feature/pins` | Cropped image pins, up to five per pattern. |
| `feature/bookmarks` | Bookmarks and the document index. |
| `feature/export` | Page-range PDF export. Independent of the other three. |
| `feature/raglan-calculator` | Raglan calculator. Has open questions below. |
| `feature/colourwork-designer` | Schematic colourwork designer. Open questions below. |
| `feature/lopapeysa` | Round yoke calculator. Probably a mode of the raglan one. |
| `feature/native-file-drop` | Native file drop, so dropping a large PDF is as fast as Browse. |
| `feature/undo-delete` | A way to recover a removed pattern. |
| `feature/keyboard-config` | Make the row keys configurable. |

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
| Highlights, notes, drawings, pins, bookmarks, index, PDF export | **backend only, no UI** |
| Raglan calculator, colourwork designer, lopapeysa | not started |

## The big one: annotations, pins, bookmarks, export

Everything below has a **finished, tested backend** — tables, migrations, CRUD,
and 16 Tauri commands, all covered by tests — but **no frontend at all**. The
commands are registered and callable; nothing calls them.

This is the largest remaining piece of work and it is one coherent feature: the
reader needs a toolbar, and the five things below hang off it.

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
- **Make the row keys configurable.** `J`/`K` were chosen, not asked for. If
  they clash with something, they are one branch in `handleRowKey`.

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
