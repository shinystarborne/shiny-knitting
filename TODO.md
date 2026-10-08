# To do

What is planned for the app, what is still only an idea, and things worth
knowing before working on it.

- [Next up](#next-up): agreed, to build: the bigger pieces, then the small fixes
- [Ideas](#ideas-not-agreed-yet): not agreed yet
- [Already built](#already-built)
- [Worth knowing](#worth-knowing-before-you-change-things): traps that cost time before

---

## Next up

### The list

One at a time, from the top. Each is ticked when it is built, checked and
released as a beta. **Decide first** means an open question to settle before
starting; the details are in the sections under the list.

**Bugs: before the next task**

- [x] **Finishing a project does not update the stash** (reported 6 Oct
  2026, in 0.3.27). A lot never weighed counted as 0 g; now it is its balls
  by the ball band, and each leftover is filled in as what it held less what
  the project was to take. *0.3.28* Then everywhere: whole balls count by
  the ball band, grams only once balls are started. *0.3.29*
- [x] **Finishing says what each yarn used**, in grams or balls (a ball is
  its weight per ball), or what is left. *0.3.30* A yarn's card says what
  there is now, not what was bought (that is for the Statistics). *0.3.31*

**Asked for along the way**

- [x] A chart's highlight line steps up the page; counting only on a
  project's page; pins onto its board; the pattern beside the board by
  default. *0.3.40*
- [x] Crop a picture on a project's board (and a pin), or a photo in its
  log. *0.3.41*

**Yarn and the stash**

1. [x] A project's yarn: how much it is expected to take (grams, balls, or
   all of it), instead of showing 0 g. *0.3.24*
2. [x] Ball band thumbnails on a yarn's card and in its form, opening the
   band big. *0.3.25*
3. [x] Ball bands out of the stash: the Ball bands view, the pictures, and
   the thumbnails on a yarn's card and in its form. Never used. What a yarn
   says of itself (metres and grams per ball, fibres) stays. *0.3.32*
4. [x] A yarn's expected gauge and needles to use, as its band gives them:
   sts and rows over 10 cm, and a needle size or range, in its form and on
   its card. Saved by brand and yarn name, so every colour of it has them.
   *0.3.33*
5. [x] A yarn's care markings: the symbols (washing, bleach, drying,
   ironing, dry cleaning) picked in its form, shown on its card, each with a
   label saying what it means (hand wash only, do not iron...). Saved by
   brand and yarn name, like 4. *0.3.34*

**Projects**

6. [x] Plans: projects not started yet, with a pattern or an idea, yarn, a
   rough date and an order to drag; from a stash yarn's Planned for, or a
   Want to knit pattern. *Decided:* both, a rough time or an exact date. *0.3.27*
7. [x] Finished gallery: photos of finished projects with their pattern,
   yarn, needles, dates and log. *Decided:* by itself, every finished
   project, with a way to hide one. *0.3.35*
8. [x] Two projects from one pattern, each with its own row counter.
   *Decided:* yes, a counter per project, started from the pattern's.
   *0.3.36*

**Settings**

9. [x] Make a backup: in Settings, one click saves the whole library (the
   database and every file: patterns, covers, photos) to a zip, where the
   Save dialog says. *0.3.37*

**Patterns and the reader**

10. [x] PDF export: a screen to choose pages from a pattern and save them as a
    PDF. *0.3.26*
11. [x] Restore a removed pattern: a bin, or Undo for a few seconds.
    *Both.* *0.3.38*
12. [x] Faster drag and drop of a large PDF (it arrives as its contents, not a
    path). Sent raw now (upload_pattern), not as a JSON array. *0.3.39*
13. [x] Pins: bring one to the front. Pressed, or shown from its chip. *0.3.42*
14. [x] Zoom remembered per pattern. *0.3.43*
15. [x] Page by page (swipe) reading. **Pages**: a page fitted whole, turned by keys, ‹ › or a swipe. *0.3.44*
16. [x] A light reader theme. ☀ / ☾ in the reader bar. *0.3.45*
17. [x] Two PDFs side by side. **Beside…**: another pattern next to this one. *0.3.46*
18. [x] Marks moved and resized. With Select: drag to move, the corner to resize. *0.3.47*
19. [x] An eraser for drawings. ⌫: rubs out what it passes over, splitting a stroke. *0.3.48*
20. [x] Typed text on the page. Aa: click, type; moved, resized and changed with Select. *0.3.49*
21. [x] "Open in the default PDF app" (the backend is there; it needs a
    button). Open ↗ in the reader, and in the ⋯ menu. *0.3.50*
22. [x] A card for a pattern whose file has gone missing. File missing, Find it…. *0.3.51*

**Calculators**

23. [ ] The raglan, bottom-up.
24. [ ] The raglan worked flat, as a cardigan with front edges.
25. [ ] A raised back neck with short rows.
26. [ ] Rib repeats that fit the counts (2x2 wants a multiple of 4).

**Colourwork charts**

27. [ ] Select, copy and paste a block of squares.
28. [ ] A chart's colours linked to stash yarns, named in the legend.
29. [ ] Knitting from a chart: on a project's page, the current row marked
    and counted.
30. [ ] The round yoke calculator and a yoke chart together.
    **Decide first:** fit the chart to the calculator's counts, or the
    calculator to the chart?

### Finished gallery

Photos of finished things: several per project, with the pattern, yarn,
needles, dates, notes and the project log. Probably a view of finished
projects rather than something separate.

Decided (6 Oct 2026): by itself. Every finished project is in the gallery,
with its cover and log photos; one can be hidden, and its photos chosen.

### Knitting calculators

They all need measurements and a gauge, and both are built now: the People
tab's measurements (in cm), and the stash's swatches (sts and rows per 10 cm,
the blocked gauge when there is one). A calculator offers a person and a
swatch, and still takes a gauge typed in for a swatch not logged.

The Calculators tab has the top-down raglan in the round and the everyday
helpers (see Already built). Still to come:

- **The raglan, further:** bottom-up; worked flat as a cardigan, with front
  edges; a raised back neck with short rows; rib repeats that fit the counts
  (2x2 wants a multiple of 4).

### Colourwork charts, further

The designer is built (see Already built). Left over:

- **Select, copy and paste** a block of squares, to repeat a motif or move it.
- **Colours from the stash:** a chart colour linked to a yarn, so the legend
  says which yarn and colourway.
- **The round yoke calculator and a yoke chart together:** the calculator fits
  its counts to a repeat, but a lopapeysa chart keeps its repeats and narrows
  each one; the two work the other way round from each other. Open question:
  fit the chart to the calculator's counts, or the calculator to the chart?
- **Knitting from a chart:** a chart on a project's page with the current row
  marked, counted like a pattern's rows.

### Two projects from one pattern

The row counter belongs to the pattern, so two projects knitted from the same
pattern share their counts. A counter per project, started from the pattern's,
would keep them apart. Decided (6 Oct 2026): yes, a counter per project.

### A yarn's band, as details instead of pictures

Asked for 7 Oct 2026: ball band pictures are never used, so they go (the
Ball bands view, the thumbnails, the stored pictures). What a band says is
kept as details on the yarn instead. These belong to the yarn, not the
colour: saved once by brand and yarn name, shared by every colour of it in
the stash and its history. Changed on one colour, they change for all; a new
colour of a yarn already known starts with them.

- **Expected gauge:** sts and rows over 10 cm (or 4 in), as the band gives
  it. A swatch's own gauge stays the one that counts; this is what to expect.
- **Needles to use:** a size or a range (e.g. 3.5 to 4 mm).
- **Care markings:** the standard care symbols, picked from a list in the
  yarn's form, shown on its card as the symbols, each labelled with what it
  means (machine wash 30°, hand wash only, do not bleach, do not tumble dry,
  dry flat, do not iron, do not dry clean...).

### Backup

Asked for 7 Oct 2026: **Make a backup** in Settings. One click saves the whole
library -- the database and the library folder's files (pattern files,
covers, yarn, swatch, log and wishlist photos, board pictures) -- to one zip,
named with the date, where the Save dialog says. Restoring from one is a
separate step, not asked for yet.

### Small fixes

- **Restore a removed pattern.** Removing is immediate and also deletes the
  file. A bin, or an Undo for a few seconds, would be kinder.
- **Faster drag and drop.** Dropping a large PDF onto the app is slower than
  Browse, because a dropped file arrives as its contents rather than a path.
- **Pins: bring one to the front.** Pins stack in the order they were made;
  there is no way to raise one yet.
- **More from Shelfmind's reader:** zoom remembered per pattern, page-by-page
  (swipe) mode, a light reader theme, two PDFs side by side, moving and
  resizing marks, an eraser, typed text on the page, "Open in the default PDF
  app" (the backend exists, no button yet), and a card for a pattern whose file
  has gone missing.

---

## Ideas (not agreed yet)

- **Wishlist and Shops, further.** Both are done for now (see Already
  built). Left over, if they turn out to be wanted:
  - Add to the wishlist from a project ("I need another 200 g of this"),
    with the project already chosen. The form already takes one.
  - Suggestions: a project needs a 4 mm circular and none is free, or a
    pattern needs 600 m and the stash has 400 m.
  - A list to take to the shop: copy or print what is wanted from one shop.
  - Shops that refuse to be read (Etsy, Garnstudio, Maschenfein: 401 or 403
    to anything that is not a browser). Reading the page in a hidden webview
    would get past most of them, at the cost of running the shop's scripts.
  - A pattern got from the wishlist into the library, as yarn and needles go
    into the stash: it needs the file, so it would open Add pattern.
- **Fibre content on patterns.** A pattern's recommended yarn given its fibres
  too, so "could I knit this in something I have?" can match on them.
- **Ravelry import.** Ravelry can export your library and stash; a one-time
  import would fill both tabs.
- **Needles a plan needs.** Once plans exist, warn that a plan needs a 4 mm
  circular you do not own, or that is busy on another project.

---

## Already built

- **Patterns:** library, search, filters, covers (pasted, dropped or read from
  the file), add a whole folder, find duplicates, a page at a time for big
  libraries. A ⋯ menu on every card for the status (No status, Want to knit, In
  progress, Finished, Abandoned), tags, details, cover and starting a project;
  a pattern goes In progress by itself when a project starts from it.
  Designers and tags most used first, with a search and a full list.
- **Describing with a model:** off unless switched on; a robot icon; only the
  first pages are sent; a run over the library keeps going in the background,
  behind a panel that minimises and closes.
- **Reading:** PDF and EPUB, zoom, turning a page, contents, bookmarks, search,
  links, highlight line, row counter with named counters and your own keys,
  highlights, notes, drawings, pins. **Save pages…** saves chosen pages of a
  PDF (copied as they are, by pdf-lib) or chapters of an EPUB (laid out on A4
  as pictures, broken between lines) as a PDF, where the Save dialog says. The
  older raster writer (`export.rs`, `save_export_pdf`) is unused, kept for a
  pages-with-my-marks export if one is wanted.
- **Stash statistics:** the stash's metres and weight (in the Yarn view, of
  what the filters leave). A Statistics view: in the stash now, and yarn
  added and used each calendar month for the last twelve, in metres or grams,
  each month's yarn listed. Added comes from the lots as bought (dated when
  bought, or when the yarn was added), so it goes back as far as the stash
  does. Used is recorded as it goes (a finished project's, weighed before and
  after; what was left of yarn marked used up), from 0.3.23 on.
