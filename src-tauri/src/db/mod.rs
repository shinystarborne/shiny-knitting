use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{
    Annotation, AnnotationInput, AnnotationKind, AppError, AppResult, Bookmark, Counter,
    CounterInput, HighlightSettings, PageRotation, Pattern, PatternInput, Pin, PinInput, PinPlacement, Progress,
    Tool, ToolInput, Yarn, YarnInput, YarnLot, DIFFICULTIES, FinishInput, Project,
    ProjectInput, ProjectYarn, BoardItem, BoardItemInput, BoardItemPatch, BOARD_KINDS,
    tidy_status, is_live, BoardPicture, InspirationBoard, PROJECT_STATUSES,
};

#[cfg(test)]
pub mod tests;

/// Exposed for tests in other modules that need a migrated database.
#[cfg(test)]
pub(crate) use tests::open_test_db;

/// Opens the library database and brings the schema up to date.
pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> AppResult<()> {
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

        CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
        CREATE INDEX IF NOT EXISTS idx_patterns_designer ON patterns(designer);
        "#,
    )?;


    // ALTER TABLE ADD COLUMN is not idempotent, so it is only issued when the
    // column is genuinely missing. This is what brings an existing library
    // (created before covers existed) up to date.
    // Sections became counters. The concepts are the same -- a named thing you
    // count with a target -- but a counter carries an `enabled` flag so several
    // can count at once, where a section could only ever have one active.
    //
    // The previously active section becomes the one enabled counter, so
    // reopening a pattern lands the user where they left off. Everything else
    // carries over disabled, which is inert rather than lossy.
    if table_exists(conn, "sections")? {
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO counters
               (id, pattern_id, name, target, current, enabled, excluded_from_total, position)
             SELECT s.id, s.pattern_id, s.name, s.target, s.current,
                    CASE WHEN s.id = p.current_section_id THEN 1 ELSE 0 END,
                    s.excluded_from_total, s.position
             FROM sections s
             LEFT JOIN progress p ON p.pattern_id = s.pattern_id",
            [],
        )?;
        tx.execute("DROP TABLE sections", [])?;
        tx.commit()?;
    }

    // The active section is now expressed by `counters.enabled`, so the column
    // that pointed at one is dead. Dropping it needs SQLite 3.35 or newer;
    // where that is unavailable the column is simply left empty and unused,
    // which costs nothing but a little clutter.
    if column_exists(conn, "progress", "current_section_id")? {
        let _ = conn.execute("ALTER TABLE progress DROP COLUMN current_section_id", []);
    }

    if !column_exists(conn, "patterns", "cover_path")? {
        conn.execute("ALTER TABLE patterns ADD COLUMN cover_path TEXT NOT NULL DEFAULT ''", [])?;
    }

    // A content hash of the pattern's file, used to spot a duplicate before it
    // is added. Empty for rows that predate the column until the backfill
    // below hashes their files; an empty hash never counts as a match.
    //
    // The index is created here rather than in the batch above because an old
    // database has no file_hash column until the ALTER runs, and CREATE INDEX
    // on a missing column would fail.
    if !column_exists(conn, "patterns", "file_hash")? {
        conn.execute("ALTER TABLE patterns ADD COLUMN file_hash TEXT NOT NULL DEFAULT ''", [])?;
    }
    conn.execute("CREATE INDEX IF NOT EXISTS idx_patterns_hash ON patterns(file_hash)", [])?;
    backfill_file_hashes(conn)?;

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

    // A counter's own key; empty for the counters made before keys existed.
    if !column_exists(conn, "counters", "hotkey")? {
        conn.execute("ALTER TABLE counters ADD COLUMN hotkey TEXT NOT NULL DEFAULT ''", [])?;
    }
    // What a yarn is made of, and whether it is superwash.
    if !column_exists(conn, "yarns", "fibres")? {
        conn.execute("ALTER TABLE yarns ADD COLUMN fibres TEXT NOT NULL DEFAULT '[]'", [])?;
    }
    if !column_exists(conn, "yarns", "superwash")? {
        conn.execute("ALTER TABLE yarns ADD COLUMN superwash INTEGER NOT NULL DEFAULT 0", [])?;
    }
    // A lot that is what a finished project left over.
    if !column_exists(conn, "yarn_lots", "leftover")? {
        conn.execute("ALTER TABLE yarn_lots ADD COLUMN leftover INTEGER NOT NULL DEFAULT 0", [])?;
    }
    move_tools_into_projects(conn)?;
    // A project's cover picture.
    if !column_exists(conn, "projects", "cover_path")? {
        conn.execute("ALTER TABLE projects ADD COLUMN cover_path TEXT NOT NULL DEFAULT ''", [])?;
    }

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

/// The derived needle sizes of a stated size, as the JSON array stored in
/// `patterns.needle_sizes`.
fn needle_sizes_json(text: &str) -> String {
    serde_json::to_string(&crate::needle_size::sizes_of(text)).unwrap_or_else(|_| "[]".to_string())
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

/// The hex SHA-256 of a pattern file's contents, which is what duplicate
/// detection compares: the same pattern under a different name hashes alike,
/// while a renamed edit does not.
pub fn hash_bytes(bytes: &[u8]) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// The pattern whose file has this content hash, if any.
///
/// An empty hash means "unknown" -- a row whose file could not be hashed -- so
/// it returns `None` without querying: two files of unknown hash must never
/// be treated as duplicates of each other.
pub fn pattern_with_hash(conn: &Connection, hash: &str) -> AppResult<Option<Pattern>> {
    if hash.is_empty() {
        return Ok(None);
    }
    Ok(conn
        .query_row(
            "SELECT * FROM patterns WHERE file_hash = ?1 LIMIT 1",
            params![hash],
            row_to_pattern,
        )
        .optional()?)
}

/// Reports whether a table exists at all.
///
/// Used to decide whether the section-to-counter migration has already run,
/// since `CREATE TABLE IF NOT EXISTS` cannot tell "not yet" from "already
/// done" and the two need opposite handling.
fn table_exists(conn: &Connection, table: &str) -> AppResult<bool> {
    // The name is a compile-time constant from this module, never user input.
    let found: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get(0),
    )?;
    Ok(found > 0)
}

/// Reports whether a table already has a column.
fn column_exists(conn: &Connection, table: &str, column: &str) -> AppResult<bool> {
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

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn row_to_pattern(row: &rusqlite::Row) -> rusqlite::Result<Pattern> {
    let tags_json: String = row.get("tags")?;
    let tags = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Pattern {
        id: row.get("id")?,
        title: row.get("title")?,
        designer: row.get("designer")?,
        file_path: row.get("file_path")?,
        file_name: row.get("file_name")?,
        format: row.get("format")?,
        status: row.get("status")?,
        difficulty: row.get("difficulty")?,
        needle_size: row.get("needle_size")?,
        yarn_weight: row.get("yarn_weight")?,
        yarn_weight_family: row.get("yarn_weight_family")?,
        tags,
        notes: row.get("notes")?,
        added_at: row.get("added_at")?,
        last_opened_at: row.get("last_opened_at")?,
        last_page: row.get("last_page")?,
        last_scroll: row.get("last_scroll")?,
        cover_path: row.get("cover_path")?,
    })
}

/// Optional filters for the library view. All fields are optional; empty means
/// "do not filter on this".
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub search: Option<String>,
    pub status: Option<String>,
    pub designer: Option<String>,
    pub difficulty: Option<String>,
    /// Canonical mm needle sizes, e.g. "4". Several may be given to widen the
    /// filter, the same way yarn weights are.
    pub needle_sizes: Option<Vec<String>>,
    /// Standard yarn weight family, e.g. "dk". Several may be given to widen
    /// the filter, the same way tags are.
    pub yarn_weight: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub sort: Option<String>,
}

/// Makes user text safe for a LIKE pattern: the wildcards `%` and `_`, and
/// the escape character itself, are escaped so a search for "100%" matches
/// that literal text rather than "100" followed by anything. The SQL using
/// this must declare `ESCAPE '\'`.
fn escape_like(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub fn list_patterns(conn: &Connection, filter: &Filter) -> AppResult<Vec<Pattern>> {
    // The free-text term is parameter ?1 and is always present, so an empty
    // search becomes "%%" and matches everything.
    let term = match filter.search.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => format!("%{}%", escape_like(s.trim())),
        None => "%".to_string(),
    };
    let mut sql = String::from(
        "SELECT * FROM patterns WHERE 1=1 \
         AND (title LIKE ?1 ESCAPE '\\' OR designer LIKE ?1 ESCAPE '\\' \
         OR notes LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\')",
    );
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(term)];

    // Each optional filter appends a placeholder numbered by its position.
    let mut next_index = 2usize;
    macro_rules! push_eq {
        ($col:expr, $value:expr) => {{
            let idx = next_index;
            next_index += 1;
            sql.push_str(&format!(" AND {} = ?{}", $col, idx));
            args.push(Box::new($value.clone()));
        }};
    }

    if let Some(v) = filter.status.as_ref().filter(|s| !s.is_empty()) {
        push_eq!("status", v);
    }
    if let Some(v) = filter.difficulty.as_ref().filter(|s| !s.is_empty()) {
        push_eq!("difficulty", v);
    }
    if let Some(v) = filter.designer.as_ref().filter(|s| !s.is_empty()) {
        push_eq!("designer", v);
    }
    // Needle sizes are stored as a JSON array of canonical mm keys, so match
    // on the quoted key: a bare "4" would also hit "4.5" and "14". Several
    // sizes are an OR within the group and an AND against everything else,
    // which is how the other checkbox groups behave.
    if let Some(sizes) = filter.needle_sizes.as_ref().filter(|s| !s.is_empty()) {
        let mut clauses = Vec::new();
        for key in sizes.iter().filter(|k| !k.is_empty()) {
            let idx = next_index;
            next_index += 1;
            clauses.push(format!("needle_sizes LIKE ?{idx} ESCAPE '\\'"));
            args.push(Box::new(format!("%\"{}\"%", escape_like(key))));
        }
        if !clauses.is_empty() {
            sql.push_str(&format!(" AND ({})", clauses.join(" OR ")));
        }
    }

    // Yarn weight is an OR within itself and an AND against everything else,
    // which is how the other checkbox groups behave: picking DK and Aran means
    // "either", not "both".
    if let Some(families) = filter.yarn_weight.as_ref().filter(|f| !f.is_empty()) {
        let mut placeholders = Vec::new();
        for family in families.iter().filter(|f| !f.is_empty()) {
            let idx = next_index;
            next_index += 1;
            placeholders.push(format!("?{idx}"));
            args.push(Box::new(family.clone()));
        }
        if !placeholders.is_empty() {
            sql.push_str(&format!(
                " AND yarn_weight_family IN ({})",
                placeholders.join(", ")
            ));
        }
    }

    // Tags are stored as a JSON array, so match on the quoted substring to
    // avoid "lace" matching "laceweight".
    if let Some(tags) = filter.tags.as_ref().filter(|t| !t.is_empty()) {
        for tag in tags {
            let idx = next_index;
            next_index += 1;
            sql.push_str(&format!(" AND tags LIKE ?{} ESCAPE '\\'", idx));
            args.push(Box::new(format!("%\"{}\"%", escape_like(tag))));
        }
    }

    let order = match filter.sort.as_deref() {
        Some("title") => "title COLLATE NOCASE ASC",
        Some("oldest") => "added_at ASC",
        Some("lastOpened") => "last_opened_at DESC NULLS LAST",
        _ => "added_at DESC",
    };
    sql.push_str(&format!(" ORDER BY {}", order));

    let mut stmt = conn.prepare(&sql)?;
    let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(refs.as_slice(), row_to_pattern)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_pattern(conn: &Connection, id: &str) -> AppResult<Pattern> {
    conn.query_row("SELECT * FROM patterns WHERE id = ?1", params![id], row_to_pattern)
        .optional()?
        .ok_or_else(|| AppError::NotFound(id.to_string()))
}

