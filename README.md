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

- **[v0.3.0-beta.9](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.9)** —
  the pattern read beside a project's board, and the pattern's row counter on
  the project's page. The one to test.
- **[v0.3.0-beta.8](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.8)** —
  status and tags from a card's ⋯ menu, patterns in progress from their
  projects, paused and frogged projects, and describing with a model only when
  switched on, running in the background. Superseded by `beta.9`.
- **[v0.3.0-beta.7](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.7)** —
  a page and a Miro-like board per project, Inspiration boards, Want to knit by
  choice, pattern covers by paste, finding duplicate patterns, faster big
  libraries, and the settings gear. Superseded by `beta.8`.
- **[v0.3.0-beta.6](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.6)** —
  Projects: needles, hooks, cables and yarn in use, finishing with leftovers
  back in the stash; sets that change connector; pasted yarn photos and a
  weight cheat sheet with cone counts. Superseded by `beta.7`.
- **[v0.3.0-beta.5](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.5)** —
  needle sets in one go, type-or-pick brand and material (any material), and
  choosing needles from the pattern itself. Superseded by `beta.6`.
- **[v0.3.0-beta.4](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.4)** — the
  Needles & hooks tab, the reader brought up to Shelfmind's (pen highlighter,
  pins, zoom, contents, search, links), page rotation, and your own count
  keys. Superseded by `beta.5`.
- **[v0.3.0-beta.3](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.3)** — a
  mark left behind by a window resize, fixed. Superseded by `beta.4`.
- **[v0.3.0-beta.2](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.2)** — the
  reader toolbar, fixed. Superseded by `beta.3`.
- **[v0.3.0-beta.1](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.3.0-beta.1)** — a
  pre-release with bulk add, in-app update checks, and the yarn stash, plus a
  project-wide audit's worth of fixes. Superseded by `beta.2`.