- **Stash history:** yarn used up (from its card, or by finishing a project
  with none of it left) leaves the stash for a History, with when and what it
  went into, and can come back. (Ball band pictures were here until
  0.3.31; taken out, never used. An empty ball_bands table is dropped.)
- **Stash:** what a yarn is planned for: patterns from the library (searched
  by title and designer) or titles typed for ones not got yet, on its card,
  in the search and as a Planned filter. Yarn with lots, photos (pasted or dropped), weight from metres and
  grams, cone counts (2/28), weight cheat sheet, leftovers, another colour of
  the same yarn; fibre content and superwash, with Fibre and Made of filters.
  What its ball band says, kept by brand and yarn name for every colour of
  it (yarn_details): the gauge to expect, the needles to use, and its care
  symbols, drawn and named (views/care.ts, models::CARE_SYMBOLS). A card
  says what there is now (whole balls by grams per ball, started ones
  weighed); what was bought is for the Statistics.
- **Calculators:** a top-down round yoke (lopapeysa), with 3 to 6 increase
  rounds fitted to the colourwork's repeat; and a top-down raglan in the round, from a person's
  measurements and a swatch's blocked gauge (or both typed in) with the fit's
  ease: the numbers, and the steps in words, copied or saved to a project's
  board. And stitches for a size (fitted to a repeat), increasing or
  decreasing evenly in the round or flat, and a pattern re-gauged to yours.
