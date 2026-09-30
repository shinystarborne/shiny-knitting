# Shiny Knitting

A desktop app for reading knitting patterns, built for Windows with Tauri.

It does five things:

- **Keeps your patterns in one place.** Add a PDF or EPUB and it is copied into
  the app's own library, so the file never moves or gets lost.
- **Finds them again.** Filter by status, designer, difficulty, needle size, or
  tags, and search titles, designers, and your notes.
- **Counts rows.** A project total for the whole piece, plus a per-section
  counter for working through a repeat like "row 7 of 12".
- **Gives you a highlight line.** A movable line you can drag, click, or nudge
  with the keyboard, useful for tracking your place in a chart.
- **Adds covers and fills in the details.** Every pattern gets a cover taken
  from its own file, and a language model can read the front of a pattern and
  fill in the designer, difficulty, needle size, yarn, and tags.

## Releases

Installers are on the [releases page](https://github.com/shinystarborne/shiny-knitting/releases):

- **[v0.3.0-beta.1](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.1)** — a
  pre-release with bulk add, in-app update checks, and the yarn stash, plus a
  project-wide audit's worth of fixes. The one to test.
- **[v0.2.0-beta.2](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.2.0-beta.2)** — the
  previous pre-release, if the new one misbehaves.
- **[v0.1.0](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.1.0)** — the
  last stable release.

Each has an `.exe` (installs per user, no administrator rights) and an `.msi`.
Both install to the same place, so running the older one afterwards puts you
back on it. Your library lives in `%APPDATA%\com.shiny.knittingapp\` and is
untouched by either.

> `v0.2.0-beta.1` was broken: the marking toolbar did nothing, because every
> tool asked the browser for a dialog and a Tauri window has none. `beta.2` is
> the fixed build. The installers are versioned `0.2.1` so Windows treats it as
> an upgrade rather than a reinstall of the same version.

## Requirements

Building from source needs:

- Node.js 20 or newer
- Rust (stable) — <https://rustup.rs>
- Visual Studio 2022 Build Tools with the C++ workload
  (`winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`)

You do **not** need these to run a built installer.

## Getting started

```bash
npm install
npm run app          # dev, with hot reload
npm run app:build    # produce an installer in src-tauri/target/release/bundle
```

`npm run app` needs the MSVC environment on your PATH. If `link.exe` is not
found, open a **Developer PowerShell** or run this first in your shell:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
```

## Where your data lives

Everything is under `%APPDATA%\com.shiny.knittingapp`:

```
library.db        SQLite database: metadata, notes, counters, highlight settings
library/originals/  your imported PDF and EPUB files
```

Back up that one folder and you have backed up the whole app.

## Using it

**Adding a pattern.** "Add pattern", then drop a PDF/EPUB onto the box or press
**Browse for a file…**. The title is pre-filled from the filename; edit it and
fill in designer, tags, and needle size while you are there. Browse is the
faster of the two for anything sizeable: it hands the app a path and the file is
copied on the Rust side, whereas a dropped file's contents have to travel across
the app boundary, which is slow for a PDF of any size.

**Add folder…** adds a whole folder at once: every PDF and EPUB under it,
subfolders included, is copied in with its title taken from the file name. A
progress panel lists each file as it lands and can be stopped partway; anything
already added stays. Files already in the library are skipped — duplicates are
recognised by content, not name — and the panel ends with a count of what was
added, skipped, and could not be read.

**Finding a pattern.** The left sidebar filters. Status, difficulty, designer,
needle size, and yarn weight are checkboxes; tags are buttons you can combine.
The search box covers title, designer, notes, and tags.

**Yarn weight** filters on the standard weight scale — Lace, Fingering, Sport,
DK, Worsted, Aran, Bulky, Chunky, Super chunky, Jumbo — lightest first, with a
count beside each. A pattern states its weight however the designer liked, so
anything from "DK" and "4-ply worsted" through to a bare "100 m/100g" is read
into the right family. A name always wins over a figure; a figure with no
recognisable unit is left alone rather than guessed at, and a weight nothing
matches is still shown on the card as written. Families you own nothing in are
dimmed rather than hidden, since they still answer "could I knit this in
something I have?".

**Removing a pattern.** Every card has a **Remove** button. It asks first, and
says plainly that the file and its cover go too and that it cannot be undone.

## Yarn stash

The **Stash** tab (next to **Patterns** at the top) is every yarn you own. A
card shows the name, brand and colourway, the weight, a photo, and what is
left of it: "4 × 100 g · 240 g left · ~528 m".

**Partial balls are weighed, not guessed.** Put the grams left on a lot and
the metres left are worked out from the ball band (metres per ball ÷ grams
per ball × grams left), so a half-used ball counts as what it actually is.
When the per-ball figures are unknown the metres line simply stays off rather
than being invented.

**Lots are first-class.** The same yarn bought twice is two lots, because dye
lots differ between purchases and mixing them shows in the knitting. Each lot
keeps its dye lot, balls, grams left, where it lives, and when it was bought;
a yarn's totals add up over all of them. A new yarn starts with one empty lot
row, and the **+ Add lot** button adds another.

The weight filter down the side is the same standard scale the library
filters patterns on — Lace through Jumbo, with a count beside each — so
"could I knit this in something I have?" reads off one table. Families you
own nothing in are dimmed rather than hidden.

A photo can be chosen in the add/edit form; it is downscaled in the app
before it is stored, as covers are. Removing a yarn asks first and takes its
photo with it.

**The row counter.** One total, and any number of named counters.

- ***Project total*** — every row you finish, across the whole project. It
  **always** counts. There is no way to switch it off, and nothing any counter
  does can stop it.
- ***Counters*** — named places counted separately: a front, a sleeve, a
  collar, a 12-row lace repeat. Each keeps its own count and its own target,
  and each has a dot that switches it on or off.

The dot is the whole idea. A counter that is **on** moves whenever rows are
counted; one that is **off** keeps its count and stops moving. Several can be
on at once, so working two sleeves alternately advances both from the same rows.
Counters never affect each other — one reaching its target leaves the others
alone — and a counter sitting on its target does not hold the total back, so
the two numbers can never quietly disagree.

Each counter has its own `−`/`+` for nudging it on its own, which is how you
check a count against the pattern without counting a project row. Tick
*own* on a counter to have its own buttons leave the project total alone, for a
cast-on or a setup row.

There is a **click** on every count, like a mechanical counter, because the
sound tells you the press registered without looking away from the needles. The
`♪` button beside the counter's title turns it off; the choice is remembered.
It is synthesised, so there is no sound file in the installer.

Everything is saved as you go and survives closing the app.

Keyboard, while the reader has focus:

| Key | Action |
| --- | --- |
| `J` / `K` | **one row down / up** — moves the line a whole band *and* counts it |
| `Shift`+`J`/`K` | counts the row without moving the line |
| `Alt`+`J`/`K` | moves the line a whole band without counting |
| `↓` `→` | count a row (`Shift` for +10) |
| `↑` `←` | uncount a row (`Shift` for −10) |
| `PageDown` / `PageUp` | scroll the pattern under a stationary line |
| `+` / `-` | count ±1 (`Shift` for ±10) |

Every one of those counting keys is the same single action: the project total
plus every counter that is switched on. There is deliberately no key that moves
just one counter — that is what a counter's own buttons are for, and a keyboard
route to one would make it too easy to move a number without the others.

`J` and `K` are the ones for working through a schematic. Set the line's
thickness to the on-screen height of one chart row and each press lands on
exactly the next row — a line covering 0–5px moves to 5–10px, then 10–15px —
and the project total follows, so a row is marked and counted in one press. The
reader bar shows which row the line is on.

Two deliberate choices: the **project total** is the counter that moves, not any
one named counter, because the line tracks a position in the document and the
total counts rows worked — the same kind of quantity. A counter is a named part
of that work, so the enabled ones follow it and the disabled ones do not. And
the line is free to be dragged anywhere; only the keys snap to the band grid, so
a precise position is still available when you want one.

**The highlight line.** It sits over the reading area and stays put while the
pattern scrolls beneath it.

- Drag it to move it; drag the round handle for a precise grab.
- Click anywhere in the pattern to park it there.
- `Shift`+`↑`/`↓` moves the line itself, `PageUp`/`PageDown` scroll the
  pattern under a stationary line.
- Double-click the line, or press "Line", to open its settings: height on
  screen, thickness, width, side margin, colour, opacity, and whether movement
  is smoothly animated.

Every setting is remembered per pattern, so a wide chart and a text page can
each keep their own geometry. Turning width to 0 makes the line span the
column.

The line starts at 30% opacity, which is faint enough to read the pattern
straight through it. Thickness goes from 1px to 600px, and the number box beside
the slider takes an exact value: a highlight is often meant to mask a block of
chart legend or a run of instructions, not just mark off a single row. That
thickness is also the height of one row for the `J`/`K` keys, which is what ties
the line to the counter. Existing patterns still on the old 90% default are moved
over on first launch, and any opacity you have set deliberately is left alone.

**Layout.** "Split view" puts the counter, notes, and tags beside the pattern.
"Focus view" gives the pattern the full width; a "Counter" button brings the
panel back for a quick check.

**Updates.** **Settings → Updates** shows the version you have and checks for a
newer one on request. Tick **Include beta releases** to be offered pre-releases
as well as stable ones. With **Check automatically on startup** on, a quiet
check runs once a day and an **Update available** button appears in the library
toolbar only when there is something new. Downloading fetches the installer and
runs it for you; your library is untouched.

Your place in the document is saved as you scroll, so reopening a pattern
returns you to the same page and position.

## Marking up a pattern

Four tools, in the bar above the reading area. **Select** is the default, so
reading and tidying up need no tool chosen at all.

- **Select** — click a note to open it and change the wording, or click a
  highlight or drawing to be offered its removal. Nothing is deleted without
  asking.
- **Highlight** — select some text and it is marked in the current colour.
  `H` does the same without leaving the keyboard.
- **Note** — click anywhere to drop a note. Clearing the text and saving
  removes the note rather than leaving an empty dot behind.
- **Draw** — freehand, over charts and diagrams. Per page.

The colour button picks the highlight colour.

On a **PDF**, a mark is remembered as a rectangle on its page, because the page
does not move. On an **EPUB**, the text does move — a wider window, a different
font — so a mark is remembered as *which* passage it was made on: the words
themselves, and which time round they appear if the same phrase occurs more
than once. A highlight therefore stays on the words you made it on when the
chapter rewraps, instead of drifting to wherever that text used to be.

## Pins

A pin keeps a picture of part of a page somewhere you can see it while you work,
which is the point: a chart you have to keep scrolling back to is no help.

Choose **Pin** and drag a box around anything — a chart, a stitch diagram, a run
of instructions you will refer to again. Up to **5** per pattern; the button
greys out at the limit and says so. Each pin becomes a card you can:

- **drag** by its title bar, anywhere over the reading pane
- **resize** by the corner grip
- **rename** by clicking its title
- **hide** and bring back, without losing it
- **remove** with the ×

Cards stay where you put them — including across closing the pattern — and a new
one arrives clear of the last, so five pins do not land on the same spot. A card
is named after the words under its crop, cut to fit.

Pins are for **PDFs**. A PDF page is a picture, so a crop is real pixels. An
EPUB's text is reflowed and rewrapped by the window it is shown in, so there is
no fixed region of the page to cut, and the Pin button says so rather than
offering a card that is subtly not what you pointed at.

## Covers

A new pattern gets a cover automatically, in the background: the first page of
a PDF, or the cover image an EPUB declares (checking the EPUB 3
`cover-image` property, the older `<meta name="cover">`, then any image with
"cover" in its name). Everything is downscaled and stored as a JPEG under
`library/covers/`.

Hover a card to change it:

- **Image** — pick your own picture, from anywhere on disk.
- **From file** — read the cover out of the pattern again, discarding whatever
  you had.
- **×** — remove it, leaving the placeholder.

The **Covers** button in the toolbar adds a cover to every pattern that is
missing one, which is useful for a library that predates the feature.

## Filling in details with a model

**Describe** in the toolbar reads the front of each pattern and fills in what
it can. **Describe** on a single pattern does the same for just that one and
shows you a before/after table.

The model is configured under **Settings**, and there is no provider list: any
model serving an OpenAI-compatible API works, which covers Ollama, LM Studio,
vLLM, llama.cpp, LocalAI, and hosted services alike. Point it at the address
and press **Test connection** to list the models it offers. The `/v1` is added
for you if you leave it off.

The dialog says whether the address is on your own network or out on the
internet, and whether anything would be sent there. Only the start of each
pattern is ever sent — roughly the first page or two, adjustable under *More
options* — because gauge, size, and materials are all at the front, and a
pattern's instructions are not the app's business.

An API key is optional (a local model rarely needs one) and is stored encrypted
with Windows DPAPI, so it can only be read back by your Windows account.

**Scanned patterns are read from their pictures.** A great many knitting
patterns are scans or phone photographs, where the page is an image and there is
no text to extract at all. When the text comes back empty, the first three pages
are rendered and sent as images instead, and the model is asked to describe what
it can see — the designer, needle size, yarn, and difficulty off the front page.
This needs a model that accepts images; if yours does not, the app says so
plainly rather than reporting a bare error. The prompt insists on transcribing
only what is actually legible, so an unreadable detail comes back empty rather
than guessed.

**Results are saved automatically**, and each affected card grows an **Undo
model change** button. By default a scan only fills fields that are still empty,
so it will not overwrite your own wording; turn that off under *More options* if
you want a scan to replace it.

Two settings worth knowing about, both under *More options*:

- **Reasoning effort** — a reasoning model can spend its entire reply budget
  thinking and return an empty answer. Lower effort is faster, cheaper, and
  more reliable for this task.
- **Include patterns that already have metadata** — off by default, so a second
  scan does not repeat work you have already reviewed.

## Project layout

```
src/
  main.ts              app shell: the tab bar, swapping library, stash and reader
  api.ts               typed wrapper over the Tauri commands
  covers.ts            cover and yarn-photo extraction, downscaling, storage
  annotations.ts       mark coordinates, quote anchoring, rectangle merging
  views/
    library.ts         search, filters, covers, scanning
    stash.ts           the yarn stash: cards, quantities, the weight filter
    pattern-form.ts    add/edit pattern dialog
    yarn-form.ts       add/edit yarn dialog, with lots and a photo
    settings.ts        updates and model settings, with the privacy notice
  ai/
    scan.ts            running a scan, and undo
    excerpt.ts         pulling a short excerpt, or page images for a scan
  reader/
    reader.ts          reading screen, layout, key bindings
    pdf.ts             PDF rendering via pdf.js, continuous scroll
    epub.ts            EPUB unpacking and chapter rendering
    highlight.ts       the movable highlight line and its row grid
    counter.ts         the project total and the named counters
    click.ts           the mechanical-counter click, synthesised
    marks.ts           highlights, notes, drawings, and the note editor
    pins.ts            cropping part of a page, and the floating cards
src-tauri/src/
  db/                  schema, queries, counter arithmetic, and their tests
  ai/                  the model client, prompting, parsing, and merge rules
  covers.rs            cover file storage and validation
  commands.rs          the commands exposed to the frontend
  models.rs            shared types
  yarn.rs              the standard yarn weight table, and reading a weight
  annotations.rs        storing and editing marks
```

Agreed but not yet built — bookmarks, the index, PDF export, and the native file
drop — are written down in [TODO.md](TODO.md), along with the traps worth
remembering about this codebase.

## Notes on the design

PDFs and EPUBs render as one continuous scroll rather than discrete pages,
because chart rows and instructions often straddle a page break, and a single
scroll surface makes the highlight line behave predictably.

The highlight line is a fixed overlay rather than something drawn inside the
document, which is what lets it stay stationary while content moves under it.
Its position is stored as a fraction of the viewport height, so it survives
resizing the window and changing page zoom.

EPUB chapters render into sandboxed iframes with stylesheets and images
inlined as data URIs, and with scripts stripped: a pattern book has no need to
run code, and this keeps a downloaded file from doing anything unexpected.

Row arithmetic lives in the database layer, not in the UI, and one counting
action is one transaction. The total and the enabled counters are written
together or not at all, because a half-applied count is worse than a failed
one: the numbers would disagree about what has been worked, with nothing to say
which is right. The clamping rules live there too, so the client never
reimplements them and drifts.

A pattern's yarn weight is stored twice: as the designer wrote it, and as the
family it falls into. Only the family is filtered on, and it is re-derived on
every write rather than being asked for, so there is one thing to enter and
correcting a weight also corrects what it filters under. Deriving it in SQL
would mean either a fuzzy match per row or a scan of the whole table.

A PDF's first paint is deliberately **not** awaited before the reader builds
its tools. pdf.js yields between chunks of a page paint on
`requestAnimationFrame`, and rAF is paused whenever the window is hidden or
minimised, so awaiting the paint meant that opening a pattern while the window
was in the background left the reader pending forever — no counter, no highlight
line, and no retry once the window came back. Painting is progressive anyway:
the pages that are visible start immediately and the rest follow on scroll.

File contents move across the app boundary as raw binary, not as JSON arrays of
numbers. A `Vec<u8>` argument is serialised one number per byte and then built
and parsed on both sides, which for a 20 MB pattern is tens of megabytes of
digit soup and was slow enough that adding a PDF looked like a hang. Reading
uses a raw response payload; adding a file uses the path the native dialog
returns, so nothing crosses the boundary at all. Drag and drop still sends
bytes, because a dropped file is only ever handed over as contents.

The screen element owns the layout chain — it is the flex item carrying
`min-height: 0` that lets a height reach a scrolling pane. Views render into a
child of it and must never overwrite its class: when one did, the document grew
to its full length instead of scrolling, the wheel did nothing, and every
functional test still passed. `harness/layout-checks.js` guards it now.

The model client is one OpenAI-compatible endpoint rather than a set of named
providers, because every server worth using exposes the same two routes. A
model's reply is never trusted: the JSON is found by scanning for the first
balanced object, each field is validated on its own, and an unrecognised
difficulty or a malformed tag is dropped rather than stored. An empty reply
from a reasoning model that ran out of budget is reported as exactly that,
instead of surfacing as a parsing failure.

## Development helpers

```bash
python make-fixtures.py         # sample PDF and EPUB in fixtures/
python make-long-fixture.py     # a 40-page PDF, for scrolling behaviour
python make-scan-fixture.py     # a 3-page PDF with no text layer at all
python make-icon.py             # regenerate src-tauri/icons/
python check-ai.py              # exercise the model client against a live server
python check-export.py          # verify a written export PDF with pypdf, an independent parser
```

`make-fixtures.py` writes a two-page PDF with a chart grid and a three-chapter
EPUB that declares a cover image, so you can exercise both readers and cover
extraction without hunting for real patterns. The generated files are written
to `fixtures/` and copied into `public/fixtures/` for the test harness. `make-long-fixture.py` writes a
40-page pattern, which is what you want when testing scrolling, page-height
reservation, and restoring your place. `make-scan-fixture.py` writes a PDF whose
pages are pure images with no text layer, which is the only way to reach the
AI's picture fallback. `check-ai.py` sends the real prompt to the configured
server and shows what would be stored.

### Tests

```bash
cd src-tauri && cargo test     # data layer: filters, row arithmetic, storage
npm run typecheck               # (npx tsc --noEmit) the frontend
```

The Rust tests cover the parts where a silent mistake would be costly: counter
counting and clamping, what a counter on its target does to the total, counters
that are switched off, several counters on at once, the section-to-counter
migration with a database shaped the way a real one would be, tag matching, and
reading-position storage.

### Browser harness

The Tauri window is hard to drive from a terminal, so the UI can also be run in
an ordinary browser against a stubbed IPC layer:

```bash
npx vite --config harness/vite.harness.config.ts   # then open localhost:1421/harness/index.html
```

`harness/stub.js` implements every Tauri command against an in-memory store and
serves the fixture documents, so the real frontend code can be exercised
end to end — both readers, the counter, the highlight line, and every filter —
without a build or a window.

Run the same UI as a minified production bundle, which is where a problem that
only appears after optimisation is reproducible without building the app:

```bash
npm run harness:build
npm run harness:serve       # then open localhost:1422/harness/index.html
```

`harness/layout-checks.js` asserts the app shell's layout survives: that the
screen element still carries its own class, that no ancestor has outgrown the
window, and that a pane with more content than fits actually scrolls. It is
loaded by both harness pages, and `window.__layoutChecks()` runs the same
checks on demand so a test driver can assert on the result.

`harness/row-checks.js` does the same for the highlight line's row grid, via
`window.__rowChecks()`. The band arithmetic is a pure function, so the edges —
row one being reachable, the last band fitting, a line dragged off the grid —
are checked directly rather than by pressing keys and reading the DOM.

`harness/annotation-checks.ts` covers marks, via `window.__annotationChecks()`.
It checks the coordinate mapping both ways, that a quote saved against one
occurrence is redrawn over the words it was made from, and that a passage which
has ended up outside the visible box is dropped rather than clamped onto the
page edge, and that a crop is named after the words inside it rather than a
neighbouring paragraph.

`harness/bulk-add-checks.js` covers Add folder…, via `window.__bulkAddChecks()`.
It seeds a fake folder through the stub, clicks the real button, and asserts
which patterns land and what the summary says — including a second run over the
same folder being all skips, and Stop ending a long run early.

`harness/update-checks.js` covers the in-app update check, via
`window.__updateChecks()`. It drives the real Settings dialog: the up-to-date,
available, and failed cases of a manual check, the beta tick reaching the
backend unsaved, a download ending in the installer being started, the startup
notice appearing only when a release is seeded, and the settings surviving a
save and reopen.

`harness/yarn-stash-checks.js` covers the stash tab, via
`window.__yarnStashChecks()`. It drives the real UI: the tab switch there and
back (re-running the layout checks after it), the seeded cards' derived
quantities, adding a yarn through the real form, editing a lot's weighed grams
and watching the metres line move, the weight-family filter, adding a second
dye lot, and a removal staying removed across a tab round trip.

Together that is 117 checks: 7 layout, 13 row, 58 annotation, 8 bulk add,
11 update, 20 yarn stash.

`harness/run-checks.mjs` drives every suite from a terminal: serve the built
harness (`npm run harness:build && npm run harness:serve`), start Chrome with
`--headless=new --remote-debugging-port=9222`, and `node harness/run-checks.mjs`
prints every check's result and any page errors the stub collected.