/// Stores a new pattern. `file_path` is where the bytes were copied to, and
/// `file_hash` is the content hash duplicate detection matches on.
#[allow(clippy::too_many_arguments)]
pub fn insert_pattern(
    conn: &Connection,
    id: &str,
    input: &PatternInput,
    file_path: &str,
    format: &str,
    file_hash: &str,
) -> AppResult<Pattern> {
    let status = tidy_status(&input.status);
    // Difficulty is optional; an unrecognised value is dropped rather than
    // stored, so the filter list stays meaningful.
    let difficulty = if DIFFICULTIES.contains(&input.difficulty.as_str()) {
        input.difficulty.as_str()
    } else {
        ""
    };
    let tags_json = serde_json::to_string(&input.tags).unwrap_or_else(|_| "[]".to_string());
    let added = now_ms();

    conn.execute(
        "INSERT INTO patterns
         (id, title, designer, file_path, file_name, format, status, difficulty,
          needle_size, needle_sizes, yarn_weight, yarn_weight_family, tags, notes, added_at, cover_path, file_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'',?16)",
        params![
            id,
            input.title,
            input.designer,
            file_path,
            input.file_name,
            format,
            status,
            difficulty,
            input.needle_size,
            needle_sizes_json(&input.needle_size),
            input.yarn_weight,
            crate::yarn::family_of(&input.yarn_weight),
            tags_json,
            input.notes,
            added,
            file_hash
        ],
    )?;

    // Seed the progress and highlight rows so the UI never has to handle nulls.
    conn.execute(
        "INSERT INTO progress (pattern_id, total_rows, updated_at)
         VALUES (?1, 0, ?2)",
        params![id, added],
    )?;
    let h = HighlightSettings::defaults(id);
    save_highlight(conn, &h)?;

    get_pattern(conn, id)
}

pub fn update_pattern(conn: &Connection, pattern: &Pattern) -> AppResult<Pattern> {
    let tags_json = serde_json::to_string(&pattern.tags).unwrap_or_else(|_| "[]".to_string());
    let status = tidy_status(&pattern.status);
    let difficulty = if DIFFICULTIES.contains(&pattern.difficulty.as_str()) {
        pattern.difficulty.as_str()
    } else {
        ""
    };
    conn.execute(
        "UPDATE patterns SET title=?2, designer=?3, status=?4, difficulty=?5,
         needle_size=?6, needle_sizes=?7, yarn_weight=?8, yarn_weight_family=?9, tags=?10, notes=?11
         WHERE id=?1",
        params![
            pattern.id,
            pattern.title,
            pattern.designer,
            status,
            difficulty,
            pattern.needle_size,
            // Re-derived on every write, like the family below, so correcting
            // the stated size also corrects what the filter matches on.
            needle_sizes_json(&pattern.needle_size),
            pattern.yarn_weight,
            // Re-derived on every write, so correcting the stated weight also
            // corrects the family the filter matches on.
            crate::yarn::family_of(&pattern.yarn_weight),
            tags_json,
            pattern.notes
        ],
    )?;
    get_pattern(conn, &pattern.id)
}

/// Sets only a pattern's status, as the card's "Want to knit" does.
pub fn set_pattern_status(conn: &Connection, id: &str, status: &str) -> AppResult<Pattern> {
    let changed = conn.execute("UPDATE patterns SET status = ?2 WHERE id = ?1", params![id, tidy_status(status)])?;
    if changed == 0 {
        return Err(AppError::NotFound(id.to_string()));
    }
    get_pattern(conn, id)
}

// ---------- duplicates ----------

/// A title as two copies of a pattern would share it: case, punctuation, a
/// file extension, and the "(1)" or "copy" a download adds all left out.
pub fn title_key(title: &str) -> String {
    let lower = title.to_lowercase();
    let stem = ["pdf", "epub"]
        .iter()
        .find_map(|ext| lower.strip_suffix(&format!(".{ext}")))
        .unwrap_or(&lower)
        .to_string();
    let words: Vec<String> = stem
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect();
    // A trailing copy number or "copy" is how a second download is named.
    let mut end = words.len();
    while end > 1 {
        let w = &words[end - 1];
        if w == "copy" || w == "kopie" || w == "kopia" || (w.len() <= 2 && w.chars().all(|c| c.is_ascii_digit())) {
            end -= 1;
        } else {
            break;
        }
    }
    words[..end].join(" ")
}

/// The patterns that look like copies of each other: the same file, or the
/// same title by the same designer (or with one of them unnamed). Each group
/// comes with what is attached to each copy, for choosing which to keep.
pub fn duplicate_groups(conn: &Connection) -> AppResult<Vec<(bool, Vec<(Pattern, i64, i64, i64, String)>)>> {
    let patterns: Vec<(Pattern, String)> = conn
        .prepare("SELECT * FROM patterns ORDER BY added_at")?
        .query_map([], |r| Ok((row_to_pattern(r)?, r.get::<_, String>("file_hash")?)))?
        .collect::<Result<_, _>>()?;

    // Union-find over the two ways of matching, so a pattern is in one group.
    let n = patterns.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn root(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let join = |parent: &mut Vec<usize>, a: usize, b: usize| {
        let (ra, rb) = (root(parent, a), root(parent, b));
        if ra != rb {
            parent[rb] = ra;
        }
    };
    let mut by_hash: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    let mut by_title: std::collections::HashMap<String, Vec<usize>> = std::collections::HashMap::new();
    for (i, (p, hash)) in patterns.iter().enumerate() {
        if !hash.is_empty() {
            match by_hash.get(hash.as_str()) {
                Some(&first) => join(&mut parent, first, i),
                None => {
                    by_hash.insert(hash.as_str(), i);
                }
            }
        }
        let key = title_key(&p.title);
        if !key.is_empty() {
            by_title.entry(key).or_default().push(i);
        }
    }
    for members in by_title.values() {
        for (a_at, &a) in members.iter().enumerate() {
            for &b in &members[a_at + 1..] {
                let (da, db) = (patterns[a].0.designer.trim().to_lowercase(), patterns[b].0.designer.trim().to_lowercase());
                if da.is_empty() || db.is_empty() || da == db {
                    join(&mut parent, a, b);
                }
            }
        }
    }

    let mut groups: std::collections::BTreeMap<usize, Vec<usize>> = std::collections::BTreeMap::new();
    for i in 0..n {
        let r = root(&mut parent, i);
        groups.entry(r).or_default().push(i);
    }
    let count = |sql: &str, id: &str| -> AppResult<i64> { Ok(conn.query_row(sql, params![id], |r| r.get(0))?) };
    let mut out = Vec::new();
    for members in groups.into_values().filter(|m| m.len() > 1) {
        let first_hash = &patterns[members[0]].1;
        let exact = !first_hash.is_empty() && members.iter().all(|&i| &patterns[i].1 == first_hash);
        let mut entries = Vec::new();
        for i in members {
            let (p, _) = &patterns[i];
            let projects = count("SELECT COUNT(*) FROM projects WHERE pattern_id = ?1", &p.id)?;
            let marks = count(
                "SELECT (SELECT COUNT(*) FROM annotations WHERE pattern_id = ?1)
                      + (SELECT COUNT(*) FROM bookmarks WHERE pattern_id = ?1)
                      + (SELECT COUNT(*) FROM pins WHERE pattern_id = ?1)",
                &p.id,
            )?;
            let rows = count("SELECT COALESCE((SELECT total_rows FROM progress WHERE pattern_id = ?1), 0)", &p.id)?;
            entries.push((p.clone(), projects, marks, rows, p.file_path.clone()));
        }
        out.push((exact, entries));
    }
    Ok(out)
}

/// Folds the copies into the one kept, before they are removed: projects,
/// needles and board cards made from a copy now point at the kept pattern;
/// tags are joined; a status, notes or details the kept one lacks are taken
/// from a copy. Highlights, pins and counters stay with their copy and go
/// with it, which is why the copy with the most of them is the one suggested.
pub fn merge_patterns(conn: &Connection, keep: &str, copies: &[String]) -> AppResult<Pattern> {
    let mut kept = get_pattern(conn, keep)?;
    for copy_id in copies.iter().filter(|c| c.as_str() != keep) {
        let copy = get_pattern(conn, copy_id)?;
        conn.execute("UPDATE projects SET pattern_id = ?1 WHERE pattern_id = ?2", params![keep, copy_id])?;
        conn.execute("UPDATE tools SET pattern_id = ?1 WHERE pattern_id = ?2", params![keep, copy_id])?;
        let cards: Vec<(String, String)> = conn
            .prepare("SELECT id, data FROM board_items WHERE kind = 'pattern'")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (item, data) in cards {
            let mut value: serde_json::Value = serde_json::from_str(&data).unwrap_or_default();
            if value.get("patternId").and_then(|v| v.as_str()) == Some(copy_id.as_str()) {
                value["patternId"] = serde_json::Value::String(keep.to_string());
                conn.execute("UPDATE board_items SET data = ?2 WHERE id = ?1", params![item, value.to_string()])?;
            }
        }

        for tag in copy.tags {
            if !kept.tags.iter().any(|t| t.eq_ignore_ascii_case(&tag)) {
                kept.tags.push(tag);
            }
        }
        if kept.status.is_empty() {
            kept.status = copy.status;
        }
        let note = copy.notes.trim();
        if !note.is_empty() && !kept.notes.contains(note) {
            kept.notes = if kept.notes.trim().is_empty() { note.to_string() } else { format!("{}\n\n{}", kept.notes.trim_end(), note) };
        }
        for (mine, theirs) in [
            (&mut kept.designer, copy.designer),
            (&mut kept.difficulty, copy.difficulty),
            (&mut kept.needle_size, copy.needle_size),
            (&mut kept.yarn_weight, copy.yarn_weight),
        ] {
            if mine.trim().is_empty() {
                *mine = theirs;
            }
        }
    }
    update_pattern(conn, &kept)
}

pub fn delete_pattern(conn: &Connection, id: &str) -> AppResult<()> {
    // Child rows go with it via ON DELETE CASCADE.
    conn.execute("DELETE FROM patterns WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn touch_pattern(
    conn: &Connection,
    id: &str,
    page: i64,
    scroll: f64,
) -> AppResult<()> {
    conn.execute(
        "UPDATE patterns SET last_opened_at = ?2, last_page = ?3, last_scroll = ?4 WHERE id = ?1",
        params![id, now_ms(), page, scroll],
    )?;
    Ok(())
}

/// One entry in the yarn weight filter: a family from the standard table, with
/// the number of patterns that fall into it.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YarnWeightFacet {
    pub key: String,
    pub label: String,
    pub count: i64,
}

/// One entry in the needle size filter: a canonical mm key with its labels in
/// both systems and the number of patterns that use it. The labels travel
/// with the facet so the frontend never re-derives them; `us` is empty for a
/// size with no standard US number.
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NeedleSizeFacet {
    pub key: String,
    pub mm: String,
    pub us: String,
    pub count: i64,
}

/// Distinct designers, needle sizes, yarn weight families and tags, for
/// populating the filter sidebar.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facets {
    /// Alphabetical.
    pub designers: Vec<String>,
    /// The same designers with how many patterns each has, most first: the
    /// sidebar shows the top few of a long list, and searches the rest.
    pub designer_counts: Vec<FacetCount>,
    /// Smallest first.
    pub needle_sizes: Vec<NeedleSizeFacet>,
    /// Every family in the standard table, in table order, whether or not any
    /// pattern uses it, so the sidebar reads the same for everyone.
    pub yarn_weights: Vec<YarnWeightFacet>,
    /// Alphabetical.
    pub tags: Vec<String>,
    /// The tags with how many patterns carry each, most first.
    pub tag_counts: Vec<FacetCount>,
}

/// A designer or tag, and how many patterns it is on.
#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FacetCount {
    pub value: String,
    pub count: i64,
}

/// Most used first; the same count, alphabetically.
fn by_use(mut counts: Vec<FacetCount>) -> Vec<FacetCount> {
    counts.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.to_lowercase().cmp(&b.value.to_lowercase())));
    counts
}

