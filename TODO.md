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

### Project log

A **Log** on each project's page: a running diary of the knitting.

- Type an entry and it gets the **date and time added automatically**; no date
  to fill in.
- Entries newest first, each one editable and removable.
- What goes in: what you changed in the pattern, where you stopped, what you
  would do differently next time, how the yarn behaves.
- When the project is finished, the log stays with it as its record.

Open questions:

- Should the app add some entries by itself, e.g. "Started", "Finished",
  "Added 4 mm circular", "Rows counted today: 32"? Or only what you type?
- A photo on an entry (progress pictures)?

### Gauge swatch log

A record of every gauge swatch you knit, because your real gauge is worth more
than what the ball band says. **It lives in the stash.**

- For each swatch: the **yarn** (from the stash), the **needle** (from Needles
  & hooks, or just a size), the stitch pattern, **stitches and rows per 10 cm**,
  before and after blocking, a photo, the date and notes.
- **In the stash, choose to see Yarn or Swatches.** The Swatches view is a grid
  of swatch cards (photo, gauge, needle). Clicking one shows everything about
  the swatch **and the yarn it was knitted in**, with a way through to the yarn.
- **A yarn shows its own swatches.** Opening a yarn lists the swatches knitted
  in it, and you can add a new one from there with the yarn already chosen.
- The yarn's card says it has been swatched ("22 sts / 30 rows on 4 mm").
- Can be linked to a project.
- Later, the calculators (raglan, yoke, colourwork) offer your swatches as the
  gauge to use.

Open questions:

- Measured over 10 cm only, or any width (e.g. 23 sts over 11 cm, worked out
  per 10 cm)?
- Inches as well as centimetres?
- A swatch in yarn that is not in the stash (a friend's, or used up): allowed,
  with the yarn typed in?

### Shopping list

Two lists of things to buy: **yarn**, and **needles & hooks**.

- **Yarn:** name, brand, weight, colour, how much (grams, metres or balls),
  and what it is for (a project, or nothing yet).
- **Needles & hooks:** size, type, length or cable, and what it is for.
- Tick an item as **bought** and it moves into the stash or into Needles &
  hooks, with the form already filled in from the list.
- Can be added to from a project ("I need another 200 g of this").

Open questions:

- Should the app suggest things, e.g. a project needs a 4 mm circular and none
  is free, or a pattern needs 600 m and the stash has 400 m?
- A shop or link and a price on each item?
- Something to copy or print to take to the shop?

### Shops

The shops you buy from, as links with your own comments.

- A shop: name, web address, and a **comment**, e.g. "Drops is the cheapest
  here" or "great prices on deadstock".
- Click to open the shop in the browser.
- Search or filter by what the comments say (find "deadstock" or "Drops").
- Fits with the Shopping list: an item can say which shop to buy it from.

Open questions:

- Tags as well as a comment (yarn, needles, deadstock, sale)?
- A country or shipping note per shop?
- Its own tab, or a part of the Shopping list?

### Recipient measurements

The people you knit for, with their measurements.

- A person: name, and a set of measurements, e.g. chest, waist, hips, neck,
  head, wrist, upper arm, arm length, back length, foot length, shoe size.
- **The date they were measured**, with older sets kept, because children grow.
- Notes: colours they like, fibres they cannot wear (wool allergy!).
- A project can say who it is for, and its page shows their measurements.
- Later, the calculators use them.

Open questions:

- A fixed list of measurements, or your own as well?
- Centimetres, inches, or a choice per person?
- Its own tab, or inside Settings or Projects?

---

## Later

### Plans: what to knit next

A queue of projects not started yet: a pattern (or just an idea), yarn from the
stash, a rough date ("autumn", "before the baby comes"), and an order you can
drag. Since Projects exist, a plan is probably a project with a **planned**
status rather than a new kind of thing. Patterns marked **Want to knit** are a
natural place to start one from.

Open question: exact dates, rough ones, or both?

### Finished gallery

Photos of finished things: several per project, with the pattern, yarn,
needles, dates, notes and the project log. Probably a view of finished
projects rather than something separate.

Open question: made automatically when a project is finished, or added by
hand?

### Knitting calculators and a chart designer

They all need measurements (see Recipient measurements) and a gauge (see Gauge
swatch log), so those two come first.

**Raglan calculator.** Measurements and gauge in; stitches, rows and raglan
increases out. Open questions:

- Which measurements, and which construction?
- Top-down, bottom-up, or both?
- Increase rules (every 2nd/4th row and so on): fixed, or configurable with a
  sensible default?
- Knit in the round or flat?

**Round yoke (lopapeysa).** Like the raglan, but increases in rounds across the
yoke. Probably a mode of the raglan calculator, since the measurements are the
same.

**Colourwork chart designer.** A grid where one square is one stitch.

- A heavier line every 10 stitches and 10 rows; another every 50?
- Named colours with a legend (a chart without a key is not usable).
- Export to PNG and PDF, printable at the real size.
- Written row-by-row instructions as well as the picture?

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

- **Ravelry import.** Ravelry can export your library and stash; a one-time
  import would fill both tabs.
- **Backup.** One click to save the whole library to a zip file.
- **Needles a plan needs.** Once plans exist, warn that a plan needs a 4 mm
  circular you do not own, or that is busy on another project.

---

## Small fixes

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
- **Describing with a model:** off unless switched on; a robot icon; only the
  first pages are sent; a run over the library keeps going in the background,
  behind a panel that minimises and closes.
- **Reading:** PDF and EPUB, zoom, turning a page, contents, bookmarks, search,
  links, highlight line, row counter with named counters and your own keys,
  highlights, notes, drawings, pins.
- **Stash:** yarn with lots, photos (pasted or dropped), weight from metres and
  grams, cone counts (2/28), weight cheat sheet, leftovers, another colour of
  the same yarn.
- **Needles & hooks:** inventory, sets, what each is used on, a Free filter.
- **Projects:** needles, hooks, cables and yarn in use; Active, Paused, Finished
  and Frogged; finishing frees them and records leftovers; a page per project
  with a cover, dates, a board, the pattern read beside the board (resizable,
  minimises to a tab), and the pattern's own row counter.
- **Inspiration:** named boards of pictures, patterns, yarn, links, colours and
  notes.
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
