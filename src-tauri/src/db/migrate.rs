//! Brings a library's database up to date: each step makes what is missing
//! and changes nothing that is already there, so all of them run on every
//! launch, in order. A new step goes at the end of STEPS.

use rusqlite::{params, Connection, OptionalExtension};

use super::*;
use crate::models::AppResult;

/// The steps, in the order they run. Each can run again on a library already
/// up to date and do nothing; the ones that must happen once keep a flag in
/// app_settings.
pub(super) const STEPS: &[(&str, fn(&Connection) -> AppResult<()>)] = &[
    ("board_items_to_boards", board_items_to_boards),
    ("create_tables", create_tables),
    ("sections_into_counters", sections_into_counters),
    ("pattern_cover_and_hash", pattern_cover_and_hash),
    ("yarn_weights_and_needle_sizes", yarn_weights_and_needle_sizes),
    ("highlight_opacity_once", highlight_opacity_once),
    ("counter_and_yarn_columns", counter_and_yarn_columns),
    ("project_plan_columns", project_plan_columns),
    ("used_up_zoom_and_bin_columns", used_up_zoom_and_bin_columns),
    ("highlight_place_columns", highlight_place_columns),
    ("lot_leftover_column", lot_leftover_column),
    ("drop_empty_ball_bands", drop_empty_ball_bands),
    ("lot_weighed_column", lot_weighed_column),
    ("move_tools_into_projects", super::move_tools_into_projects),
    ("shop_and_wish_columns", shop_and_wish_columns),
    ("log_backfill_once", log_backfill_once),
    ("person_wish_and_cover_columns", person_wish_and_cover_columns),
    ("tool_connectors", tool_connectors),
    ("masterclass_first_part", masterclass_first_part),
    ("project_tool_tips", project_tool_tips),
    ("prices", prices),
    ("pattern_size_column", pattern_size_column),
    ("tool_prices_and_sets", tool_prices_and_sets),
    ("abbreviations", crate::abbreviations::migrate),
    ("goals", crate::goals::migrate),
    ("chart_pictures", crate::chart_pictures::migrate),
    ("crochet", crate::crochet::migrate),
    ("knit_time", knit_time),
    ("masterclass_size_region_columns", masterclass_size_region_columns),
    ("epubs_tagged_once", epubs_tagged_once),
    ("pattern_status_once", pattern_status_once),
    ("highlight_off_once", highlight_off_once),
    ("lot_bought_grams", lot_bought_grams),
];

/// Each step in a transaction of its own: one that fails partway (a disk
/// full, a file unreadable) leaves nothing half done -- a table renamed and
/// not refilled, a column added and not backfilled, half a log -- and runs
/// whole again on the next launch, as its column or flag is not there yet.
pub(super) fn migrate(conn: &Connection) -> AppResult<()> {
    for (_, step) in STEPS {
        let tx = conn.unchecked_transaction()?;
        step(&tx)?;
        tx.commit()?;
    }
    Ok(())
}

/// Adds a column when the table has none of that name. ALTER TABLE ADD
/// COLUMN is not idempotent, so it is only issued when the column is truly
/// missing: that is what brings a library made before it up to date.
fn add_column(conn: &Connection, table: &str, column: &str, definition: &str) -> AppResult<()> {
    if !column_exists(conn, table, column)? {
        // Table, column and definition are literals from this file, never user input.
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"), [])?;
    }
    Ok(())
}

/// Board items, once keyed to a project, belong to a board: an older library's are moved across before the tables are made.
fn board_items_to_boards(conn: &Connection) -> AppResult<()> {
    // Board items were first keyed to a project, with a foreign key to it;
    // they now belong to a board, which an inspiration board can be too. A
    // database from before has its items moved across, before the table below
    // is made (its index would not find the new column otherwise).
    if column_exists(conn, "board_items", "project_id")? {
        conn.execute_batch(
            "ALTER TABLE board_items RENAME TO board_items_by_project;
             CREATE TABLE board_items (
                 id          TEXT PRIMARY KEY,
                 board_id    TEXT NOT NULL,
                 kind        TEXT NOT NULL,
                 x           REAL NOT NULL DEFAULT 0,
                 y           REAL NOT NULL DEFAULT 0,
                 w           REAL NOT NULL DEFAULT 220,
                 h           REAL NOT NULL DEFAULT 160,
                 z           INTEGER NOT NULL DEFAULT 0,
                 data        TEXT NOT NULL DEFAULT '{}',
                 image_file  TEXT NOT NULL DEFAULT '',
                 created_at  INTEGER NOT NULL
             );
             INSERT INTO board_items (id, board_id, kind, x, y, w, h, z, data, image_file, created_at)
                 SELECT id, project_id, kind, x, y, w, h, z, data, image_file, created_at FROM board_items_by_project;
             DROP TABLE board_items_by_project;",
        )?;
    }
    Ok(())
}