- **Colourwork charts:** in the Calculators tab. A standard chart (flat, in
  right- and wrong-side rows, or in the round) or a round yoke's repeat (a
  lopapeysa's), with its decrease rounds, or increase rounds top-down, and the
  squares with no stitch grey. Draw, fill, line, box, pick, mirror, undo; move,
  flip and resize; named colours with a legend and symbols; a heavier line
  every 10; long floats underlined. Beside it the chart tiled, or the yoke from
  above, and the rows in words. A gauge gives squares the shape of stitches
  and the size it comes out. Exported as a PNG, or a PDF at the real size (or
  a square size), over several pages if need be; or put on a project's board.
- **Gauge swatches:** in the stash, beside the yarn: the yarn (from the stash
  or typed in), the needle (from the box or a size), the stitch pattern, sts
  and rows over 10 × 10 cm (or 4 × 4 in) before and after blocking, a photo,
  the date, a project and notes. A yarn's card says it was swatched, and its
  form lists its swatches and adds one in it; a removed yarn's swatches keep
  its name.
- **Needles & hooks:** inventory, sets, what each is used on, a Free filter.
- **Project log:** a diary on each project's page (Board | Log), the newest
  first by day: entries dated by themselves, a photo each, changed or removed,
  and milestones the project writes (started, paused, frogged, finished, a new
  pattern). A live Log card on the project's board shows it and takes new
  entries.