pub fn list_facets(conn: &Connection) -> AppResult<Facets> {
    let column = |col: &str| -> AppResult<Vec<String>> {
        let mut stmt = conn.prepare(&format!(
            "SELECT DISTINCT {0} FROM patterns WHERE {0} <> '' ORDER BY {0} COLLATE NOCASE",
            col
        ))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    };

    // Yarn weights come from the fixed table rather than from the data, so the
    // sidebar reads the same way whether or not you happen to own a jumbo
    // pattern, and so the counts line up with the table's own order.
    let mut yarn_weights: Vec<YarnWeightFacet> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT yarn_weight_family, COUNT(*) FROM patterns
             WHERE yarn_weight_family <> '' GROUP BY yarn_weight_family",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        let mut counts: Vec<(String, i64)> = Vec::new();
        for r in rows {
            counts.push(r?);
        }
        for (key, _, _, _) in crate::yarn::FAMILIES {
            let count = counts
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, n)| *n)
                .unwrap_or(0);
            yarn_weights.push(YarnWeightFacet {
                key: key.to_string(),
                label: crate::yarn::label_for(key).to_string(),
                count,
            });
        }
    }

    let mut tags: Vec<String> = Vec::new();
    {
        // Count each exact casing first, then merge spellings that differ
        // only by case, or "Lace" and "lace" both end up in the sidebar. The
        // display form is the most common casing, with ties going to the one
        // seen first.
        let mut exact: Vec<(String, usize)> = Vec::new();
        let mut stmt =
            conn.prepare("SELECT tags FROM patterns WHERE tags <> '[]'")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for r in rows {
            let list: Vec<String> = serde_json::from_str(&r?).unwrap_or_default();
            for t in list {
                match exact.iter_mut().find(|(seen, _)| *seen == t) {
                    Some((_, n)) => *n += 1,
                    None => exact.push((t, 1)),
                }
            }
        }
        for (t, n) in &exact {
            match tags
                .iter()
                .position(|seen: &String| seen.eq_ignore_ascii_case(t))
            {
                Some(pos) => {
                    let kept = exact
                        .iter()
                        .find(|(seen, _)| seen == &tags[pos])
                        .map(|(_, n)| *n)
                        .unwrap_or(0);
                    if *n > kept {
                        tags[pos] = t.clone();
                    }
                }
                None => tags.push(t.clone()),
            }
        }
    }
    tags.sort_by_key(|t| t.to_lowercase());

    // Each tag counted once per pattern, whatever its casing there.
    let mut tag_counts: Vec<FacetCount> = tags.iter().map(|t| FacetCount { value: t.clone(), count: 0 }).collect();
    {
        let mut stmt = conn.prepare("SELECT tags FROM patterns WHERE tags <> '[]'")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for r in rows {
            let mut list: Vec<String> = serde_json::from_str::<Vec<String>>(&r?).unwrap_or_default().iter().map(|t| t.to_lowercase()).collect();
            list.sort();
            list.dedup();
            for t in list {
                if let Some(c) = tag_counts.iter_mut().find(|c| c.value.to_lowercase() == t) {
                    c.count += 1;
                }
            }
        }
    }
    let designer_counts: Vec<FacetCount> = conn
        .prepare("SELECT designer, COUNT(*) FROM patterns WHERE designer <> '' GROUP BY designer")?
        .query_map([], |r| Ok(FacetCount { value: r.get(0)?, count: r.get(1)? }))?
        .collect::<Result<_, _>>()?;

    // Needle sizes are counted in Rust from the derived JSON arrays, like the
    // tags below: each canonical key once per pattern, smallest first, with
    // the mm and US labels filled in from the table.
    let mut needle_sizes: Vec<NeedleSizeFacet> = Vec::new();
    {
        let mut stmt =
            conn.prepare("SELECT needle_sizes FROM patterns WHERE needle_sizes <> '[]'")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        for r in rows {
            let mut keys: Vec<String> = serde_json::from_str(&r?).unwrap_or_default();
            keys.sort();
            keys.dedup();
            for key in keys {
                match needle_sizes.iter_mut().find(|f| f.key == key) {
                    Some(f) => f.count += 1,
                    None => needle_sizes.push(NeedleSizeFacet {
                        mm: crate::needle_size::mm_label(&key),
                        us: crate::needle_size::us_label(&key).to_string(),
                        key,
                        count: 1,
                    }),
                }
            }
        }
    }
    needle_sizes.sort_by(|a, b| {
        let value = |key: &str| key.parse::<f64>().unwrap_or(f64::MAX);
        value(&a.key)
            .partial_cmp(&value(&b.key))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.key.cmp(&b.key))
    });

    Ok(Facets {
        designers: column("designer")?,
        designer_counts: by_use(designer_counts),
        needle_sizes,
        yarn_weights,
        tags,
        tag_counts: by_use(tag_counts),
    })
}


// ---------- counters ----------

/// What one counting action did, so the UI can repaint from a single result
/// rather than doing arithmetic of its own and drifting out of step with the
/// clamping rules.
#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CountOutcome {
    pub pattern_id: String,
    /// The project total after the action. Always one of these two numbers.
    pub total_rows: i64,
    /// Every counter after the action, in display order.
    pub counters: Vec<Counter>,
}

pub fn list_counters(conn: &Connection, pattern_id: &str) -> AppResult<Vec<Counter>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM counters WHERE pattern_id = ?1 ORDER BY position ASC, rowid ASC",
    )?;
    let rows = stmt.query_map(params![pattern_id], row_to_counter)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn row_to_counter(row: &rusqlite::Row) -> rusqlite::Result<Counter> {
    Ok(Counter {
        id: row.get("id")?,
        pattern_id: row.get("pattern_id")?,
        name: row.get("name")?,
        target: row.get("target")?,
        current: row.get("current")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        excluded_from_total: row.get::<_, i64>("excluded_from_total")? != 0,
        position: row.get("position")?,
        hotkey: row.get("hotkey")?,
    })
}

pub fn add_counter(
    conn: &Connection,
    pattern_id: &str,
    input: &CounterInput,
) -> AppResult<Counter> {
    let id = uuid::Uuid::new_v4().to_string();
    let position: i64 = conn.query_row(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM counters WHERE pattern_id = ?1",
        params![pattern_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO counters
           (id, pattern_id, name, target, current, enabled, excluded_from_total, position)
         VALUES (?1,?2,?3,?4,0,?5,?6,?7)",
        params![
            id,
            pattern_id,
            input.name,
            input.target,
            input.enabled as i64,
            input.excluded_from_total as i64,
            position
        ],
    )?;
    Ok(Counter {
        id,
        pattern_id: pattern_id.to_string(),
        name: input.name.clone(),
        target: input.target,
        current: 0,
        enabled: input.enabled,
        excluded_from_total: input.excluded_from_total,
        position,
        hotkey: String::new(),
    })
}

/// Gives a counter its own key, or takes it away with an empty string.
pub fn set_counter_key(conn: &Connection, id: &str, hotkey: &str) -> AppResult<()> {
    let changed = conn.execute("UPDATE counters SET hotkey = ?2 WHERE id = ?1", params![id, hotkey])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("counter {id}")));
    }
    Ok(())
}

pub fn update_counter(
    conn: &Connection,
    id: &str,
    name: &str,
    target: i64,
    excluded: bool,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE counters SET name=?2, target=?3, excluded_from_total=?4 WHERE id=?1",
        params![id, name, target, excluded as i64],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No counter with id {id}.")));
    }
    Ok(())
}

/// Switches a counter on or off.
///
/// Off means the counter keeps its place and its count but stops moving when
/// rows are counted. That is the whole difference between a counter you are
/// working through and one you have set aside.
pub fn set_counter_enabled(
    conn: &Connection,
    id: &str,
    enabled: bool,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE counters SET enabled = ?2 WHERE id = ?1",
        params![id, enabled as i64],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No counter with id {id}.")));
    }
    Ok(())
}

pub fn reset_counter(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE counters SET current = 0 WHERE id = ?1",
        params![id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No counter with id {id}.")));
    }
    Ok(())
}

pub fn delete_counter(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM counters WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No counter with id {id}.")));
    }
    Ok(())
}