/// Every table and index there is, made where missing.
fn create_tables(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS patterns (
            id             TEXT PRIMARY KEY,
            title          TEXT NOT NULL,
            designer       TEXT NOT NULL DEFAULT '',
            file_path      TEXT NOT NULL,
            file_name      TEXT NOT NULL,
            format         TEXT NOT NULL,
            status         TEXT NOT NULL DEFAULT '',
            difficulty     TEXT NOT NULL DEFAULT '',
            needle_size    TEXT NOT NULL DEFAULT '',
            needle_sizes   TEXT NOT NULL DEFAULT '[]',
            yarn_weight     TEXT NOT NULL DEFAULT '',
            yarn_weight_family TEXT NOT NULL DEFAULT '',
            tags           TEXT NOT NULL DEFAULT '[]',
            notes          TEXT NOT NULL DEFAULT '',
            added_at       INTEGER NOT NULL,
            last_opened_at INTEGER,
            last_page      INTEGER NOT NULL DEFAULT 0,
            last_scroll    REAL    NOT NULL DEFAULT 0,
            cover_path     TEXT    NOT NULL DEFAULT '',
            file_hash      TEXT    NOT NULL DEFAULT ''
        );

        -- Named counters: the places in a pattern that get counted separately,
        -- such as a front, two sleeves worked in turn, or a collar. Each keeps
        -- its own count and target and is independent of the others.
        --
        -- `enabled` is what makes a counter count: a counting action moves the
        -- project total always, and every enabled counter besides. Several can
        -- be on at once, which is the point -- working two sleeves alternately
        -- means both need to advance from the same rows.
        CREATE TABLE IF NOT EXISTS counters (
            id                   TEXT PRIMARY KEY,
            pattern_id           TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            name                 TEXT NOT NULL,
            target               INTEGER NOT NULL DEFAULT 0,
            current              INTEGER NOT NULL DEFAULT 0,
            enabled              INTEGER NOT NULL DEFAULT 0,
            excluded_from_total  INTEGER NOT NULL DEFAULT 0,
            position             INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_counters_pattern ON counters(pattern_id);

        CREATE TABLE IF NOT EXISTS progress (
            pattern_id        TEXT PRIMARY KEY REFERENCES patterns(id) ON DELETE CASCADE,
            total_rows        INTEGER NOT NULL DEFAULT 0,
            current_section_id TEXT,
            updated_at        INTEGER NOT NULL DEFAULT 0
        );

        -- A project's own row total, for the pattern it is knitted from; the
        -- pattern's own is in progress.
        CREATE TABLE IF NOT EXISTS project_progress (
            project_id  TEXT NOT NULL,
            pattern_id  TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            total_rows  INTEGER NOT NULL DEFAULT 0,
            updated_at  INTEGER NOT NULL DEFAULT 0,
            -- The one project that took the pattern's counts, when its counter was made.
            took_counts INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (project_id, pattern_id)
        );

        CREATE TABLE IF NOT EXISTS highlights (
            pattern_id    TEXT PRIMARY KEY REFERENCES patterns(id) ON DELETE CASCADE,
            enabled       INTEGER NOT NULL DEFAULT 0,
            offset_y      REAL    NOT NULL DEFAULT 0.35,
            thickness     REAL    NOT NULL DEFAULT 3,
            width         REAL    NOT NULL DEFAULT 0,
            inset_x       REAL    NOT NULL DEFAULT 24,
            color         TEXT    NOT NULL DEFAULT '#e5484d',
            opacity       REAL    NOT NULL DEFAULT 0.3,
            animate       INTEGER NOT NULL DEFAULT 1,
            animation_ms  INTEGER NOT NULL DEFAULT 260
        );

        -- A previous snapshot of a pattern's metadata, written before the AI
        -- changed it, so the change can be undone.
        CREATE TABLE IF NOT EXISTS ai_history (
            id           TEXT PRIMARY KEY,
            pattern_id   TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            before_json  TEXT NOT NULL,
            after_json   TEXT NOT NULL,
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_history_pattern ON ai_history(pattern_id, created_at DESC);

        -- Key/value store for app settings that are not per-pattern.
        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        -- Mark a user made on a pattern: a coloured highlight, a written note,
        -- or a freehand drawing. `geometry` holds the shape; how to read it
        -- depends on `kind`.
        CREATE TABLE IF NOT EXISTS annotations (
            id          TEXT PRIMARY KEY,
            pattern_id  TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            kind        TEXT NOT NULL,
            -- 1-based page for a PDF, chapter index for an EPUB.
            page        INTEGER NOT NULL DEFAULT 1,
            geometry    TEXT NOT NULL DEFAULT '[]',
            -- For EPUB anchoring, and as a readable label everywhere: the text
            -- this was made from. Also what gets re-found after a reflow.
            quote       TEXT NOT NULL DEFAULT '',
            occurrence  INTEGER NOT NULL DEFAULT 0,
            color       TEXT NOT NULL DEFAULT '#e5484d',
            text        TEXT NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_annotations_pattern ON annotations(pattern_id, page);

        CREATE TABLE IF NOT EXISTS bookmarks (
            id          TEXT PRIMARY KEY,
            pattern_id  TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            page        INTEGER NOT NULL,
            title       TEXT NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bookmarks_pattern ON bookmarks(pattern_id, sort_order);

        -- A floating copy of a piece of the pattern, kept beside it. At most
        -- five per pattern, which is enforced in the command rather than the
        -- schema so the limit can be explained in an error message.
        CREATE TABLE IF NOT EXISTS pins (
            id          TEXT PRIMARY KEY,
            pattern_id  TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            page        INTEGER NOT NULL DEFAULT 1,
            -- What was pinned, in normalised 0..1 page coordinates.
            geometry    TEXT NOT NULL DEFAULT '[]',
            quote       TEXT NOT NULL DEFAULT '',
            title       TEXT NOT NULL DEFAULT '',
            -- Where the floating card sits, as a fraction of the reading pane.
            offset_x    REAL NOT NULL DEFAULT 0.72,
            offset_y    REAL NOT NULL DEFAULT 0.18,
            width       REAL NOT NULL DEFAULT 0.24,
            -- File name of the cropped image inside library/pins.
            image_file  TEXT NOT NULL DEFAULT '',
            hidden      INTEGER NOT NULL DEFAULT 0,
            z           INTEGER NOT NULL DEFAULT 0,
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pins_pattern ON pins(pattern_id);

        -- A needle, a set of needles, a cable, or a hook. Which measurements
        -- apply depends on the kind; the others are kept at 0 or empty. A
        -- tool is in use while it has a pattern or a named project, and
        -- removing the pattern frees it rather than removing the tool.
        CREATE TABLE IF NOT EXISTS tools (
            id          TEXT PRIMARY KEY,
            kind        TEXT NOT NULL,
            size_mm     REAL NOT NULL DEFAULT 0,
            length_cm   REAL NOT NULL DEFAULT 0,
            cable_cm    REAL NOT NULL DEFAULT 0,
            cable_size  TEXT NOT NULL DEFAULT '',
            brand       TEXT NOT NULL DEFAULT '',
            material    TEXT NOT NULL DEFAULT '',
            pattern_id  TEXT REFERENCES patterns(id) ON DELETE SET NULL,
            project     TEXT NOT NULL DEFAULT '',
            notes       TEXT NOT NULL DEFAULT '',
            added_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_tools_pattern ON tools(pattern_id);

        -- A piece of knitting: from a library pattern or not, active until it
        -- is finished. What is on an active project is in use; a finished
        -- one keeps what it used as its record.
        CREATE TABLE IF NOT EXISTS projects (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            pattern_id   TEXT REFERENCES patterns(id) ON DELETE SET NULL,
            status       TEXT NOT NULL DEFAULT 'active',
            started_at   INTEGER NOT NULL,
            finished_at  INTEGER,
            notes        TEXT NOT NULL DEFAULT '',
            created_at   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_projects_pattern ON projects(pattern_id);

        -- The needles, hooks and cables on a project.
        CREATE TABLE IF NOT EXISTS project_tools (
            project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            tool_id      TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
            added_at     INTEGER NOT NULL,
            released_at  INTEGER,
            PRIMARY KEY (project_id, tool_id)
        );
        CREATE INDEX IF NOT EXISTS idx_project_tools_tool ON project_tools(tool_id);

        -- The yarn on a project, from which lot, and what was left of it.
        CREATE TABLE IF NOT EXISTS project_yarns (
            id              TEXT PRIMARY KEY,
            project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            yarn_id         TEXT NOT NULL REFERENCES yarns(id) ON DELETE CASCADE,
            lot_id          TEXT REFERENCES yarn_lots(id) ON DELETE SET NULL,
            added_at        INTEGER NOT NULL,
            released_at     INTEGER,
            leftover_grams  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_project_yarns_yarn ON project_yarns(yarn_id);

        -- A board: notes, pictures, links and the rest, laid out freely.
        -- `board_id` is a project's id for a project's board, or an
        -- inspiration board's. It has no foreign key because it can be either,
        -- so whatever owns a board removes its items itself. `data` is the
        -- item's own content as JSON; a picture's file lives in
        -- library/project-images.
        CREATE TABLE IF NOT EXISTS board_items (
            id          TEXT PRIMARY KEY,
            board_id    TEXT NOT NULL,
            kind        TEXT NOT NULL,
            x           REAL NOT NULL DEFAULT 0,
            y           REAL NOT NULL DEFAULT 0,
            w           REAL NOT NULL DEFAULT 220,
            h           REAL NOT NULL DEFAULT 160,
            z           INTEGER NOT NULL DEFAULT 0,
            data        TEXT NOT NULL DEFAULT '{}',
            image_file  TEXT NOT NULL DEFAULT '',
            created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id);

        -- A board of its own, for ideas not yet a project.
        CREATE TABLE IF NOT EXISTS inspiration_boards (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );

        -- A shop you buy from, with your own comment on it.
        CREATE TABLE IF NOT EXISTS shops (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            url         TEXT NOT NULL DEFAULT '',
            comment     TEXT NOT NULL DEFAULT '',
            tags        TEXT NOT NULL DEFAULT '[]',
            added_at    INTEGER NOT NULL
        );

        -- Something you want to get. It stays when it is got, with the date,
        -- until it is removed; removing its shop or project only unlinks it.
        CREATE TABLE IF NOT EXISTS wishlist (
            id          TEXT PRIMARY KEY,
            kind        TEXT NOT NULL,
            name        TEXT NOT NULL,
            brand       TEXT NOT NULL DEFAULT '',
            amount      TEXT NOT NULL DEFAULT '',
            price       TEXT NOT NULL DEFAULT '',
            url         TEXT NOT NULL DEFAULT '',
            shop_id     TEXT REFERENCES shops(id) ON DELETE SET NULL,
            project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
            notes       TEXT NOT NULL DEFAULT '',
            photo_path  TEXT NOT NULL DEFAULT '',
            got_at      INTEGER,
            stashed_at  INTEGER,
            added_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wishlist_shop ON wishlist(shop_id);
        CREATE INDEX IF NOT EXISTS idx_wishlist_project ON wishlist(project_id);

        -- A project's diary: what was typed, and the milestones the app wrote.
        CREATE TABLE IF NOT EXISTS project_log (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            at          INTEGER NOT NULL,
            text        TEXT NOT NULL DEFAULT '',
            milestone   INTEGER NOT NULL DEFAULT 0,
            photo_path  TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_project_log_project ON project_log(project_id);

        -- A gauge swatch. Its yarn, needle and project only link: removing
        -- one leaves the swatch, and a removed yarn's name is kept in
        -- yarn_text. Counts are per 10 cm, 0 when not counted.
        CREATE TABLE IF NOT EXISTS swatches (
            id            TEXT PRIMARY KEY,
            yarn_id       TEXT REFERENCES yarns(id) ON DELETE SET NULL,
            yarn_text     TEXT NOT NULL DEFAULT '',
            tool_id       TEXT REFERENCES tools(id) ON DELETE SET NULL,
            needle_mm     REAL NOT NULL DEFAULT 0,
            stitch        TEXT NOT NULL DEFAULT '',
            sts           REAL NOT NULL DEFAULT 0,
            rows          REAL NOT NULL DEFAULT 0,
            sts_blocked   REAL NOT NULL DEFAULT 0,
            rows_blocked  REAL NOT NULL DEFAULT 0,
            project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
            photo_path    TEXT NOT NULL DEFAULT '',
            notes         TEXT NOT NULL DEFAULT '',
            made_at       INTEGER NOT NULL,
            added_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_swatches_yarn ON swatches(yarn_id);

        -- Videos kept to learn from. A YouTube one has its video id, and its
        -- picture in masterclasses/<id>.jpg when has_thumb.
        CREATE TABLE IF NOT EXISTS masterclasses (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            url         TEXT NOT NULL,
            video_id    TEXT NOT NULL DEFAULT '',
            channel     TEXT NOT NULL DEFAULT '',
            notes       TEXT NOT NULL DEFAULT '',
            has_thumb   INTEGER NOT NULL DEFAULT 0,
            added_at    INTEGER NOT NULL
        );

        -- A masterclass's videos, in order. One kept before there were several
        -- is its own first video, with the masterclass's id.
        CREATE TABLE IF NOT EXISTS masterclass_videos (
            id              TEXT PRIMARY KEY,
            masterclass_id  TEXT NOT NULL,
            position        INTEGER NOT NULL DEFAULT 0,
            title           TEXT NOT NULL,
            url             TEXT NOT NULL,
            video_id        TEXT NOT NULL DEFAULT '',
            channel         TEXT NOT NULL DEFAULT '',
            has_thumb       INTEGER NOT NULL DEFAULT 0,
            watched         INTEGER NOT NULL DEFAULT 0,
            added_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_masterclass_videos ON masterclass_videos(masterclass_id, position);

        -- Kept to look things up in: a web page, pages of a PDF, or an EPUB's
        -- chapter (its copy is a file, cheatsheets/<id>.html). `pattern_id`
        -- is not a reference: a book gone from the library leaves the
        -- cheatsheet saying so.
        CREATE TABLE IF NOT EXISTS cheatsheets (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            kind        TEXT NOT NULL,
            url         TEXT NOT NULL DEFAULT '',
            framable    INTEGER NOT NULL DEFAULT 1,
            pattern_id  TEXT NOT NULL DEFAULT '',
            page_from   INTEGER NOT NULL DEFAULT 0,
            page_to     INTEGER NOT NULL DEFAULT 0,
            notes       TEXT NOT NULL DEFAULT '',
            position    INTEGER NOT NULL DEFAULT 0,
            added_at    INTEGER NOT NULL,
            region      TEXT NOT NULL DEFAULT ''
        );

        -- Someone knitted for. `extra` is the names of their own measurements,
        -- beyond the standard ones, as a JSON list.
        CREATE TABLE IF NOT EXISTS people (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            notes       TEXT NOT NULL DEFAULT '',
            extra       TEXT NOT NULL DEFAULT '[]',
            added_at    INTEGER NOT NULL
        );

        -- One time someone was measured: centimetres by measurement key, as
        -- a JSON object, so a person's own measurements need no column.
        CREATE TABLE IF NOT EXISTS measurement_sets (
            id           TEXT PRIMARY KEY,
            person_id    TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
            measured_at  INTEGER NOT NULL,
            measures     TEXT NOT NULL DEFAULT '{}',
            shoe_size    TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_measurement_sets_person ON measurement_sets(person_id);

        -- A colourwork chart. Its grid, colours and shaping are one JSON
        -- object (`ChartData`), read and written whole: a chart is edited as
        -- a picture is, never queried square by square.
        CREATE TABLE IF NOT EXISTS charts (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            data        TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );

        -- A page the reader turned, for a chart printed sideways to fit. Only
        -- turned pages have a row; turning one back to upright removes it.
        CREATE TABLE IF NOT EXISTS page_rotations (
            pattern_id  TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
            page        INTEGER NOT NULL,
            rotation    INTEGER NOT NULL,
            PRIMARY KEY (pattern_id, page)
        );

        -- A yarn in the stash. The weight is kept as written, with the
        -- standard family derived from it on every write, exactly like
        -- patterns; the family is a column because the filter matches on it.
        CREATE TABLE IF NOT EXISTS yarns (
            id                 TEXT PRIMARY KEY,
            name               TEXT NOT NULL,
            brand              TEXT NOT NULL DEFAULT '',
            colourway          TEXT NOT NULL DEFAULT '',
            yarn_weight        TEXT NOT NULL DEFAULT '',
            yarn_weight_family TEXT NOT NULL DEFAULT '',
            metres_per_ball    INTEGER NOT NULL DEFAULT 0,
            grams_per_ball     INTEGER NOT NULL DEFAULT 0,
            photo_path         TEXT NOT NULL DEFAULT '',
            notes              TEXT NOT NULL DEFAULT '',
            added_at           INTEGER NOT NULL
        );

        -- One purchase of a yarn: the dye lot, how many balls it was, and how
        -- much is left. Partial balls are kept as grams left, weighed, rather
        -- than as a fraction of a ball.
        CREATE TABLE IF NOT EXISTS yarn_lots (
            id         TEXT PRIMARY KEY,
            yarn_id    TEXT NOT NULL REFERENCES yarns(id) ON DELETE CASCADE,
            dye_lot    TEXT NOT NULL DEFAULT '',
            balls      REAL NOT NULL DEFAULT 0,
            grams_left INTEGER NOT NULL DEFAULT 0,
            location   TEXT NOT NULL DEFAULT '',
            bought_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_yarn_lots_yarn ON yarn_lots(yarn_id);

        -- Yarn used, when: a finished project's, weighed before and after, or
        -- what was left of a yarn marked used up. Names are kept, so a
        -- removed yarn or project still says.
        CREATE TABLE IF NOT EXISTS yarn_usage (
            id            TEXT PRIMARY KEY,
            yarn_id       TEXT REFERENCES yarns(id) ON DELETE SET NULL,
            yarn_name     TEXT NOT NULL DEFAULT '',
            project_id    TEXT REFERENCES projects(id) ON DELETE SET NULL,
            project_name  TEXT NOT NULL DEFAULT '',
            at            INTEGER NOT NULL,
            grams         INTEGER NOT NULL,
            metres        INTEGER NOT NULL DEFAULT 0,
            source        TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_yarn_usage_at ON yarn_usage(at);

        -- What a yarn's ball band says of knitting it, by brand and yarn name:
        -- every colour of the yarn shares it. 0 is not said.
        CREATE TABLE IF NOT EXISTS yarn_details (
            brand       TEXT NOT NULL COLLATE NOCASE,
            name        TEXT NOT NULL COLLATE NOCASE,
            gauge_sts   REAL NOT NULL DEFAULT 0,
            gauge_rows  REAL NOT NULL DEFAULT 0,
            needle_from REAL NOT NULL DEFAULT 0,
            needle_to   REAL NOT NULL DEFAULT 0,
            care        TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY (brand, name)
        );

        CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
        CREATE INDEX IF NOT EXISTS idx_patterns_designer ON patterns(designer);
        "#,
    )?;
    Ok(())
}

/// Sections became counters; the active one is the counter left on.
fn sections_into_counters(conn: &Connection) -> AppResult<()> {
    // Sections became counters. The concepts are the same -- a named thing you
    // count with a target -- but a counter carries an `enabled` flag so several
    // can count at once, where a section could only ever have one active.
    //
    // The previously active section becomes the one enabled counter, so
    // reopening a pattern lands the user where they left off. Everything else
    // carries over disabled, which is inert rather than lossy.
    if table_exists(conn, "sections")? {
        conn.execute(
            "INSERT INTO counters
               (id, pattern_id, name, target, current, enabled, excluded_from_total, position)
             SELECT s.id, s.pattern_id, s.name, s.target, s.current,
                    CASE WHEN s.id = p.current_section_id THEN 1 ELSE 0 END,
                    s.excluded_from_total, s.position
             FROM sections s
             LEFT JOIN progress p ON p.pattern_id = s.pattern_id",
            [],
        )?;
        conn.execute("DROP TABLE sections", [])?;
    }

    // The active section is now expressed by `counters.enabled`, so the column
    // that pointed at one is dead. Dropping it needs SQLite 3.35 or newer;
    // where that is unavailable the column is simply left empty and unused,
    // which costs nothing but a little clutter.
    if column_exists(conn, "progress", "current_section_id")? {
        let _ = conn.execute("ALTER TABLE progress DROP COLUMN current_section_id", []);
    }
    Ok(())
}

/// A pattern's cover, and its file's content hash for spotting duplicates.
fn pattern_cover_and_hash(conn: &Connection) -> AppResult<()> {
    add_column(conn, "patterns", "cover_path", "TEXT NOT NULL DEFAULT ''")?;

    // A content hash of the pattern's file, used to spot a duplicate before it
    // is added. Empty for rows that predate the column until the backfill
    // below hashes their files; an empty hash never counts as a match.
    //
    // The index is created here rather than in the batch above because an old
    // database has no file_hash column until the ALTER runs, and CREATE INDEX
    // on a missing column would fail.
    add_column(conn, "patterns", "file_hash", "TEXT NOT NULL DEFAULT ''")?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_patterns_hash ON patterns(file_hash)", [])?;
    backfill_file_hashes(conn)?;
    Ok(())
}

/// The yarn weight family and needle sizes derived from what a pattern says.
fn yarn_weights_and_needle_sizes(conn: &Connection) -> AppResult<()> {
    // Yarn weight as the pattern states it, plus the standard family derived
    // from it. The family is a separate column because the filter matches on
    // it: deriving a family from free text inside SQL would mean either a
    // fuzzy match per row or a scan of the whole table.
    for (column, kind) in [
        ("yarn_weight", "TEXT NOT NULL DEFAULT ''"),
        ("yarn_weight_family", "TEXT NOT NULL DEFAULT ''"),
    ] {
        if !column_exists(conn, "patterns", column)? {
            conn.execute(
                &format!("ALTER TABLE patterns ADD COLUMN {column} {kind}"),
                [],
            )?;
        }
    }
    // A library that predates the column has no family to filter on, so any
    // rows that already state a weight get their family filled in. This has to
    // be done in Rust: the family is derived from free text, which SQL has no
    // way to do per row.
    backfill_yarn_families(conn)?;

    // The canonical mm sizes derived from the stated needle size, as a JSON
    // array -- the same arrangement as the yarn family: the text is kept as
    // written for display, and the derived column is what the filter and the
    // sidebar facet match on, since free text cannot be matched per row in
    // SQL.
    if !column_exists(conn, "patterns", "needle_sizes")? {
        conn.execute(
            "ALTER TABLE patterns ADD COLUMN needle_sizes TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }
    backfill_needle_sizes(conn)?;
    // The ply counts changed meaning (4 ply is fingering, as in the UK and on
    // Ravelry, not worsted), so every stored family is worked out again once.
    let ply_fixed: bool = get_setting(conn, "yarn_families_ply_v2")?;
    if !ply_fixed {
        rederive_families(conn, "patterns")?;
        rederive_families(conn, "yarns")?;
        set_setting(conn, "yarn_families_ply_v2", &true)?;
    }
    Ok(())
}

/// The highlight line's old default opacity moved to the new one, once.
fn highlight_opacity_once(conn: &Connection) -> AppResult<()> {
    // The highlight line's default opacity dropped from 0.9 to 0.3, which
    // reads far better over a pattern: at 90% the text underneath was hard to
    // follow. Only rows still sitting on the old default are moved, so a line
    // someone has deliberately made more or less strong is left alone.
    //
    // This runs once, recorded in app_settings. migrate() runs on every
    // launch, and without the flag a line deliberately set to exactly 0.9
    // after the migration would be rewritten to 0.3 on every start.
    let opacity_migrated: bool = get_setting(conn, "highlight_opacity_0_3")?;
    if !opacity_migrated {
        conn.execute(
            "UPDATE highlights SET opacity = 0.3 WHERE ABS(opacity - 0.9) < 0.0001",
            [],
        )?;
        set_setting(conn, "highlight_opacity_0_3", &true)?;
    }
    Ok(())
}

/// A counter's key and project; a yarn's fibres, superwash and plans.
fn counter_and_yarn_columns(conn: &Connection) -> AppResult<()> {
    // A counter's own key; empty for the counters made before keys existed.
    add_column(conn, "counters", "hotkey", "TEXT NOT NULL DEFAULT ''")?;
    // The project a counter counts for; empty for the pattern's own.
    add_column(conn, "counters", "project_id", "TEXT NOT NULL DEFAULT ''")?;
    // What a yarn is made of, and whether it is superwash.
    add_column(conn, "yarns", "fibres", "TEXT NOT NULL DEFAULT '[]'")?;
    add_column(conn, "yarns", "superwash", "INTEGER NOT NULL DEFAULT 0")?;
    // What a yarn is planned for, as a JSON list of YarnPlan.
    add_column(conn, "yarns", "plans", "TEXT NOT NULL DEFAULT '[]'")?;
    Ok(())
}

/// A project's chart, gallery choices, plan and planned grams.
fn project_plan_columns(conn: &Connection) -> AppResult<()> {
    // The chart a project is knitted from, and the row it starts on.
    if !column_exists(conn, "projects", "chart_id")? {
        conn.execute_batch(
            "ALTER TABLE projects ADD COLUMN chart_id TEXT NOT NULL DEFAULT '';
             ALTER TABLE projects ADD COLUMN chart_start INTEGER NOT NULL DEFAULT 1;",
        )?;
    }
    // A finished project in the gallery: hidden from it, and the photos it leaves out.
    if !column_exists(conn, "projects", "gallery_hidden")? {
        conn.execute_batch(
            "ALTER TABLE projects ADD COLUMN gallery_hidden INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE projects ADD COLUMN gallery_skip TEXT NOT NULL DEFAULT '[]';",
        )?;
    }
    // A plan's time as said, its exact date, and its place in the plans' order.
    if !column_exists(conn, "projects", "plan_when")? {
        conn.execute_batch(
            "ALTER TABLE projects ADD COLUMN plan_when TEXT NOT NULL DEFAULT '';
             ALTER TABLE projects ADD COLUMN plan_date INTEGER;
             ALTER TABLE projects ADD COLUMN plan_order REAL NOT NULL DEFAULT 0;",
        )?;
    }
    // How much of a yarn a project is expected to take; NULL when not said.
    add_column(conn, "project_yarns", "planned_grams", "INTEGER")?;
    Ok(())
}

/// When a yarn was used up; a pattern's zoom and when it went to the Bin.
fn used_up_zoom_and_bin_columns(conn: &Connection) -> AppResult<()> {
    // When a yarn was used up; NULL while it is in the stash.
    add_column(conn, "yarns", "used_up_at", "INTEGER")?;
    // How far a pattern was zoomed when last read; 1 is fit-width.
    add_column(conn, "patterns", "zoom", "REAL NOT NULL DEFAULT 1")?;
    // A pattern removed to the Bin, to restore or delete for good; NULL while
    // it is in the library.
    add_column(conn, "patterns", "removed_at", "INTEGER")?;
    Ok(())
}

/// Which way a highlight line steps, and its page and box.
fn highlight_place_columns(conn: &Connection) -> AppResult<()> {
    // A chart's line steps up the page when a row is counted; text's, down.
    add_column(conn, "highlights", "reads_up", "INTEGER NOT NULL DEFAULT 0")?;
    // The line on the page: which page, and its box there as shares of it.
    if !column_exists(conn, "highlights", "page")? {
        conn.execute_batch(
            "ALTER TABLE highlights ADD COLUMN page INTEGER NOT NULL DEFAULT 0;
             ALTER TABLE highlights ADD COLUMN box_x REAL NOT NULL DEFAULT 0;
             ALTER TABLE highlights ADD COLUMN box_y REAL NOT NULL DEFAULT 0;
             ALTER TABLE highlights ADD COLUMN box_w REAL NOT NULL DEFAULT 0;
             ALTER TABLE highlights ADD COLUMN box_h REAL NOT NULL DEFAULT 0;",
        )?;
    }
    Ok(())
}

/// A lot that is what a finished project left over.
fn lot_leftover_column(conn: &Connection) -> AppResult<()> {
    // A lot that is what a finished project left over.
    add_column(conn, "yarn_lots", "leftover", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

/// The ball band pictures' table, gone when empty.
fn drop_empty_ball_bands(conn: &Connection) -> AppResult<()> {
    // Ball bands' pictures are gone (0.3.32): their table goes when nothing
    // is in it, and stays, unread, when something is.
    let bands: Option<i64> = conn
        .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ball_bands'", [], |r| r.get(0))
        .optional()?;
    if bands.is_some() && conn.query_row("SELECT COUNT(*) FROM ball_bands", [], |r| r.get::<_, i64>(0))? == 0 {
        conn.execute("DROP TABLE ball_bands", [])?;
    }
    Ok(())
}

/// Whether a lot's grams were weighed.
fn lot_weighed_column(conn: &Connection) -> AppResult<()> {
    // Whether a lot's grams were weighed. A lot of balls at 0 g was never
    // weighed -- it is its balls by the ball band -- unless a finished project
    // left none of that yarn.
    if !column_exists(conn, "yarn_lots", "weighed")? {
        conn.execute_batch(
            "ALTER TABLE yarn_lots ADD COLUMN weighed INTEGER NOT NULL DEFAULT 1;
             UPDATE yarn_lots SET weighed = 0 WHERE grams_left = 0 AND balls > 0
               AND NOT EXISTS (SELECT 1 FROM project_yarns py WHERE py.yarn_id = yarn_lots.yarn_id AND py.leftover_grams = 0);",
        )?;
    }
    Ok(())
}

/// A shop's tags; a wishlist item's picture.
fn shop_and_wish_columns(conn: &Connection) -> AppResult<()> {
    // A shop's tags, and a wishlist item's picture and when it went into the
    // stash: for a library made by the first build with shops in it.
    add_column(conn, "shops", "tags", "TEXT NOT NULL DEFAULT '[]'")?;
    add_column(conn, "wishlist", "photo_path", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

/// Projects from before the log get their start and end as milestones, once.
fn log_backfill_once(conn: &Connection) -> AppResult<()> {
    // The projects from before the log get their start, and their end, as
    // milestones, so every log begins where its project did. Once only.
    let log_backfilled: bool = get_setting(conn, "project_log_backfill")?;
    if !log_backfilled {
        let projects: Vec<(String, String, i64, Option<i64>)> = conn
            .prepare("SELECT id, status, started_at, finished_at FROM projects")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<_, _>>()?;
        for (id, status, started, finished) in projects {
            log_milestone(conn, &id, "Started", Some(started))?;
            if let Some(end) = finished {
                let what = if status == "frogged" { "Frogged" } else { "Finished" };
                log_milestone(conn, &id, what, Some(end))?;
            }
        }
        set_setting(conn, "project_log_backfill", &true)?;
    }
    Ok(())
}

/// Who a project is for, a wish's brand and when it was stashed, a project's cover.
fn person_wish_and_cover_columns(conn: &Connection) -> AppResult<()> {
    // Who a project is for.
    add_column(conn, "projects", "person_id", "TEXT REFERENCES people(id) ON DELETE SET NULL")?;
    add_column(conn, "wishlist", "brand", "TEXT NOT NULL DEFAULT ''")?;
    add_column(conn, "wishlist", "stashed_at", "INTEGER")?;
    // A project's cover picture.
    add_column(conn, "projects", "cover_path", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

/// The connector system of interchangeable tips and cables, and an adapter's other end.
fn tool_connectors(conn: &Connection) -> AppResult<()> {
    // The system an interchangeable tip's or cable's connector is, which
    // decides what fits it; the ones there already take it from their brand.
    if !column_exists(conn, "tools", "connector")? {
        conn.execute("ALTER TABLE tools ADD COLUMN connector TEXT NOT NULL DEFAULT ''", [])?;
        let rows: Vec<(String, String)> = conn
            .prepare("SELECT id, brand FROM tools WHERE kind IN ('tips', 'cable')")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (id, brand) in rows {
            let system = crate::tools::connector_of_brand(&brand);
            if !system.is_empty() {
                conn.execute("UPDATE tools SET connector = ?2 WHERE id = ?1", params![id, system])?;
            }
        }
    }
    // An adapter's cable end: tips of its connector size on a cable of this.
    add_column(conn, "tools", "adapter_to", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

/// A masterclass kept as one video gets it as its first part.
fn masterclass_first_part(conn: &Connection) -> AppResult<()> {
    // A masterclass kept as one video is that video, as its first part: its
    // picture's file is named by the masterclass's id, which the part takes.
    // A masterclass always has a part, so this only ever finds the old ones.
    conn.execute(
        "INSERT INTO masterclass_videos (id, masterclass_id, position, title, url, video_id, channel, has_thumb, watched, added_at)
         SELECT m.id, m.id, 0, m.title, m.url, m.video_id, m.channel, m.has_thumb, 0, m.added_at FROM masterclasses m
         WHERE NOT EXISTS (SELECT 1 FROM masterclass_videos v WHERE v.masterclass_id = m.id)",
        [],
    )?;
    Ok(())
}

/// Which tip of a pair is on a project; right and left are one.
fn project_tool_tips(conn: &Connection) -> AppResult<()> {
    // One tip of a pair of interchangeable tips on a project: which.
    add_column(conn, "project_tools", "tip", "TEXT NOT NULL DEFAULT ''")?;
    // A tip of a pair was once said as right or left: the two are alike, so one.
    conn.execute("UPDATE project_tools SET tip = 'one' WHERE tip IN ('right', 'left')", [])?;
    Ok(())
}

/// Prices of lots, yarns by brand and name, deadstock and cones, and patterns.
fn prices(conn: &Connection) -> AppResult<()> {
    // Prices: a ball's, by brand and yarn as the band's details are; a
    // pattern's. None when not said.
    add_column(conn, "yarn_lots", "price", "REAL")?;
    if !column_exists(conn, "yarn_details", "price")? {
        conn.execute("ALTER TABLE yarn_details ADD COLUMN price REAL", [])?;
        // A price was once a lot's (0.3.86): each yarn takes the one said
        // last for any of its colours, and the lots' are left behind.
        let said: Vec<(String, String, f64)> = conn
            .prepare(
                "SELECT y.brand, y.name, l.price FROM yarn_lots l JOIN yarns y ON y.id = l.yarn_id
                 WHERE l.price IS NOT NULL ORDER BY COALESCE(l.bought_at, y.added_at), l.rowid",
            )?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?;
        for (brand, name, price) in said {
            conn.execute(
                "INSERT INTO yarn_details (brand, name, price) VALUES (?1, ?2, ?3)
                 ON CONFLICT (brand, name) DO UPDATE SET price = ?3",
                params![details_key(&brand), details_key(&name), price],
            )?;
        }
        conn.execute("UPDATE yarn_lots SET price = NULL", [])?;
    }
    // Deadstock or cone yarn: its price is for 100 g.
    add_column(conn, "yarn_details", "deadstock", "INTEGER NOT NULL DEFAULT 0")?;
    // Deadstock priced by the cone, as bought.
    add_column(conn, "yarn_details", "per_cone", "INTEGER NOT NULL DEFAULT 0")?;
    add_column(conn, "patterns", "price", "REAL")?;
    Ok(())
}

/// The size knitted from a pattern.
fn pattern_size_column(conn: &Connection) -> AppResult<()> {
    // The size knitted from a pattern, as its place among the sizes.
    add_column(conn, "patterns", "size_index", "INTEGER")?;
    Ok(())
}

/// What a needle or hook cost alone, and the set it came in.
fn tool_prices_and_sets(conn: &Connection) -> AppResult<()> {
    // Needles and hooks: what one cost alone, and the set it came in, a set
    // having one price for all its pieces.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tool_sets (
            id       TEXT PRIMARY KEY,
            name     TEXT NOT NULL,
            price    REAL,
            added_at INTEGER NOT NULL
        );",
    )?;
    add_column(conn, "tools", "price", "REAL")?;
    add_column(conn, "tools", "set_id", "TEXT REFERENCES tool_sets(id) ON DELETE SET NULL")?;
    Ok(())
}

/// A project's own hour rate, and the knitting sessions with their pauses.
fn knit_time(conn: &Connection) -> AppResult<()> {
    // A project's own hour's worth, when not the standard.
    add_column(conn, "projects", "hour_rate", "REAL")?;
    // Time spent knitting a project: spells of it, one timed at a time.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS knit_sessions (
            id         TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            started_at INTEGER NOT NULL,
            ended_at   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_knit_sessions_project ON knit_sessions(project_id);",
    )?;
    // A sitting paused -- a break, not its end: the time paused, and when the pause now on began.
    if !column_exists(conn, "knit_sessions", "paused_ms")? {
        conn.execute("ALTER TABLE knit_sessions ADD COLUMN paused_ms INTEGER NOT NULL DEFAULT 0", [])?;
        conn.execute("ALTER TABLE knit_sessions ADD COLUMN paused_at INTEGER", [])?;
    }
    Ok(())
}

/// A masterclass's pattern, a project's masterclass and size, a cheatsheet's region.
fn masterclass_size_region_columns(conn: &Connection) -> AppResult<()> {
    // The pattern a masterclass goes with.
    add_column(conn, "masterclasses", "pattern_id", "TEXT NOT NULL DEFAULT ''")?;
    // The masterclass a project is knitted along with.
    add_column(conn, "projects", "masterclass_id", "TEXT NOT NULL DEFAULT ''")?;
    // The size a project is knitted in, as said.
    add_column(conn, "projects", "size", "TEXT NOT NULL DEFAULT ''")?;
    // A cheatsheet of part of a page: the box kept, as JSON; empty for all of it.
    add_column(conn, "cheatsheets", "region", "TEXT NOT NULL DEFAULT ''")?;
    Ok(())
}

/// EPUBs already in the library tagged as books, once.
fn epubs_tagged_once(conn: &Connection) -> AppResult<()> {
    // Books have a tab of their own, found by the tag `book`; the EPUBs
    // already in the library are books, and are tagged so, once (one untagged
    // afterwards stays untagged).
    let epubs_tagged: bool = get_setting(conn, "epubs_tagged_book")?;
    if !epubs_tagged {
        tag_epubs_as_books(conn)?;
        set_setting(conn, "epubs_tagged_book", &true)?;
    }
    Ok(())
}

/// Default "want to knit" statuses cleared, and patterns with a project in progress, once.
fn pattern_status_once(conn: &Connection) -> AppResult<()> {
    // Every pattern used to start as "want to knit", so in a large library the
    // status said nothing. Now a pattern starts with none, and "want to knit"
    // is for the ones actually planned; the ones that only had it by default
    // lose it, once.
    let status_reset: bool = get_setting(conn, "patterns_no_default_status")?;
    if !status_reset {
        conn.execute("UPDATE patterns SET status = '' WHERE status = 'want-to-knit'", [])?;
        set_setting(conn, "patterns_no_default_status", &true)?;
    }
    // A pattern with a project on the needles is in progress; ones started
    // before that was automatic catch up, once.
    let in_progress: bool = get_setting(conn, "patterns_in_progress_from_projects")?;
    if !in_progress {
        conn.execute(
            "UPDATE patterns SET status = 'in-progress'
             WHERE status IN ('', 'want-to-knit')
               AND id IN (SELECT pattern_id FROM projects WHERE status = 'active' AND pattern_id IS NOT NULL)",
            [],
        )?;
        set_setting(conn, "patterns_in_progress_from_projects", &true)?;
    }
    Ok(())
}

/// Highlight lines on the old factory setting switched off, once.
fn highlight_off_once(conn: &Connection) -> AppResult<()> {
    // The line is now off by default: most patterns are read rather than
    // counted against a chart, and for those it was in the way. Lines still on
    // the old factory setting -- every style field untouched -- are switched
    // off; a line someone has restyled was set up on purpose and keeps its
    // state. The position is not part of the test, since clicking the page
    // moves it without anyone meaning to configure anything. Once only, for
    // the same reason as the opacity migration above.
    let off_migrated: bool = get_setting(conn, "highlight_off_by_default")?;
    if !off_migrated {
        conn.execute(
            "UPDATE highlights SET enabled = 0
             WHERE ABS(thickness - 3.0) < 0.0001 AND ABS(width) < 0.0001
               AND ABS(inset_x - 24.0) < 0.0001 AND color = '#e5484d'
               AND ABS(opacity - 0.3) < 0.0001 AND animate = 1 AND animation_ms = 260",
            [],
        )?;
        set_setting(conn, "highlight_off_by_default", &true)?;
    }
    Ok(())
}

/// Works out the family of every row of `table` again, from what it states.
fn rederive_families(conn: &Connection, table: &str) -> AppResult<()> {
    // `table` is one of two literals from migrate(), never user input.
    let rows: Vec<(String, String)> = conn
        .prepare(&format!("SELECT id, yarn_weight FROM {table}"))?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, weight) in rows {
        conn.execute(
            &format!("UPDATE {table} SET yarn_weight_family = ?2 WHERE id = ?1"),
            params![id, crate::yarn::family_of(&weight)],
        )?;
    }
    Ok(())
}

/// Fills in the derived yarn family for any row that states a weight but has
/// no family yet.
///
/// Idempotent, and cheap on an already-migrated library because the `WHERE`
/// matches nothing once every row is up to date.
fn backfill_yarn_families(conn: &Connection) -> AppResult<()> {
    let stale: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, yarn_weight FROM patterns WHERE yarn_weight <> '' AND yarn_weight_family = ''")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out
    };
    for (id, weight) in stale {
        conn.execute(
            "UPDATE patterns SET yarn_weight_family = ?2 WHERE id = ?1",
            params![id, crate::yarn::family_of(&weight)],
        )?;
    }
    Ok(())
}

/// Fills in the derived needle sizes for any row that states a size but has
/// none derived yet.
///
/// Idempotent in the same way as `backfill_yarn_families`: the `WHERE`
/// matches nothing once every row is up to date, so no one-shot flag is
/// needed.
fn backfill_needle_sizes(conn: &Connection) -> AppResult<()> {
    let stale: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, needle_size FROM patterns WHERE needle_size <> '' AND needle_sizes = '[]'")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out
    };
    for (id, size) in stale {
        conn.execute(
            "UPDATE patterns SET needle_sizes = ?2 WHERE id = ?1",
            params![id, needle_sizes_json(&size)],
        )?;
    }
    Ok(())
}

/// Fills in the content hash for any pattern added before hashing existed.
///
/// The originals folder is derived from the database's own location -- the db
/// sits beside `library/originals` -- and each row's file is found there by
/// the file name its `file_path` ends in, so both absolute and relative stored
/// paths resolve. Best-effort: a file that is missing or unreadable keeps its
/// empty hash rather than failing the launch, and an empty hash never matches
/// anything, so the row simply stays outside duplicate detection.
///
/// Idempotent in the same way as `backfill_yarn_families`: the `WHERE` matches
/// nothing once every readable row is done. An in-memory database has no file
/// location, so there is nothing to derive and nothing to do.
fn backfill_file_hashes(conn: &Connection) -> AppResult<()> {
    let db_file: String = conn.query_row(
        "SELECT file FROM pragma_database_list WHERE name = 'main'",
        [],
        |r| r.get(0),
    )?;
    if db_file.is_empty() {
        return Ok(());
    }
    let originals = Path::new(&db_file)
        .parent()
        .map(|base| base.join("library").join("originals"));

    let stale: Vec<(String, String)> = {
        let mut stmt =
            conn.prepare("SELECT id, file_path FROM patterns WHERE file_hash = ''")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out
    };
    let Some(originals) = originals else { return Ok(()) };
    for (id, file_path) in stale {
        let Some(file_name) = Path::new(&file_path).file_name() else {
            continue;
        };
        if let Ok(bytes) = std::fs::read(originals.join(file_name)) {
            conn.execute(
                "UPDATE patterns SET file_hash = ?2 WHERE id = ?1",
                params![id, hash_bytes(&bytes)],
            )?;
        }
    }
    Ok(())
}

/// Reports whether a table exists at all.
///
/// Used to decide whether the section-to-counter migration has already run,
/// since `CREATE TABLE IF NOT EXISTS` cannot tell "not yet" from "already
/// done" and the two need opposite handling.
pub(super) fn table_exists(conn: &Connection, table: &str) -> AppResult<bool> {
    // The name is a compile-time constant from this module, never user input.
    let found: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get(0),
    )?;
    Ok(found > 0)
}

/// Reports whether a table already has a column.
pub(super) fn column_exists(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
    // table_info takes a literal, and both values here are compile-time
    // constants from this module, never user input.
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every table, index and column, as SQLite has them.
    fn schema(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT type, name, COALESCE(sql, '') FROM sqlite_master ORDER BY type, name").unwrap();
        stmt.query_map([], |r| Ok(format!("{} {} {}", r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn each_step_runs_again_and_changes_nothing() {
        let conn = crate::db::open_test_db();
        let before = schema(&conn);
        for (name, step) in STEPS {
            step(&conn).unwrap_or_else(|e| panic!("{name} again: {e}"));
            assert_eq!(schema(&conn), before, "{name} again changed the schema");
        }
        let mut names: Vec<&str> = STEPS.iter().map(|(n, _)| *n).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), STEPS.len(), "each step has a name of its own");
    }
}

/// The grams a lot bought by weight was bought as. Before, only what is left
/// was kept, so what it cost and what was added shrank as it was knitted
/// from. An older lot's is worked out once: what is left, and for a yarn with
/// that one lot, what its projects took of it as well.
fn lot_bought_grams(conn: &Connection) -> AppResult<()> {
    if column_exists(conn, "yarn_lots", "bought_grams")? {
        return Ok(());
    }
    conn.execute("ALTER TABLE yarn_lots ADD COLUMN bought_grams INTEGER", [])?;
    conn.execute(
        "UPDATE yarn_lots SET bought_grams = grams_left
           + CASE WHEN (SELECT COUNT(*) FROM yarn_lots o WHERE o.yarn_id = yarn_lots.yarn_id) = 1
                  THEN COALESCE((SELECT SUM(u.grams) FROM yarn_usage u WHERE u.yarn_id = yarn_lots.yarn_id), 0)
                  ELSE 0 END
         WHERE balls = 0 AND weighed = 1",
        [],
    )?;
    // Nothing to say it was ever bought: none kept.
    conn.execute("UPDATE yarn_lots SET bought_grams = NULL WHERE bought_grams <= 0", [])?;
    Ok(())
}
