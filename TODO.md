# To do

What is planned for the app, what is still only an idea, and things worth
knowing before working on it.

- [Next up](#next-up): agreed and ready to build
- [Later](#later): agreed, but bigger or waiting on something else
- [Ideas](#ideas-not-agreed-yet): not agreed yet
- [Small fixes](#small-fixes)
- [Already built](#already-built)
- [Worth knowing](#worth-knowing-before-you-change-things): traps that cost time before

---

## Next up

### How much yarn a project expects to use

Choosing a yarn from the stash for a project says nothing about how much of
it: the project shows it as 0 g, which is confusing. When a yarn is chosen,
ask how much it is expected to take (grams, or balls, or "all of it"), show
that on the project, and keep it apart from the leftovers recorded when the
project is finished. Later it could warn when a yarn is promised to more
projects than there is of it.

---

## Later

### Plans: what to knit next

A queue of projects not started yet: a pattern (or just an idea), yarn from the
stash, a rough date ("autumn", "before the baby comes"), and an order you can
drag. Since Projects exist, a plan is probably a project with a **planned**
status rather than a new kind of thing. Patterns marked **Want to knit** are a
natural place to start one from.

A yarn in the stash can already say what it is planned for (a pattern, or
a title); a plan could start from there, with that yarn on it.

Open question: exact dates, rough ones, or both?

### Finished gallery

Photos of finished things: several per project, with the pattern, yarn,
needles, dates, notes and the project log. Probably a view of finished
projects rather than something separate.

Open question: made automatically when a project is finished, or added by
hand?

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

### PDF export

Choose pages from a pattern (for example one pattern out of a big EPUB
collection) and save them as a PDF. The part that writes the PDF is finished
and tested; the screen to choose pages is not built.

### Two projects from one pattern

The row counter belongs to the pattern, so two projects knitted from the same
pattern share their counts. A counter per project, started from the pattern's,
would keep them apart. Open question: worth it, or is knitting one pattern twice
at once rare enough?

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
- **Backup.** One click to save the whole library to a zip file.
- **Needles a plan needs.** Once plans exist, warn that a plan needs a 4 mm
  circular you do not own, or that is busy on another project.

---

## Small fixes

- **Ball band thumbnails.** A yarn's card and its form could show a small
  picture of its ball band (from Stash → Ball bands, by brand and name), to
  open it big, without going to the Ball bands view.
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
  highlights, notes, drawings, pins.
- **Stash totals and yarn used:** the stash's metres and weight, of all of
  it or what the filters leave. Yarn used is recorded as it goes (a finished
  project's, weighed before and after; what was left of yarn marked used up),
  and the History shows the metres used each calendar month for the last
  twelve, each month's yarn listed. Counted from 0.3.23: what was used before
  was never recorded.
- **Stash history and ball bands:** yarn used up (from its card, or by
  finishing a project with none of it left) leaves the stash for a History,
  with when and what it went into, and can come back. Ball bands: pictures of
  each yarn's band, several each, filed by brand and yarn for every colour of
  it, with what the stash knows of the yarn, and the stash's yarn without one
  offered to add.
- **Stash:** what a yarn is planned for: patterns from the library (searched
  by title and designer) or titles typed for ones not got yet, on its card,
  in the search and as a Planned filter. Yarn with lots, photos (pasted or dropped), weight from metres and
  grams, cone counts (2/28), weight cheat sheet, leftovers, another colour of
  the same yarn; fibre content and superwash, with Fibre and Made of filters.
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
- **Projects:** the pattern searched for by title, designer or tag (in
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
