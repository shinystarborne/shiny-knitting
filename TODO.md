# To do

What is planned for the app, what is still only an idea, and things worth
knowing before working on it.

- [Next up](#next-up): agreed, to build
- [Ideas](#ideas-not-agreed-yet): not agreed yet
- [Already built](#already-built)
- [Worth knowing](#worth-knowing-before-you-change-things): traps that cost time before

---

## Next up

### The list

One at a time, from the top. Each is ticked when it is built, checked and
released as a beta, then moved to Already built. **Decide first** means an
open question to settle before starting; the details are in the sections
under the list.

- [ ] **The round yoke calculator and a yoke chart together.** *Decided
  (10 Oct 2026):* the chart fits the calculator's counts, and the yoke chart
  lives in the round yoke calculator itself.

**Asked for 16 Oct 2026**

- [ ] **Copy a project's pictures**: a photo on a project (its cover, the
  board's pictures, the log's photos) copied to the clipboard, to paste
  anywhere (a post on Threads...).
- [ ] **A project card to post**: one picture of a project with what there
  is to say about it, saved or copied. *Decided:* its shape chosen each
  time (square, 4:5 portrait, a story's 9:16). See below.
- [ ] **Needles and cables that fit each other**: a needle's and a cable's
  connector system (ChiaoGoo / Lotus Yarns, KnitPro...), so a ChiaoGoo
  needle is only offered ChiaoGoo cables. See below.
- [ ] **One needle of a pair**: a project takes one tip of a set's size (a
  5 mm right needle with a 4.5 or 4 mm left), not the pair. See below.
- [ ] **Ravelry in the app**: a tab to search Ravelry for a pattern without
  leaving the app. **Check first** whether it can be shown in a frame. See
  below.
- [ ] **Prices**: what yarn, needles and patterns cost, to keep track of what
  is spent. *Decided (16 Oct 2026):* yarn priced per ball, a lot adding up;
  totals for the stash, the tools and per project. See below.
- [ ] **Describing with a model fails on some patterns**: the model uses its
  whole reply on reasoning and returns no answer. See below.

### The round yoke and its chart

The calculator fits its counts to a repeat, but a lopapeysa chart keeps its
repeats and narrows each one; the two work the other way round from each
other. Decided (10 Oct 2026): the chart is fitted to the calculator's counts,
not the calculator to the chart, and it is drawn in the round yoke
calculator.

### A project card to post

One picture to post on social media, made from a project: its name, the
pattern and its designer, started and finished dates, a few of its photos
(chosen), the yarn used and how much, the size knitted, the needles, and
lines from its log (chosen). Saved as a PNG, or copied to paste straight into
a post. Decided (16 Oct 2026): the shape is picked in the card's screen
each time: square, 4:5 portrait or a story's 9:16.

### Needles and cables that fit each other

A needle already has a connector size (Mini, Small, Standard, Large:
ChiaoGoo's names), but not which system it is. ChiaoGoo and Lotus Yarns
cables fit each other; KnitPro cables fit only KnitPro needles. A needle
and a cable get a connector system as well as a size, and picking a cable
for a project's needle offers only the ones that fit (the same system and
size), and the other way round.

### One needle of a pair

Interchangeable tips come as a pair of one size, but a project can want
two sizes: a 5 mm right needle and a 4.5 or 4 mm left one. A project takes
a single tip from a set, so the other is still free for another project,
and its needles say which is which.

### Ravelry in the app

A tab with Ravelry's search, to find a pattern from the app. Ravelry may
refuse to be shown in a frame (as some cheatsheet sites do), in which case
it opens in a window of its own, as those do. A pattern found there could
go to the wishlist or, once bought and downloaded, into the library.

### Prices

The wishlist takes a price already, as typed ("€4.95 a ball"). The stash's
yarn, needles & hooks and patterns get one too, carried over when a
wishlist item is got. Decided (16 Oct 2026):

- **Yarn:** a price per ball; a lot's cost is its balls times that.
- **The stash's total:** what the yarn in it cost, and in the Statistics
  what was spent each month, from when it was added to the stash.
- **Per project:** what its yarn and its pattern cost. Tools are left out of
  a project's cost.
- **Tools:** the total cost of all the needles & hooks. A set is added as
  one entry per size, with nothing tying them together afterwards, so a set
  needs to become a thing of its own: its pieces chosen (or the ones added
  together), and one price written for the set. To think through when
  building it.

### Describing with a model fails on some patterns

The reply is capped at 4000 tokens (`ai/openai_compat.rs`). A reasoning
model can spend all of it thinking about a long pattern and answer with
nothing, and the run shows an error. To do: send less of a long pattern,
ask again once with more room (or less reasoning) when the reply comes
back empty, and in a run over the library, note the pattern and go on.

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
- **Needles a plan needs.** Plans take no needles yet; a plan could warn that
  it needs a 4 mm circular you do not own, or that is busy on another project.
- **Restoring a backup.** Make a backup is built; reading one back in is not.

---

## Already built

- **Patterns:** library, search, filters, covers (pasted, dropped or read from
  the file), add a whole folder, find duplicates, a page at a time for big
  libraries. A ⋯ menu on every card for the status (No status, Want to knit, In
  progress, Finished, Abandoned), tags, details, cover and starting a project;
  a pattern goes In progress by itself when a project starts from it.
  Designers and tags most used first, with a search and a full list. Two
  shelves, Patterns and Books, by the tag `book` (a file of several patterns:
  given by Describe with its length, and every EPUB). A dropped file is sent
  raw (upload_pattern). A pattern whose file has gone missing says so, with
  Find it….
- **Describing with a model:** off unless switched on; a robot icon; only the
  first pages are sent; a run over the library keeps going in the background,
  behind a panel that minimises and closes.
- **Reading:** PDF and EPUB, zoom (remembered per pattern), turning a page,
  contents, bookmarks, search, links, highlight line, row counter with named
  counters and your own keys, highlights, notes, drawings, pins (brought to
  the front when pressed or shown from their chip). Pages: a page fitted
  whole, turned by keys, ‹ › or a swipe. A light reader theme (☀ / ☾).
  Beside…: another pattern next to this one. Marks moved and resized with
  Select; an eraser (⌫) that splits a stroke; typed text (Aa). Open ↗ in the
  default PDF app. A PDF's page number in the bar ("15 / 19"), clicked to go
  to a page; resized, the pages keep the spot being read. **Save pages…**
  saves chosen pages of a PDF (copied as they are, by pdf-lib) or chapters of
  an EPUB (laid out on A4 as pictures, broken between lines) as a PDF, where
  the Save dialog says. The older raster writer (`export.rs`,
  `save_export_pdf`) is unused, kept for a pages-with-my-marks export if one
  is wanted.
- **Cheatsheets:** a tab of its own: online pages kept to read in the app (in
  a frame, or a window of its own where a site refuses frames), and pages
  from books in the library (a PDF's pages, an EPUB's chapter as a copy).
  Part of a page: a box drawn round the table or chart wanted, as a pin is,
  from the reader (Cheatsheet…, Part of a page…) or in the tab (Crop…);
  stored upright (cheatsheets.region), drawn sharp from the book's file.
  *0.3.69*
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
  rounds fitted to the colourwork's repeat; and a raglan, top-down or
  bottom-up, in the round or flat as a cardigan (bands and buttonholes picked
  up), from a person's measurements and a swatch's blocked gauge (or both
  typed in) with the fit's ease: the numbers, and the steps in words, copied
  or saved to a project's board. A raised back neck in German short rows (the
  raglan and the round yoke), and rib that fits the counts (1x1, 2x2 or any).
  And stitches for a size (fitted to a repeat), increasing or decreasing
  evenly in the round or flat, a pattern re-gauged to yours, and yarns held
  together (the strands' metres per 100 g in, the yarn they make out; from
  the stash too).
- **Colourwork charts:** in the Calculators tab. A standard chart (flat, in
  right- and wrong-side rows, or in the round) or a round yoke's repeat (a
  lopapeysa's), with its decrease rounds, or increase rounds top-down, and the
  squares with no stitch grey. Draw, fill, line, box, pick, mirror, undo; move,
  flip and resize; select (S), copy, cut and paste a block, flipped, into
  another chart too with its colours matched; named colours with a legend and
  symbols, each linkable to a stash yarn; a heavier line every 10; long
  floats underlined. Beside it the chart tiled, or the yoke from above, and
  the rows in words. A gauge gives squares the shape of stitches and the size
  it comes out. Exported as a PNG, or a PDF at the real size (or a square
  size), over several pages if need be; or put on a project's board, and
  knitted from there with the current row marked and counted.
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
  entries and photos (📷, pasted or dropped).
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
  and Frogged; finishing frees them, says what each yarn used and records
  leftovers; a page per project with a cover, dates, a board (pictures
  cropped there: ✂ Crop, or C), the pattern read beside the board
  (resizable, minimises to a tab, its title and details a row above the
  tools), and the pattern's own row counter.
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
  board (open by default) has the line, with the page's counter. The line is
  kept as its page and its box there, so it scrolls with the pattern and
  keeps its row whatever the display, width or zoom; moved by its ●, sized by
  its corner ◢, and moved exactly its own height by every count (keys, + and
  −), the pattern scrolling near the edges. Its "Rows go up the page (a
  chart)" (highlights.reads_up) steps it up for a chart. A count clicks
  (Shelfmind's soft tap, a wood block or a tick). A pin goes onto a project's
  board (board kind "pin", with the pattern and page) from its ⤴ button.
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