- **A counter per project:** counters belong to a pattern and a project
  (counters.project_id, empty for the pattern's own), with a project's total
  in project_progress. Made the first time asked for, from the pattern's: the
  first project takes its counts, later ones start at 0. The reader counts for
  the pattern's live project, asking which with two or more (remembered in
  localStorage, counter-for:<pattern>).
- **Finished gallery:** the Projects tab's Gallery: every finished project by
  itself, with its cover and log photos (list_gallery_photos); opened big,
  with its pattern, yarn, needles, dates, notes and log. Photos left out and
  a project hidden are kept on the project (gallery_skip, gallery_hidden).
- **Plans:** what to knit next, in the Projects tab's Plans list: projects
  not started, with a pattern (or only a name), yarn from the stash and how
  much, a rough time and or an exact date. Dragged into order, or sorted by
  date; made from the tab, a pattern's ⋯ menu (Plan it) or a stash yarn's
  Make a plan. A plan's yarn is meant for it, not in use, and it takes no
  needles; Start knitting makes it an active project from today.
- **Projects:** how much of each yarn a project will take (grams, balls by
  the ball band, or all of it), and a lot never weighed shown by its balls,
  not as 0 g. The pattern searched for by title, designer or tag (in
  progress and wanted first), when starting one and on its page; needles,
  hooks, cables and yarn in use; Active, Paused, Finished
  and Frogged; finishing frees them and records leftovers; a page per project
  with a cover, dates, a board, the pattern read beside the board (resizable,
  minimises to a tab), and the pattern's own row counter.
- **Inspiration:** named boards of pictures, patterns, yarn, links, colours and
  notes.
- **Wishlist:** yarn, needles & hooks, patterns and anything else to get, with
  brand, how much, a price, a picture, a link, a shop and a project; a pasted
  link reads the shop's page for the name, brand, price and picture and picks
  its shop; Got it moves an item to a dated Got section, and yarn and needles
  go on into the stash or Needles & hooks with their form filled in.
- **People:** the people you knit for, in their own tab: notes, and their
  measurements as dated sets, older ones kept and each newer value showing how
  much it changed; a standard list (with how to take each) plus their own;
  stored in cm, shown and typed in cm or inches (Settings). A project says who
  it is for, and its page shows their latest measurements.
- **Shops:** name, web address, tags and your comment, searched by all of
  them, with the tags as filters; the name looked up from the shop's own page
  (and Look up names for shops still named after their address); two rows of
  tags on a card and the rest as +N; opens in the browser; shows how much on
  the wishlist is from it.
- **Counting is on a project's page** (8 Oct 2026, asked for): the pattern
  opened from the library has no counter and no line; the pattern beside a
  board (open by default) has the line, with the page's counter. The line's
  "Rows go up the page (a chart)" (highlights.reads_up) steps it up for a
  chart. A pin goes onto a project's board (board kind "pin", with the
  pattern and page) from its ⤴ button.
- **The Bin:** Remove is patterns.removed_at, everything kept; Undo for 8
  s, and the library's Bin (restore, delete for good, empty). Deleted for
  good at start after 30 days (commands::purge_bin). Every library query
  says removed_at IS NULL; adding a file that is in the Bin restores it.
- **Backup:** Make a backup in Settings: the database (a VACUUM INTO copy)
  and every file of the library folder in one zip, stored, zip64; written as
  .part and renamed when whole; progress polled (backup_progress); the last
  one remembered (app_settings last_backup). backup.json says what it is. A
  real 6.5 GB library took 20 s. Restoring is not built yet.