/// Moves one counter by `delta` and returns the new state.
///
/// The project total moves with it unless the counter is excluded, which is
/// what the flag is for: a setup row or a side note that is not one of the
/// project's rows.
///
/// One transaction, like count_rows: the counter and the total are written
/// together or not at all.
pub fn count_one(conn: &Connection, id: &str, delta: i64) -> AppResult<CountOutcome> {
    let tx = conn.unchecked_transaction()?;

    let (pattern_id, current, target, excluded) = tx
        .query_row(
            "SELECT pattern_id, current, target, excluded_from_total FROM counters WHERE id = ?1",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No counter with id {id}.")))?;

    let next = clamp_count(current, delta, target);
    let applied = next - current;
    tx.execute(
        "UPDATE counters SET current = ?2 WHERE id = ?1",
        params![id, next],
    )?;

    let total: i64 = tx
        .query_row(
            "SELECT total_rows FROM progress WHERE pattern_id = ?1",
            params![pattern_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let total = if excluded {
        total
    } else {
        total.saturating_add(applied).max(0)
    };
    upsert_total(&tx, &pattern_id, total)?;
    tx.commit()?;

    outcome(conn, &pattern_id, total)
}

/// Applies one counting action across the project: the total, plus every
/// counter that is switched on.
///
/// The total always moves. Each enabled counter moves independently, clamped to
/// its own target, and a counter sitting on its target simply stays there
/// while the total carries on -- the total counts the work, not the target.
///
/// One transaction, because a half-applied count is worse than a failed one:
/// the total and the counters must never disagree about what has been worked.
pub fn count_rows(conn: &Connection, pattern_id: &str, delta: i64) -> AppResult<CountOutcome> {
    let tx = conn.unchecked_transaction()?;

    let total = tx
        .query_row(
            "SELECT total_rows FROM progress WHERE pattern_id = ?1",
            params![pattern_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    let next_total = total.saturating_add(delta).max(0);

    // Collect first, then write, so the reads are not interleaved with the
    // updates on a connection that is mid-transaction.
    let enabled: Vec<(String, i64, i64)> = {
        let mut stmt = tx.prepare(
            "SELECT id, current, target FROM counters
             WHERE pattern_id = ?1 AND enabled = 1",
        )?;
        let rows = stmt.query_map(params![pattern_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out
    };
    for (id, current, target) in enabled {
        let next = clamp_count(current, delta, target);
        tx.execute(
            "UPDATE counters SET current = ?2 WHERE id = ?1",
            params![id, next],
        )?;
    }

    upsert_total(&tx, pattern_id, next_total)?;
    tx.commit()?;

    outcome(conn, pattern_id, next_total)
}

/// One counter's new count, held inside its own limits.
///
/// A target of zero means "no target", which is why an untargeted counter can
/// count past any number; a targeted one stops at its target rather than
/// running on and having to be corrected by hand. The add saturates: a delta
/// straight from IPC can be i64::MAX, and an overflow would panic a debug
/// build rather than clamp.
fn clamp_count(current: i64, delta: i64, target: i64) -> i64 {
    if target > 0 {
        current.saturating_add(delta).clamp(0, target)
    } else {
        current.saturating_add(delta).max(0)
    }
}

fn outcome(conn: &Connection, pattern_id: &str, total: i64) -> AppResult<CountOutcome> {
    Ok(CountOutcome {
        pattern_id: pattern_id.to_string(),
        total_rows: total,
        counters: list_counters(conn, pattern_id)?,
    })
}

// ---------- progress ----------

pub fn get_progress(conn: &Connection, pattern_id: &str) -> AppResult<Progress> {
    let found = conn
        .query_row(
            "SELECT pattern_id, total_rows, updated_at FROM progress WHERE pattern_id = ?1",
            params![pattern_id],
            |r| {
                Ok(Progress {
                    pattern_id: r.get(0)?,
                    total_rows: r.get(1)?,
                    updated_at: r.get(2)?,
                })
            },
        )
        .optional()?
        .unwrap_or_else(|| Progress {
            pattern_id: pattern_id.to_string(),
            ..Default::default()
        });
    Ok(found)
}

pub fn set_total_rows(conn: &Connection, pattern_id: &str, total: i64) -> AppResult<()> {
    upsert_total(conn, pattern_id, total)
}

/// Writes the project total, creating the progress row when none exists.
///
/// A bare UPDATE silently affects zero rows on a pattern whose progress row
/// is missing -- reachable from a partially migrated database -- while the
/// counting paths go on to report the new total, so the stored and reported
/// numbers quietly disagree. The upsert makes the total always land.
fn upsert_total(conn: &Connection, pattern_id: &str, total: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO progress (pattern_id, total_rows, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(pattern_id) DO UPDATE SET
           total_rows = excluded.total_rows, updated_at = excluded.updated_at",
        params![pattern_id, total.max(0), now_ms()],
    )?;
    Ok(())
}

// ---------- highlight ----------

pub fn get_highlight(conn: &Connection, pattern_id: &str) -> AppResult<HighlightSettings> {
    let found = conn
        .query_row(
            "SELECT pattern_id, enabled, offset_y, thickness, width, inset_x,
                    color, opacity, animate, animation_ms
             FROM highlights WHERE pattern_id = ?1",
            params![pattern_id],
            |r| {
                Ok(HighlightSettings {
                    pattern_id: r.get(0)?,
                    enabled: r.get::<_, i64>(1)? != 0,
                    offset_y: r.get(2)?,
                    thickness: r.get(3)?,
                    width: r.get(4)?,
                    inset_x: r.get(5)?,
                    color: r.get(6)?,
                    opacity: r.get(7)?,
                    animate: r.get::<_, i64>(8)? != 0,
                    animation_ms: r.get(9)?,
                })
            },
        )
        .optional()?
        .unwrap_or_else(|| HighlightSettings::defaults(pattern_id));
    Ok(found)
}

pub fn save_highlight(conn: &Connection, h: &HighlightSettings) -> AppResult<()> {
    conn.execute(
        "INSERT INTO highlights
           (pattern_id, enabled, offset_y, thickness, width, inset_x, color, opacity, animate, animation_ms)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(pattern_id) DO UPDATE SET
           enabled=excluded.enabled, offset_y=excluded.offset_y,
           thickness=excluded.thickness, width=excluded.width,
           inset_x=excluded.inset_x, color=excluded.color,
           opacity=excluded.opacity, animate=excluded.animate,
           animation_ms=excluded.animation_ms",
        params![
            h.pattern_id,
            h.enabled as i64,
            h.offset_y,
            h.thickness,
            h.width,
            h.inset_x,
            h.color,
            h.opacity,
            h.animate as i64,
            h.animation_ms
        ],
    )?;
    Ok(())
}

// ---------- app settings ----------

/// Reads a stored setting, falling back to the type's default.
///
/// A setting that will not parse is treated as absent rather than fatal: it
/// means the stored shape changed under us, and refusing to start the app over
/// one bad row would be a poor trade.
pub fn get_setting<T>(conn: &Connection, key: &str) -> AppResult<T>
where
    T: serde::de::DeserializeOwned + Default,
{
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()?;
    Ok(match raw {
        Some(text) => serde_json::from_str(&text).unwrap_or_default(),
        None => T::default(),
    })
}

pub fn set_setting<T: serde::Serialize>(conn: &Connection, key: &str, value: &T) -> AppResult<()> {
    let text = serde_json::to_string(value)?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, text],
    )?;
    Ok(())
}

// ---------- ai history ----------

/// Stores the state before the model changed a pattern, so the change can be
/// undone. Only the most recent is ever used; older ones are pruned.
pub fn record_ai_change(
    conn: &Connection,
    pattern_id: &str,
    before: &Pattern,
    after: &Pattern,
) -> AppResult<()> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ai_history (id, pattern_id, before_json, after_json, created_at)
         VALUES (?1,?2,?3,?4,?5)",
        params![
            id,
            pattern_id,
            serde_json::to_string(before)?,
            serde_json::to_string(after)?,
            now_ms()
        ],
    )?;
    // Keep one step of history: an undo only ever applies to the last change,
    // and an unbounded log of whole patterns would grow without limit.
    conn.execute(
        "DELETE FROM ai_history WHERE pattern_id = ?1 AND id <> (
             SELECT id FROM ai_history WHERE pattern_id = ?1
             ORDER BY created_at DESC, rowid DESC LIMIT 1
         )",
        params![pattern_id],
    )?;
    Ok(())
}

/// The most recent undo point for a pattern, as its id and the "before" state.
///
/// Ordered by rowid as well as the timestamp because two changes inside the
/// same millisecond are indistinguishable by time alone, and picking the wrong
/// one would restore the wrong thing.
pub fn latest_ai_change(
    conn: &Connection,
    pattern_id: &str,
) -> AppResult<Option<(String, Pattern)>> {
    let found = conn
        .query_row(
            "SELECT id, before_json FROM ai_history WHERE pattern_id = ?1
             ORDER BY created_at DESC, rowid DESC LIMIT 1",
            params![pattern_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .optional()?;
    Ok(match found {
        Some((id, json)) => match serde_json::from_str::<Pattern>(&json) {
            Ok(pattern) => Some((id, pattern)),
            // A snapshot that will not parse is no use as an undo point, and
            // is better treated as no history than as a crash on open.
            Err(_) => None,
        },
        None => None,
    })
}

pub fn clear_ai_history(conn: &Connection, pattern_id: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM ai_history WHERE pattern_id = ?1",
        params![pattern_id],
    )?;
    Ok(())
}

// ---------- annotations ----------



pub fn list_annotations(conn: &Connection, pattern_id: &str) -> AppResult<Vec<Annotation>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM annotations WHERE pattern_id = ?1 ORDER BY page ASC, rowid ASC",
    )?;
    let rows = stmt.query_map(params![pattern_id], |row| {
        Ok(Annotation {
            id: row.get("id")?,
            pattern_id: row.get("pattern_id")?,
            kind: row.get("kind")?,
            page: row.get("page")?,
            geometry: row.get("geometry")?,
            quote: row.get("quote")?,
            occurrence: row.get("occurrence")?,
            color: row.get("color")?,
            text: row.get("text")?,
            created_at: row.get("created_at")?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn insert_annotation(
    conn: &Connection,
    pattern_id: &str,
    input: &AnnotationInput,
) -> AppResult<Annotation> {
    let id = uuid::Uuid::new_v4().to_string();
    // An unrecognised kind becomes a highlight, so a row written by a future
    // version can never leave a pattern with a mark nothing knows how to draw.
    let kind = AnnotationKind::parse(&input.kind);
    // Pages are 1-based everywhere the UI shows them, and a 0 here would be an
    // annotation nothing can ever display.
    let page = input.page.max(1);
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO annotations
           (id, pattern_id, kind, page, geometry, quote, occurrence, color, text, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            pattern_id,
            kind.as_str(),
            page,
            input.geometry,
            input.quote,
            input.occurrence,
            input.color,
            input.text,
            created_at
        ],
    )?;
    Ok(Annotation {
        id,
        pattern_id: pattern_id.to_string(),
        kind: kind.as_str().to_string(),
        page,
        geometry: input.geometry.clone(),
        quote: input.quote.clone(),
        occurrence: input.occurrence,
        color: input.color.clone(),
        text: input.text.clone(),
        created_at,
    })
}

pub fn update_annotation_text(
    conn: &Connection,
    id: &str,
    text: &str,
    color: &str,
) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE annotations SET text = ?2, color = ?3 WHERE id = ?1",
        params![id, text, color],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No annotation with id {id}.")));
    }
    Ok(())
}

pub fn delete_annotation(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM annotations WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No annotation with id {id}.")));
    }
    Ok(())
}

// ---------- needles and hooks ----------

/// A tool with the active project it is on, if any. A tool is on at most one
/// active project -- `link_tool` keeps it that way -- and the subquery takes
/// one regardless, so a stray second link could never list a tool twice.
const TOOL_SELECT: &str = "SELECT t.*, pr.id AS active_project_id, COALESCE(pr.name, '') AS active_project_name
     FROM tools t
     LEFT JOIN projects pr ON pr.id = (
         SELECT pt.project_id FROM project_tools pt
         JOIN projects p2 ON p2.id = pt.project_id
         WHERE pt.tool_id = t.id AND p2.status IN ('active', 'paused')
         LIMIT 1)";

fn row_to_tool(row: &rusqlite::Row) -> rusqlite::Result<Tool> {
    Ok(Tool {
        id: row.get("id")?,
        kind: row.get("kind")?,
        size_mm: row.get("size_mm")?,
        length_cm: row.get("length_cm")?,
        cable_cm: row.get("cable_cm")?,
        cable_size: row.get("cable_size")?,
        brand: row.get("brand")?,
        material: row.get("material")?,
        project_id: row.get("active_project_id")?,
        project_name: row.get("active_project_name")?,
        notes: row.get("notes")?,
        added_at: row.get("added_at")?,
    })
}

/// Every tool, smallest first, so a needle size reads down the list in order.
pub fn list_tools(conn: &Connection) -> AppResult<Vec<Tool>> {
    let mut stmt = conn.prepare(&format!(
        "{TOOL_SELECT} ORDER BY t.size_mm ASC, t.kind ASC, t.added_at ASC"
    ))?;
    let rows = stmt.query_map([], row_to_tool)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_tool(conn: &Connection, id: &str) -> AppResult<Tool> {
    conn.query_row(&format!("{TOOL_SELECT} WHERE t.id = ?1"), params![id], row_to_tool)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No needle or hook with id {id}.")))
}

/// Stores a new tool. The input is expected to have been through
/// `tools::clean` already, which is what keeps the measurements consistent.
pub fn insert_tool(conn: &Connection, id: &str, input: &ToolInput) -> AppResult<Tool> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO tools
         (id, kind, size_mm, length_cm, cable_cm, cable_size, brand, material,
          notes, added_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            input.kind,
            input.size_mm,
            input.length_cm,
            input.cable_cm,
            input.cable_size,
            input.brand,
            input.material,
            input.notes,
            now_ms()
        ],
    )?;
    place_tool(&tx, id, input.project_id.as_deref())?;
    tx.commit()?;
    get_tool(conn, id)
}

/// Replaces a tool's details, its project included.
pub fn update_tool(conn: &Connection, id: &str, input: &ToolInput) -> AppResult<Tool> {
    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE tools SET kind = ?2, size_mm = ?3, length_cm = ?4, cable_cm = ?5,
         cable_size = ?6, brand = ?7, material = ?8, notes = ?9
         WHERE id = ?1",
        params![
            id,
            input.kind,
            input.size_mm,
            input.length_cm,
            input.cable_cm,
            input.cable_size,
            input.brand,
            input.material,
            input.notes
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No needle or hook with id {id}.")));
    }
    place_tool(&tx, id, input.project_id.as_deref())?;
    tx.commit()?;
    get_tool(conn, id)
}

/// Puts a tool on an active project, moving it off any other, or frees it
/// with None.
pub fn set_tool_project(conn: &Connection, id: &str, project_id: Option<&str>) -> AppResult<Tool> {
    let found: Option<i64> = conn
        .query_row("SELECT 1 FROM tools WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    if found.is_none() {
        return Err(AppError::NotFound(format!("No needle or hook with id {id}.")));
    }
    let tx = conn.unchecked_transaction()?;
    place_tool(&tx, id, project_id)?;
    tx.commit()?;
    get_tool(conn, id)
}

/// The one place a tool is put on or taken off a project.
///
/// Only active projects are touched: a finished project's tools are its
/// record of what it used, and stay. Taking a tool off an active project
/// removes it from that project altogether -- it was moved or freed, not used
/// to the end -- and putting it on one takes it off any other active one,
/// since a needle is in one project at a time.
fn place_tool(conn: &Connection, tool_id: &str, project_id: Option<&str>) -> AppResult<()> {
    if let Some(p) = project_id {
        let status: Option<String> = conn
            .query_row("SELECT status FROM projects WHERE id = ?1", params![p], |r| r.get(0))
            .optional()?;
        match status.as_deref() {
            None => return Err(AppError::Message("That project is no longer there.".to_string())),
            Some(s) if is_live(s) => {}
            Some(_) => {
                return Err(AppError::Message(
                    "That project is finished or frogged, so nothing more can go on it.".to_string(),
                ))
            }
        }
    }
    conn.execute(
        "DELETE FROM project_tools WHERE tool_id = ?1 AND project_id <> COALESCE(?2, '')
         AND project_id IN (SELECT id FROM projects WHERE status IN ('active', 'paused'))",
        params![tool_id, project_id],
    )?;
    if let Some(p) = project_id {
        conn.execute(
            "INSERT OR IGNORE INTO project_tools (project_id, tool_id, added_at) VALUES (?1, ?2, ?3)",
            params![p, tool_id, now_ms()],
        )?;
    }
    Ok(())
}

pub fn delete_tool(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM tools WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No needle or hook with id {id}.")));
    }
    Ok(())
}

// ---------- projects ----------

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get("id")?,
        name: row.get("name")?,
        pattern_id: row.get("pattern_id")?,
        pattern_title: row.get("pattern_title")?,
        status: row.get("status")?,
        started_at: row.get("started_at")?,
        finished_at: row.get("finished_at")?,
        notes: row.get("notes")?,
        created_at: row.get("created_at")?,
        cover_path: row.get("cover_path")?,
        tool_ids: Vec::new(),
        yarns: Vec::new(),
    })
}