- **[v0.2.0-beta.2](https://github.com/shinystarborne/shiny-knitting/releases/tag/v0.2.0-beta.2)** — an
  earlier pre-release, if a newer one misbehaves.
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

> `v0.3.0-beta.1` had the same toolbar in worse shape: the Highlight button
> was wired to nothing, the row highlight-line's whole band silently stole any
> text-selection drag made near it (exactly where a reader is most likely to
> be highlighting from), and a PDF wider than ~1100px drifted the invisible
> text layer out of alignment with the page under it — worst on a maximized
> window, where it also broke the page's own proportions. `beta.2` fixes all
> three and adds PDF zoom. The installers are versioned `0.3.1`.

> `v0.3.0-beta.2` still left an existing mark stuck exactly where it was drawn
> after the window resized, maximizing included: the page reflowed to a new
> width under it, but nothing told the mark layer to repaint, so a highlight
> ended up sitting over blank pane nowhere near the text it was made on.
> `beta.3` fixes it. The installers are versioned `0.3.2`.

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

**Finding a pattern.** Every card is the same size; a wider window fits more of
them to a row rather than stretching them. The left sidebar filters. Status, difficulty, designer,
needle size, and yarn weight are checkboxes; tags are buttons you can combine.
The search box covers title, designer, notes, and tags.

A large library stays quick: cards are drawn a page at a time as the grid is
scrolled, and a cover is read only when its card is about to come into view.
The stash, needles, projects and inspiration boards work the same way.

**Want to knit.** A pattern starts with no status. Mark the ones you plan to
knit soon with **☆ Want to knit** on the card (click again to take it off), and
the **Want to knit** filter lists just those. Libraries from before this have
the old automatic "Want to knit" cleared once, on the first start, so the list
means something; In progress, Finished and Abandoned are left as they were.

**⋯ on a card** sets the status without opening the pattern — No status, Want
to knit, In progress, Finished or Abandoned, with or without a project — and
opens **Tags…** (add with Enter or a comma, the tags you already use offered as
you type), **Details…**, **Cover…** and **Start a project…**. A pattern goes
**In progress** by itself when a project is started from it or an active
project is given it; patterns that already had an active project catch up once.

**Yarn weight** filters on the standard weight scale — Lace, Fingering, Sport,
DK, Worsted, Aran, Bulky, Chunky, Super chunky, Jumbo — lightest first, with a
count beside each. A pattern states its weight however the designer liked, so
anything from "DK", "8 ply" and "4-ply worsted" through to a bare "100 m/100g", or a cone's "2/28", is read
into the right family. A name always wins over a figure; a figure with no
recognisable unit is left alone rather than guessed at, and a weight nothing
matches is still shown on the card as written. Families you own nothing in are
dimmed rather than hidden, since they still answer "could I knit this in
something I have?".

**Removing a pattern.** Every card has a **Remove** button. It asks first, and
says plainly that the file and its cover go too and that it cannot be undone.

**Duplicates…** in the toolbar finds patterns that are in the library more
than once: identical files, and patterns with the same title (a download's
"(1)" or "copy", case and punctuation ignored) by the same designer or with
one of them unnamed. Each group suggests which to keep — the copy with the most
attached to it: projects, then highlights and pins, rows counted, notes, the
one read last. The extra copies of identical files are ticked for removal from
the start; in a same-name group nothing is, since those may be different
versions or languages. Removing folds each copy into the one kept first: its
projects and board cards move across, its tags are added, and a status, notes,
designer, needle size or yarn weight the kept one lacks are taken from it. Its
highlights, pins and counters go with it.

## Needles & hooks

The **Needles & hooks** tab is everything in your needle box, and what each
thing is on. A card shows the size big, what it is, its lengths, the brand and
material, and either **Free** (green edge) or the project it is on (red edge).

**What can be recorded.** Straight needles, fixed circulars, double-pointed
sets, interchangeable tips, interchangeable cables, and crochet hooks. Each
kind asks only for what it has:

| Kind | Size | Length | Cable length | Cable size |
| --- | :-: | :-: | :-: | :-: |
| Straight, double-pointed, crochet hook | ✓ | ✓ | | |
| Circular (fixed) | ✓ | | ✓ | |
| Interchangeable tips | ✓ | ✓ | | ✓ |
| Interchangeable cable | | | ✓ | ✓ |

Cable size is the connector — **mini, small, standard or large** — which is
what decides which tips fit which cables. A circular's cable length is the
length as sold, tip to tip. Every tool also has a brand, a material and notes.
A double-pointed set is one entry.

**Brand and material** are typed, or picked: **▾** lists the brands already in
your box, and the materials (metal, aluminium, steel, copper, bamboo, wood,
carbon, plastic, plus any you have typed before). Typing narrows the list;
anything not on it — casein, rosewood — is kept as typed and gets its own
filter box. A brand typed in another case ("chiaogoo") is filed under the
spelling you already use.

**Adding a set.** Type several sizes into Size — `2.75, 3, 3.25, 3.5, 4` — and
**Add** makes one entry per size, sharing the kind, length, brand, material and
notes; the button says how many ("Add 5") before anything is added. A comma
between digits with nothing else around it (`3,5`) is read as a decimal comma,
so `3,5` is 3.5 mm. When a set's tips change connector partway — ChiaoGoo's are
small up to 5 mm and large from 5.5 mm — choose **Changes with size…** under
Cable size and say where each connector starts ("From 5.5 mm: Large"; **+ Add a
change** for a third). Each size is stored with its own. A set is added free: its sizes do not share a project, so
"In use for" is hidden while one is typed, and each size goes onto its own
project afterwards.

**Adding a run of them.** **Save and add another** keeps the form filled in, so
needles that differ by more than the size are still quick to enter.

**What it is on.** A tool is in use while an active **project** has it (see
[Projects](#projects)). *In use for* in the form puts it on one; its card shows
the project, and the project's name opens it. **Free it** on the card takes a
tool off its project.

**Filters.** **Free** shows only what is not on a project. There are also
**In use**, kind, size, material, cable size and brand. Boxes in one group widen
the list (4 mm *or* 4.5 mm); different groups narrow it (4 mm *and* free). The
search box matches size ("4mm"), brand, kind, material, project and notes.

## Projects

The **Projects** tab is everything being knitted, and everything finished. A
project has a name, optionally a pattern from your library (a pattern can be
knitted more than once), a start date, notes — and the needles, hooks, cables
and yarn it is made with. **What is on an active project is what is in use**:
the Needles & hooks tab and the stash both say so, and filter on it.

**Starting one.** **+ New project** on the tab, or **+ Start a project** in the
side pane of an open pattern, which fills the pattern in. Choose its needles
and yarn there: free ones first, then those on another project, which are moved
over. A yarn bought in more than one dye lot asks which lot, since that is the
one knitted from and the one its leftover goes back to. Left without a name, a
project takes its pattern's.

**A project's page.** Opening a project — from its card, a needle's card, or
the name in a pattern's side pane — goes to its own page. Down the side: a
**cover** (click the box and paste a picture with `Ctrl`+`V`, drop one on it, or
choose one), the name, the pattern, **Started** and **Finished** dates (the
finished date can be corrected once it is finished), its needles and yarn, and
notes. Everything there saves as it is changed.

The rest of the page is the project's **board**, an endless surface to gather
what it is made of and what it should look like, as on a Miro board:

- **Note** — a sticky note, in five colours; double-click to write
- **Text** — words on the board itself, for headings
- **Link** — a web address, opened in your browser
- **Picture** — chosen, pasted with `Ctrl`+`V`, or dropped from a folder
- **Pattern**, **Yarn**, **Needle** — cards for things already in the app,
  this project's own listed first; a pattern's card opens it
- **Colour** — a swatch, with a name; double-click to change the colour

Drag the board to move around, scroll to pan, `Ctrl`+scroll to zoom; **Fit**
shows everything. Drag an item to move it and its corner to resize it (a picture
keeps its shape unless `Shift` is held); `Delete` removes the one selected, after
asking. Pasting a web address makes a link and pasting words makes a note. New
things go into free space near the middle of the view, and the board remembers
where it was looked at.

**The pattern beside the board.** **📄 Show the pattern here** opens the
project's pattern in a pane beside its board — the whole reader, with marks,
pins, zoom and the row line — so it can be followed while the board is in
view. Drag the pane's left edge to make it wider or narrower; **–** minimises
it to a tab on the right edge, which brings it back where it was; **×** closes
it, and **Open full ↗** opens it on its own. The page remembers how it was
left, and how wide.

**Row counter.** A project with a pattern has the pattern's row counter on its
page: the same counts as in the pattern itself, not a copy, so counting in
either place counts in both. The count keys (J and K unless you chose others)
and each counter's own key work on the page as well — in the pattern beside the
board, or anywhere else on the page except while typing.

**Saved as you go.** The name and notes save a moment after typing stops, and
a note on the board does too, so opening another tab straight away loses
nothing.

**While knitting.** An open pattern's side pane shows its project at the top —
what is on it, and **Needles, yarn, finish…** to change any of it.

**Status.** A project is **Active**, **Paused**, **Finished** or **Frogged**, set
on its page. Paused keeps its needles and yarn in use — the knitting is still on
them — and they can still be changed. Frogging asks first, then frees them as
finishing does, keeping them listed as a record, and its yarn is simply back in
the stash. A frogged project can be started again: it gets back what it had,
except a needle that has gone onto another project since. The Projects tab
filters by all four.

**Finishing.** **Finish project…** releases every needle, hook and cable back to
free, and asks what is left of each yarn: weigh it and type the grams. That
becomes what the lot holds, with a **Leftover** tag in the stash; 0 g is used
up; left empty, the stash stays as it was. It also offers to mark the pattern
Finished. A finished project keeps the list of what it used and what was left,
as a record.

**Removing** a project frees what is on it; the needles and yarn stay. Removing
a pattern keeps its projects, without the pattern.

## Inspiration

The **Inspiration** tab holds boards of their own, not tied to a project: a
colour scheme, a shape of cardigan, next winter's hats. **+ New board** asks
for its name and opens it. A board works like a project's — notes, text, links,
pictures pasted with `Ctrl`+`V` or dropped from anywhere, patterns from the
library, yarn from the stash, and colour swatches — and everything on it,
including its name, saves as it changes. Each board's card shows a few of its
pictures and its colours, newest first, and the boards changed most recently
come first. Removing a board removes what is on it; the patterns and yarn on it
stay where they are.

The gear at the right end of the tab bar opens **Settings**, from any tab.

## Yarn stash

The **Stash** tab (next to **Patterns** at the top) is every yarn you own. A
card shows the name, brand and colourway, the weight, a photo, and what is
left of it: "4 × 100 g · 240 g left · ~528 m". A yarn on an active project says
which ("In use: Gift hat"), and one holding a project's leftover is tagged
**Leftover**; **Availability** down the side filters on Free, In use and
Leftover. A lot's **Leftover** box can also be ticked or cleared by hand.

**Another colour of the same yarn** is quick: **+ Colour** on a card opens a new
yarn with its brand, name, weight and ball band filled in, so only the
colourway is typed; each colour is its own card. In the form, **Brand** and
**Name** are typed or picked — **▾** lists the brands and yarns already in the
stash (a chosen brand narrows the names) — and picking a name you have fills in
the rest of that yarn, leaving anything already typed alone. A name or brand
typed in another case files with the one already there.

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

**A photo** can be chosen, pasted with `Ctrl`+`V` — a picture copied from a
shop's page, or a screenshot — or dropped on the photo box. It is downscaled in
the app before it is stored, as covers are. Removing a yarn asks first and takes
its photo with it.

**Yarn weight.** **Weights ?** beside the field opens a cheat sheet: each weight
with its metres per 100 g, its other names, and the needles it is usually knitted
on. Fill in metres and grams per ball and the weight is filled in for you ("175 m
/ 50 g = 350 m/100 g: Sport"); a weight you type yourself is kept, with the
figures' weight said beside it if they disagree. **Cone yarn** can be given by its
count: `2/28` is two strands of 28 m to the gram, 1 400 m/100 g, a lace weight;
`2/2800` gives the single strand per 100 g and is the same yarn. With the cone's
grams filled in, its metres are worked out too.

Ply counts follow the UK and Australian names Ravelry uses: 2 ply lace, 3–4 ply
fingering, 5 ply sport, 8 ply DK, 10 ply worsted, 12 ply bulky, 14 ply chunky. A
family name wins over a ply count, so "4-ply worsted" is worsted.

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
| `J` / `K` | **count a row up / down** — and, with the line on, move it a whole band |
| `Shift`+`J`/`K` | counts the row without moving the line |
| `Alt`+`J`/`K` | moves the line a whole band without counting |
| `↓` `→` | count a row (`Shift` for +10) |
| `↑` `←` | uncount a row (`Shift` for −10) |
| `PageDown` / `PageUp` | scroll the pattern under a stationary line |
| `+` / `-` | count ±1 (`Shift` for ±10) |

Every one of those counting keys is the same single action: the project total
plus every counter that is switched on.

**Choosing your keys.** `J` and `K` are only the starting keys. Under **Keys** in
the counter panel, click the key beside *Count up* or *Count down* and press the
one you want instead. A counter can also have a key of its own: its **Key**
button takes one the same way, and that key then works like the counter's own
`+` (with `Shift`, its `−`), whether or not the counter is switched on. A key
already in use is refused with what it is used for, so one key never does two
things; `Escape`, `Tab`, `PageUp`/`PageDown` and the modifier keys cannot be
chosen. **Clear** takes a counter's key away, or puts *Count up*/*Count down*
back to `J`/`K`. Keys are matched by their place on the keyboard, so they work
the same with `Shift` held and on any keyboard layout. The choices are saved.

The count keys are the ones for working through a schematic. Set the line's
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
pattern scrolls beneath it. It is **off** until you want it: press **Line** and
tick *Show line*. While it is off the count keys just count, and the page
stays where it is.

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
thickness is also the height of one row for the count keys, which is what ties
the line to the counter. Existing patterns still on the old 90% default are moved
over on first launch, and any opacity you have set deliberately is left alone.
Likewise, a line that was only ever on because it used to start on is switched
off once on first launch; one you have adjusted in any way is left showing.

**Layout.** "Split view" puts the counter, notes, and tags beside the pattern.
"Focus view" gives the pattern the full width; a "Counter" button brings the
panel back for a quick check.

**Updates.** **Settings → Updates** shows the version you have and checks for a
newer one on request. Tick **Include beta releases** to be offered pre-releases
as well as stable ones; a beta build is always offered the next beta, ticked or
not, since otherwise it would have nowhere to go. With **Check automatically on startup** on, a quiet
check runs once a day and an **Update available** button appears beside the
settings gear only when there is something new. Click it (or **Update now** in
Settings) and, after one question, the app downloads the new version, closes,
updates itself in place — a small progress window, nothing to click, no
uninstalling — and opens again. Your library is untouched. This works from the
version that brought it onwards; updating *to* it still goes through the old
installer once.

Your place in the document is saved as you scroll, so reopening a pattern
returns you to the same page and position.

A PDF opens fit to the width of the pane. `+`/`-`/fit buttons in the reader
bar zoom it further, as do `Ctrl` + `=`/`-`/`0` and `Ctrl`+scroll-wheel; past
the width of the window it scrolls sideways as well as down. An EPUB reflows
to the pane instead, so there is nothing to zoom.

**Turning a page.** A chart printed sideways to fit can be turned the right way
up: **⟳** turns the page taking up most of the pane a quarter turn clockwise,
and `Shift`-click turns it back. Only that page turns, and it stays turned the
next time you open the pattern. Marks, pins, search and links all turn with it,
and a mark made on a turned page is still in the right place if you turn the
page back.

**Contents and bookmarks.** **📑** opens a panel with the PDF's own table of
contents (an EPUB's chapters), and a **Bookmarks** tab. **🔖** bookmarks the
page in view in one click; rename a bookmark in the panel, or remove it with
its ✕. Click any entry to go there.

**Search.** **🔎** or `Ctrl`+`F` searches the PDF's text: `Enter`/`Shift`+`Enter`
or ▲/▼ step through the matches, which are marked on the page, and `Escape`
closes it. A PDF made of scanned pictures has no text to search, and says so.

**Links** in a PDF work with **Select** (➤): one inside the document jumps to its
page, and a web or email link opens in your browser rather than in the app.

## Marking up a pattern

Four tools, as icons in the bar above the reading area. **Select** (➤) is the
default, so reading and tidying up need no tool chosen at all.

- **Select** (➤) — click a note to open it and change the wording, or click a
  highlight or drawing to be offered its removal. Nothing is deleted without
  asking.
- **Highlighter** (🖊) — drag over the page like a highlighter pen: a broad,
  see-through band in the current colour, over text or over a chart alike.
  It scales with the page, so it stays on the same rows at any zoom.
- **Note** (🅣) — click anywhere to drop a note. Clearing the text and saving
  removes the note rather than leaving an empty dot behind.
- **Draw** (✏️) — a thin pen, freehand, over charts and diagrams.

The colour wheel picks the colour for both pens. **Undo** (↶) removes the last
mark made; **Clear** (🗑) removes every mark on the pattern, after asking once.
Both grey out when there is nothing to act on.

Every mark belongs to the page it was made on and moves with that page as you
scroll, zoom or resize the window. It is remembered as a position on the page,
so on a **PDF**, whose pages never change, it stays exactly where you put it.
An **EPUB** reflows when the window changes width, and a stroke drawn over its
text is not moved with the words — the same as a drawing.

## Pins

A pin keeps a picture of part of a page somewhere you can see it while you work,
which is the point: a chart you have to keep scrolling back to is no help.

Press **Pin** (📌) and drag a box around anything — a chart, a stitch diagram,
a run of instructions you will refer to again. Pin mode ends after each box;
press 📌 again for the next one. Up to **5** per pattern; the button greys out
at the limit and says so.

Each pin gets a numbered chip next to the 📌 button. Click a chip to show or
hide that pin; hover it and click its ✕ to remove the pin. A shown pin is a
panel you can:

- **drag** by its header, anywhere over the reading pane
- **zoom** with its − and + buttons
- **resize** from its bottom-right corner

The panel is drawn straight from the PDF, so it stays as sharp as the page at
any size. Panels stay where you put them — including across closing the
pattern. Hover a panel's header to see the words under its crop.

Pins are for **PDFs**. An EPUB's text is reflowed and rewrapped by the window it
is shown in, so there is no fixed region of the page to cut, and the Pin button
says so rather than offering something that is subtly not what you pointed at.

## Covers

A new pattern gets a cover automatically, in the background: the first page of
a PDF, or the cover image an EPUB declares (checking the EPUB 3
`cover-image` property, the older `<meta name="cover">`, then any image with
"cover" in its name). Everything is downscaled and stored as a JPEG under
`library/covers/`.

Hover a card and press **Cover…** (or **Change cover…** in the pattern's
details) to change it:

- **Paste** — `Ctrl`+`V` while the dialog is open uses the picture on the
  clipboard, such as a shop's photo copied with *Copy image*.
- **Drop** a picture file on it, or **Choose a picture…** from disk.
- **Read from the pattern** — take the cover from the file again, discarding
  whatever you had.
- **Remove** — leave the placeholder.

The **Covers** button in the toolbar adds a cover to every pattern that is
missing one, which is useful for a library that predates the feature.

## Filling in details with a model

It is **off unless you switch it on**: **Settings → Describe patterns with a
model**. While it is off there is no robot anywhere and nothing is ever sent;
the model's own settings appear once it is on.

The **robot** in the patterns toolbar reads the front of each pattern and fills
in what it can; the robot in an open pattern does the same for just that one and
shows you a before/after table. A run over the library carries on while you use
the rest of the app: its panel can be minimised to a small bar, or closed, which
leaves a robot and the count beside the settings gear to bring it back. **Stop**
ends it after the pattern being read. Cards update one by one as it goes.

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
  main.ts              app shell: the tab bar, swapping library, projects, inspiration, stash, tools and reader
  api.ts               typed wrapper over the Tauri commands
  covers.ts            cover and yarn-photo extraction, downscaling, storage
  annotations.ts       mark coordinates, quote anchoring, rectangle merging
  views/
    library.ts         search, filters, covers, scanning
    stash.ts           the yarn stash: cards, quantities, the weight filter
    tools.ts           needles and hooks: cards, filters, Free it
    tool-form.ts       add/edit needle or hook dialog
    tool-filter.ts     filtering, facet counts and naming for needles and hooks
    tool-picker.ts     choosing a project's needles: side pane and Details
    combo.ts           a field you can type in or pick from
    projects.ts        the projects tab
    project-form.ts    a project: its pattern, needles and yarn
    finish-project.ts  finishing one: releasing needles, recording leftovers
    project-page.ts    a project's own page: cover, details, and its board
    board.ts           a board: notes, pictures, links and cards, laid out freely
    inspiration.ts     the inspiration tab and its boards
    lazy.ts            long grids, painted a page at a time with pictures read on sight
    cover-dialog.ts    changing a pattern's cover: paste, drop, choose, read again
    duplicates.ts      finding duplicate patterns and folding them into one
    tags-dialog.ts     editing a pattern's tags from its card
    yarn-picker.ts     choosing a project's yarn, and its lot
    yarn-weight.ts     the weight table and cheat sheet, mirroring yarn.rs
    pattern-form.ts    add/edit pattern dialog
    yarn-form.ts       add/edit yarn dialog, with lots and a photo
    settings.ts        updates and model settings, with the privacy notice
  ai/
    scan.ts            running a scan, and undo
    describe-run.ts    a run over the library that keeps going in the background
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
    project-panel.ts   the pattern's project, in the side pane
src-tauri/src/
  db/                  schema, queries, counter arithmetic, and their tests
  ai/                  the model client, prompting, parsing, and merge rules
  covers.rs            cover file storage and validation
  commands.rs          the commands exposed to the frontend
  models.rs            shared types
  yarn.rs              the standard yarn weight table, and reading a weight
  tools.rs             needles and hooks: what each kind keeps, and the commands
  projects.rs          projects: starting, finishing, and what puts things in use
  annotations.rs        storing and editing marks
```

Agreed but not yet built — PDF export, the rest of the Shelfmind reader, and the native file
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