- **App:** updates found by themselves (at every start and every hour, with a
  card that says so) and installed in place in one click, with betas; settings
  behind the gear.

---

## Worth knowing before you change things

### Building and testing

- **`cargo` is not on `PATH`.** Source `vcvars64.bat` and add
  `%USERPROFILE%\.cargo\bin` before any cargo command, including
  `npm run tauri build`.
- **Build the harness as a production bundle** (`npm run harness:build &&
  npm run harness:serve`) before deciding a bug only happens in dev.
- **Test the built app, not only the harness.** The harness is the same code in
  the same engine, so anything the app's host does differently is invisible to
  it. Start the app with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and drive
  it over CDP at `http://127.0.0.1:9222`.
- **`element.click()` is not a click.** It skips the pointer events a real click
  sends, so it can pass while a button is unclickable. Use CDP's
  `Input.dispatchMouseEvent` and `Input.dispatchKeyEvent`. On this machine they
  only work when the window is in front and `document.visibilityState` is
  `"visible"`.
- **A resize event sent from JS proves nothing.** Real resizing (maximize the
  window over CDP) is what caught marks staying put while the page reflowed.
- **Screen capture of the Tauri window does not work** on this multi-monitor
  setup. Use the browser harness.
- **Check generated PDFs with an independent parser** (`check-export.py`).
  Structural tests missed two real bugs in the export writer.

### The browser

- **`window.prompt`, `confirm` and `alert` do not work in a Tauri window**, and
  fail silently: `prompt` freezes the window for good, `confirm` returns
  `undefined`, `alert` shows nothing. Everything goes through `src/dialogs.ts`,
  and `harness/no-dialogs.js` makes the harness refuse them.
- **A hidden tab runs no `requestAnimationFrame` and no `ResizeObserver`.**
  pdf.js waits on rAF between paint chunks, so awaiting a page's paint hangs
  forever there. A `MutationObserver` does fire. When something never finishes
  in the harness, check `document.visibilityState` first.
- **An observer only watches its own document.** One made in the app does
  nothing to a chapter inside an iframe; build it from
  `frame.contentWindow.ResizeObserver`.
- **pdf.js does not turn its own text and link layers.** The rules that do are
  in `styles.css`; without them a turned page's words and the picture no longer
  match. Marks and pins are stored upright and turned on the way to the screen
  (`src/reader/rotation.ts`).
- **Do not wait for a canvas paint to build a PDF's text layer.** It is
  independent of the paint, and tying them means words are not selectable until
  the paint happens to finish.

### Layout and input

- **Never overwrite the `.screen` element's class.** It carries the
  `flex`/`min-height` chain that lets panes scroll. `harness/layout-checks.js`
  guards it.
- **One size, one source of truth.** A PDF's width worked out in JS and capped
  again in CSS let the invisible text layer drift away from the words on
  screen.
- **An overlay draggable across its whole area eats input meant for what is
  under it.** The highlight line did this to text selection; only its small
  grip takes the pointer now.
- **Capture the pointer on the element that was pressed**, not on a sibling;
  pins' drag only worked by accident until this changed.
- **`currentPage()` means "the page at the top of the pane".** With two pages on
  screen that is often not the one being acted on. Find the page from the
  pointer or the element instead.
- **Click handlers go most specific first.** The card's Remove button has to be
  checked before the card itself, or Remove opens the pattern.
- **A dialog must own the keyboard.** Use one document listener and a stack,
  and `stopImmediatePropagation`: plain `stopPropagation` let Escape close a
  dialog and leave the pattern too.

### Data and files

- **Send file bytes as raw binary**, never as a JSON array of numbers (about
  three characters per byte).
- **PowerShell `Set-Content -Encoding UTF8` writes a BOM** and has corrupted
  files twice. Use `[IO.File]::WriteAllText` or the edit tool.
- **PowerShell `Invoke-WebRequest` cannot download a GitHub release asset**
  (the redirect to S3 is cut off). Use the asset API:
  `curl.exe -L -H "Accept: application/octet-stream"
  https://api.github.com/repos/OWNER/REPO/releases/assets/ID`.
- **Release tags and app versions differ.** A beta is tagged `v0.3.0-beta.N`
  but the build inside is a plain `0.3.N`, because the installers cannot carry
  a beta label. The update check reads the version from the installer's file
  name, not the tag.
- The model server at `gen2.zeroval.eu` returned **502 for every request** as
  of 26 Sep 2026, so the model path could not be checked live.