const PROJECT_SELECT: &str = "SELECT pr.*, COALESCE(p.title, '') AS pattern_title
     FROM projects pr LEFT JOIN patterns p ON p.id = pr.pattern_id";

/// Fills in a project's tools and yarns.
fn with_links(conn: &Connection, mut project: Project) -> AppResult<Project> {
    let mut stmt = conn.prepare(
        "SELECT tool_id FROM project_tools WHERE project_id = ?1 ORDER BY added_at, rowid",
    )?;
    project.tool_ids = stmt
        .query_map(params![project.id], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT py.id, py.yarn_id, y.name, py.lot_id, COALESCE(l.dye_lot, '') AS dye_lot, py.leftover_grams
         FROM project_yarns py
         JOIN yarns y ON y.id = py.yarn_id
         LEFT JOIN yarn_lots l ON l.id = py.lot_id
         WHERE py.project_id = ?1 ORDER BY py.added_at, py.rowid",
    )?;
    project.yarns = stmt
        .query_map(params![project.id], |r| {
            Ok(ProjectYarn {
                id: r.get(0)?,
                yarn_id: r.get(1)?,
                yarn_name: r.get(2)?,
                lot_id: r.get(3)?,
                dye_lot: r.get(4)?,
                leftover_grams: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(project)
}

/// Every project: active ones first, the latest started first within each.
pub fn list_projects(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare(&format!(
        "{PROJECT_SELECT} ORDER BY (pr.status = 'active') DESC, (pr.status = 'paused') DESC, pr.started_at DESC, pr.created_at DESC"
    ))?;
    let rows: Vec<Project> = stmt.query_map([], row_to_project)?.collect::<Result<_, _>>()?;
    rows.into_iter().map(|p| with_links(conn, p)).collect()
}

pub fn get_project(conn: &Connection, id: &str) -> AppResult<Project> {
    let project = conn
        .query_row(&format!("{PROJECT_SELECT} WHERE pr.id = ?1"), params![id], row_to_project)
        .optional()?
        .ok_or_else(|| AppError::NotFound("That project is no longer there.".to_string()))?;
    with_links(conn, project)
}

/// The name a project gets when none is typed: its pattern's title, or a
/// plain placeholder.
fn project_name(conn: &Connection, input: &ProjectInput) -> AppResult<String> {
    let typed: String = input.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if !typed.is_empty() {
        return Ok(typed.chars().take(120).collect());
    }
    if let Some(p) = &input.pattern_id {
        let title: Option<String> = conn
            .query_row("SELECT title FROM patterns WHERE id = ?1", params![p], |r| r.get(0))
            .optional()?;
        if let Some(t) = title.filter(|t| !t.trim().is_empty()) {
            return Ok(t);
        }
    }
    Ok("Untitled project".to_string())
}

fn check_pattern(conn: &Connection, pattern_id: Option<&str>) -> AppResult<()> {
    let Some(id) = pattern_id else { return Ok(()) };
    let found: Option<i64> = conn
        .query_row("SELECT 1 FROM patterns WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    if found.is_none() {
        return Err(AppError::Message("That pattern is no longer in the library.".to_string()));
    }
    Ok(())
}

pub fn insert_project(conn: &Connection, id: &str, input: &ProjectInput) -> AppResult<Project> {
    check_pattern(conn, input.pattern_id.as_deref())?;
    let name = project_name(conn, input)?;
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO projects (id, name, pattern_id, status, started_at, finished_at, notes, created_at)
         VALUES (?1, ?2, ?3, 'active', ?4, NULL, ?5, ?6)",
        params![id, name, input.pattern_id, input.started_at.unwrap_or(now), input.notes, now],
    )?;
    sync_links(&tx, id, input)?;
    pattern_in_progress(&tx, input.pattern_id.as_deref())?;
    tx.commit()?;
    get_project(conn, id)
}

/// A pattern being knitted is in progress: starting a project from it, or
/// picking it for one that is active, says so.
fn pattern_in_progress(conn: &Connection, pattern_id: Option<&str>) -> AppResult<()> {
    if let Some(p) = pattern_id {
        conn.execute("UPDATE patterns SET status = 'in-progress' WHERE id = ?1", params![p])?;
    }
    Ok(())
}

/// Saves a project's details. While it is active its tools and yarns are
/// brought to what was sent; a finished project's are its record, so only
/// the name, pattern, dates and notes change.
pub fn update_project(conn: &Connection, id: &str, input: &ProjectInput) -> AppResult<Project> {
    let current = get_project(conn, id)?;
    check_pattern(conn, input.pattern_id.as_deref())?;
    let name = project_name(conn, input)?;
    let tx = conn.unchecked_transaction()?;
    // A finished or frogged project's end date can be corrected; a live one has none.
    let finished_at = if !is_live(&current.status) {
        input.finished_at.or(current.finished_at)
    } else {
        None
    };
    tx.execute(
        "UPDATE projects SET name = ?2, pattern_id = ?3, started_at = ?4, notes = ?5, finished_at = ?6 WHERE id = ?1",
        params![id, name, input.pattern_id, input.started_at.unwrap_or(current.started_at), input.notes, finished_at],
    )?;
    if is_live(&current.status) {
        sync_links(&tx, id, input)?;
    }
    if current.status == "active" && input.pattern_id != current.pattern_id {
        pattern_in_progress(&tx, input.pattern_id.as_deref())?;
    }
    tx.commit()?;
    get_project(conn, id)
}

/// Brings an active project's tools and yarns to the set the dialog sent.
fn sync_links(conn: &Connection, id: &str, input: &ProjectInput) -> AppResult<()> {
    let current: Vec<String> = conn
        .prepare("SELECT tool_id FROM project_tools WHERE project_id = ?1")?
        .query_map(params![id], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    for tool in current.iter().filter(|t| !input.tool_ids.contains(t)) {
        conn.execute(
            "DELETE FROM project_tools WHERE project_id = ?1 AND tool_id = ?2",
            params![id, tool],
        )?;
    }
    for tool in input.tool_ids.iter().filter(|t| !current.contains(t)) {
        let found: Option<i64> = conn
            .query_row("SELECT 1 FROM tools WHERE id = ?1", params![tool], |r| r.get(0))
            .optional()?;
        if found.is_none() {
            return Err(AppError::Message("One of those needles or hooks is no longer there.".to_string()));
        }
        place_tool(conn, tool, Some(id))?;
    }

    let kept: Vec<&str> = input.yarns.iter().filter_map(|y| y.id.as_deref()).collect();
    let existing: Vec<String> = conn
        .prepare("SELECT id FROM project_yarns WHERE project_id = ?1")?
        .query_map(params![id], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    for entry in existing.iter().filter(|e| !kept.contains(&e.as_str())) {
        conn.execute("DELETE FROM project_yarns WHERE id = ?1", params![entry])?;
    }
    for yarn in &input.yarns {
        // Scoped to the yarn, so a lot from another yarn cannot be named.
        if let Some(lot) = &yarn.lot_id {
            let ok: Option<i64> = conn
                .query_row(
                    "SELECT 1 FROM yarn_lots WHERE id = ?1 AND yarn_id = ?2",
                    params![lot, yarn.yarn_id],
                    |r| r.get(0),
                )
                .optional()?;
            if ok.is_none() {
                return Err(AppError::Message("That lot is not one of that yarn's.".to_string()));
            }
        }
        match yarn.id.as_deref().filter(|e| existing.iter().any(|x| x == e)) {
            Some(entry) => {
                conn.execute(
                    "UPDATE project_yarns SET yarn_id = ?2, lot_id = ?3 WHERE id = ?1",
                    params![entry, yarn.yarn_id, yarn.lot_id],
                )?;
            }
            None => {
                let found: Option<i64> = conn
                    .query_row("SELECT 1 FROM yarns WHERE id = ?1", params![yarn.yarn_id], |r| r.get(0))
                    .optional()?;
                if found.is_none() {
                    return Err(AppError::Message("One of those yarns is no longer in the stash.".to_string()));
                }
                conn.execute(
                    "INSERT INTO project_yarns (id, project_id, yarn_id, lot_id, added_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![uuid::Uuid::new_v4().to_string(), id, yarn.yarn_id, yarn.lot_id, now_ms()],
                )?;
            }
        }
    }
    Ok(())
}

/// Finishes a project: its tools are released, and each yarn's leftover, if
/// given, becomes what its lot holds -- tagged as a leftover in the stash, or
/// used up at 0 g. The tools and yarns stay listed on the project, as the
/// record of what it was made with.
pub fn finish_project(conn: &Connection, id: &str, input: &FinishInput) -> AppResult<Project> {
    let project = get_project(conn, id)?;
    if !is_live(&project.status) {
        return Err(AppError::Message("That project is already finished or frogged.".to_string()));
    }
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE projects SET status = 'finished', finished_at = ?2 WHERE id = ?1",
        params![id, input.finished_at.unwrap_or(now)],
    )?;
    tx.execute(
        "UPDATE project_tools SET released_at = ?2 WHERE project_id = ?1 AND released_at IS NULL",
        params![id, now],
    )?;
    tx.execute(
        "UPDATE project_yarns SET released_at = ?2 WHERE project_id = ?1 AND released_at IS NULL",
        params![id, now],
    )?;
    for left in &input.leftovers {
        let Some(grams) = left.grams else { continue };
        if grams < 0 {
            return Err(AppError::Message("Leftovers are a number of grams, 0 or more.".to_string()));
        }
        let Some(entry) = project.yarns.iter().find(|y| y.id == left.entry_id) else {
            return Err(AppError::Message("That yarn is not on this project.".to_string()));
        };
        tx.execute(
            "UPDATE project_yarns SET leftover_grams = ?2 WHERE id = ?1",
            params![entry.id, grams],
        )?;
        // The lot the yarn came from; for a yarn with one lot, that one; for
        // one with none, a lot is made to hold what is left.
        let lot: Option<String> = match &entry.lot_id {
            Some(l) => Some(l.clone()),
            None => tx
                .query_row(
                    "SELECT id FROM yarn_lots WHERE yarn_id = ?1 ORDER BY rowid LIMIT 1",
                    params![entry.yarn_id],
                    |r| r.get(0),
                )
                .optional()?,
        };
        match lot {
            Some(l) => {
                tx.execute(
                    "UPDATE yarn_lots SET grams_left = ?2, leftover = ?3 WHERE id = ?1",
                    params![l, grams, grams > 0],
                )?;
            }
            None => {
                tx.execute(
                    "INSERT INTO yarn_lots (id, yarn_id, dye_lot, balls, grams_left, location, bought_at, leftover)
                     VALUES (?1, ?2, '', 0, ?3, '', NULL, ?4)",
                    params![uuid::Uuid::new_v4().to_string(), entry.yarn_id, grams, grams > 0],
                )?;
            }
        }
    }
    tx.commit()?;
    get_project(conn, id)
}

/// Removes a project. Its tools and yarns are freed with it -- the links go,
/// the needles and yarn stay.
/// Moves a project between active, paused and frogged.
///
/// Pausing keeps its needles and yarn: the knitting is still on them.
/// Frogging releases them, as finishing does, and its yarn is simply back in
/// the stash. A frogged project can be started again: what it had comes back
/// to it, except a needle that has since gone onto another project. Finishing
/// is its own step, with the leftovers (`finish_project`).
pub fn set_project_status(conn: &Connection, id: &str, status: &str) -> AppResult<Project> {
    if !PROJECT_STATUSES.contains(&status) {
        return Err(AppError::Message(format!("A project cannot be “{status}”.")));
    }
    let project = get_project(conn, id)?;
    if project.status == status {
        return Ok(project);
    }
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    match (project.status.as_str(), status) {
        (from, "active" | "paused") if is_live(from) => {
            tx.execute("UPDATE projects SET status = ?2 WHERE id = ?1", params![id, status])?;
        }
        (from, "frogged") if is_live(from) => {
            tx.execute("UPDATE projects SET status = 'frogged', finished_at = ?2 WHERE id = ?1", params![id, now])?;
            tx.execute("UPDATE project_tools SET released_at = ?2 WHERE project_id = ?1 AND released_at IS NULL", params![id, now])?;
            tx.execute("UPDATE project_yarns SET released_at = ?2 WHERE project_id = ?1 AND released_at IS NULL", params![id, now])?;
        }
        ("frogged", "active" | "paused") => {
            // Its needles come back unless another project has one now.
            tx.execute(
                "DELETE FROM project_tools WHERE project_id = ?1 AND tool_id IN (
                     SELECT pt.tool_id FROM project_tools pt JOIN projects p ON p.id = pt.project_id
                     WHERE pt.project_id <> ?1 AND p.status IN ('active', 'paused'))",
                params![id],
            )?;
            tx.execute("UPDATE project_tools SET released_at = NULL WHERE project_id = ?1", params![id])?;
            tx.execute("UPDATE project_yarns SET released_at = NULL WHERE project_id = ?1", params![id])?;
            tx.execute("UPDATE projects SET status = ?2, finished_at = NULL WHERE id = ?1", params![id, status])?;
            if status == "active" {
                pattern_in_progress(&tx, project.pattern_id.as_deref())?;
            }
        }
        ("finished", _) => {
            return Err(AppError::Message("A finished project stays finished.".to_string()));
        }
        (_, "finished") => {
            return Err(AppError::Message("Finishing a project asks about its leftovers: use Finish.".to_string()));
        }
        (from, to) => {
            return Err(AppError::Message(format!("A project cannot go from {from} to {to}.")));
        }
    }
    tx.commit()?;
    get_project(conn, id)
}

pub fn delete_project(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("That project is no longer there.".to_string()));
    }
    conn.execute("DELETE FROM board_items WHERE board_id = ?1", params![id])?;
    Ok(())
}

// ---------- inspiration boards ----------

/// How many pictures a board's card shows, and how many colours.
const CARD_PICTURES: usize = 4;
const CARD_COLOURS: usize = 6;

fn row_to_inspiration(conn: &Connection, id: String, name: String, created_at: i64, updated_at: i64) -> AppResult<InspirationBoard> {
    let items: Vec<(String, String, String, String)> = conn
        .prepare(
            "SELECT id, kind, data, image_file FROM board_items WHERE board_id = ?1
             ORDER BY created_at DESC",
        )?
        .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    let mut pictures = Vec::new();
    let mut colours = Vec::new();
    for (item, kind, data, image) in &items {
        let data: serde_json::Value = serde_json::from_str(data).unwrap_or_default();
        let field = |k: &str| data.get(k).and_then(|v| v.as_str()).map(str::to_string);
        // Only what has a picture to show: a pattern with a cover, a yarn with a photo.
        let has = |sql: &str, id: &str| -> bool {
            conn.query_row(sql, params![id], |r| r.get::<_, String>(0)).map(|f| !f.is_empty()).unwrap_or(false)
        };
        let picture = match kind.as_str() {
            "image" if !image.is_empty() => Some(item.clone()),
            "pattern" => field("patternId").filter(|id| has("SELECT cover_path FROM patterns WHERE id = ?1", id)),
            "yarn" => field("yarnId").filter(|id| has("SELECT photo_path FROM yarns WHERE id = ?1", id)),
            _ => None,
        };
        if let Some(pic) = picture {
            if pictures.len() < CARD_PICTURES {
                pictures.push(BoardPicture { kind: kind.clone(), id: pic });
            }
        }
        if kind == "swatch" && colours.len() < CARD_COLOURS {
            if let Some(c) = field("colour") {
                colours.push(c);
            }
        }
    }
    Ok(InspirationBoard { id, name, created_at, updated_at, item_count: items.len() as i64, pictures, colours })
}

pub fn list_inspiration_boards(conn: &Connection) -> AppResult<Vec<InspirationBoard>> {
    let rows: Vec<(String, String, i64, i64)> = conn
        .prepare("SELECT id, name, created_at, updated_at FROM inspiration_boards ORDER BY updated_at DESC, created_at DESC")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<Result<_, _>>()?;
    rows.into_iter().map(|(id, name, c, u)| row_to_inspiration(conn, id, name, c, u)).collect()
}

pub fn get_inspiration_board(conn: &Connection, id: &str) -> AppResult<InspirationBoard> {
    let (name, c, u): (String, i64, i64) = conn
        .query_row("SELECT name, created_at, updated_at FROM inspiration_boards WHERE id = ?1", params![id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?
        .ok_or_else(|| AppError::NotFound("That board is no longer there.".to_string()))?;
    row_to_inspiration(conn, id.to_string(), name, c, u)
}

/// A board's name: what was typed, or a plain one when nothing was.
fn board_name(name: &str) -> String {
    let name = name.trim();
    if name.is_empty() { "Untitled board".to_string() } else { name.chars().take(120).collect() }
}

pub fn insert_inspiration_board(conn: &Connection, id: &str, name: &str) -> AppResult<InspirationBoard> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO inspiration_boards (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, board_name(name), now],
    )?;
    get_inspiration_board(conn, id)
}

pub fn rename_inspiration_board(conn: &Connection, id: &str, name: &str) -> AppResult<InspirationBoard> {
    let changed = conn.execute(
        "UPDATE inspiration_boards SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, board_name(name), now_ms()],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("That board is no longer there.".to_string()));
    }
    get_inspiration_board(conn, id)
}

/// Removes a board and everything on it, returning its pictures' files.
pub fn delete_inspiration_board(conn: &Connection, id: &str) -> AppResult<Vec<String>> {
    let images = board_images(conn, id)?;
    let changed = conn.execute("DELETE FROM inspiration_boards WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound("That board is no longer there.".to_string()));
    }
    conn.execute("DELETE FROM board_items WHERE board_id = ?1", params![id])?;
    Ok(images)
}

// ---------- boards ----------

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<BoardItem> {
    let data: String = row.get("data")?;
    let image: String = row.get("image_file")?;
    Ok(BoardItem {
        id: row.get("id")?,
        board_id: row.get("board_id")?,
        kind: row.get("kind")?,
        x: row.get("x")?,
        y: row.get("y")?,
        w: row.get("w")?,
        h: row.get("h")?,
        z: row.get("z")?,
        data: serde_json::from_str(&data).unwrap_or_else(|_| serde_json::json!({})),
        has_image: !image.is_empty(),
        created_at: row.get("created_at")?,
    })
}

/// The longest an item's content may be, as JSON: a long note is a few
/// thousand characters; anything far past that is not a note.
const MAX_ITEM_DATA: usize = 20_000;

/// An item's content as stored: a JSON object, of a sane size.
fn item_data(data: &serde_json::Value) -> AppResult<String> {
    if !data.is_object() {
        return Err(AppError::Message("A board item holds an object.".to_string()));
    }
    let text = data.to_string();
    if text.len() > MAX_ITEM_DATA {
        return Err(AppError::Message("That is too much for one item on the board.".to_string()));
    }
    Ok(text)
}

/// A position: any finite number, kept within a reach no one scrolls past.
fn board_coord(v: f64) -> f64 {
    if v.is_finite() { v.clamp(-1_000_000.0, 1_000_000.0) } else { 0.0 }
}

/// A size: from a small sticker to a large picture.
fn board_size(v: f64, fallback: f64) -> f64 {
    if v.is_finite() && v > 0.0 { v.clamp(40.0, 4000.0) } else { fallback }
}

pub fn list_board_items(conn: &Connection, board_id: &str) -> AppResult<Vec<BoardItem>> {
    let mut stmt = conn.prepare("SELECT * FROM board_items WHERE board_id = ?1 ORDER BY z, created_at")?;
    let rows = stmt.query_map(params![board_id], row_to_item)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// That a board is there to put things on: a project, or an inspiration board.
fn board_exists(conn: &Connection, board_id: &str) -> AppResult<()> {
    let found: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?1) OR EXISTS(SELECT 1 FROM inspiration_boards WHERE id = ?1)",
        params![board_id],
        |r| r.get(0),
    )?;
    if found { Ok(()) } else { Err(AppError::NotFound("That board is no longer there.".to_string())) }
}

/// Notes that something on an inspiration board changed, so it sorts first.
fn touch_board(conn: &Connection, board_id: &str) -> AppResult<()> {
    conn.execute("UPDATE inspiration_boards SET updated_at = ?2 WHERE id = ?1", params![board_id, now_ms()])?;
    Ok(())
}

pub fn get_board_item(conn: &Connection, id: &str) -> AppResult<BoardItem> {
    conn.query_row("SELECT * FROM board_items WHERE id = ?1", params![id], row_to_item)
        .optional()?
        .ok_or_else(|| AppError::NotFound("That is no longer on the board.".to_string()))
}

/// Adds an item, on top of everything already on the board.
pub fn insert_board_item(conn: &Connection, id: &str, board_id: &str, input: &BoardItemInput) -> AppResult<BoardItem> {
    board_exists(conn, board_id)?;
    if !BOARD_KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Message(format!("A board cannot hold a “{}”.", input.kind)));
    }
    let data = item_data(input.data.as_ref().unwrap_or(&serde_json::json!({})))?;
    let top: i64 = conn.query_row(
        "SELECT COALESCE(MAX(z), 0) FROM board_items WHERE board_id = ?1",
        params![board_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO board_items (id, board_id, kind, x, y, w, h, z, data, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            id,
            board_id,
            input.kind,
            board_coord(input.x),
            board_coord(input.y),
            board_size(input.w, 220.0),
            board_size(input.h, 160.0),
            top + 1,
            data,
            now_ms()
        ],
    )?;
    touch_board(conn, board_id)?;
    get_board_item(conn, id)
}

/// Moves, resizes, raises or rewrites an item: only what is given changes.
pub fn update_board_item(conn: &Connection, id: &str, patch: &BoardItemPatch) -> AppResult<BoardItem> {
    let current = get_board_item(conn, id)?;
    let data = match &patch.data {
        Some(d) => item_data(d)?,
        None => current.data.to_string(),
    };
    let z = if patch.to_front {
        let top: i64 = conn.query_row(
            "SELECT COALESCE(MAX(z), 0) FROM board_items WHERE board_id = ?1",
            params![current.board_id],
            |r| r.get(0),
        )?;
        if top == current.z { current.z } else { top + 1 }
    } else {
        current.z
    };
    conn.execute(
        "UPDATE board_items SET x = ?2, y = ?3, w = ?4, h = ?5, z = ?6, data = ?7 WHERE id = ?1",
        params![
            id,
            patch.x.map(board_coord).unwrap_or(current.x),
            patch.y.map(board_coord).unwrap_or(current.y),
            patch.w.map(|v| board_size(v, current.w)).unwrap_or(current.w),
            patch.h.map(|v| board_size(v, current.h)).unwrap_or(current.h),
            z,
            data
        ],
    )?;
    touch_board(conn, &current.board_id)?;
    get_board_item(conn, id)
}

/// Removes an item, returning its picture's file name for the caller to delete.
pub fn delete_board_item(conn: &Connection, id: &str) -> AppResult<String> {
    let (board, image): (String, String) = conn
        .query_row("SELECT board_id, image_file FROM board_items WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::NotFound("That is no longer on the board.".to_string()))?;
    conn.execute("DELETE FROM board_items WHERE id = ?1", params![id])?;
    touch_board(conn, &board)?;
    Ok(image)
}

/// Every picture file on a board, so removing its owner can take them too.
fn board_images(conn: &Connection, board_id: &str) -> AppResult<Vec<String>> {
    Ok(conn
        .prepare("SELECT image_file FROM board_items WHERE board_id = ?1 AND image_file <> ''")?
        .query_map(params![board_id], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?)
}

pub fn board_item_image(conn: &Connection, id: &str) -> AppResult<String> {
    Ok(conn
        .query_row("SELECT image_file FROM board_items WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .unwrap_or_default())
}

pub fn set_board_item_image(conn: &Connection, id: &str, file: &str) -> AppResult<()> {
    let changed = conn.execute("UPDATE board_items SET image_file = ?2 WHERE id = ?1", params![id, file])?;
    if changed == 0 {
        return Err(AppError::NotFound("That is no longer on the board.".to_string()));
    }
    Ok(())
}

/// Every picture file a project holds -- its cover and its board's -- so
/// removing the project can take them with it.
pub fn project_files(conn: &Connection, project_id: &str) -> AppResult<(String, Vec<String>)> {
    let cover: String = conn
        .query_row("SELECT cover_path FROM projects WHERE id = ?1", params![project_id], |r| r.get(0))
        .optional()?
        .unwrap_or_default();
    Ok((cover, board_images(conn, project_id)?))
}

pub fn set_project_cover(conn: &Connection, project_id: &str, file: &str) -> AppResult<()> {
    let changed = conn.execute("UPDATE projects SET cover_path = ?2 WHERE id = ?1", params![project_id, file])?;
    if changed == 0 {
        return Err(AppError::NotFound("That project is no longer there.".to_string()));
    }
    Ok(())
}

/// Moves needles put straight on a pattern, or on a project named in words,
/// onto projects, from before projects existed. One project per pattern and
/// per name, as each was one piece of knitting. Once only.
fn move_tools_into_projects(conn: &Connection) -> AppResult<()> {
    let done: bool = get_setting(conn, "tools_into_projects")?;
    if done {
        return Ok(());
    }
    let tx = conn.unchecked_transaction()?;
    let now = now_ms();
    let on_patterns: Vec<(String, String, String)> = tx
        .prepare(
            "SELECT t.id, p.id, p.title FROM tools t JOIN patterns p ON p.id = t.pattern_id
             ORDER BY t.added_at",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let mut by_key: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (tool, pattern, title) in on_patterns {
        let project = match by_key.get(&format!("p:{pattern}")) {
            Some(p) => p.clone(),
            None => {
                let pid = uuid::Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO projects (id, name, pattern_id, status, started_at, notes, created_at)
                     VALUES (?1, ?2, ?3, 'active', ?4, '', ?4)",
                    params![pid, title, pattern, now],
                )?;
                by_key.insert(format!("p:{pattern}"), pid.clone());
                pid
            }
        };
        tx.execute(
            "INSERT OR IGNORE INTO project_tools (project_id, tool_id, added_at) VALUES (?1, ?2, ?3)",
            params![project, tool, now],
        )?;
    }
    let named: Vec<(String, String)> = tx
        .prepare("SELECT id, TRIM(project) FROM tools WHERE pattern_id IS NULL AND TRIM(project) <> '' ORDER BY added_at")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (tool, name) in named {
        let key = format!("n:{}", name.to_lowercase());
        let project = match by_key.get(&key) {
            Some(p) => p.clone(),
            None => {
                let pid = uuid::Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO projects (id, name, pattern_id, status, started_at, notes, created_at)
                     VALUES (?1, ?2, NULL, 'active', ?3, '', ?3)",
                    params![pid, name, now],
                )?;
                by_key.insert(key, pid.clone());
                pid
            }
        };
        tx.execute(
            "INSERT OR IGNORE INTO project_tools (project_id, tool_id, added_at) VALUES (?1, ?2, ?3)",
            params![project, tool, now],
        )?;
    }
    // The old columns stay in the table, empty: SQLite cannot drop a column
    // with a foreign key on every version this runs on.
    tx.execute("UPDATE tools SET pattern_id = NULL, project = ''", [])?;
    set_setting(&tx, "tools_into_projects", &true)?;
    tx.commit()?;
    Ok(())
}

// ---------- page rotations ----------

/// Every turned page of a pattern, in page order. Upright pages are left out.
pub fn list_page_rotations(conn: &Connection, pattern_id: &str) -> AppResult<Vec<PageRotation>> {
    let mut stmt = conn.prepare(
        "SELECT page, rotation FROM page_rotations WHERE pattern_id = ?1 ORDER BY page",
    )?;
    let rows = stmt.query_map(params![pattern_id], |row| {
        Ok(PageRotation {
            page: row.get(0)?,
            rotation: row.get(1)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Turns a page to a rotation, clockwise in degrees.
///
/// Any whole number of degrees is accepted and brought round to 0, 90, 180 or
/// 270, so a caller can add 90 without minding the wrap. Anything between the
/// quarter turns is refused: a page can only be shown square.
pub fn set_page_rotation(
    conn: &Connection,
    pattern_id: &str,
    page: i64,
    rotation: i64,
) -> AppResult<i64> {
    if page < 1 {
        return Err(AppError::Message(format!("There is no page {page}.")));
    }
    if rotation % 90 != 0 {
        return Err(AppError::Message(format!(
            "A page turns in quarter turns, not {rotation}°."
        )));
    }
    let normal = rotation.rem_euclid(360);
    if normal == 0 {
        conn.execute(
            "DELETE FROM page_rotations WHERE pattern_id = ?1 AND page = ?2",
            params![pattern_id, page],
        )?;
    } else {
        conn.execute(
            "INSERT INTO page_rotations (pattern_id, page, rotation) VALUES (?1, ?2, ?3)
             ON CONFLICT(pattern_id, page) DO UPDATE SET rotation = excluded.rotation",
            params![pattern_id, page, normal],
        )?;
    }
    Ok(normal)
}

// ---------- bookmarks ----------

pub fn list_bookmarks(conn: &Connection, pattern_id: &str) -> AppResult<Vec<Bookmark>> {
    let mut stmt = conn.prepare(
        "SELECT * FROM bookmarks WHERE pattern_id = ?1
         ORDER BY sort_order ASC, created_at ASC, rowid ASC",
    )?;
    let rows = stmt.query_map(params![pattern_id], |row| {
        Ok(Bookmark {
            id: row.get("id")?,
            pattern_id: row.get("pattern_id")?,
            page: row.get("page")?,
            title: row.get("title")?,
            sort_order: row.get("sort_order")?,
            created_at: row.get("created_at")?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// Adds a bookmark, at the end or at a given position.
///
/// A position renumbers the ones after it rather than leaving gaps, so the
/// list is always 0, 1, 2 and moving something cannot leave a hole behind.
pub fn add_bookmark(
    conn: &Connection,
    pattern_id: &str,
    page: i64,
    title: &str,
    position: Option<i64>,
) -> AppResult<Bookmark> {
    let id = uuid::Uuid::new_v4().to_string();
    let existing: i64 = conn.query_row(
        "SELECT COUNT(*) FROM bookmarks WHERE pattern_id = ?1",
        params![pattern_id],
        |r| r.get(0),
    )?;
    let at = position.unwrap_or(existing).clamp(0, existing) as usize;

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE bookmarks SET sort_order = sort_order + 1
         WHERE pattern_id = ?1 AND sort_order >= ?2",
        params![pattern_id, at as i64],
    )?;
    tx.execute(
        "INSERT INTO bookmarks (id, pattern_id, page, title, sort_order, created_at)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![id, pattern_id, page.max(1), title, at as i64, now_ms()],
    )?;
    tx.commit()?;

    Ok(Bookmark {
        id,
        pattern_id: pattern_id.to_string(),
        page: page.max(1),
        title: title.to_string(),
        sort_order: at as i64,
        created_at: now_ms(),
    })
}

pub fn rename_bookmark(conn: &Connection, id: &str, title: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE bookmarks SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No bookmark with id {id}.")));
    }
    Ok(())
}

/// Moves a bookmark to a new index, then closes the gap it leaves.
pub fn move_bookmark(conn: &Connection, id: &str, position: i64) -> AppResult<()> {
    let pattern_id: String = conn
        .query_row(
            "SELECT pattern_id FROM bookmarks WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No bookmark with id {id}.")))?;

    // Read the current order out, reorder it in memory, and write it back.
    // Doing it with a set of UPDATE ... sort_order = ? shifts is where gaps and
    // duplicates come from.
    let mut ids: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT id FROM bookmarks WHERE pattern_id = ?1
             ORDER BY sort_order ASC, created_at ASC, rowid ASC",
        )?;
        let rows = stmt.query_map(params![pattern_id], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out
    };
    let from = ids
        .iter()
        .position(|x| x == id)
        .ok_or_else(|| AppError::NotFound(format!("No bookmark with id {id}.")))?;
    let to = (position.max(0) as usize).min(ids.len() - 1);
    let moved = ids.remove(from);
    ids.insert(to, moved);

    let tx = conn.unchecked_transaction()?;
    for (index, bookmark_id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE bookmarks SET sort_order = ?2 WHERE id = ?1",
            params![bookmark_id, index as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_bookmark(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No bookmark with id {id}.")));
    }
    Ok(())
}

// ---------- pins ----------

pub fn list_pins(conn: &Connection, pattern_id: &str) -> AppResult<Vec<Pin>> {
    // Highest z first, so the pin just made is the one on top rather than
    // buried under the ones already there.
    let mut stmt = conn.prepare("SELECT * FROM pins WHERE pattern_id = ?1 ORDER BY z DESC")?;
    let rows = stmt.query_map(params![pattern_id], row_to_pin)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

fn row_to_pin(row: &rusqlite::Row) -> rusqlite::Result<Pin> {
    Ok(Pin {
        id: row.get("id")?,
        pattern_id: row.get("pattern_id")?,
        page: row.get("page")?,
        geometry: row.get("geometry")?,
        quote: row.get("quote")?,
        title: row.get("title")?,
        offset_x: row.get("offset_x")?,
        offset_y: row.get("offset_y")?,
        width: row.get("width")?,
        hidden: row.get::<_, i64>("hidden")? != 0,
        z: row.get("z")?,
        image_file: row.get("image_file")?,
        created_at: row.get("created_at")?,
    })
}

pub fn get_pin(conn: &Connection, id: &str) -> AppResult<Pin> {
    conn.query_row("SELECT * FROM pins WHERE id = ?1", params![id], row_to_pin)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("No pin with id {id}.")))
}

pub fn count_pins(conn: &Connection, pattern_id: &str) -> AppResult<usize> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pins WHERE pattern_id = ?1",
        params![pattern_id],
        |r| r.get(0),
    )?;
    Ok(n.max(0) as usize)
}

pub fn insert_pin(
    conn: &Connection,
    pattern_id: &str,
    input: &PinInput,
    file_name: &str,
) -> AppResult<Pin> {
    let id = uuid::Uuid::new_v4().to_string();
    // Above every existing pin, so a new one is always the topmost.
    let z: i64 = conn.query_row(
        "SELECT COALESCE(MAX(z), -1) + 1 FROM pins WHERE pattern_id = ?1",
        params![pattern_id],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO pins
           (id, pattern_id, page, geometry, quote, title, offset_x, offset_y,
            width, hidden, z, image_file, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,0.72,0.18,0.24,0,?7,?8,?9)",
        params![
            id,
            pattern_id,
            input.page.max(1),
            input.geometry,
            input.quote,
            input.title,
            z,
            file_name,
            now_ms()
        ],
    )?;
    get_pin(conn, &id)
}

/// Moves or resizes a pin's floating card, returning it as stored.
///
/// The fractions are clamped so a card cannot be dragged off the pane or
/// resized to nothing, which would make it unreachable to move back.
pub fn update_pin_placement(
    conn: &Connection,
    id: &str,
    placement: &PinPlacement,
) -> AppResult<Pin> {
    let changed = conn.execute(
        "UPDATE pins SET offset_x = ?2, offset_y = ?3, width = ?4, hidden = ?5
         WHERE id = ?1",
        params![
            id,
            placement.offset_x.clamp(0.0, 1.0),
            placement.offset_y.clamp(0.0, 1.0),
            placement.width.clamp(0.05, 1.0),
            placement.hidden as i64
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No pin with id {id}.")));
    }
    get_pin(conn, id)
}

pub fn rename_pin(conn: &Connection, id: &str, title: &str) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE pins SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("No pin with id {id}.")));
    }
    Ok(())
}

/// Deletes a pin and reports the image file so the caller can remove it.
pub fn delete_pin(conn: &Connection, id: &str) -> AppResult<Option<String>> {
    let file: Option<String> = conn
        .query_row("SELECT image_file FROM pins WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .optional()?;
    match file {
        Some(name) => {
            conn.execute("DELETE FROM pins WHERE id = ?1", params![id])?;
            Ok(Some(name))
        }
        None => Err(AppError::NotFound(format!("No pin with id {id}."))),
    }
}

// ---------- covers ----------

/// The cover file name recorded against a pattern, or an empty string when it
/// has none.
pub fn get_cover(conn: &Connection, pattern_id: &str) -> AppResult<String> {
    let found = conn
        .query_row(
            "SELECT cover_path FROM patterns WHERE id = ?1",
            params![pattern_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();
    Ok(found)
}

/// Records a cover file name against a pattern. An empty name clears it, which
/// is how a cover is removed.
pub fn set_cover(conn: &Connection, pattern_id: &str, file_name: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE patterns SET cover_path = ?2 WHERE id = ?1",
        params![pattern_id, file_name],
    )?;
    Ok(())
}

// ---------- yarn stash ----------

/// Optional filters for the stash view. All fields are optional; empty means
/// "do not filter on this".
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YarnFilter {
    pub search: Option<String>,
    /// Standard yarn weight family, e.g. "dk". Several may be given to widen
    /// the filter, which is an OR within the group like the pattern filter.
    pub yarn_weight: Option<Vec<String>>,
}

fn row_to_lot(row: &rusqlite::Row) -> rusqlite::Result<YarnLot> {
    Ok(YarnLot {
        id: row.get("id")?,
        yarn_id: row.get("yarn_id")?,
        dye_lot: row.get("dye_lot")?,
        balls: row.get("balls")?,
        grams_left: row.get("grams_left")?,
        location: row.get("location")?,
        bought_at: row.get("bought_at")?,
        leftover: row.get("leftover")?,
    })
}

/// The yarn row alone: no lots, and the derived figures left at zero for
/// `with_lots` to fill in.
fn row_to_yarn(row: &rusqlite::Row) -> rusqlite::Result<Yarn> {
    Ok(Yarn {
        id: row.get("id")?,
        name: row.get("name")?,
        brand: row.get("brand")?,
        colourway: row.get("colourway")?,
        yarn_weight: row.get("yarn_weight")?,
        yarn_weight_family: row.get("yarn_weight_family")?,
        metres_per_ball: row.get("metres_per_ball")?,
        grams_per_ball: row.get("grams_per_ball")?,
        photo_path: row.get("photo_path")?,
        notes: row.get("notes")?,
        fibres: serde_json::from_str(&row.get::<_, String>("fibres")?).unwrap_or_default(),
        superwash: row.get("superwash")?,
        added_at: row.get("added_at")?,
        lots: Vec::new(),
        grams_left: 0,
        balls_total: 0.0,
        metres_left: 0,
        projects: Vec::new(),
    })
}

/// Attaches a yarn's lots and fills in the figures derived from them: the
/// grams left across every lot, the total ball count, and the metres that
/// much yarn works out to. The metres need both per-ball figures; with either
/// missing the honest answer is zero rather than a guess.
fn with_lots(conn: &Connection, mut yarn: Yarn) -> AppResult<Yarn> {
    yarn.lots = list_yarn_lots(conn, &yarn.id)?;
    yarn.projects = conn
        .prepare(
            "SELECT DISTINCT pr.name FROM project_yarns py JOIN projects pr ON pr.id = py.project_id
             WHERE py.yarn_id = ?1 AND pr.status IN ('active', 'paused') ORDER BY pr.name",
        )?
        .query_map(params![yarn.id], |r| r.get::<_, String>(0))?
        .collect::<Result<_, _>>()?;
    yarn.grams_left = yarn.lots.iter().map(|l| l.grams_left).sum();
    yarn.balls_total = yarn.lots.iter().map(|l| l.balls).sum();
    yarn.metres_left = if yarn.grams_per_ball > 0 && yarn.metres_per_ball > 0 {
        (yarn.grams_left as f64 / yarn.grams_per_ball as f64 * yarn.metres_per_ball as f64).round()
            as i64
    } else {
        0
    };
    Ok(yarn)
}

pub fn list_yarn_lots(conn: &Connection, yarn_id: &str) -> AppResult<Vec<YarnLot>> {
    let mut stmt =
        conn.prepare("SELECT * FROM yarn_lots WHERE yarn_id = ?1 ORDER BY rowid ASC")?;
    let rows = stmt.query_map(params![yarn_id], row_to_lot)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_yarn(conn: &Connection, id: &str) -> AppResult<Yarn> {
    let yarn = conn
        .query_row("SELECT * FROM yarns WHERE id = ?1", params![id], row_to_yarn)
        .optional()?
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    with_lots(conn, yarn)
}

pub fn list_yarns(conn: &Connection, filter: &YarnFilter) -> AppResult<Vec<Yarn>> {
    // The free-text term is parameter ?1 and is always present, so an empty
    // search becomes "%%" and matches everything.
    let term = match filter.search.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(s) => format!("%{}%", escape_like(s.trim())),
        None => "%".to_string(),
    };
    let mut sql = String::from(
        "SELECT * FROM yarns WHERE 1=1 \
         AND (name LIKE ?1 ESCAPE '\\' OR brand LIKE ?1 ESCAPE '\\' \
         OR colourway LIKE ?1 ESCAPE '\\' OR notes LIKE ?1 ESCAPE '\\')",
    );
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(term)];

    // Yarn weight is an OR within itself, the same as the pattern filter:
    // picking DK and Aran means "either", not "both".
    if let Some(families) = filter.yarn_weight.as_ref().filter(|f| !f.is_empty()) {
        let mut placeholders = Vec::new();
        for family in families.iter().filter(|f| !f.is_empty()) {
            args.push(Box::new(family.clone()));
            placeholders.push(format!("?{}", args.len()));
        }
        if !placeholders.is_empty() {
            sql.push_str(&format!(
                " AND yarn_weight_family IN ({})",
                placeholders.join(", ")
            ));
        }
    }
    sql.push_str(" ORDER BY added_at DESC");

    let mut stmt = conn.prepare(&sql)?;
    let refs: Vec<&dyn rusqlite::ToSql> = args.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(refs.as_slice(), row_to_yarn)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(with_lots(conn, r?)?);
    }
    Ok(out)
}

/// A fibre content as stored: names trimmed, empty ones dropped, a fibre
/// named twice (in any case) counted once with its shares added, and each
/// share kept between 0 and 100. Whether they add up to 100 is for the form to
/// point out; a ball band that says "wool, nylon" with no shares is still
/// worth keeping.
pub fn tidy_fibres(fibres: &[crate::models::Fibre]) -> String {
    let mut out: Vec<crate::models::Fibre> = Vec::new();
    for f in fibres {
        let name: String = f.name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(40).collect();
        if name.is_empty() {
            continue;
        }
        let percent = if f.percent.is_finite() { (f.percent.clamp(0.0, 100.0) * 10.0).round() / 10.0 } else { 0.0 };
        match out.iter_mut().find(|o| o.name.eq_ignore_ascii_case(&name)) {
            Some(o) => o.percent = (o.percent + percent).min(100.0),
            None => out.push(crate::models::Fibre { name, percent }),
        }
    }
    serde_json::to_string(&out).unwrap_or_else(|_| "[]".to_string())
}

/// Stores a new yarn with its lots, in one transaction so a failure halfway
/// cannot leave a yarn with only some of its lots.
pub fn insert_yarn(conn: &Connection, id: &str, input: &YarnInput) -> AppResult<Yarn> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO yarns
         (id, name, brand, colourway, yarn_weight, yarn_weight_family,
          metres_per_ball, grams_per_ball, photo_path, notes, added_at, fibres, superwash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'',?9,?10,?11,?12)",
        params![
            id,
            input.name,
            input.brand,
            input.colourway,
            input.yarn_weight,
            crate::yarn::family_of(&input.yarn_weight),
            input.metres_per_ball,
            input.grams_per_ball,
            input.notes,
            now_ms(),
            tidy_fibres(&input.fibres),
            input.superwash
        ],
    )?;
    for lot in &input.lots {
        insert_lot(&tx, id, lot)?;
    }
    tx.commit()?;
    get_yarn(conn, id)
}

fn insert_lot(
    conn: &Connection,
    yarn_id: &str,
    lot: &crate::models::YarnLotInput,
) -> AppResult<()> {
    let id = lot
        .id
        .clone()
        .filter(|i| !i.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    conn.execute(
        "INSERT INTO yarn_lots (id, yarn_id, dye_lot, balls, grams_left, location, bought_at, leftover)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            id,
            yarn_id,
            lot.dye_lot,
            lot.balls,
            lot.grams_left,
            lot.location,
            lot.bought_at,
            lot.leftover
        ],
    )?;
    Ok(())
}

/// Writes the whole yarn back, lots included.
///
/// The lots are reconciled rather than rewritten wholesale: an id the stash
/// already knows is updated in place, an id that is gone from what the caller
/// sent is deleted, and a lot with a new or empty id is inserted. One
/// transaction, so the yarn and its lots are written together or not at all.
pub fn update_yarn(conn: &Connection, yarn: &Yarn) -> AppResult<Yarn> {
    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE yarns SET name=?2, brand=?3, colourway=?4, yarn_weight=?5,
         yarn_weight_family=?6, metres_per_ball=?7, grams_per_ball=?8, notes=?9,
         fibres=?10, superwash=?11
         WHERE id=?1",
        params![
            yarn.id,
            yarn.name,
            yarn.brand,
            yarn.colourway,
            yarn.yarn_weight,
            // Re-derived on every write, like patterns, so correcting the
            // stated weight also corrects the family the filter matches on.
            crate::yarn::family_of(&yarn.yarn_weight),
            yarn.metres_per_ball,
            yarn.grams_per_ball,
            yarn.notes,
            tidy_fibres(&yarn.fibres),
            yarn.superwash
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(yarn.id.clone()));
    }

    let existing: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM yarn_lots WHERE yarn_id = ?1")?;
        let rows = stmt.query_map(params![yarn.id], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        out
    };
    let mut kept: Vec<&String> = Vec::new();
    for lot in &yarn.lots {
        if !lot.id.is_empty() && existing.contains(&lot.id) {
            // Scoped to the yarn as well as the id, so a lot can never be
            // rewritten through another yarn's update.
            tx.execute(
                "UPDATE yarn_lots SET dye_lot=?3, balls=?4, grams_left=?5, location=?6, bought_at=?7, leftover=?8
                 WHERE id=?1 AND yarn_id=?2",
                params![
                    lot.id,
                    yarn.id,
                    lot.dye_lot,
                    lot.balls,
                    lot.grams_left,
                    lot.location,
                    lot.bought_at,
                    lot.leftover
                ],
            )?;
            kept.push(&lot.id);
        } else {
            let id = if lot.id.is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                lot.id.clone()
            };
            tx.execute(
                "INSERT INTO yarn_lots (id, yarn_id, dye_lot, balls, grams_left, location, bought_at, leftover)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![
                    id,
                    yarn.id,
                    lot.dye_lot,
                    lot.balls,
                    lot.grams_left,
                    lot.location,
                    lot.bought_at,
                    lot.leftover
                ],
            )?;
        }
    }
    for stale in existing.iter().filter(|id| !kept.contains(id)) {
        tx.execute("DELETE FROM yarn_lots WHERE id = ?1", params![stale])?;
    }
    tx.commit()?;
    get_yarn(conn, &yarn.id)
}

pub fn delete_yarn(conn: &Connection, id: &str) -> AppResult<()> {
    // Lots go with it via ON DELETE CASCADE.
    let changed = conn.execute("DELETE FROM yarns WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(id.to_string()));
    }
    Ok(())
}

/// The photo file name recorded against a yarn, or an empty string when it
/// has none.
pub fn get_yarn_photo(conn: &Connection, yarn_id: &str) -> AppResult<String> {
    let found = conn
        .query_row(
            "SELECT photo_path FROM yarns WHERE id = ?1",
            params![yarn_id],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .unwrap_or_default();
    Ok(found)
}

/// Records a photo file name against a yarn. An empty name clears it, which
/// is how a photo is removed.
pub fn set_yarn_photo(conn: &Connection, yarn_id: &str, file_name: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE yarns SET photo_path = ?2 WHERE id = ?1",
        params![yarn_id, file_name],
    )?;
    Ok(())
}

/// One entry in the stash's weight filter: a family from the standard table,
/// with the number of yarns that fall into it. The same shape `list_facets`
/// uses for patterns, so the sidebar code can treat them alike.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YarnFamilyFacet {
    pub key: String,
    pub label: String,
    pub count: i64,
}

pub fn yarn_facets(conn: &Connection) -> AppResult<Vec<YarnFamilyFacet>> {
    let mut counts: Vec<(String, i64)> = Vec::new();
    {
        let mut stmt = conn.prepare(
            "SELECT yarn_weight_family, COUNT(*) FROM yarns
             WHERE yarn_weight_family <> '' GROUP BY yarn_weight_family",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for r in rows {
            counts.push(r?);
        }
    }
    // Yarn weights come from the fixed table rather than from the data, so
    // the filter reads the same whether or not you happen to own a jumbo
    // yarn, and the counts line up with the table's own order.
    let mut out: Vec<YarnFamilyFacet> = Vec::new();
    for (key, _, _, _) in crate::yarn::FAMILIES {
        let count = counts
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, n)| *n)
            .unwrap_or(0);
        out.push(YarnFamilyFacet {
            key: key.to_string(),
            label: crate::yarn::label_for(key).to_string(),
            count,
        });
    }
    Ok(out)
}
