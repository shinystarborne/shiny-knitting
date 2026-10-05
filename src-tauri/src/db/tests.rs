//! Tests for the data layer: filtering, row arithmetic, and highlight storage.

use super::*;
use crate::models::{
    AnnotationInput, Counter, CounterInput, HighlightSettings, Pattern, PinInput, PinPlacement,
    Yarn, YarnInput, YarnLot, YarnLotInput,
};

/// A connection against a throwaway in-memory database.
fn test_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    migrate(&conn).expect("migrate");
    conn
}

/// The same helper, for tests in other modules that need a real schema.
pub fn open_test_db() -> Connection {
    test_db()
}

fn sample(conn: &Connection, title: &str, designer: &str, status: &str, tags: &[&str]) -> Pattern {
    let input = PatternInput {
        title: title.to_string(),
        designer: designer.to_string(),
        file_name: format!("{}.pdf", title),
        bytes: Some(vec![]),
        source_path: None,
        status: status.to_string(),
        difficulty: "intermediate".to_string(),
        needle_size: "4mm".to_string(),
        yarn_weight: String::new(),
        tags: tags.iter().map(|t| t.to_string()).collect(),
        notes: String::new(),
    };
    let id = uuid::Uuid::new_v4().to_string();
    insert_pattern(conn, &id, &input, &format!("C:/lib/{}.pdf", id), "pdf", "").expect("insert")
}

/// A pattern with a stated yarn weight, for the weight filter tests.
fn with_yarn(conn: &Connection, title: &str, weight: &str) -> Pattern {
    let mut p = sample(conn, title, "Someone", "want-to-knit", &[]);
    p.yarn_weight = weight.to_string();
    update_pattern(conn, &p).expect("update")
}

/// A filter with only the yarn weights set.
fn yarn_filter(weights: &[&str]) -> Filter {
    Filter {
        yarn_weight: Some(weights.iter().map(|w| w.to_string()).collect()),
        ..Filter::default()
    }
}

/// A counter that counts as soon as rows are counted, the common case.
fn enabled_counter(conn: &Connection, pattern_id: &str, name: &str, target: i64) -> Counter {
    add_counter(
        conn,
        pattern_id,
        &CounterInput {
            name: name.to_string(),
            target,
            enabled: true,
            excluded_from_total: false,
        },
    )
    .expect("add counter")
}

#[test]
fn a_counter_key_is_stored_and_cleared() {
    let conn = test_db();
    let p = sample(&conn, "Jumper", "A", "in-progress", &[]);
    let c = enabled_counter(&conn, &p.id, "Sleeve", 40);
    assert_eq!(c.hotkey, "", "a new counter has no key");

    set_counter_key(&conn, &c.id, "KeyS").unwrap();
    assert_eq!(list_counters(&conn, &p.id).unwrap()[0].hotkey, "KeyS");
    set_counter_key(&conn, &c.id, "").unwrap();
    assert_eq!(list_counters(&conn, &p.id).unwrap()[0].hotkey, "");

    assert!(set_counter_key(&conn, "no-such-counter", "KeyX").is_err());
}

/// Finds one counter in a result by id, so a test can assert on it without
/// depending on the order the rows happen to come back in.
fn counter<'a>(out: &'a CountOutcome, id: &str) -> &'a Counter {
    out.counters
        .iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("no counter {id} in the result"))
}

#[test]
fn the_yarn_family_is_derived_when_a_pattern_is_written() {
    let conn = test_db();
    let p = with_yarn(&conn, "Aran Cardigan", "aran");
    assert_eq!(p.yarn_weight, "aran");
    assert_eq!(p.yarn_weight_family, "aran");

    // The family is derived, never taken on trust: a metre figure is read
    // into the family it belongs to.
    let q = with_yarn(&conn, "Sock", "230 m/100g");
    assert_eq!(q.yarn_weight_family, "dk");

    // Something unrecognisable leaves the family empty rather than guessing.
    let r = with_yarn(&conn, "Mystery", "hand-dyed local spin");
    assert_eq!(r.yarn_weight, "hand-dyed local spin");
    assert_eq!(r.yarn_weight_family, "");
}

#[test]
fn correcting_the_weight_corrects_the_family() {
    // Otherwise a pattern edited from "aran" to "lace" would keep filtering
    // under the old weight, which is worse than having no filter at all.
    let conn = test_db();
    let mut p = with_yarn(&conn, "Cowl", "aran");
    assert_eq!(p.yarn_weight_family, "aran");

    p.yarn_weight = "lace weight".to_string();
    let saved = update_pattern(&conn, &p).unwrap();
    assert_eq!(saved.yarn_weight_family, "lace");
}

#[test]
fn patterns_can_be_filtered_by_yarn_weight() {
    let conn = test_db();
    with_yarn(&conn, "A", "fingering");
    with_yarn(&conn, "B", "aran");
    with_yarn(&conn, "C", "180 m/100g");
    // No weight at all, which must never be swept into a family's results.
    sample(&conn, "D", "Someone", "want-to-knit", &[]);

    let titles = |f: Filter| -> Vec<String> {
        let mut rows = list_patterns(&conn, &f).unwrap();
        rows.sort_by(|a, b| a.title.cmp(&b.title));
        rows.into_iter().map(|p| p.title).collect()
    };

    assert_eq!(titles(yarn_filter(&["aran"])), vec!["B", "C"]);
    // Several weights are an OR within the group.
    assert_eq!(
        titles(yarn_filter(&["aran", "fingering"])),
        vec!["A", "B", "C"]
    );
    // An empty group filters nothing rather than everything.
    assert_eq!(titles(yarn_filter(&[])).len(), 4);
}

#[test]
fn yarn_weight_filters_combine_with_the_others() {
    let conn = test_db();
    with_yarn(&conn, "A", "aran");
    with_yarn(&conn, "B", "dk");

    let both = Filter {
        status: Some("want-to-knit".to_string()),
        ..yarn_filter(&["aran"])
    };
    assert_eq!(list_patterns(&conn, &both).unwrap().len(), 1);

    // A status that matches nothing empties the result even with a weight set.
    let none = Filter {
        status: Some("finished".to_string()),
        ..yarn_filter(&["aran", "dk"])
    };
    assert!(list_patterns(&conn, &none).unwrap().is_empty());
}

#[test]
fn the_yarn_facets_list_every_family_with_its_count() {
    let conn = test_db();
    with_yarn(&conn, "A", "aran");
    with_yarn(&conn, "B", "180 m/100g");
    with_yarn(&conn, "C", "fingering");

    let facets = list_facets(&conn).unwrap();
    // Every family in the table is present whether or not it is used, so the
    // sidebar reads the same for everyone.
    assert_eq!(facets.yarn_weights.len(), crate::yarn::FAMILIES.len());
    let count = |key: &str| -> i64 {
        facets
            .yarn_weights
            .iter()
            .find(|f| f.key == key)
            .unwrap_or_else(|| panic!("no facet for {key}"))
            .count
    };
    assert_eq!(count("aran"), 2, "the named one and the 75 m one");
    assert_eq!(count("fingering"), 1);
    assert_eq!(count("jumbo"), 0, "unused but still listed");
    // Table order, lightest first, so the filter reads as a scale.
    let keys: Vec<&str> = facets.yarn_weights.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys[0], "lace");
    assert_eq!(*keys.last().unwrap(), "jumbo");
}

#[test]
fn a_library_built_before_yarn_weights_is_migrated() {
    // The old schema, with a pattern that already states a weight in its notes
    // and no columns for it.
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute_batch(
        "CREATE TABLE patterns (
             id TEXT PRIMARY KEY, title TEXT NOT NULL, designer TEXT NOT NULL DEFAULT '',
             file_path TEXT NOT NULL, file_name TEXT NOT NULL, format TEXT NOT NULL,
             status TEXT NOT NULL, difficulty TEXT NOT NULL DEFAULT '',
             needle_size TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
             notes TEXT NOT NULL DEFAULT '', added_at INTEGER NOT NULL,
             last_opened_at INTEGER, last_page INTEGER NOT NULL DEFAULT 0,
             last_scroll REAL NOT NULL DEFAULT 0
         );
         INSERT INTO patterns (id, title, file_path, file_name, format, status, added_at)
         VALUES ('a', 'Old', 'C:/x.pdf', 'x.pdf', 'pdf', 'want-to-knit', 1);
        ",
    )
    .expect("seed old schema");

    migrate(&conn).expect("migrate");

    let columns = |c: &str| -> bool { column_exists(&conn, "patterns", c).unwrap() };
    assert!(columns("yarn_weight"));
    assert!(columns("yarn_weight_family"));
    assert!(columns("cover_path"), "the earlier migration still runs");
}

// ---------- needle sizes ----------

/// A pattern with a stated needle size, for the size filter tests.
fn with_needles(conn: &Connection, title: &str, size: &str) -> Pattern {
    let mut p = sample(conn, title, "Someone", "want-to-knit", &[]);
    p.needle_size = size.to_string();
    update_pattern(conn, &p).expect("update")
}

/// A filter with only the needle sizes set.
fn needle_filter(sizes: &[&str]) -> Filter {
    Filter {
        needle_sizes: Some(sizes.iter().map(|s| s.to_string()).collect()),
        ..Filter::default()
    }
}

/// The derived `needle_sizes` column as stored, parsed back.
fn stored_sizes(conn: &Connection, id: &str) -> Vec<String> {
    let raw: String = conn
        .query_row("SELECT needle_sizes FROM patterns WHERE id = ?1", [id], |r| r.get(0))
        .expect("row");
    serde_json::from_str(&raw).expect("a JSON array")
}

#[test]
fn the_needle_sizes_are_derived_when_a_pattern_is_written() {
    let conn = test_db();
    // sample() states "4mm", so insert derives it straight away.
    let p = sample(&conn, "Sock", "A", "want-to-knit", &[]);
    assert_eq!(stored_sizes(&conn, &p.id), vec!["4"]);

    // Correcting the stated size re-derives the list, like the yarn family.
    let p = with_needles(&conn, "Sock", "3.5mm and 4mm");
    assert_eq!(stored_sizes(&conn, &p.id), vec!["3.5", "4"]);

    // Something unrecognisable yields an empty list rather than a guess.
    let p = with_needles(&conn, "Sock", "some needles");
    assert_eq!(stored_sizes(&conn, &p.id), Vec::<String>::new());
}

#[test]
fn patterns_can_be_filtered_by_needle_size() {
    let conn = test_db();
    with_needles(&conn, "Sock", "3.5mm and 4mm");
    // Neighbours that a bare substring match would wrongly include.
    with_needles(&conn, "Mitts", "4.5mm");
    with_needles(&conn, "Blanket", "14mm");

    let hits = |f: Filter| -> Vec<String> {
        list_patterns(&conn, &f).unwrap().into_iter().map(|p| p.title).collect()
    };
    assert_eq!(hits(needle_filter(&["4"])), vec!["Sock"]);
    assert_eq!(hits(needle_filter(&["3.5"])), vec!["Sock"]);
    assert!(hits(needle_filter(&["5"])).is_empty());
    // Several sizes are an OR within the group.
    assert_eq!(hits(needle_filter(&["4", "5"])), vec!["Sock"]);
    // An empty group filters nothing rather than everything.
    assert_eq!(hits(needle_filter(&[])).len(), 3);

    let facets = list_facets(&conn).unwrap();
    let four = facets.needle_sizes.iter().find(|f| f.key == "4").expect("4 mm facet");
    assert_eq!((four.mm.as_str(), four.us.as_str(), four.count), ("4 mm", "6", 1));
    let keys: Vec<&str> = facets.needle_sizes.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys, vec!["3.5", "4", "4.5", "14"], "numeric order, smallest first");
}

#[test]
fn a_library_built_before_needle_sizes_is_migrated() {
    // The schema as it was before the derived column, with rows that already
    // state a size and one that does not.
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute_batch(
        "CREATE TABLE patterns (
             id TEXT PRIMARY KEY, title TEXT NOT NULL, designer TEXT NOT NULL DEFAULT '',
             file_path TEXT NOT NULL, file_name TEXT NOT NULL, format TEXT NOT NULL,
             status TEXT NOT NULL, difficulty TEXT NOT NULL DEFAULT '',
             needle_size TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
             notes TEXT NOT NULL DEFAULT '', added_at INTEGER NOT NULL,
             last_opened_at INTEGER, last_page INTEGER NOT NULL DEFAULT 0,
             last_scroll REAL NOT NULL DEFAULT 0
         );
         INSERT INTO patterns (id, title, file_path, file_name, format, status, needle_size, added_at)
         VALUES ('a', 'Old Sock', 'C:/x.pdf', 'x.pdf', 'pdf', 'want-to-knit', 'US 6 and 5mm', 1);
         INSERT INTO patterns (id, title, file_path, file_name, format, status, needle_size, added_at)
         VALUES ('b', 'Unstated', 'C:/y.pdf', 'y.pdf', 'pdf', '', '', 1);
        ",
    )
    .expect("seed old schema");

    migrate(&conn).expect("migrate");

    assert!(column_exists(&conn, "patterns", "needle_sizes").unwrap());
    assert_eq!(stored_sizes(&conn, "a"), vec!["4", "5"]);
    assert_eq!(stored_sizes(&conn, "b"), Vec::<String>::new(), "nothing stated, nothing derived");

    // Idempotent: a second migrate leaves the derived sizes alone.
    migrate(&conn).expect("second migrate");
    assert_eq!(stored_sizes(&conn, "a"), vec!["4", "5"]);
}

#[test]
fn insert_seeds_progress_and_highlight() {
    let conn = test_db();
    let p = sample(&conn, "Lace Sock", "Jess", "want-to-knit", &[]);

    let progress = get_progress(&conn, &p.id).unwrap();
    assert_eq!(progress.total_rows, 0);
    // A new pattern has no counters; the ones it gets are the user's to add.
    assert!(list_counters(&conn, &p.id).unwrap().is_empty());

    // A pattern gets usable highlight settings without the caller asking.
    let h = get_highlight(&conn, &p.id).unwrap();
    // Off until wanted: most patterns are read, not counted against a chart.
    assert!(!h.enabled);
    assert_eq!(h.pattern_id, p.id);
    // 30% rather than the old 90%: the point of the line is to mark a spot,
    // and at 90% it hid the text it was marking.
    assert!((h.opacity - 0.3).abs() < f64::EPSILON, "opacity was {}", h.opacity);
}

#[test]
fn migration_moves_only_the_old_default_opacity() {
    // A library from before the default changed: one line left at the old
    // 0.9, one deliberately dimmed, one deliberately strengthened.
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute_batch(
        "CREATE TABLE highlights (
             pattern_id TEXT PRIMARY KEY,
             enabled INTEGER NOT NULL DEFAULT 1,
             offset_y REAL NOT NULL DEFAULT 0.35,
             thickness REAL NOT NULL DEFAULT 3,
             width REAL NOT NULL DEFAULT 0,
             inset_x REAL NOT NULL DEFAULT 24,
             color TEXT NOT NULL DEFAULT '#e5484d',
             opacity REAL NOT NULL DEFAULT 0.9,
             animate INTEGER NOT NULL DEFAULT 1,
             animation_ms INTEGER NOT NULL DEFAULT 260
         );
         INSERT INTO highlights (pattern_id, opacity) VALUES ('untouched', 0.9);
         INSERT INTO highlights (pattern_id, opacity) VALUES ('dimmed', 0.15);
         INSERT INTO highlights (pattern_id, opacity) VALUES ('strong', 1.0);
        ",
    )
    .expect("seed old schema");

    migrate(&conn).expect("migrate");

    let opacity = |id: &str| -> f64 {
        conn.query_row("SELECT opacity FROM highlights WHERE pattern_id = ?1", [id], |r| {
            r.get(0)
        })
        .expect("row")
    };
    assert!((opacity("untouched") - 0.3).abs() < 0.0001, "was {}", opacity("untouched"));
    // Deliberate choices survive the migration.
    assert!((opacity("dimmed") - 0.15).abs() < 0.0001);
    assert!((opacity("strong") - 1.0).abs() < 0.0001);
}

#[test]
fn migration_turns_off_only_lines_left_on_the_factory_setting() {
    // A library from before the line was off by default: one line untouched
    // but moved by clicking, one restyled and on, one already switched off.
    let conn = Connection::open_in_memory().expect("in-memory db");
    conn.execute_batch(
        "CREATE TABLE highlights (
             pattern_id TEXT PRIMARY KEY,
             enabled INTEGER NOT NULL DEFAULT 1,
             offset_y REAL NOT NULL DEFAULT 0.35,
             thickness REAL NOT NULL DEFAULT 3,
             width REAL NOT NULL DEFAULT 0,
             inset_x REAL NOT NULL DEFAULT 24,
             color TEXT NOT NULL DEFAULT '#e5484d',
             opacity REAL NOT NULL DEFAULT 0.3,
             animate INTEGER NOT NULL DEFAULT 1,
             animation_ms INTEGER NOT NULL DEFAULT 260
         );
         INSERT INTO highlights (pattern_id, offset_y) VALUES ('untouched', 0.71);
         INSERT INTO highlights (pattern_id, thickness, opacity) VALUES ('restyled', 12, 0.35);
         INSERT INTO highlights (pattern_id, enabled) VALUES ('already-off', 0);
        ",
    )
    .expect("seed old schema");

    migrate(&conn).expect("migrate");

    let enabled = |id: &str| -> bool {
        conn.query_row("SELECT enabled FROM highlights WHERE pattern_id = ?1", [id], |r| {
            r.get::<_, i64>(0)
        })
        .expect("row")
            != 0
    };
    assert!(!enabled("untouched"), "an untouched line should be switched off");
    assert!(enabled("restyled"), "a line set up on purpose keeps its state");
    assert!(!enabled("already-off"));

    // Once only: a line switched back on afterwards stays on.
    conn.execute("UPDATE highlights SET enabled = 1 WHERE pattern_id = 'untouched'", []).unwrap();
    migrate(&conn).expect("second migrate");
    assert!(enabled("untouched"), "switched back on, it must stay on");
}

#[test]
fn a_deliberate_old_default_opacity_survives_a_second_migrate() {
    // The migration runs once, recorded in app_settings. A user who sets the
    // opacity to exactly 0.9 afterwards must not have it rewritten to 0.3 on
    // the next launch, which is what an unguarded UPDATE would do.
    let conn = test_db();
    let p = sample(&conn, "Chart", "A", "in-progress", &[]);
    let mut h = get_highlight(&conn, &p.id).unwrap();
    h.opacity = 0.9;
    save_highlight(&conn, &h).unwrap();

    migrate(&conn).expect("second migrate");
    migrate(&conn).expect("third migrate");

    let got = get_highlight(&conn, &p.id).unwrap();
    assert!((got.opacity - 0.9).abs() < 0.0001, "was {}", got.opacity);
}

#[test]
fn unknown_status_falls_back_to_none() {
    let conn = test_db();
    let p = sample(&conn, "Odd", "Nobody", "nonsense-status", &[]);
    assert_eq!(p.status, "", "an unknown status is no status, not want to knit");
    let none = sample(&conn, "Plain", "Nobody", "", &[]);
    assert_eq!(none.status, "");
    assert_eq!(set_pattern_status(&conn, &none.id, "want-to-knit").unwrap().status, "want-to-knit");
    assert_eq!(set_pattern_status(&conn, &none.id, "").unwrap().status, "");
    assert!(set_pattern_status(&conn, "missing", "").is_err());
}

#[test]
fn want_to_knit_given_by_default_is_cleared_once() {
    let conn = test_db();
    let a = sample(&conn, "A", "X", "want-to-knit", &[]);
    let b = sample(&conn, "B", "Y", "in-progress", &[]);
    // As a library from before: the reset has not run.
    set_setting(&conn, "patterns_no_default_status", &false).unwrap();
    migrate(&conn).unwrap();
    assert_eq!(get_pattern(&conn, &a.id).unwrap().status, "");
    assert_eq!(get_pattern(&conn, &b.id).unwrap().status, "in-progress", "a real status stays");
    // Chosen afterwards, it is kept through later launches.
    set_pattern_status(&conn, &a.id, "want-to-knit").unwrap();
    migrate(&conn).unwrap();
    assert_eq!(get_pattern(&conn, &a.id).unwrap().status, "want-to-knit");
}

#[test]
fn tags_round_trip_through_json() {
    let conn = test_db();
    let p = sample(&conn, "Tagged", "Someone", "in-progress", &["lace", "socks"]);
    let fetched = get_pattern(&conn, &p.id).unwrap();
    assert_eq!(fetched.tags, vec!["lace", "socks"]);
}

#[test]
fn facets_collect_distinct_values() {
    let conn = test_db();
    sample(&conn, "A", "Jess", "want-to-knit", &["lace"]);
    sample(&conn, "B", "Jess", "in-progress", &["lace", "socks"]);
    sample(&conn, "C", "Elizabeth", "in-progress", &["colourwork"]);

    let facets = list_facets(&conn).unwrap();
    assert_eq!(facets.designers, vec!["Elizabeth", "Jess"]);
    // All three used 4mm, so it appears once with a count of three.
    assert_eq!(
        facets.needle_sizes,
        vec![NeedleSizeFacet {
            key: "4".to_string(),
            mm: "4 mm".to_string(),
            us: "6".to_string(),
            count: 3,
        }]
    );
    assert_eq!(facets.tags, vec!["colourwork", "lace", "socks"]);
}

#[test]
fn tag_facets_dedupe_case_insensitively() {
    // "Lace" and "lace" are one tag with two spellings; showing both in the
    // sidebar would offer two filters for the same thing. The display form is
    // the most common casing.
    let conn = test_db();
    sample(&conn, "A", "X", "want-to-knit", &["Lace"]);
    sample(&conn, "B", "Y", "want-to-knit", &["lace"]);
    sample(&conn, "C", "Z", "want-to-knit", &["lace"]);

    let facets = list_facets(&conn).unwrap();
    assert_eq!(facets.tags, vec!["lace"]);

    // A tie keeps the casing seen first.
    let conn = test_db();
    sample(&conn, "A", "X", "want-to-knit", &["Chunky"]);
    sample(&conn, "B", "Y", "want-to-knit", &["chunky"]);
    let facets = list_facets(&conn).unwrap();
    assert_eq!(facets.tags, vec!["Chunky"]);
}

#[test]
fn search_covers_title_designer_and_notes() {
    let conn = test_db();
    sample(&conn, "Featherweight Sock", "Jess Leslie", "want-to-knit", &[]);
    sample(&conn, "Cable Cardigan", "Elizabeth Zimmermann", "want-to-knit", &[]);

    let f = Filter {
        search: Some("sock".to_string()),
        ..Default::default()
    };
    assert_eq!(list_patterns(&conn, &f).unwrap().len(), 1);

    let f = Filter {
        search: Some("zimmermann".to_string()),
        ..Default::default()
    };
    assert_eq!(list_patterns(&conn, &f).unwrap().len(), 1);

    let f = Filter {
        search: Some("nothing here".to_string()),
        ..Default::default()
    };
    assert!(list_patterns(&conn, &f).unwrap().is_empty());
}

#[test]
fn search_treats_like_wildcards_as_literal_text() {
    // % and _ are LIKE wildcards, so an unescaped search for "100%" would
    // match "1000" and one for "k2_tog" would match "k2ptog".
    let conn = test_db();
    sample(&conn, "100% Wool Socks", "A", "want-to-knit", &[]);
    sample(&conn, "1000 Lakes Shawl", "B", "want-to-knit", &[]);
    sample(&conn, "k2_tog Scarf", "C", "want-to-knit", &[]);
    sample(&conn, "k2ptog Hat", "D", "want-to-knit", &[]);

    let titles = |term: &str| -> Vec<String> {
        let f = Filter {
            search: Some(term.to_string()),
            ..Default::default()
        };
        let mut rows = list_patterns(&conn, &f).unwrap();
        rows.sort_by(|a, b| a.title.cmp(&b.title));
        rows.into_iter().map(|p| p.title).collect()
    };
    assert_eq!(titles("100%"), vec!["100% Wool Socks"]);
    assert_eq!(titles("k2_tog"), vec!["k2_tog Scarf"]);
}

#[test]
fn a_tag_with_wildcards_matches_only_itself() {
    let conn = test_db();
    sample(&conn, "Exact", "A", "want-to-knit", &["100% wool"]);
    sample(&conn, "Other", "B", "want-to-knit", &["1000 wool"]);

    let f = Filter {
        tags: Some(vec!["100% wool".to_string()]),
        ..Default::default()
    };
    let hits = list_patterns(&conn, &f).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "Exact");
}

#[test]
fn empty_search_matches_everything() {
    let conn = test_db();
    sample(&conn, "A", "X", "want-to-knit", &[]);
    sample(&conn, "B", "Y", "want-to-knit", &[]);

    for term in [None, Some(String::new()), Some("   ".to_string())] {
        let f = Filter {
            search: term.clone(),
            ..Default::default()
        };
        assert_eq!(
            list_patterns(&conn, &f).unwrap().len(),
            2,
            "empty search should match all, got {:?}",
            term
        );
    }
}

#[test]
fn tag_filter_matches_whole_tags_only() {
    let conn = test_db();
    sample(&conn, "Lace", "A", "want-to-knit", &["lace"]);
    sample(&conn, "Laceweight", "B", "want-to-knit", &["laceweight"]);

    // "lace" must not match the "laceweight" tag.
    let f = Filter {
        tags: Some(vec!["lace".to_string()]),
        ..Default::default()
    };
    let hits = list_patterns(&conn, &f).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "Lace");
}

#[test]
fn multiple_tags_are_combined_with_and() {
    let conn = test_db();
    sample(&conn, "Both", "A", "want-to-knit", &["lace", "socks"]);
    sample(&conn, "Only socks", "B", "want-to-knit", &["socks"]);

    let f = Filter {
        tags: Some(vec!["lace".to_string(), "socks".to_string()]),
        ..Default::default()
    };
    let hits = list_patterns(&conn, &f).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "Both");
}

#[test]
fn status_and_difficulty_filters() {
    let conn = test_db();
    sample(&conn, "WIP", "A", "in-progress", &[]);
    sample(&conn, "Idea", "B", "want-to-knit", &[]);

    let f = Filter {
        status: Some("in-progress".to_string()),
        ..Default::default()
    };
    assert_eq!(list_patterns(&conn, &f).unwrap().len(), 1);

    let f = Filter {
        difficulty: Some("intermediate".to_string()),
        ..Default::default()
    };
    // Both samples are intermediate, so difficulty alone does not narrow it.
    assert_eq!(list_patterns(&conn, &f).unwrap().len(), 2);
}

#[test]
fn counting_moves_the_total_and_every_enabled_counter() {
    let conn = test_db();
    let p = sample(&conn, "Sock", "A", "in-progress", &[]);
    let front = enabled_counter(&conn, &p.id, "Front", 0);
    let cuff = enabled_counter(&conn, &p.id, "Cuff", 0);

    // Two sleeves worked in turn: one action moves both, and the total.
    let out = count_rows(&conn, &p.id, 5).unwrap();
    assert_eq!(out.total_rows, 5);
    assert_eq!(counter(&out, &front.id).current, 5);
    assert_eq!(counter(&out, &cuff.id).current, 5);

    let out = count_rows(&conn, &p.id, -2).unwrap();
    assert_eq!(out.total_rows, 3);
    assert_eq!(counter(&out, &front.id).current, 3);
    assert_eq!(counter(&out, &cuff.id).current, 3);
}

#[test]
fn a_disabled_counter_stays_put_while_the_total_moves() {
    // The point of the enable flag: a counter that is set aside keeps its
    // place, and the work still counts towards the project.
    let conn = test_db();
    let p = sample(&conn, "Sock", "A", "in-progress", &[]);
    let working = enabled_counter(&conn, &p.id, "Working", 0);
    let set_aside = add_counter(
        &conn,
        &p.id,
        &CounterInput {
            name: "Set aside".to_string(),
            target: 0,
            enabled: false,
            excluded_from_total: false,
        },
    )
    .unwrap();
    count_rows(&conn, &p.id, 7).unwrap();

    let out = count_rows(&conn, &p.id, 3).unwrap();
    assert_eq!(out.total_rows, 10);
    assert_eq!(counter(&out, &working.id).current, 10);
    assert_eq!(
        counter(&out, &set_aside.id).current, 0,
        "a counter that was never enabled stays at zero"
    );
}

#[test]
fn several_counters_can_be_enabled_at_once() {
    let conn = test_db();
    let p = sample(&conn, "Pair", "A", "in-progress", &[]);
    let a = enabled_counter(&conn, &p.id, "Sleeve 1", 0);
    let b = enabled_counter(&conn, &p.id, "Sleeve 2", 0);
    assert_ne!(a.id, b.id, "two distinct counters");
    count_rows(&conn, &p.id, 4).unwrap();
    let out = list_counters(&conn, &p.id).unwrap();
    assert_eq!(out.iter().filter(|c| c.enabled).count(), 2);
    assert!(out.iter().all(|c| c.current == 4));
}

#[test]
fn a_counter_on_its_target_does_not_stop_the_total() {
    // The total counts work, not targets. A finished part should not silently
    // stop the project total, or the two numbers quietly disagree.
    let conn = test_db();
    let p = sample(&conn, "Cardigan", "A", "in-progress", &[]);
    let front = enabled_counter(&conn, &p.id, "Front", 10);

    let out = count_rows(&conn, &p.id, 10).unwrap();
    assert_eq!(counter(&out, &front.id).current, 10, "exactly on target");
    assert_eq!(out.total_rows, 10);

    let out = count_rows(&conn, &p.id, 5).unwrap();
    assert_eq!(counter(&out, &front.id).current, 10, "clamped at the target");
    assert_eq!(out.total_rows, 15, "the total carries on regardless");
}

#[test]
fn counter_counting_clamps_to_target_and_floor() {
    let conn = test_db();
    let p = sample(&conn, "Sock", "A", "in-progress", &[]);
    let c = enabled_counter(&conn, &p.id, "Repeat", 4);

    // Overshooting the target stops at the target, and the total only counts
    // the rows actually applied to the counter.
    let out = count_rows(&conn, &p.id, 10).unwrap();
    assert_eq!(counter(&out, &c.id).current, 4);
    assert_eq!(out.total_rows, 10, "the total is not clamped by a counter target");

    // Going below zero stops at zero rather than going negative.
    let out = count_rows(&conn, &p.id, -100).unwrap();
    assert_eq!(counter(&out, &c.id).current, 0);
    assert_eq!(out.total_rows, 0);
}

#[test]
fn an_untargeted_counter_can_count_past_any_limit() {
    let conn = test_db();
    let p = sample(&conn, "Freeform", "A", "in-progress", &[]);
    let c = enabled_counter(&conn, &p.id, "Notes", 0);
    let out = count_rows(&conn, &p.id, 250).unwrap();
    assert_eq!(counter(&out, &c.id).current, 250);
    assert_eq!(out.total_rows, 250);
}

#[test]
fn a_counter_can_be_counted_on_its_own() {
    // Its own buttons, which is how a counter is nudged without counting a
    // project row -- checking a count against the pattern, say.
    let conn = test_db();
    let p = sample(&conn, "Sock", "A", "in-progress", &[]);
    let c = enabled_counter(&conn, &p.id, "Cuff", 0);
    count_rows(&conn, &p.id, 4).unwrap();

    let out = count_one(&conn, &c.id, 2).unwrap();
    assert_eq!(counter(&out, &c.id).current, 6);
    assert_eq!(out.total_rows, 6, "a plain counter still moves the total");
}

#[test]
fn an_excluded_counter_leaves_the_total_alone() {
    let conn = test_db();
    let p = sample(&conn, "Sock", "A", "in-progress", &[]);
    let c = add_counter(
        &conn,
        &p.id,
        &CounterInput {
            name: "Setup row".to_string(),
            target: 0,
            enabled: false,
            excluded_from_total: true,
        },
    )
    .unwrap();

    let out = count_one(&conn, &c.id, 12).unwrap();
    assert_eq!(counter(&out, &c.id).current, 12);
    assert_eq!(out.total_rows, 0, "excluded from the project total");
}

#[test]
fn counters_are_independent_of_each_other() {
    // One counter reaching its target must not affect another, which is the
    // whole reason they are separate rows rather than one shared number.
    let conn = test_db();
    let p = sample(&conn, "Cardigan", "A", "in-progress", &[]);
    let front = enabled_counter(&conn, &p.id, "Front", 3);
    let sleeve = enabled_counter(&conn, &p.id, "Sleeve", 0);

    let out = count_rows(&conn, &p.id, 9).unwrap();
    assert_eq!(counter(&out, &front.id).current, 3);
    assert_eq!(counter(&out, &sleeve.id).current, 9);
    assert_eq!(out.total_rows, 9);
}

#[test]
fn counters_can_be_renamed_switched_reset_and_deleted() {
    let conn = test_db();
    let p = sample(&conn, "Sock", "A", "in-progress", &[]);
    let c = add_counter(
        &conn,
        &p.id,
        &CounterInput {
            name: "Draft".to_string(),
            target: 0,
            enabled: true,
            excluded_from_total: false,
        },
    )
    .unwrap();

    update_counter(&conn, &c.id, "Final", 20, false).unwrap();
    let stored = &list_counters(&conn, &p.id).unwrap()[0];
    assert_eq!(stored.name, "Final");
    assert_eq!(stored.target, 20);

    set_counter_enabled(&conn, &c.id, false).unwrap();
    assert!(!list_counters(&conn, &p.id).unwrap()[0].enabled);

    count_rows(&conn, &p.id, 5).unwrap();
    reset_counter(&conn, &c.id).unwrap();
    assert_eq!(list_counters(&conn, &p.id).unwrap()[0].current, 0);

    delete_counter(&conn, &c.id).unwrap();
    assert!(list_counters(&conn, &p.id).unwrap().is_empty());
}

#[test]
fn a_missing_counter_is_an_error() {
    // The UI removes the row first, so a silent success would leave a button
    // wired to something that no longer exists.
    let conn = test_db();
    assert!(update_counter(&conn, "gone", "x", 0, false).is_err());
    assert!(set_counter_enabled(&conn, "gone", true).is_err());
    assert!(reset_counter(&conn, "gone").is_err());
    assert!(delete_counter(&conn, "gone").is_err());
    assert!(count_one(&conn, "gone", 1).is_err());
}

#[test]
fn counting_a_missing_counter_reports_not_found() {
    // The same NotFound style the other missing-row paths use, rather than a
    // raw query error the frontend cannot tell apart from a real failure.
    let conn = test_db();
    let err = count_one(&conn, "gone", 1).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "got {err}");
}

#[test]
fn the_total_is_stored_even_without_a_progress_row() {
    // A partially migrated database can have a pattern with no progress row.
    // A bare UPDATE would store nothing while the result went on to report
    // the new total, leaving the two disagreeing.
    let conn = test_db();
    let p = sample(&conn, "Sock", "A", "in-progress", &[]);
    let drop_progress = || {
        conn.execute(
            "DELETE FROM progress WHERE pattern_id = ?1",
            params![&p.id],
        )
        .unwrap();
    };

    drop_progress();
    let out = count_rows(&conn, &p.id, 3).unwrap();
    assert_eq!(out.total_rows, 3);
    assert_eq!(get_progress(&conn, &p.id).unwrap().total_rows, 3);

    drop_progress();
    set_total_rows(&conn, &p.id, 7).unwrap();
    assert_eq!(get_progress(&conn, &p.id).unwrap().total_rows, 7);

    drop_progress();
    let c = enabled_counter(&conn, &p.id, "Front", 0);
    let out = count_one(&conn, &c.id, 2).unwrap();
    assert_eq!(out.total_rows, 2);
    assert_eq!(get_progress(&conn, &p.id).unwrap().total_rows, 2);
}

#[test]
fn extreme_deltas_saturate_instead_of_overflowing() {
    // Deltas come straight from IPC, so i64::MAX must clamp rather than panic
    // a debug build or wrap a release one.
    let conn = test_db();
    let p = sample(&conn, "Marathon", "A", "in-progress", &[]);
    let c = enabled_counter(&conn, &p.id, "Lots", 0);

    let out = count_rows(&conn, &p.id, i64::MAX).unwrap();
    assert_eq!(out.total_rows, i64::MAX);
    assert_eq!(counter(&out, &c.id).current, i64::MAX);

    let out = count_rows(&conn, &p.id, i64::MIN).unwrap();
    assert_eq!(out.total_rows, 0);
    assert_eq!(counter(&out, &c.id).current, 0);

    let out = count_one(&conn, &c.id, i64::MAX).unwrap();
    assert_eq!(counter(&out, &c.id).current, i64::MAX);
    assert_eq!(out.total_rows, i64::MAX);

    let out = count_one(&conn, &c.id, i64::MIN).unwrap();
    assert_eq!(counter(&out, &c.id).current, 0);
    assert_eq!(out.total_rows, 0);
}

#[test]
fn deleting_a_pattern_removes_its_counters() {
    let conn = test_db();
    let p = sample(&conn, "Doomed", "A", "in-progress", &[]);
    enabled_counter(&conn, &p.id, "Front", 0);
    delete_pattern(&conn, &p.id).unwrap();
    assert!(list_counters(&conn, &p.id).unwrap().is_empty());
}

#[test]
fn counters_persist_across_reopening() {
    // Counts are the one thing that must never be lost by closing the app, so
    // this reads back through a fresh handle rather than the same connection.
    let conn = test_db();
    let p = sample(&conn, "Kept", "A", "in-progress", &[]);
    let c = enabled_counter(&conn, &p.id, "Front", 100);
    count_rows(&conn, &p.id, 42).unwrap();
    set_total_rows(&conn, &p.id, 42).unwrap();

    let reopened = get_progress(&conn, &p.id).unwrap();
    assert_eq!(reopened.total_rows, 42);
    let counters = list_counters(&conn, &p.id).unwrap();
    assert_eq!(counters[0].id, c.id);
    assert_eq!(counters[0].current, 42);
    assert_eq!(counters[0].name, "Front");
    assert!(counters[0].enabled);
}

// ---------- migration ----------

/// The old schema, with the tables as they were before counters existed.
///
/// Written out in full rather than trimmed, because the point is to prove the
/// migration reads a database shaped the way a real one would be.
fn old_schema(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE patterns (
             id TEXT PRIMARY KEY, title TEXT NOT NULL, designer TEXT NOT NULL DEFAULT '',
             file_path TEXT NOT NULL, file_name TEXT NOT NULL, format TEXT NOT NULL,
             status TEXT NOT NULL, difficulty TEXT NOT NULL DEFAULT '',
             needle_size TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
             notes TEXT NOT NULL DEFAULT '', added_at INTEGER NOT NULL,
             last_opened_at INTEGER, last_page INTEGER NOT NULL DEFAULT 0,
             last_scroll REAL NOT NULL DEFAULT 0
         );
         INSERT INTO patterns (id, title, file_path, file_name, format, status, added_at)
         VALUES ('p1', 'Old Sock', 'C:/x.pdf', 'x.pdf', 'pdf', 'in-progress', 1);

         CREATE TABLE sections (
             id TEXT PRIMARY KEY,
             pattern_id TEXT NOT NULL REFERENCES patterns(id) ON DELETE CASCADE,
             name TEXT NOT NULL,
             target INTEGER NOT NULL DEFAULT 0,
             current INTEGER NOT NULL DEFAULT 0,
             excluded_from_total INTEGER NOT NULL DEFAULT 0,
             position INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE progress (
             pattern_id TEXT PRIMARY KEY REFERENCES patterns(id) ON DELETE CASCADE,
             total_rows INTEGER NOT NULL DEFAULT 0,
             current_section_id TEXT,
             updated_at INTEGER NOT NULL DEFAULT 0
         );
         -- Two sections, one of them the active one, and a total already worked.
         INSERT INTO progress (pattern_id, total_rows, current_section_id, updated_at)
         VALUES ('p1', 340, 's2', 1);
         INSERT INTO sections VALUES ('s1', 'p1', 'Lace repeat', 8, 3, 0, 0);
         INSERT INTO sections VALUES ('s2', 'p1', 'Front', 340, 340, 1, 1);
        ",
    )
    .expect("seed the old schema");
}

#[test]
fn sections_become_counters_without_losing_anything() {
    let conn = Connection::open_in_memory().expect("in-memory db");
    old_schema(&conn);

    migrate(&conn).expect("migrate");

    assert!(!table_exists(&conn, "sections").expect("sections"), "the old table is gone");
    let counters = list_counters(&conn, "p1").expect("counters");
    assert_eq!(counters.len(), 2, "both sections carried over");

    let lace = counters.iter().find(|c| c.name == "Lace repeat").expect("lace");
    let front = counters.iter().find(|c| c.name == "Front").expect("front");

    // Counts and targets must survive exactly.
    assert_eq!(lace.current, 3);
    assert_eq!(lace.target, 8);
    assert_eq!(front.current, 340);
    assert_eq!(front.target, 340);
    assert!(front.excluded_from_total, "the exclusion flag carries over");

    // The section that was active becomes the one enabled counter, so
    // reopening a pattern lands where the user left off.
    assert!(front.enabled, "the previously active section is now enabled");
    assert!(!lace.enabled, "the others are inert rather than lost");

    // The work already counted is still counted.
    assert_eq!(get_progress(&conn, "p1").unwrap().total_rows, 340);
}

#[test]
fn the_migration_runs_only_once() {
    // Idempotent, because it runs on every launch. A second pass must not
    // duplicate the counters or fail on the missing table.
    let conn = Connection::open_in_memory().expect("in-memory db");
    old_schema(&conn);
    migrate(&conn).expect("first");
    let first = list_counters(&conn, "p1").unwrap().len();
    migrate(&conn).expect("second");
    migrate(&conn).expect("third");
    assert_eq!(list_counters(&conn, "p1").unwrap().len(), first);
    assert_eq!(first, 2);
}

#[test]
fn a_database_with_no_sections_migrates_cleanly() {
    // The common case for anyone who never used sections: there is no old table
    // at all, and the migration must be a no-op rather than an error.
    let conn = test_db();
    let p = sample(&conn, "Fresh", "A", "want-to-knit", &[]);
    migrate(&conn).expect("migrate again");
    assert!(list_counters(&conn, &p.id).unwrap().is_empty());
    assert_eq!(get_progress(&conn, &p.id).unwrap().total_rows, 0);
}

#[test]
fn counter_ordering_follows_insertion() {
    let conn = test_db();
    let p = sample(&conn, "Ordered", "A", "in-progress", &[]);
    for name in ["Cuff", "Leg", "Foot"] {
        add_counter(
            &conn,
            &p.id,
            &CounterInput {
                name: name.to_string(),
                target: 0,
                enabled: false,
                excluded_from_total: false,
            },
        )
        .unwrap();
    }
    let names: Vec<String> = list_counters(&conn, &p.id)
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(names, vec!["Cuff", "Leg", "Foot"]);
}

#[test]
fn progress_defaults_for_an_unknown_pattern() {
    let conn = test_db();
    let p = get_progress(&conn, "not-a-real-id").unwrap();
    assert_eq!(p.pattern_id, "not-a-real-id");
    assert_eq!(p.total_rows, 0);
}

#[test]
fn highlight_settings_round_trip() {
    let conn = test_db();
    let p = sample(&conn, "Chart", "A", "in-progress", &[]);

    let mut h = get_highlight(&conn, &p.id).unwrap();
    h.thickness = 8.0;
    h.width = 640.0;
    h.color = "#00ff88".to_string();
    h.animate = false;
    h.offset_y = 0.8;
    save_highlight(&conn, &h).unwrap();

    let loaded = get_highlight(&conn, &p.id).unwrap();
    assert_eq!(loaded.thickness, 8.0);
    assert_eq!(loaded.width, 640.0);
    assert_eq!(loaded.color, "#00ff88");
    assert!(!loaded.animate);
    assert_eq!(loaded.offset_y, 0.8);
}

#[test]
fn saving_highlight_twice_updates_rather_than_duplicates() {
    let conn = test_db();
    let p = sample(&conn, "Chart", "A", "in-progress", &[]);
    let mut h = get_highlight(&conn, &p.id).unwrap();
    for thickness in [2.0, 5.0, 9.0] {
        h.thickness = thickness;
        save_highlight(&conn, &h).unwrap();
    }
    assert_eq!(get_highlight(&conn, &p.id).unwrap().thickness, 9.0);
}

#[test]
fn saved_position_is_remembered() {
    let conn = test_db();
    let p = sample(&conn, "Long", "A", "in-progress", &[]);
    touch_pattern(&conn, &p.id, 7, 1234.5).unwrap();
    let loaded = get_pattern(&conn, &p.id).unwrap();
    assert_eq!(loaded.last_page, 7);
    assert_eq!(loaded.last_scroll, 1234.5);
    assert!(loaded.last_opened_at.is_some());
}

// ---------- covers ----------

#[test]
fn new_patterns_have_no_cover() {
    let conn = test_db();
    let p = sample(&conn, "No Cover", "A", "want-to-knit", &[]);
    assert_eq!(p.cover_path, "");
    assert_eq!(get_cover(&conn, &p.id).unwrap(), "");
}

#[test]
fn cover_path_is_stored_and_cleared() {
    let conn = test_db();
    let p = sample(&conn, "Has Cover", "A", "want-to-knit", &[]);
    set_cover(&conn, &p.id, "abc-123.png").unwrap();
    assert_eq!(get_cover(&conn, &p.id).unwrap(), "abc-123.png");
    assert_eq!(get_pattern(&conn, &p.id).unwrap().cover_path, "abc-123.png");

    set_cover(&conn, &p.id, "").unwrap();
    assert_eq!(get_cover(&conn, &p.id).unwrap(), "");
}

// ---------- settings ----------

#[test]
fn settings_round_trip_and_default_when_absent() {
    let conn = test_db();
    // Absent gives the default rather than an error.
    let s: crate::models::AiSettings = get_setting(&conn, "ai").unwrap();
    assert!(!s.base_url.is_empty());
    assert!(s.api_key.is_empty());

    let custom = crate::models::AiSettings {
        base_url: "http://192.168.1.20:1234/v1".to_string(),
        model: "some-model".to_string(),
        max_characters: 1234,
        skip_existing: false,
        ..Default::default()
    };
    set_setting(&conn, "ai", &custom).unwrap();

    let loaded: crate::models::AiSettings = get_setting(&conn, "ai").unwrap();
    assert_eq!(loaded.base_url, "http://192.168.1.20:1234/v1");
    assert_eq!(loaded.model, "some-model");
    assert_eq!(loaded.max_characters, 1234);
    assert!(!loaded.skip_existing);
}

#[test]
fn corrupt_settings_fall_back_to_default() {
    let conn = test_db();
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES ('ai', 'not json at all')",
        [],
    )
    .unwrap();
    let s: crate::models::AiSettings = get_setting(&conn, "ai").unwrap();
    assert!(!s.base_url.is_empty());
}

// ---------- AI history ----------

#[test]
fn ai_change_can_be_undone() {
    let conn = test_db();
    let mut p = sample(&conn, "AI Target", "Unknown", "want-to-knit", &[]);
    let before = p.clone();

    p.designer = "Jess Leslie".to_string();
    p.tags = vec!["lace".to_string()];
    p.needle_size = "4mm".to_string();
    update_pattern(&conn, &p).unwrap();
    record_ai_change(&conn, &p.id, &before, &p).unwrap();

    let (_id, restored) = latest_ai_change(&conn, &p.id).unwrap().expect("a change");
    assert_eq!(restored.designer, "Unknown");
    assert!(restored.tags.is_empty());

    // Restoring it puts the row back as it was.
    update_pattern(&conn, &restored).unwrap();
    let now = get_pattern(&conn, &p.id).unwrap();
    assert_eq!(now.designer, "Unknown");
    assert!(now.tags.is_empty());
}

#[test]
fn ai_history_is_empty_without_changes() {
    let conn = test_db();
    let p = sample(&conn, "Untouched", "A", "want-to-knit", &[]);
    assert!(latest_ai_change(&conn, &p.id).unwrap().is_none());
}

#[test]
fn latest_ai_change_wins_over_older_ones() {
    let conn = test_db();
    let mut p = sample(&conn, "Twice", "First", "want-to-knit", &[]);
    let original = p.clone();

    p.designer = "Second".to_string();
    update_pattern(&conn, &p).unwrap();
    record_ai_change(&conn, &p.id, &original, &p).unwrap();
    let after_first = p.clone();

    p.designer = "Third".to_string();
    update_pattern(&conn, &p).unwrap();
    record_ai_change(&conn, &p.id, &after_first, &p).unwrap();

    // Undo should only step back one change, not to the very beginning.
    let (_id, restored) = latest_ai_change(&conn, &p.id).unwrap().unwrap();
    assert_eq!(restored.designer, "Second");
}

#[test]
fn deleting_a_pattern_removes_its_ai_history() {
    let conn = test_db();
    let mut p = sample(&conn, "Doomed", "A", "want-to-knit", &[]);
    let before = p.clone();
    p.designer = "Changed".to_string();
    update_pattern(&conn, &p).unwrap();
    record_ai_change(&conn, &p.id, &before, &p).unwrap();

    delete_pattern(&conn, &p.id).unwrap();
    assert!(latest_ai_change(&conn, &p.id).unwrap().is_none());
}

// ---------- migration ----------

/// A database created before the cover column existed must be brought forward
/// without losing the rows already in it.
#[test]
fn migration_adds_cover_path_to_an_old_database() {
    let conn = Connection::open_in_memory().unwrap();
    // The original schema, as it shipped in 0.1.0.
    conn.execute_batch(
        r#"
        CREATE TABLE patterns (
            id             TEXT PRIMARY KEY,
            title          TEXT NOT NULL,
            designer       TEXT NOT NULL DEFAULT '',
            file_path      TEXT NOT NULL,
            file_name      TEXT NOT NULL,
            format         TEXT NOT NULL,
            status         TEXT NOT NULL DEFAULT 'want-to-knit',
            difficulty     TEXT NOT NULL DEFAULT '',
            needle_size    TEXT NOT NULL DEFAULT '',
            tags           TEXT NOT NULL DEFAULT '[]',
            notes          TEXT NOT NULL DEFAULT '',
            added_at       INTEGER NOT NULL,
            last_opened_at INTEGER,
            last_page      INTEGER NOT NULL DEFAULT 0,
            last_scroll    REAL    NOT NULL DEFAULT 0
        );
        INSERT INTO patterns
          (id,title,file_path,file_name,format,added_at)
          VALUES ('old1','Vintage Pattern','C:/x.pdf','x.pdf','pdf',1);
        "#,
    )
    .unwrap();

    migrate(&conn).unwrap();

    // The existing row survives and gains an empty cover.
    let row: Pattern = conn
        .query_row("SELECT * FROM patterns WHERE id = 'old1'", [], row_to_pattern)
        .unwrap();
    assert_eq!(row.title, "Vintage Pattern");
    assert_eq!(row.cover_path, "");

    // And the migration is safe to run a second time.
    migrate(&conn).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM patterns", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
}

// ---------- annotations ----------

fn annotation_input(kind: &str) -> AnnotationInput {
    AnnotationInput {
        kind: kind.to_string(),
        page: 3,
        geometry: r#"[{"x":0.1,"y":0.2,"w":0.3,"h":0.04}]"#.to_string(),
        quote: "k1, yo, k5".to_string(),
        occurrence: 0,
        color: "#ffd60a".to_string(),
        text: String::new(),
    }
}

#[test]
fn annotations_round_trip_for_each_kind() {
    let conn = test_db();
    let p = sample(&conn, "Charted", "A", "in-progress", &[]);
    for kind in ["highlight", "note", "draw"] {
        let mut input = annotation_input(kind);
        if kind == "note" {
            input.text = "decrease here".to_string();
        }
        let a = insert_annotation(&conn, &p.id, &input).unwrap();
        assert_eq!(a.kind, kind);
        assert_eq!(a.page, 3);
        assert_eq!(a.quote, "k1, yo, k5");
        assert_eq!(a.color, "#ffd60a");
        if kind == "note" {
            assert_eq!(a.text, "decrease here");
        }
    }
    assert_eq!(list_annotations(&conn, &p.id).unwrap().len(), 3);
}

#[test]
fn an_unknown_annotation_kind_falls_back_to_highlight() {
    let conn = test_db();
    let p = sample(&conn, "Odd", "A", "in-progress", &[]);
    let mut input = annotation_input("something-else");
    input.kind = "something-else".to_string();
    let a = insert_annotation(&conn, &p.id, &input).unwrap();
    assert_eq!(a.kind, "highlight");
}

#[test]
fn annotations_are_listed_in_page_order() {
    let conn = test_db();
    let p = sample(&conn, "Ordered", "A", "in-progress", &[]);
    for page in [5, 1, 3] {
        let mut input = annotation_input("highlight");
        input.page = page;
        insert_annotation(&conn, &p.id, &input).unwrap();
    }
    let pages: Vec<i64> = list_annotations(&conn, &p.id)
        .unwrap()
        .into_iter()
        .map(|a| a.page)
        .collect();
    assert_eq!(pages, vec![1, 3, 5]);
}

#[test]
fn a_note_can_be_edited() {
    let conn = test_db();
    let p = sample(&conn, "Editable", "A", "in-progress", &[]);
    let a = insert_annotation(&conn, &p.id, &annotation_input("note")).unwrap();
    update_annotation_text(&conn, &a.id, "new wording", "#00ff00").unwrap();
    let stored = &list_annotations(&conn, &p.id).unwrap()[0];
    assert_eq!(stored.text, "new wording");
    assert_eq!(stored.color, "#00ff00");
}

#[test]
fn deleting_a_missing_annotation_is_an_error() {
    let conn = test_db();
    // The frontend removes the mark from the page first, so a silent success
    // would leave it on screen with no way back.
    assert!(delete_annotation(&conn, "no-such-id").is_err());
    assert!(update_annotation_text(&conn, "no-such-id", "x", "#fff").is_err());
}

#[test]
fn deleting_a_pattern_removes_its_annotations() {
    let conn = test_db();
    let p = sample(&conn, "Doomed", "A", "in-progress", &[]);
    insert_annotation(&conn, &p.id, &annotation_input("highlight")).unwrap();
    delete_pattern(&conn, &p.id).unwrap();
    assert!(list_annotations(&conn, &p.id).unwrap().is_empty());
}

// ---------- bookmarks ----------

#[test]
fn bookmarks_append_in_order() {
    let conn = test_db();
    let p = sample(&conn, "Indexed", "A", "in-progress", &[]);
    add_bookmark(&conn, &p.id, 4, "Heel turn", None).unwrap();
    add_bookmark(&conn, &p.id, 9, "Cuff", None).unwrap();
    let list = list_bookmarks(&conn, &p.id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].title, "Heel turn");
    assert_eq!(list[0].sort_order, 0);
    assert_eq!(list[1].title, "Cuff");
    assert_eq!(list[1].sort_order, 1);
}

#[test]
fn a_bookmark_can_be_renamed_and_reordered() {
    let conn = test_db();
    let p = sample(&conn, "Indexed", "A", "in-progress", &[]);
    let first = add_bookmark(&conn, &p.id, 1, "One", None).unwrap();
    add_bookmark(&conn, &p.id, 2, "Two", None).unwrap();

    rename_bookmark(&conn, &first.id, "Renamed").unwrap();
    assert_eq!(list_bookmarks(&conn, &p.id).unwrap()[0].title, "Renamed");

    move_bookmark(&conn, &first.id, 5).unwrap();
    let list = list_bookmarks(&conn, &p.id).unwrap();
    assert_eq!(list[0].title, "Two", "the moved bookmark goes last");
    assert_eq!(list[1].title, "Renamed");
}

#[test]
fn a_bookmark_can_be_inserted_at_a_position() {
    let conn = test_db();
    let p = sample(&conn, "Indexed", "A", "in-progress", &[]);
    add_bookmark(&conn, &p.id, 1, "First", None).unwrap();
    add_bookmark(&conn, &p.id, 3, "Third", None).unwrap();
    let middle = add_bookmark(&conn, &p.id, 2, "Second", Some(1)).unwrap();
    assert_eq!(middle.sort_order, 1);

    let titles: Vec<String> = list_bookmarks(&conn, &p.id)
        .unwrap()
        .into_iter()
        .map(|b| b.title)
        .collect();
    assert_eq!(titles, vec!["First", "Second", "Third"]);
}

#[test]
fn bookmarks_can_be_deleted_and_missing_ones_error() {
    let conn = test_db();
    let p = sample(&conn, "Indexed", "A", "in-progress", &[]);
    let b = add_bookmark(&conn, &p.id, 1, "Temp", None).unwrap();
    delete_bookmark(&conn, &b.id).unwrap();
    assert!(list_bookmarks(&conn, &p.id).unwrap().is_empty());

    assert!(delete_bookmark(&conn, "gone").is_err());
    assert!(rename_bookmark(&conn, "gone", "x").is_err());
    assert!(move_bookmark(&conn, "gone", 0).is_err());
}

// ---------- pins ----------

fn pin_input() -> PinInput {
    PinInput {
        page: 2,
        geometry: r#"[{"x":0.1,"y":0.5,"w":0.4,"h":0.2}]"#.to_string(),
        quote: "Stitch key".to_string(),
        title: "Key".to_string(),
        image_bytes: vec![0xFF, 0xD8, 0xFF, 0xE0],
        image_mime: "image/jpeg".to_string(),
    }
}

#[test]
fn pins_are_stored_and_listed_newest_on_top() {
    let conn = test_db();
    let p = sample(&conn, "Pinned", "A", "in-progress", &[]);
    let first = insert_pin(&conn, &p.id, &pin_input(), "a.jpg").unwrap();
    let second = insert_pin(&conn, &p.id, &pin_input(), "b.jpg").unwrap();

    let list = list_pins(&conn, &p.id).unwrap();
    assert_eq!(list.len(), 2);
    // Highest z first, so a new pin is never buried.
    assert_eq!(list[0].id, second.id);
    assert_eq!(list[1].id, first.id);
}

#[test]
fn the_pin_limit_is_counted_not_guessed() {
    let conn = test_db();
    let p = sample(&conn, "Pinned", "A", "in-progress", &[]);
    for i in 0..5 {
        insert_pin(&conn, &p.id, &pin_input(), &format!("{i}.jpg")).unwrap();
    }
    assert_eq!(count_pins(&conn, &p.id).unwrap(), 5);
    // The command refuses the sixth; this confirms the count it relies on.
    assert!(count_pins(&conn, &p.id).unwrap() >= crate::models::MAX_PINS);
}

#[test]
fn pin_placement_is_remembered() {
    let conn = test_db();
    let p = sample(&conn, "Pinned", "A", "in-progress", &[]);
    let pin = insert_pin(&conn, &p.id, &pin_input(), "a.jpg").unwrap();

    let updated = update_pin_placement(
        &conn,
        &pin.id,
        &PinPlacement {
            offset_x: 0.1,
            offset_y: 0.9,
            width: 0.4,
            hidden: true,
        },
    )
    .unwrap();

    assert!((updated.offset_x - 0.1).abs() < 1e-9);
    assert!((updated.offset_y - 0.9).abs() < 1e-9);
    assert!((updated.width - 0.4).abs() < 1e-9);
    assert!(updated.hidden);
}

#[test]
fn a_hidden_pin_stays_hidden_after_being_moved() {
    let conn = test_db();
    let p = sample(&conn, "Pinned", "A", "in-progress", &[]);
    let pin = insert_pin(&conn, &p.id, &pin_input(), "a.jpg").unwrap();
    update_pin_placement(
        &conn,
        &pin.id,
        &PinPlacement { offset_x: 0.5, offset_y: 0.5, width: 0.3, hidden: true },
    )
    .unwrap();
    let stored = get_pin(&conn, &pin.id).unwrap();
    assert!(stored.hidden, "hiding must survive a move");
}

#[test]
fn a_pin_can_be_renamed_and_deleted() {
    let conn = test_db();
    let p = sample(&conn, "Pinned", "A", "in-progress", &[]);
    let pin = insert_pin(&conn, &p.id, &pin_input(), "a.jpg").unwrap();
    rename_pin(&conn, &pin.id, "Abbreviations").unwrap();
    assert_eq!(get_pin(&conn, &pin.id).unwrap().title, "Abbreviations");

    // Deletion reports the image file so the caller can remove it from disk.
    let file = delete_pin(&conn, &pin.id).unwrap();
    assert_eq!(file.as_deref(), Some("a.jpg"));
    assert!(list_pins(&conn, &p.id).unwrap().is_empty());
    assert!(delete_pin(&conn, &pin.id).is_err());
}

#[test]
fn deleting_a_pattern_removes_its_pins_and_bookmarks() {
    let conn = test_db();
    let p = sample(&conn, "Doomed", "A", "in-progress", &[]);
    insert_pin(&conn, &p.id, &pin_input(), "a.jpg").unwrap();
    add_bookmark(&conn, &p.id, 1, "Here", None).unwrap();

    delete_pattern(&conn, &p.id).unwrap();
    assert!(list_pins(&conn, &p.id).unwrap().is_empty());
    assert!(list_bookmarks(&conn, &p.id).unwrap().is_empty());
}

/// Every field of the highlight settings must survive a save/load cycle.
/// This guards the column order in the UPDATE, which is easy to break.
#[test]
fn every_highlight_field_persists() {
    let conn = test_db();
    let p = sample(&conn, "Chart", "A", "in-progress", &[]);
    let mut h = HighlightSettings::defaults(&p.id);
    h.enabled = false;
    h.offset_y = 0.77;
    h.thickness = 11.0;
    h.width = 321.0;
    h.inset_x = 55.0;
    h.color = "#123456".to_string();
    h.opacity = 0.42;
    h.animate = false;
    h.animation_ms = 555;
    save_highlight(&conn, &h).unwrap();

    let got = get_highlight(&conn, &p.id).unwrap();
    assert!(!got.enabled);
    assert_eq!(got.offset_y, 0.77);
    assert_eq!(got.thickness, 11.0);
    assert_eq!(got.width, 321.0);
    assert_eq!(got.inset_x, 55.0);
    assert_eq!(got.color, "#123456");
    assert_eq!(got.opacity, 0.42);
    assert!(!got.animate);
    assert_eq!(got.animation_ms, 555);
}

// ---------- file hashes ----------

#[test]
fn hash_bytes_is_sha256_in_hex() {
    // The known SHA-256 of the empty input pins the encoding: 64 lowercase
    // hex characters.
    assert_eq!(
        hash_bytes(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert_ne!(hash_bytes(b"a"), hash_bytes(b"b"));
}

#[test]
fn an_empty_hash_never_matches_anything() {
    // Rows whose files could not be hashed sit on '', and two of them must
    // never be read as duplicates of each other -- '' means "unknown", not
    // "same file".
    let conn = test_db();
    sample(&conn, "One", "A", "want-to-knit", &[]);
    sample(&conn, "Two", "A", "want-to-knit", &[]);
    assert!(pattern_with_hash(&conn, "").unwrap().is_none());
}

#[test]
fn a_pattern_is_found_by_its_content_hash() {
    let conn = test_db();
    let input = PatternInput {
        title: "Hashed".to_string(),
        designer: String::new(),
        file_name: "hashed.pdf".to_string(),
        bytes: Some(vec![]),
        source_path: None,
        status: "want-to-knit".to_string(),
        difficulty: String::new(),
        needle_size: String::new(),
        yarn_weight: String::new(),
        tags: vec![],
        notes: String::new(),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let hash = hash_bytes(b"the pattern bytes");
    insert_pattern(&conn, &id, &input, "C:/lib/hashed.pdf", "pdf", &hash).expect("insert");

    let found = pattern_with_hash(&conn, &hash)
        .unwrap()
        .expect("the row is found by its hash");
    assert_eq!(found.id, id);
    assert_eq!(found.title, "Hashed");

    // A hash no row holds finds nothing rather than erroring.
    assert!(pattern_with_hash(&conn, &hash_bytes(b"some other file"))
        .unwrap()
        .is_none());
}

#[test]
fn a_library_built_before_hashes_is_backfilled() {
    // A database on disk shaped like a real pre-feature one, with the
    // original file where the library would keep it: originals/ beside the
    // database, the location the backfill derives from the db file itself.
    let dir = tempfile::tempdir().expect("temp dir");
    let originals = dir.path().join("library").join("originals");
    std::fs::create_dir_all(&originals).unwrap();
    let document = originals.join("old1.pdf");
    std::fs::write(&document, b"old pattern bytes").unwrap();
    let missing = originals.join("gone.pdf").to_string_lossy().to_string();

    let conn = Connection::open(dir.path().join("library.db")).expect("db file");
    // The schema as it shipped in 0.1.0: no hash column, and no cover column
    // either, so the older guarded migrations have to run alongside.
    conn.execute_batch(&format!(
        r#"
        CREATE TABLE patterns (
            id             TEXT PRIMARY KEY,
            title          TEXT NOT NULL,
            designer       TEXT NOT NULL DEFAULT '',
            file_path      TEXT NOT NULL,
            file_name      TEXT NOT NULL,
            format         TEXT NOT NULL,
            status         TEXT NOT NULL DEFAULT 'want-to-knit',
            difficulty     TEXT NOT NULL DEFAULT '',
            needle_size    TEXT NOT NULL DEFAULT '',
            tags           TEXT NOT NULL DEFAULT '[]',
            notes          TEXT NOT NULL DEFAULT '',
            added_at       INTEGER NOT NULL,
            last_opened_at INTEGER,
            last_page      INTEGER NOT NULL DEFAULT 0,
            last_scroll    REAL    NOT NULL DEFAULT 0
        );
        INSERT INTO patterns (id, title, file_path, file_name, format, added_at)
        VALUES ('old1', 'Vintage Pattern', '{}', 'old1.pdf', 'pdf', 1);
        INSERT INTO patterns (id, title, file_path, file_name, format, added_at)
        VALUES ('gone', 'Lost Pattern', '{}', 'gone.pdf', 'pdf', 1);
        "#,
        document.to_string_lossy().replace('\\', "/"),
        missing.replace('\\', "/"),
    ))
    .expect("seed old schema");

    migrate(&conn).expect("migrate");

    // The row whose file is on disk gains its content hash...
    let stored: String = conn
        .query_row("SELECT file_hash FROM patterns WHERE id = 'old1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(stored, hash_bytes(b"old pattern bytes"));
    // ...and the hash answers duplicate lookups straight away.
    let found = pattern_with_hash(&conn, &stored)
        .unwrap()
        .expect("found by the backfilled hash");
    assert_eq!(found.id, "old1");

    // A file that is not there keeps the empty hash rather than failing the
    // migration, and stays outside duplicate detection.
    let lost: String = conn
        .query_row("SELECT file_hash FROM patterns WHERE id = 'gone'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(lost, "");
    assert!(pattern_with_hash(&conn, "").unwrap().is_none());

    // A second migrate leaves the hashes alone rather than failing or
    // rewriting them.
    migrate(&conn).expect("second migrate");
    let again: String = conn
        .query_row("SELECT file_hash FROM patterns WHERE id = 'old1'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(again, stored);
}


// ---------- yarn stash ----------

/// A lot as the add dialog sends it: dye lot, ball count, grams left.
fn lot(dye_lot: &str, balls: f64, grams_left: i64) -> YarnLotInput {
    YarnLotInput {
        dye_lot: dye_lot.to_string(),
        balls,
        grams_left,
        ..YarnLotInput::default()
    }
}

/// A yarn in the stash with the given lots, for the yarn tests.
fn stash(conn: &Connection, name: &str, weight: &str, lots: Vec<YarnLotInput>) -> Yarn {
    let input = YarnInput {
        name: name.to_string(),
        yarn_weight: weight.to_string(),
        lots,
        ..YarnInput::default()
    };
    let id = uuid::Uuid::new_v4().to_string();
    insert_yarn(conn, &id, &input).expect("insert yarn")
}

/// A filter with only the fields given set.
fn stash_filter(search: Option<&str>, weights: &[&str]) -> YarnFilter {
    YarnFilter {
        search: search.map(|s| s.to_string()),
        yarn_weight: if weights.is_empty() {
            None
        } else {
            Some(weights.iter().map(|w| w.to_string()).collect())
        },
        used: None,
    }
}

#[test]
fn the_stash_yarn_family_is_derived_and_corrected_on_update() {
    let conn = test_db();
    let y = stash(&conn, "Socks", "aran", vec![]);
    assert_eq!(y.yarn_weight, "aran");
    assert_eq!(y.yarn_weight_family, "aran");

    // Correcting the stated weight re-derives the family, like patterns, or
    // the yarn would keep filtering under the old weight.
    let mut edited = y.clone();
    edited.yarn_weight = "lace weight".to_string();
    let saved = update_yarn(&conn, &edited).unwrap();
    assert_eq!(saved.yarn_weight_family, "lace");
    let fetched = get_yarn(&conn, &y.id).unwrap();
    assert_eq!(fetched.yarn_weight_family, "lace");
}

#[test]
fn updating_a_yarn_reconciles_its_lots() {
    let conn = test_db();
    let y = stash(
        &conn,
        "Cardigan",
        "dk",
        vec![lot("A1", 2.0, 200), lot("B2", 3.0, 300), lot("C3", 1.0, 100)],
    );
    assert_eq!(y.lots.len(), 3);

    let mut edited = get_yarn(&conn, &y.id).unwrap();
    let kept = edited.lots[0].clone();
    let mut changed = edited.lots[1].clone();
    changed.grams_left = 250;
    changed.location = "attic".to_string();
    // Keep the first lot as it is, edit the second, drop the third, and add
    // one the database has never seen (no id yet).
    edited.lots = vec![
        kept.clone(),
        changed.clone(),
        YarnLot {
            id: String::new(),
            yarn_id: y.id.clone(),
            dye_lot: "D4".to_string(),
            balls: 0.5,
            grams_left: 45,
            location: String::new(),
            bought_at: None,
            leftover: false,
        },
    ];

    let saved = update_yarn(&conn, &edited).unwrap();
    assert_eq!(saved.lots.len(), 3);
    let by_id = |id: &str| saved.lots.iter().find(|l| l.id == id);

    // The kept lot is unchanged, id and all.
    let still_there = by_id(&kept.id).expect("kept lot survives");
    assert_eq!(still_there.dye_lot, "A1");
    assert_eq!(still_there.grams_left, 200);

    // The edited lot kept its id and took the new values.
    let updated = by_id(&changed.id).expect("edited lot survives");
    assert_eq!(updated.grams_left, 250);
    assert_eq!(updated.location, "attic");

    // The dropped lot is gone, and the new one was inserted with a fresh id.
    assert!(by_id(&y.lots[2].id).is_none(), "the dropped lot must go");
    let added = saved
        .lots
        .iter()
        .find(|l| l.dye_lot == "D4")
        .expect("the new lot is inserted");
    assert!(!added.id.is_empty());
    assert_eq!(added.balls, 0.5);

    // Nothing but those three rows exists for the yarn.
    assert_eq!(list_yarn_lots(&conn, &y.id).unwrap().len(), 3);
}

#[test]
fn the_derived_quantities_sum_over_the_lots() {
    let conn = test_db();
    let input = YarnInput {
        name: "Shawl".to_string(),
        yarn_weight: "fingering".to_string(),
        metres_per_ball: 400,
        grams_per_ball: 100,
        lots: vec![lot("A", 2.5, 150), lot("B", 1.0, 30)],
        ..YarnInput::default()
    };
    let id = uuid::Uuid::new_v4().to_string();
    let y = insert_yarn(&conn, &id, &input).unwrap();

    assert_eq!(y.grams_left, 180);
    assert_eq!(y.balls_total, 3.5);
    // 180 g at 100 g per 400 m ball is 720 m.
    assert_eq!(y.metres_left, 720);

    // Without a per-ball gram figure the metres cannot be known, and zero is
    // more honest than a guess. The other sums still stand.
    let mut no_grams = get_yarn(&conn, &y.id).unwrap();
    no_grams.grams_per_ball = 0;
    let saved = update_yarn(&conn, &no_grams).unwrap();
    assert_eq!(saved.metres_left, 0);
    assert_eq!(saved.grams_left, 180);
    assert_eq!(saved.balls_total, 3.5);

    // The same goes for a missing metre figure.
    let mut no_metres = get_yarn(&conn, &y.id).unwrap();
    no_metres.metres_per_ball = 0;
    let saved = update_yarn(&conn, &no_metres).unwrap();
    assert_eq!(saved.metres_left, 0);
}

#[test]
fn yarns_can_be_filtered_by_family_and_search() {
    let conn = test_db();
    let a = stash(&conn, "Alpaca Cloud", "aran", vec![]);
    let _b = stash(&conn, "Shetland", "180 m/100g", vec![]);
    let _c = stash(&conn, "Sock Set", "fingering", vec![]);
    // No weight at all, which must never be swept into a family's results.
    let _d = stash(&conn, "Mystery Bag", "", vec![]);

    let names = |f: YarnFilter| -> Vec<String> {
        let mut rows = list_yarns(&conn, &f).unwrap();
        rows.sort_by(|x, y| x.name.cmp(&y.name));
        rows.into_iter().map(|y| y.name).collect()
    };

    assert_eq!(names(stash_filter(None, &["aran"])), vec!["Alpaca Cloud", "Shetland"]);
    // Several families are an OR within the group.
    assert_eq!(
        names(stash_filter(None, &["aran", "fingering"])),
        vec!["Alpaca Cloud", "Shetland", "Sock Set"]
    );
    // Search and family combine: the term narrows the family's matches.
    assert_eq!(
        names(stash_filter(Some("alpaca"), &["aran", "fingering"])),
        vec!["Alpaca Cloud"]
    );
    // The lots and derived figures come along on a list, not just on a get.
    let listed = list_yarns(&conn, &stash_filter(None, &[])).unwrap();
    assert_eq!(listed.len(), 4);
    assert!(listed.iter().any(|y| y.id == a.id));

    // Newest first, so the stash reads as "recently added" by default. Every
    // row gets a pinned timestamp: the real ones are all "now" and would
    // outrank the small values used here.
    for (name, at) in [
        ("Alpaca Cloud", 1),
        ("Shetland", 2),
        ("Sock Set", 3),
        ("Mystery Bag", 4),
    ] {
        conn.execute(
            "UPDATE yarns SET added_at = ?2 WHERE name = ?1",
            rusqlite::params![name, at],
        )
        .unwrap();
    }
    let ordered = list_yarns(&conn, &stash_filter(None, &[])).unwrap();
    let order: Vec<&str> = ordered.iter().map(|y| y.name.as_str()).collect();
    assert_eq!(order, vec!["Mystery Bag", "Sock Set", "Shetland", "Alpaca Cloud"]);
}

#[test]
fn yarn_search_treats_like_wildcards_as_literal_text() {
    let conn = test_db();
    stash(&conn, "100% Merino", "dk", vec![]);
    // Would match a wildcard "100%" read as "100 followed by anything".
    stash(&conn, "1000 Miles", "dk", vec![]);

    let found = list_yarns(&conn, &stash_filter(Some("100%"), &[])).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "100% Merino");
}

#[test]
fn the_stash_facets_list_every_family_with_its_count() {
    let conn = test_db();
    stash(&conn, "A", "aran", vec![]);
    stash(&conn, "B", "180 m/100g", vec![]);
    stash(&conn, "C", "fingering", vec![]);

    let facets = yarn_facets(&conn).unwrap();
    // Every family in the table is present whether or not it is used, so the
    // sidebar reads the same for everyone.
    assert_eq!(facets.len(), crate::yarn::FAMILIES.len());
    let count = |key: &str| -> i64 {
        facets
            .iter()
            .find(|f| f.key == key)
            .unwrap_or_else(|| panic!("no facet for {key}"))
            .count
    };
    assert_eq!(count("aran"), 2, "the named one and the 180 m one");
    assert_eq!(count("fingering"), 1);
    assert_eq!(count("jumbo"), 0, "unused but still listed");
    // Table order, lightest first, so the filter reads as a scale.
    let keys: Vec<&str> = facets.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(keys[0], "lace");
    assert_eq!(*keys.last().unwrap(), "jumbo");
}

#[test]
fn deleting_a_yarn_removes_its_lots() {
    let conn = test_db();
    let y = stash(&conn, "Doomed", "dk", vec![lot("A", 1.0, 100), lot("B", 2.0, 200)]);
    delete_yarn(&conn, &y.id).unwrap();
    assert!(get_yarn(&conn, &y.id).is_err());
    assert!(list_yarn_lots(&conn, &y.id).unwrap().is_empty());
}

#[test]
fn a_missing_yarn_is_not_found() {
    let conn = test_db();
    let err = get_yarn(&conn, "nope").unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "got {err}");

    // Updating a yarn that is not there is NotFound, not a silent insert.
    let mut ghost = stash(&conn, "Ghost", "dk", vec![]);
    ghost.id = "nope".to_string();
    let err = update_yarn(&conn, &ghost).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "got {err}");

    let err = delete_yarn(&conn, "nope").unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "got {err}");
}

#[test]
fn a_yarn_round_trips_every_field() {
    let conn = test_db();
    let input = YarnInput {
        name: "Woolfolk Tynd".to_string(),
        brand: "Woolfolk".to_string(),
        colourway: "11 - grey".to_string(),
        yarn_weight: "fingering".to_string(),
        metres_per_ball: 223,
        grams_per_ball: 50,
        notes: "For the shop sample.".to_string(),
        fibres: vec![],
        superwash: false,
        plans: vec![],
        lots: vec![YarnLotInput {
            dye_lot: "L22".to_string(),
            balls: 4.0,
            grams_left: 173,
            location: "stash box 2".to_string(),
            bought_at: Some(1_700_000_000_000),
            ..YarnLotInput::default()
        }],
    };
    let id = uuid::Uuid::new_v4().to_string();
    let y = insert_yarn(&conn, &id, &input).unwrap();

    let fetched = get_yarn(&conn, &y.id).unwrap();
    assert_eq!(fetched.name, "Woolfolk Tynd");
    assert_eq!(fetched.brand, "Woolfolk");
    assert_eq!(fetched.colourway, "11 - grey");
    assert_eq!(fetched.yarn_weight_family, "fingering");
    assert_eq!(fetched.metres_per_ball, 223);
    assert_eq!(fetched.grams_per_ball, 50);
    assert_eq!(fetched.notes, "For the shop sample.");
    assert_eq!(fetched.photo_path, "");
    assert!(fetched.added_at > 0);
    assert_eq!(fetched.lots.len(), 1);
    assert_eq!(fetched.lots[0].yarn_id, y.id);
    assert_eq!(fetched.lots[0].dye_lot, "L22");
    assert_eq!(fetched.lots[0].location, "stash box 2");
    assert_eq!(fetched.lots[0].bought_at, Some(1_700_000_000_000));
}

#[test]
fn a_page_turns_in_quarter_turns_and_upright_is_forgotten() {
    let conn = test_db();
    let p = sample(&conn, "Sideways chart", "A", "in-progress", &[]);
    assert!(list_page_rotations(&conn, &p.id).unwrap().is_empty());

    assert_eq!(set_page_rotation(&conn, &p.id, 3, 90).unwrap(), 90);
    assert_eq!(set_page_rotation(&conn, &p.id, 7, -90).unwrap(), 270, "a turn back wraps round");
    assert_eq!(set_page_rotation(&conn, &p.id, 3, 450).unwrap(), 90, "a full turn and a quarter is a quarter");
    assert_eq!(
        list_page_rotations(&conn, &p.id).unwrap(),
        vec![
            PageRotation { page: 3, rotation: 90 },
            PageRotation { page: 7, rotation: 270 },
        ]
    );

    // Turned all the way round, a page is upright again and keeps no row.
    assert_eq!(set_page_rotation(&conn, &p.id, 3, 360).unwrap(), 0);
    assert_eq!(list_page_rotations(&conn, &p.id).unwrap(), vec![PageRotation { page: 7, rotation: 270 }]);

    assert!(set_page_rotation(&conn, &p.id, 2, 45).is_err(), "only quarter turns");
    assert!(set_page_rotation(&conn, &p.id, 0, 90).is_err(), "pages start at 1");
}

#[test]
fn a_patterns_rotations_go_with_it() {
    let conn = test_db();
    let p = sample(&conn, "Sideways chart", "A", "in-progress", &[]);
    set_page_rotation(&conn, &p.id, 2, 180).unwrap();
    conn.execute("DELETE FROM patterns WHERE id = ?1", params![p.id]).unwrap();
    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM page_rotations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

fn tool(kind: &str, size: f64) -> crate::models::ToolInput {
    crate::models::ToolInput {
        kind: kind.to_string(),
        size_mm: size,
        brand: "Addi".to_string(),
        material: "metal".to_string(),
        ..Default::default()
    }
}

fn project(conn: &Connection, name: &str, pattern: Option<&str>) -> crate::models::Project {
    let input = crate::models::ProjectInput {
        name: name.to_string(),
        pattern_id: pattern.map(str::to_string),
        ..Default::default()
    };
    insert_project(conn, &uuid::Uuid::new_v4().to_string(), &input).unwrap()
}

fn yarn_with_lots(conn: &Connection, name: &str, lots: Vec<crate::models::YarnLotInput>) -> Yarn {
    let input = YarnInput { name: name.to_string(), lots, ..YarnInput::default() };
    insert_yarn(conn, &uuid::Uuid::new_v4().to_string(), &input).unwrap()
}

#[test]
fn tools_are_listed_smallest_first_with_their_project() {
    let conn = test_db();
    let socks = project(&conn, "Socks", None);
    insert_tool(&conn, "big", &tool("hook", 6.0)).unwrap();
    insert_tool(
        &conn,
        "small",
        &crate::models::ToolInput { project_id: Some(socks.id.clone()), ..tool("dpn", 2.5) },
    )
    .unwrap();
    let list = list_tools(&conn).unwrap();
    let ids: Vec<&str> = list.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["small", "big"]);
    assert_eq!(list[0].project_id.as_deref(), Some(socks.id.as_str()));
    assert_eq!(list[0].project_name, "Socks", "the project's name comes with it");
    assert_eq!(list[1].project_id, None);
}

#[test]
fn a_tool_is_on_one_active_project_at_a_time() {
    let conn = test_db();
    let a = project(&conn, "A", None);
    let b = project(&conn, "B", None);
    insert_tool(&conn, "t1", &tool("hook", 4.0)).unwrap();

    assert_eq!(set_tool_project(&conn, "t1", Some(&a.id)).unwrap().project_name, "A");
    assert_eq!(set_tool_project(&conn, "t1", Some(&b.id)).unwrap().project_name, "B", "moved");
    assert!(get_project(&conn, &a.id).unwrap().tool_ids.is_empty(), "and off the first");
    let free = set_tool_project(&conn, "t1", None).unwrap();
    assert_eq!((free.project_id, free.project_name.as_str()), (None, ""));
    assert!(set_tool_project(&conn, "t1", Some("gone")).is_err(), "an unknown project is refused");
    assert!(set_tool_project(&conn, "nope", None).is_err());
}

#[test]
fn a_tool_is_updated_and_removed() {
    let conn = test_db();
    insert_tool(&conn, "t1", &tool("hook", 4.0)).unwrap();
    let t = update_tool(&conn, "t1", &crate::models::ToolInput { brand: "Clover".into(), ..tool("hook", 4.5) }).unwrap();
    assert_eq!((t.brand.as_str(), t.size_mm), ("Clover", 4.5));
    assert!(insert_tool(&conn, "t2", &crate::models::ToolInput { project_id: Some("gone".into()), ..tool("hook", 3.0) }).is_err());
    assert!(get_tool(&conn, "t2").is_err(), "a refused tool is not half-stored");
    delete_tool(&conn, "t1").unwrap();
    assert!(list_tools(&conn).unwrap().is_empty());
    assert!(delete_tool(&conn, "t1").is_err());
}

#[test]
fn a_project_is_named_after_its_pattern_when_no_name_is_given() {
    let conn = test_db();
    let p = sample(&conn, "Featherweight Socks", "A", "in-progress", &[]);
    let named = project(&conn, "  Gift   socks ", Some(&p.id));
    assert_eq!(named.name, "Gift socks");
    assert_eq!(named.pattern_title, "Featherweight Socks");
    assert_eq!(named.status, "active");
    assert_eq!(project(&conn, "", Some(&p.id)).name, "Featherweight Socks");
    assert_eq!(project(&conn, "", None).name, "Untitled project");
    let bad = crate::models::ProjectInput { pattern_id: Some("gone".into()), ..Default::default() };
    assert!(insert_project(&conn, "x", &bad).is_err());
}

#[test]
fn saving_a_project_brings_its_tools_and_yarns_to_what_was_sent() {
    let conn = test_db();
    let other = project(&conn, "Other", None);
    insert_tool(&conn, "t1", &tool("circular", 4.0)).unwrap();
    insert_tool(&conn, "t2", &tool("dpn", 2.5)).unwrap();
    set_tool_project(&conn, "t2", Some(&other.id)).unwrap();
    let y = yarn_with_lots(&conn, "Felted Tweed", vec![lot("A", 2.0, 100), lot("B", 1.0, 50)]);

    let input = crate::models::ProjectInput {
        name: "Jumper".into(),
        tool_ids: vec!["t1".into(), "t2".into()],
        yarns: vec![crate::models::ProjectYarnInput { id: None, yarn_id: y.id.clone(), lot_id: Some(y.lots[1].id.clone()) }],
        ..Default::default()
    };
    let jumper = insert_project(&conn, "j", &input).unwrap();
    assert_eq!(jumper.tool_ids, vec!["t1", "t2"]);
    assert_eq!(get_tool(&conn, "t2").unwrap().project_name, "Jumper", "taken from the other project");
    assert!(get_project(&conn, &other.id).unwrap().tool_ids.is_empty());
    assert_eq!(jumper.yarns.len(), 1);
    assert_eq!(jumper.yarns[0].dye_lot, "B");
    assert_eq!(get_yarn(&conn, &y.id).unwrap().projects, vec!["Jumper"], "the yarn is in use");

    let entry = jumper.yarns[0].id.clone();
    let fewer = crate::models::ProjectInput {
        name: "Jumper".into(),
        tool_ids: vec!["t2".into()],
        yarns: vec![crate::models::ProjectYarnInput { id: Some(entry.clone()), yarn_id: y.id.clone(), lot_id: Some(y.lots[1].id.clone()) }],
        ..Default::default()
    };
    let saved = update_project(&conn, "j", &fewer).unwrap();
    assert_eq!(saved.tool_ids, vec!["t2"]);
    assert_eq!(get_tool(&conn, "t1").unwrap().project_id, None, "taken off, it is free");
    assert_eq!(saved.yarns[0].id, entry, "a kept yarn keeps its entry");

    let wrong_lot = crate::models::ProjectInput {
        yarns: vec![crate::models::ProjectYarnInput { id: None, yarn_id: y.id.clone(), lot_id: Some("someone-elses".into()) }],
        ..Default::default()
    };
    assert!(update_project(&conn, "j", &wrong_lot).is_err());
}

#[test]
fn finishing_releases_the_tools_and_records_the_leftovers() {
    let conn = test_db();
    insert_tool(&conn, "t1", &tool("circular", 4.0)).unwrap();
    let y = yarn_with_lots(&conn, "Felted Tweed", vec![lot("A", 2.0, 100)]);
    let gone = yarn_with_lots(&conn, "Used up", vec![lot("", 1.0, 50)]);
    let none = yarn_with_lots(&conn, "No lots", vec![]);
    let input = crate::models::ProjectInput {
        name: "Jumper".into(),
        tool_ids: vec!["t1".into()],
        yarns: [&y, &gone, &none]
            .iter()
            .map(|yy| crate::models::ProjectYarnInput { id: None, yarn_id: yy.id.clone(), lot_id: None })
            .collect(),
        ..Default::default()
    };
    let p = insert_project(&conn, "j", &input).unwrap();
    let entry = |name: &str| p.yarns.iter().find(|e| e.yarn_name == name).unwrap().id.clone();
    let finish = crate::models::FinishInput {
        finished_at: Some(1234),
        leftovers: vec![
            crate::models::YarnLeftover { entry_id: entry("Felted Tweed"), grams: Some(35) },
            crate::models::YarnLeftover { entry_id: entry("Used up"), grams: Some(0) },
            crate::models::YarnLeftover { entry_id: entry("No lots"), grams: Some(12) },
        ],
    };
    let done = finish_project(&conn, "j", &finish).unwrap();
    assert_eq!((done.status.as_str(), done.finished_at), ("finished", Some(1234)));
    assert_eq!(done.tool_ids, vec!["t1"], "a finished project keeps what it used");
    assert_eq!(get_tool(&conn, "t1").unwrap().project_id, None, "but the tool is free");

    let left = get_yarn(&conn, &y.id).unwrap();
    assert_eq!((left.lots[0].grams_left, left.lots[0].leftover), (35, true));
    assert!(left.projects.is_empty(), "the yarn is free again");
    let used = get_yarn(&conn, &gone.id).unwrap();
    assert_eq!((used.lots[0].grams_left, used.lots[0].leftover), (0, false), "0 g is used up, not a leftover");
    assert_eq!(used.used_up_at, Some(1234), "nothing left of it anywhere: into the stash's history, dated");
    assert_eq!(used.used_in, vec!["Jumper"], "with what it went into");
    assert_eq!(get_yarn(&conn, &y.id).unwrap().used_up_at, None, "what has some left stays in the stash");
    let uses = list_yarn_usage(&conn).unwrap();
    let took = |name: &str| uses.iter().find(|u| u.yarn_name.contains(name)).map(|u| (u.grams, u.project_name.as_str(), u.at, u.source.as_str()));
    assert_eq!(took("Felted Tweed"), Some((65, "Jumper", 1234, "finished")), "100 g before, 35 g left: 65 g used");
    assert_eq!(took("Used up"), Some((50, "Jumper", 1234, "finished")));
    assert_eq!(took("No lots"), None, "nothing weighed before, nothing known to be used");
    let made = get_yarn(&conn, &none.id).unwrap();
    assert_eq!(made.lots.len(), 1, "a lot is made to hold what is left");
    assert_eq!((made.lots[0].grams_left, made.lots[0].leftover), (12, true));
    assert_eq!(done.yarns.iter().find(|e| e.yarn_name == "Felted Tweed").unwrap().leftover_grams, Some(35));

    assert!(finish_project(&conn, "j", &crate::models::FinishInput::default()).is_err(), "only once");
    assert!(set_tool_project(&conn, "t1", Some("j")).is_err(), "nothing goes on a finished project");
    let renamed = update_project(&conn, "j", &crate::models::ProjectInput { name: "Blue jumper".into(), ..Default::default() }).unwrap();
    assert_eq!(renamed.name, "Blue jumper");
    assert_eq!(renamed.tool_ids, vec!["t1"], "editing a finished project leaves its record alone");
}

#[test]
fn removing_a_project_frees_what_was_on_it() {
    let conn = test_db();
    let p = sample(&conn, "Socks", "A", "in-progress", &[]);
    let pr = project(&conn, "", Some(&p.id));
    insert_tool(&conn, "t1", &crate::models::ToolInput { project_id: Some(pr.id.clone()), ..tool("dpn", 2.5) }).unwrap();
    delete_pattern(&conn, &p.id).unwrap();
    let kept = get_project(&conn, &pr.id).unwrap();
    assert_eq!((kept.pattern_id, kept.pattern_title.as_str()), (None, ""), "removing the pattern keeps the project");
    delete_project(&conn, &pr.id).unwrap();
    assert_eq!(get_tool(&conn, "t1").unwrap().project_id, None);
    assert!(list_projects(&conn).unwrap().is_empty());
}

#[test]
fn needles_on_patterns_and_named_projects_move_onto_projects_once() {
    let conn = test_db();
    let p = sample(&conn, "Socks", "A", "in-progress", &[]);
    // As a library from before projects: the old columns filled in directly.
    for (id, pattern, name) in [("a", Some(p.id.as_str()), ""), ("b", Some(p.id.as_str()), ""), ("c", None, "Gift hat"), ("d", None, "gift hat"), ("e", None, "")] {
        conn.execute(
            "INSERT INTO tools (id, kind, size_mm, pattern_id, project, added_at) VALUES (?1, 'hook', 4, ?2, ?3, 0)",
            params![id, pattern, name],
        )
        .unwrap();
    }
    conn.execute("DELETE FROM app_settings WHERE key = 'tools_into_projects'", []).unwrap();
    migrate(&conn).unwrap();

    let projects = list_projects(&conn).unwrap();
    assert_eq!(projects.len(), 2, "one per pattern and one per name");
    let socks = projects.iter().find(|pr| pr.name == "Socks").unwrap();
    assert_eq!(socks.pattern_id.as_deref(), Some(p.id.as_str()));
    assert_eq!(socks.tool_ids.len(), 2);
    let hat = projects.iter().find(|pr| pr.name == "Gift hat").unwrap();
    assert_eq!(hat.tool_ids.len(), 2, "the same name in another case is the same project");
    assert_eq!(get_tool(&conn, "e").unwrap().project_id, None);

    migrate(&conn).unwrap();
    assert_eq!(list_projects(&conn).unwrap().len(), 2, "and not again");
}

#[test]
fn a_board_holds_items_and_puts_each_new_one_on_top() {
    let conn = test_db();
    let pr = project(&conn, "Jumper", None);
    let note = crate::models::BoardItemInput {
        kind: "note".into(),
        x: 10.0,
        y: 20.0,
        w: 0.0,
        h: 0.0,
        data: Some(serde_json::json!({ "text": "Try the cabled hem", "colour": "yellow" })),
    };
    let a = insert_board_item(&conn, "a", &pr.id, &note).unwrap();
    assert_eq!((a.w, a.h), (220.0, 160.0), "no size given is the default");
    assert_eq!(a.data["text"], "Try the cabled hem");
    let b = insert_board_item(&conn, "b", &pr.id, &crate::models::BoardItemInput { kind: "link".into(), ..note.clone() }).unwrap();
    assert!(b.z > a.z, "a new item goes on top");
    assert_eq!(list_board_items(&conn, &pr.id).unwrap().iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), vec!["a", "b"]);

    let moved = update_board_item(&conn, "a", &crate::models::BoardItemPatch { x: Some(300.0), to_front: true, ..Default::default() }).unwrap();
    assert_eq!((moved.x, moved.y), (300.0, 20.0), "only what is given changes");
    assert!(moved.z > b.z, "brought to the front");
    assert_eq!(moved.data["text"], "Try the cabled hem");
    let tiny = update_board_item(&conn, "a", &crate::models::BoardItemPatch { w: Some(1.0), h: Some(f64::NAN), ..Default::default() }).unwrap();
    assert_eq!((tiny.w, tiny.h), (40.0, 160.0), "sizes are kept sensible");

    assert!(insert_board_item(&conn, "c", &pr.id, &crate::models::BoardItemInput { kind: "spaceship".into(), ..note.clone() }).is_err());
    assert!(insert_board_item(&conn, "d", &pr.id, &crate::models::BoardItemInput { data: Some(serde_json::json!("not an object")), ..note.clone() }).is_err());
    assert!(insert_board_item(&conn, "e", "no-such-board", &note).is_err());

    assert_eq!(delete_board_item(&conn, "b").unwrap(), "");
    delete_project(&conn, &pr.id).unwrap();
    assert!(get_board_item(&conn, "a").is_err(), "the board goes with its project");
}

#[test]
fn a_finished_projects_end_date_can_be_corrected_and_an_active_one_has_none() {
    let conn = test_db();
    let pr = project(&conn, "Hat", None);
    let set = |finished_at: Option<i64>| crate::models::ProjectInput { name: "Hat".into(), finished_at, ..Default::default() };
    assert_eq!(update_project(&conn, &pr.id, &set(Some(5))).unwrap().finished_at, None, "active: no end yet");
    finish_project(&conn, &pr.id, &crate::models::FinishInput { finished_at: Some(100), ..Default::default() }).unwrap();
    assert_eq!(update_project(&conn, &pr.id, &set(Some(200))).unwrap().finished_at, Some(200));
    assert_eq!(update_project(&conn, &pr.id, &set(None)).unwrap().finished_at, Some(200), "not given, kept");
    set_project_cover(&conn, &pr.id, "x.jpg").unwrap();
    assert_eq!(get_project(&conn, &pr.id).unwrap().cover_path, "x.jpg");
}

#[test]
fn an_inspiration_board_holds_items_and_shows_its_pictures_and_colours() {
    let conn = test_db();
    let board = insert_inspiration_board(&conn, "ib", "  ").unwrap();
    assert_eq!(board.name, "Untitled board", "a board always has a name");
    assert_eq!(board.item_count, 0);
    let pattern = sample(&conn, "Cardigan", "Jess", "", &[]);
    set_cover(&conn, &pattern.id, "cardigan.jpg").unwrap();
    let bare = sample(&conn, "No Cover", "Jess", "", &[]);
    let item = |kind: &str, data: serde_json::Value| crate::models::BoardItemInput { kind: kind.into(), data: Some(data), ..Default::default() };
    insert_board_item(&conn, "i0", "ib", &item("pattern", serde_json::json!({ "patternId": bare.id }))).unwrap();
    insert_board_item(&conn, "i1", "ib", &item("pattern", serde_json::json!({ "patternId": pattern.id }))).unwrap();
    insert_board_item(&conn, "i2", "ib", &item("swatch", serde_json::json!({ "colour": "#7aa874" }))).unwrap();
    insert_board_item(&conn, "i3", "ib", &item("image", serde_json::json!({}))).unwrap();
    set_board_item_image(&conn, "i3", "i3.jpg").unwrap();
    insert_board_item(&conn, "i4", "ib", &item("note", serde_json::json!({ "text": "cosy" }))).unwrap();

    let got = get_inspiration_board(&conn, "ib").unwrap();
    assert_eq!(got.item_count, 5);
    let mut pictures: Vec<_> = got.pictures.iter().map(|p| (p.kind.as_str(), p.id.as_str())).collect();
    pictures.sort();
    assert_eq!(pictures, vec![("image", "i3"), ("pattern", pattern.id.as_str())], "a pattern without a cover has no picture to show");
    assert_eq!(got.colours, vec!["#7aa874"]);

    let renamed = rename_inspiration_board(&conn, "ib", "Autumn colours").unwrap();
    assert_eq!(renamed.name, "Autumn colours");
    insert_inspiration_board(&conn, "other", "Lace ideas").unwrap();
    update_board_item(&conn, "i4", &crate::models::BoardItemPatch { x: Some(5.0), ..Default::default() }).unwrap();
    // Touched last, first in the list (the clock is in milliseconds, so wait one).
    std::thread::sleep(std::time::Duration::from_millis(3));
    update_board_item(&conn, "i4", &crate::models::BoardItemPatch { x: Some(6.0), ..Default::default() }).unwrap();
    assert_eq!(list_inspiration_boards(&conn).unwrap()[0].id, "ib");

    assert_eq!(delete_inspiration_board(&conn, "ib").unwrap(), vec!["i3.jpg".to_string()]);
    assert!(list_board_items(&conn, "ib").unwrap().is_empty(), "its items go with it");
    assert!(get_inspiration_board(&conn, "ib").is_err());
    assert!(delete_inspiration_board(&conn, "ib").is_err());
}

#[test]
fn board_items_keyed_by_project_move_to_the_board_id() {
    let conn = test_db();
    let pr = project(&conn, "Socks", None);
    // The table as it was first made.
    conn.execute_batch(
        "DROP TABLE board_items;
         CREATE TABLE board_items (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
            w REAL NOT NULL DEFAULT 220, h REAL NOT NULL DEFAULT 160, z INTEGER NOT NULL DEFAULT 0,
            data TEXT NOT NULL DEFAULT '{}', image_file TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);",
    )
    .unwrap();
    conn.execute(
        "INSERT INTO board_items (id, project_id, kind, data, created_at) VALUES ('n', ?1, 'note', '{\"text\":\"hi\"}', 1)",
        params![pr.id],
    )
    .unwrap();
    migrate(&conn).unwrap();
    let items = list_board_items(&conn, &pr.id).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].board_id, pr.id);
    assert_eq!(items[0].data["text"], "hi");
}

#[test]
fn a_project_on_the_needles_puts_its_pattern_in_progress() {
    let conn = test_db();
    let p = sample(&conn, "Hat", "Ann", "", &[]);
    let pr = project(&conn, "Hat for Tom", Some(&p.id));
    assert_eq!(get_pattern(&conn, &p.id).unwrap().status, "in-progress");
    // Marked otherwise by hand, it stays so while the project is edited.
    set_pattern_status(&conn, &p.id, "want-to-knit").unwrap();
    update_project(&conn, &pr.id, &crate::models::ProjectInput { name: "Hat for Tom".into(), pattern_id: Some(p.id.clone()), ..Default::default() }).unwrap();
    assert_eq!(get_pattern(&conn, &p.id).unwrap().status, "want-to-knit");
    // Picking another pattern for it puts that one in progress.
    let q = sample(&conn, "Mittens", "Ann", "", &[]);
    update_project(&conn, &pr.id, &crate::models::ProjectInput { name: "Hat for Tom".into(), pattern_id: Some(q.id.clone()), ..Default::default() }).unwrap();
    assert_eq!(get_pattern(&conn, &q.id).unwrap().status, "in-progress");
}

#[test]
fn projects_pause_frog_and_start_again() {
    let conn = test_db();
    let needle = insert_tool(&conn, "n", &crate::models::ToolInput { kind: "circular".into(), size_mm: 4.0, ..Default::default() }).unwrap();
    let input = crate::models::ProjectInput { name: "Jumper".into(), tool_ids: vec![needle.id.clone()], ..Default::default() };
    let pr = insert_project(&conn, "pr", &input).unwrap();

    let paused = set_project_status(&conn, &pr.id, "paused").unwrap();
    assert_eq!(paused.status, "paused");
    assert_eq!(get_tool(&conn, &needle.id).unwrap().project_id.as_deref(), Some("pr"), "paused keeps its needles");
    update_project(&conn, &pr.id, &crate::models::ProjectInput { tool_ids: vec![], ..input.clone() }).unwrap();
    assert!(get_project(&conn, &pr.id).unwrap().tool_ids.is_empty(), "a paused project's needles can still be changed");
    update_project(&conn, &pr.id, &input).unwrap();

    let frogged = set_project_status(&conn, &pr.id, "frogged").unwrap();
    assert_eq!(frogged.status, "frogged");
    assert!(frogged.finished_at.is_some());
    assert_eq!(get_tool(&conn, &needle.id).unwrap().project_id, None, "frogging frees its needles");
    assert_eq!(frogged.tool_ids, vec![needle.id.clone()], "…and keeps the record");

    // The needle goes onto something else; starting again gets back the rest.
    let other = insert_project(&conn, "other", &crate::models::ProjectInput { name: "Socks".into(), tool_ids: vec![needle.id.clone()], ..Default::default() }).unwrap();
    let again = set_project_status(&conn, &pr.id, "active").unwrap();
    assert_eq!(again.status, "active");
    assert_eq!(again.finished_at, None);
    assert!(again.tool_ids.is_empty(), "a needle on another project stays there");
    assert_eq!(get_tool(&conn, &needle.id).unwrap().project_id.as_deref(), Some(other.id.as_str()));

    assert!(set_project_status(&conn, &pr.id, "finished").is_err(), "finishing has its own step");
    assert!(set_project_status(&conn, &pr.id, "sideways").is_err());
    finish_project(&conn, &pr.id, &crate::models::FinishInput::default()).unwrap();
    assert!(set_project_status(&conn, &pr.id, "active").is_err(), "finished stays finished");
}

#[test]
fn designers_and_tags_come_counted_most_used_first() {
    let conn = test_db();
    sample(&conn, "A", "Ann", "", &["lace", "socks"]);
    sample(&conn, "B", "Ann", "", &["Lace"]);
    sample(&conn, "C", "Bo", "", &["lace", "LACE"]);
    sample(&conn, "D", "Cy", "", &["hat"]);
    let f = list_facets(&conn).unwrap();
    let pairs = |c: &[FacetCount]| c.iter().map(|x| (x.value.clone(), x.count)).collect::<Vec<_>>();
    assert_eq!(pairs(&f.designer_counts), vec![("Ann".into(), 2), ("Bo".into(), 1), ("Cy".into(), 1)]);
    assert_eq!(pairs(&f.tag_counts), vec![("lace".into(), 3), ("hat".into(), 1), ("socks".into(), 1)], "counted once per pattern, any casing");
}

#[test]
fn a_yarn_keeps_what_it_is_made_of() {
    let conn = test_db();
    let fibre = |name: &str, percent: f64| crate::models::Fibre { name: name.into(), percent };
    let input = YarnInput {
        name: "Sock".into(),
        fibres: vec![fibre("  merino ", 75.0), fibre("polyamide", 20.0), fibre("Merino", 5.0), fibre("", 10.0), fibre("silk", 250.0)],
        superwash: true,
        ..YarnInput::default()
    };
    let y = insert_yarn(&conn, "y", &input).unwrap();
    assert_eq!(y.fibres, vec![fibre("merino", 80.0), fibre("polyamide", 20.0), fibre("silk", 100.0)], "tidied: named twice is added, empty dropped, kept to 100");
    assert!(y.superwash);
    let mut changed = y.clone();
    changed.fibres = vec![fibre("cotton", 100.0)];
    changed.superwash = false;
    let saved = update_yarn(&conn, &changed).unwrap();
    assert_eq!(saved.fibres, vec![fibre("cotton", 100.0)]);
    assert!(!saved.superwash);
}

#[test]
fn titles_match_whatever_a_download_added() {
    assert_eq!(title_key("Featherweight Lace Sock"), "featherweight lace sock");
    assert_eq!(title_key("featherweight-lace-sock (1).pdf"), "featherweight lace sock");
    assert_eq!(title_key("Featherweight_Lace_Sock copy"), "featherweight lace sock");
    assert_eq!(title_key("Sock 2"), "sock", "a copy number");
    assert_eq!(title_key("1000"), "1000", "a title that is only a number stays");
    assert_ne!(title_key("Sock 2024"), "sock", "a year is part of the name");
}

#[test]
fn duplicates_are_found_by_file_or_by_title_and_designer() {
    let conn = test_db();
    let a = sample(&conn, "Lace Sock", "Jess", "", &[]);
    let b = sample(&conn, "lace-sock (1)", "", "", &[]);
    let c = sample(&conn, "Lace Sock", "Someone Else", "", &[]);
    let d = sample(&conn, "Cardigan", "Ann", "", &[]);
    let e = sample(&conn, "Cardigan Renamed", "Ann", "", &[]);
    sample(&conn, "Alone", "Ann", "", &[]);
    for (id, hash) in [(&d.id, "h1"), (&e.id, "h1")] {
        conn.execute("UPDATE patterns SET file_hash = ?2 WHERE id = ?1", params![id, hash]).unwrap();
    }
    let groups = duplicate_groups(&conn).unwrap();
    let ids = |g: &(bool, Vec<(Pattern, i64, i64, i64, String)>)| {
        let mut v: Vec<String> = g.1.iter().map(|e| e.0.id.clone()).collect();
        v.sort();
        v
    };
    assert_eq!(groups.len(), 2, "{:?}", groups.iter().map(ids).collect::<Vec<_>>());
    let exact = groups.iter().find(|g| g.0).expect("an exact group");
    let mut want = vec![d.id.clone(), e.id.clone()];
    want.sort();
    assert_eq!(ids(exact), want);
    let by_name = groups.iter().find(|g| !g.0).expect("a name group");
    // Jess's sock and the unnamed download, and the other designer's sock
    // through the unnamed one, which could be either.
    let mut want = vec![a.id.clone(), b.id.clone(), c.id.clone()];
    want.sort();
    assert_eq!(ids(by_name), want);
}

#[test]
fn merging_copies_keeps_what_was_made_from_them() {
    let conn = test_db();
    let keep = sample(&conn, "Lace Sock", "", "", &["socks"]);
    let mut copy = sample(&conn, "Lace Sock (1)", "Jess", "want-to-knit", &["Socks", "lace"]);
    copy.notes = "Use a smaller needle".into();
    copy.yarn_weight = "fingering".into();
    update_pattern(&conn, &copy).unwrap();
    let pr = project(&conn, "Mum's socks", Some(&copy.id));
    insert_board_item(
        &conn,
        "card",
        &pr.id,
        &crate::models::BoardItemInput { kind: "pattern".into(), data: Some(serde_json::json!({ "patternId": copy.id })), ..Default::default() },
    )
    .unwrap();

    let merged = merge_patterns(&conn, &keep.id, &[copy.id.clone()]).unwrap();
    assert_eq!(merged.tags, vec!["socks", "lace"], "tags joined, case-blind");
    assert_eq!(merged.status, "in-progress", "the copy's project had put it in progress");
    assert_eq!(merged.designer, "Jess");
    assert_eq!(merged.notes, "Use a smaller needle");
    assert_eq!(merged.yarn_weight, "fingering");
    assert_eq!(get_project(&conn, &pr.id).unwrap().pattern_id.as_deref(), Some(keep.id.as_str()));
    assert_eq!(get_board_item(&conn, "card").unwrap().data["patternId"], keep.id.as_str());
}

// ---------- shops and the wishlist ----------

fn shop(conn: &Connection, name: &str) -> crate::models::Shop {
    let input = crate::models::ShopInput { name: name.into(), url: format!("https://{}.example.com", name.to_lowercase()), comment: String::new(), tags: vec!["yarn".into()] };
    insert_shop(conn, &uuid::Uuid::new_v4().to_string(), &input).unwrap()
}

fn wish(conn: &Connection, name: &str, shop_id: Option<&str>, project_id: Option<&str>) -> crate::models::Wish {
    let input = crate::models::WishInput {
        kind: "yarn".into(),
        name: name.into(),
        shop_id: shop_id.map(str::to_string),
        project_id: project_id.map(str::to_string),
        ..Default::default()
    };
    insert_wish(conn, &uuid::Uuid::new_v4().to_string(), &input).unwrap()
}

#[test]
fn a_wish_shows_its_shop_and_project_and_a_shop_counts_what_is_wanted_there() {
    let conn = test_db();
    let drops = shop(&conn, "Drops");
    let hat = project(&conn, "Gift hat", None);
    let alpaca = wish(&conn, "Alpaca", Some(&drops.id), Some(&hat.id));
    assert_eq!((alpaca.shop_name.as_str(), alpaca.shop_url.as_str()), ("Drops", "https://drops.example.com"));
    assert_eq!(alpaca.project_name, "Gift hat");
    wish(&conn, "Merino", Some(&drops.id), None);
    assert_eq!(get_shop(&conn, &drops.id).unwrap().wanted, 2);
    set_wish_got(&conn, &alpaca.id, true).unwrap();
    assert_eq!(get_shop(&conn, &drops.id).unwrap().wanted, 1, "what was got is no longer wanted there");
}

#[test]
fn what_is_got_goes_below_what_is_still_wanted_and_can_go_back() {
    let conn = test_db();
    let first = wish(&conn, "First", None, None);
    std::thread::sleep(std::time::Duration::from_millis(3));
    wish(&conn, "Second", None, None);
    let got = set_wish_got(&conn, &first.id, true).unwrap();
    assert!(got.got_at.is_some());
    let names: Vec<_> = list_wishes(&conn).unwrap().into_iter().map(|w| w.name).collect();
    assert_eq!(names, vec!["Second", "First"]);
    let back = set_wish_got(&conn, &first.id, false).unwrap();
    assert_eq!(back.got_at, None);
    assert!(set_wish_got(&conn, "gone", true).is_err());
}

#[test]
fn removing_a_shop_or_project_leaves_the_wish_without_it() {
    let conn = test_db();
    let drops = shop(&conn, "Drops");
    let hat = project(&conn, "Gift hat", None);
    let alpaca = wish(&conn, "Alpaca", Some(&drops.id), Some(&hat.id));
    delete_shop(&conn, &drops.id).unwrap();
    delete_project(&conn, &hat.id).unwrap();
    let after = get_wish(&conn, &alpaca.id).unwrap();
    assert_eq!((after.shop_id, after.project_id), (None, None));
    assert_eq!((after.shop_name.as_str(), after.project_name.as_str()), ("", ""));
}

#[test]
fn a_wish_refuses_a_shop_or_project_that_is_not_there() {
    let conn = test_db();
    let input = crate::models::WishInput { kind: "yarn".into(), name: "Alpaca".into(), shop_id: Some("gone".into()), ..Default::default() };
    assert!(insert_wish(&conn, "w1", &input).is_err());
    let input = crate::models::WishInput { shop_id: None, project_id: Some("gone".into()), ..input };
    assert!(insert_wish(&conn, "w1", &input).is_err());
    let input = crate::models::WishInput { project_id: None, ..input };
    insert_wish(&conn, "w1", &input).unwrap();
    let edited = update_wish(&conn, "w1", &crate::models::WishInput { name: "Baby alpaca".into(), brand: "Drops".into(), ..input }).unwrap();
    assert_eq!((edited.name.as_str(), edited.brand.as_str()), ("Baby alpaca", "Drops"));
}

#[test]
fn shops_are_listed_by_name_whatever_the_case() {
    let conn = test_db();
    shop(&conn, "wollknoll");
    shop(&conn, "Drops");
    shop(&conn, "Lana Grossa");
    let names: Vec<_> = list_shops(&conn).unwrap().into_iter().map(|s| s.name).collect();
    assert_eq!(names, vec!["Drops", "Lana Grossa", "wollknoll"]);
}

#[test]
fn a_shop_keeps_its_tags() {
    let conn = test_db();
    let drops = shop(&conn, "Drops");
    assert_eq!(drops.tags, vec!["yarn"]);
    let input = crate::models::ShopInput { name: "Drops".into(), tags: vec!["yarn".into(), "sale".into()], ..Default::default() };
    assert_eq!(update_shop(&conn, &drops.id, &input).unwrap().tags, vec!["yarn", "sale"]);
}

#[test]
fn adding_to_the_stash_makes_a_wish_got_and_wanting_it_again_undoes_both() {
    let conn = test_db();
    let alpaca = wish(&conn, "Alpaca", None, None);
    let stashed = set_wish_stashed(&conn, &alpaca.id).unwrap();
    assert!(stashed.got_at.is_some() && stashed.stashed_at.is_some());
    let got = set_wish_got(&conn, &alpaca.id, true).unwrap();
    assert!(got.stashed_at.is_some(), "ticking got again keeps it stashed");
    let back = set_wish_got(&conn, &alpaca.id, false).unwrap();
    assert_eq!((back.got_at, back.stashed_at), (None, None));
}

#[test]
fn removing_a_wish_hands_back_its_picture() {
    let conn = test_db();
    let alpaca = wish(&conn, "Alpaca", None, None);
    set_wish_photo(&conn, &alpaca.id, "w.jpg").unwrap();
    assert_eq!(get_wish(&conn, &alpaca.id).unwrap().photo_path, "w.jpg");
    assert_eq!(delete_wish(&conn, &alpaca.id).unwrap(), "w.jpg");
    assert!(delete_wish(&conn, &alpaca.id).is_err());
}

#[test]
fn a_library_from_the_first_shops_build_gains_the_new_columns() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE shops (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL DEFAULT '',
             comment TEXT NOT NULL DEFAULT '', added_at INTEGER NOT NULL);
         INSERT INTO shops VALUES ('s1', 'Drops', '', '', 1);
         CREATE TABLE wishlist (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
             amount TEXT NOT NULL DEFAULT '', price TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
             shop_id TEXT, project_id TEXT, notes TEXT NOT NULL DEFAULT '', got_at INTEGER, added_at INTEGER NOT NULL);
         INSERT INTO wishlist (id, kind, name, added_at) VALUES ('w1', 'yarn', 'Alpaca', 1);",
    )
    .unwrap();
    migrate(&conn).unwrap();
    assert!(get_shop(&conn, "s1").unwrap().tags.is_empty());
    let w = get_wish(&conn, "w1").unwrap();
    assert_eq!((w.photo_path.as_str(), w.stashed_at, w.brand.as_str()), ("", None, ""));
}

// ---------- people and their measurements ----------

fn person(conn: &Connection, name: &str, extra: &[&str]) -> crate::models::Person {
    let input = crate::models::PersonInput { name: name.into(), extra: extra.iter().map(|e| e.to_string()).collect(), ..Default::default() };
    insert_person(conn, &uuid::Uuid::new_v4().to_string(), &input).unwrap()
}

fn values(pairs: &[(&str, f64)]) -> std::collections::BTreeMap<String, f64> {
    pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
}

#[test]
fn a_new_person_has_a_set_to_fill_in_and_sets_come_newest_first() {
    let conn = test_db();
    let mo = person(&conn, "Mo", &[]);
    assert_eq!(mo.sets.len(), 1, "one set, ready to fill in");
    assert!(mo.sets[0].values.is_empty());
    let first = &mo.sets[0];
    update_measurement_set(&conn, &first.id, &crate::models::MeasurementSetInput { measured_at: 1000, values: values(&[("chest", 60.0)]), shoe_size: "EU 28".into() }).unwrap();
    let later = crate::models::MeasurementSetInput { measured_at: 5000, values: values(&[("chest", 64.0)]), shoe_size: String::new() };
    let mo = insert_measurement_set(&conn, "later", &mo.id, &later).unwrap();
    assert_eq!(mo.sets.iter().map(|s| s.values["chest"]).collect::<Vec<_>>(), vec![64.0, 60.0], "older sets are kept, newest first");
    assert_eq!(mo.sets[1].shoe_size, "EU 28");
    let mo = delete_measurement_set(&conn, "later").unwrap();
    assert_eq!(mo.sets.len(), 1);
}

#[test]
fn a_measurement_of_their_own_that_goes_takes_its_values() {
    let conn = test_db();
    let mo = person(&conn, "Mo", &["Calf", "Thumb"]);
    let set = &mo.sets[0];
    update_measurement_set(&conn, &set.id, &crate::models::MeasurementSetInput { measured_at: 1, values: values(&[("x:Calf", 30.0), ("x:Thumb", 6.0), ("head", 52.0)]), shoe_size: String::new() }).unwrap();
    let input = crate::models::PersonInput { name: "Mo".into(), notes: String::new(), extra: vec!["Thumb".into()] };
    let mo = update_person(&conn, &mo.id, &input).unwrap();
    assert_eq!(mo.extra, vec!["Thumb"]);
    assert_eq!(mo.sets[0].values, values(&[("head", 52.0), ("x:Thumb", 6.0)]));
}

#[test]
fn a_project_says_who_it_is_for_and_keeps_that_through_its_own_saves() {
    let conn = test_db();
    let mo = person(&conn, "Mo", &[]);
    let hat = project(&conn, "Hat", None);
    let hat = set_project_person(&conn, &hat.id, Some(&mo.id)).unwrap();
    assert_eq!((hat.person_id.as_deref(), hat.person_name.as_str()), (Some(mo.id.as_str()), "Mo"));
    let input = crate::models::ProjectInput { name: "Warm hat".into(), ..Default::default() };
    assert_eq!(update_project(&conn, &hat.id, &input).unwrap().person_id.as_deref(), Some(mo.id.as_str()), "saving the details leaves who it is for");
    assert_eq!(get_person(&conn, &mo.id).unwrap().project_count, 1);
    assert!(set_project_person(&conn, &hat.id, Some("gone")).is_err());
    delete_person(&conn, &mo.id).unwrap();
    let hat = get_project(&conn, &hat.id).unwrap();
    assert_eq!((hat.person_id, hat.person_name.as_str()), (None, ""), "removing them leaves the project, for no one");
    assert!(get_person(&conn, &mo.id).is_err());
}

#[test]
fn people_are_listed_by_name() {
    let conn = test_db();
    person(&conn, "zoe", &[]);
    person(&conn, "Anna", &[]);
    person(&conn, "Mo", &[]);
    assert_eq!(list_people(&conn).unwrap().into_iter().map(|p| p.name).collect::<Vec<_>>(), vec!["Anna", "Mo", "zoe"]);
}

// ---------- gauge swatches ----------

fn swatch(conn: &Connection, id: &str, input: crate::models::SwatchInput) -> crate::models::Swatch {
    insert_swatch(conn, id, &input).unwrap()
}

#[test]
fn a_swatch_names_its_yarn_from_the_stash_or_as_typed() {
    let conn = test_db();
    let mut input = YarnInput { name: "Alpaca".into(), brand: "Drops".into(), ..YarnInput::default() };
    input.colourway = "Light grey".into();
    let yarn = insert_yarn(&conn, "y1", &input).unwrap();
    let s = swatch(&conn, "s1", crate::models::SwatchInput { yarn_id: Some(yarn.id.clone()), sts: 22.0, made_at: Some(5), ..Default::default() });
    assert_eq!((s.yarn_name.as_str(), s.yarn_colourway.as_str(), s.made_at), ("Drops Alpaca", "Light grey", 5));
    let typed = swatch(&conn, "s2", crate::models::SwatchInput { yarn_text: "Friend's merino".into(), made_at: Some(9), ..Default::default() });
    assert_eq!(typed.yarn_name, "Friend's merino");
    let ids: Vec<_> = list_swatches(&conn).unwrap().into_iter().map(|s| s.id).collect();
    assert_eq!(ids, vec!["s2", "s1"], "the most recently knitted first");
}

#[test]
fn removing_its_yarn_needle_or_project_keeps_the_swatch_and_what_it_was_knitted_in() {
    let conn = test_db();
    let mut input = YarnInput { name: "Alpaca".into(), brand: "Drops".into(), ..YarnInput::default() };
    input.colourway = "Light grey".into();
    let yarn = insert_yarn(&conn, "y1", &input).unwrap();
    insert_tool(&conn, "t1", &tool("circular", 4.0)).unwrap();
    let pr = project(&conn, "Hat", None);
    swatch(&conn, "s1", crate::models::SwatchInput {
        yarn_id: Some(yarn.id.clone()),
        tool_id: Some("t1".into()),
        needle_mm: 4.0,
        project_id: Some(pr.id.clone()),
        ..Default::default()
    });
    delete_yarn(&conn, &yarn.id).unwrap();
    delete_tool(&conn, "t1").unwrap();
    delete_project(&conn, &pr.id).unwrap();
    let s = get_swatch(&conn, "s1").unwrap();
    assert_eq!((s.yarn_id, s.tool_id, s.project_id), (None, None, None));
    assert_eq!((s.yarn_name.as_str(), s.needle_mm), ("Drops Alpaca, Light grey", 4.0), "the yarn's name and the size stay");
}

#[test]
fn a_swatch_refuses_links_that_are_not_there_and_hands_back_its_photo() {
    let conn = test_db();
    assert!(insert_swatch(&conn, "s1", &crate::models::SwatchInput { yarn_id: Some("gone".into()), ..Default::default() }).is_err());
    assert!(insert_swatch(&conn, "s1", &crate::models::SwatchInput { tool_id: Some("gone".into()), ..Default::default() }).is_err());
    swatch(&conn, "s1", crate::models::SwatchInput { sts: 20.0, ..Default::default() });
    let made = get_swatch(&conn, "s1").unwrap().made_at;
    let s = update_swatch(&conn, "s1", &crate::models::SwatchInput { sts: 21.0, made_at: None, ..Default::default() }).unwrap();
    assert_eq!((s.sts, s.made_at), (21.0, made), "no date given keeps the date it had");
    set_swatch_photo(&conn, "s1", "s1.jpg").unwrap();
    assert_eq!(delete_swatch(&conn, "s1").unwrap(), "s1.jpg");
}

// ---------- a project's log ----------

fn log_texts(conn: &Connection, project_id: &str) -> Vec<String> {
    list_project_log(conn, project_id).unwrap().into_iter().map(|e| e.text).collect()
}

#[test]
fn a_project_writes_its_milestones_into_its_log() {
    let conn = test_db();
    let p = sample(&conn, "Lace Sock", "", "", &[]);
    let input = crate::models::ProjectInput { name: "Socks".into(), started_at: Some(1_000), ..Default::default() };
    let pr = insert_project(&conn, "pr", &input).unwrap();
    assert_eq!(list_project_log(&conn, &pr.id).unwrap()[0].at, 1_000, "started when it says it started");
    set_project_status(&conn, &pr.id, "paused").unwrap();
    set_project_status(&conn, &pr.id, "active").unwrap();
    update_project(&conn, &pr.id, &crate::models::ProjectInput { name: "Socks".into(), pattern_id: Some(p.id.clone()), ..Default::default() }).unwrap();
    update_project(&conn, &pr.id, &crate::models::ProjectInput { name: "Socks for Mo".into(), pattern_id: Some(p.id.clone()), ..Default::default() }).unwrap();
    set_project_status(&conn, &pr.id, "frogged").unwrap();
    set_project_status(&conn, &pr.id, "active").unwrap();
    let texts = log_texts(&conn, &pr.id);
    assert_eq!(
        texts,
        vec!["Started again", "Frogged", "Pattern: Lace Sock", "Back on the needles", "Paused", "Started"],
        "newest first, and a rename is no milestone"
    );
    assert!(list_project_log(&conn, &pr.id).unwrap().iter().all(|e| e.milestone));
    finish_project(&conn, &pr.id, &crate::models::FinishInput { finished_at: Some(9_999_999_999_999), leftovers: vec![] }).unwrap();
    assert_eq!(log_texts(&conn, &pr.id)[0], "Finished");
}

#[test]
fn what_is_typed_is_dated_and_can_be_changed_and_removed() {
    let conn = test_db();
    let pr = project(&conn, "Hat", None);
    let entry = insert_log_entry(&conn, "e1", &pr.id, "Changed the decreases to every 4th row.", None).unwrap();
    assert!(!entry.milestone && entry.at > 0);
    assert_eq!(log_texts(&conn, &pr.id)[0], "Changed the decreases to every 4th row.", "now is after the start");
    let edited = update_log_entry(&conn, "e1", "Decreases every 3rd row after all.", 5).unwrap();
    assert_eq!((edited.text.as_str(), edited.at), ("Decreases every 3rd row after all.", 5));
    assert_eq!(log_texts(&conn, &pr.id).last().unwrap(), "Decreases every 3rd row after all.", "redated before the start, it sorts there");
    set_log_photo(&conn, "e1", "e1.jpg").unwrap();
    assert_eq!(log_photos(&conn, &pr.id).unwrap(), vec!["e1.jpg"]);
    assert_eq!(delete_log_entry(&conn, "e1").unwrap(), "e1.jpg");
    assert!(insert_log_entry(&conn, "e2", "gone", "x", None).is_err(), "a log belongs to a project that is there");
    delete_project(&conn, &pr.id).unwrap();
    assert!(list_project_log(&conn, &pr.id).unwrap().is_empty(), "a removed project takes its log");
}

#[test]
fn projects_from_before_the_log_get_their_start_and_end() {
    let conn = Connection::open_in_memory().unwrap();
    migrate(&conn).unwrap();
    conn.execute("DELETE FROM app_settings WHERE key = 'project_log_backfill'", []).unwrap();
    conn.execute_batch(
        "INSERT INTO projects (id, name, status, started_at, finished_at, created_at) VALUES ('a', 'A', 'finished', 10, 20, 10);
         INSERT INTO projects (id, name, status, started_at, finished_at, created_at) VALUES ('b', 'B', 'frogged', 30, 40, 30);
         INSERT INTO projects (id, name, status, started_at, created_at) VALUES ('c', 'C', 'active', 50, 50);",
    )
    .unwrap();
    migrate(&conn).unwrap();
    assert_eq!(log_texts(&conn, "a"), vec!["Finished", "Started"]);
    assert_eq!(log_texts(&conn, "b"), vec!["Frogged", "Started"]);
    assert_eq!(list_project_log(&conn, "c").unwrap()[0].at, 50);
    migrate(&conn).unwrap();
    assert_eq!(log_texts(&conn, "c").len(), 1, "once only");
}

#[test]
fn a_log_card_belongs_on_a_project_board_only() {
    let conn = test_db();
    let pr = project(&conn, "Hat", None);
    let board = insert_inspiration_board(&conn, "ib", "Ideas").unwrap();
    let log = crate::models::BoardItemInput { kind: "log".into(), ..Default::default() };
    assert!(insert_board_item(&conn, "on-project", &pr.id, &log).is_ok());
    assert!(insert_board_item(&conn, "on-ideas", &board.id, &log).is_err(), "an inspiration board has no log");
}

#[test]
fn a_chart_is_stored_whole_and_listed_newest_first() {
    use crate::models::{ChartColour, ChartData};
    let conn = test_db();
    let input = |name: &str, cells: &str| crate::models::ChartInput {
        name: name.into(),
        data: ChartData {
            kind: "standard".into(),
            width: 2,
            height: 2,
            cells: cells.into(),
            colours: vec![ChartColour { name: "White".into(), hex: "#ffffff".into() }, ChartColour { name: "Red".into(), hex: "#cc0000".into() }],
            repeats: 1,
            ..Default::default()
        },
    };
    let a = insert_chart(&conn, "c1", &input("Hearts", "0110")).unwrap();
    assert_eq!((a.name.as_str(), a.data.cells.as_str(), a.data.colours[1].name.as_str()), ("Hearts", "0110", "Red"));
    insert_chart(&conn, "c2", &input("Stars", "0000")).unwrap();
    // Changed later, so first.
    std::thread::sleep(std::time::Duration::from_millis(5));
    let changed = update_chart(&conn, "c1", &input("Hearts", "1111")).unwrap();
    assert_eq!(changed.data.cells, "1111");
    assert!(changed.updated_at >= changed.created_at);
    let ids: Vec<_> = list_charts(&conn).unwrap().into_iter().map(|c| c.id).collect();
    assert_eq!(ids, vec!["c1", "c2"]);
    delete_chart(&conn, "c1").unwrap();
    assert!(get_chart(&conn, "c1").is_err());
    assert!(update_chart(&conn, "c1", &input("Gone", "0000")).is_err());
    assert!(delete_chart(&conn, "c1").is_err());
}

#[test]
fn a_yarn_is_planned_for_a_pattern_or_a_title() {
    use crate::models::YarnPlan;
    let conn = test_db();
    let pattern = sample(&conn, "Rjupa", "Hulda", "", &[]);
    let plan = |id: Option<&str>, title: &str| YarnPlan { pattern_id: id.map(str::to_string), title: title.into() };
    let input = YarnInput {
        name: "Lettlopi".into(),
        plans: vec![
            plan(Some(&pattern.id), "whatever was typed"),
            plan(None, "  Strange   Brew "),
            plan(None, "strange brew"),
            plan(None, "  "),
            plan(Some("gone"), "Riddari"),
        ],
        ..YarnInput::default()
    };
    let yarn = insert_yarn(&conn, "y1", &input).unwrap();
    let got: Vec<_> = yarn.plans.iter().map(|p| (p.pattern_id.clone(), p.title.as_str())).collect();
    assert_eq!(
        got,
        vec![(Some(pattern.id.clone()), "Rjupa"), (None, "Strange Brew"), (None, "Riddari")],
        "a pattern by its own title, a title typed once, a pattern not there by its title"
    );
    assert_eq!(list_yarns(&conn, &YarnFilter { search: Some("strange".into()), ..Default::default() }).unwrap().len(), 1, "found by what it is planned for");

    // A renamed pattern is shown by its new name; a removed one keeps its old.
    conn.execute("UPDATE patterns SET title = 'Rjupa yoke' WHERE id = ?1", params![pattern.id]).unwrap();
    assert_eq!(get_yarn(&conn, "y1").unwrap().plans[0].title, "Rjupa yoke");
    delete_pattern(&conn, &pattern.id).unwrap();
    let after = get_yarn(&conn, "y1").unwrap();
    assert_eq!((after.plans[0].pattern_id.clone(), after.plans[0].title.as_str()), (None, "Rjupa"));

    let mut edited = after.clone();
    edited.plans = vec![];
    assert!(update_yarn(&conn, &edited).unwrap().plans.is_empty());
}

#[test]
fn a_used_up_yarn_leaves_the_stash_for_its_history() {
    let conn = test_db();
    insert_yarn(&conn, "y1", &YarnInput { name: "Air".into(), brand: "Drops".into(), yarn_weight: "DK".into(), ..YarnInput::default() }).unwrap();
    insert_yarn(&conn, "y2", &YarnInput { name: "Alpaca".into(), ..YarnInput::default() }).unwrap();
    let ids = |used: Option<&str>| -> Vec<String> {
        list_yarns(&conn, &YarnFilter { used: used.map(str::to_string), ..Default::default() }).unwrap().into_iter().map(|y| y.id).collect()
    };
    let used = set_yarn_used_up(&conn, "y1", Some(1234)).unwrap();
    assert_eq!(used.used_up_at, Some(1234));
    assert_eq!(ids(None), vec!["y2"], "the stash is what is not used up");
    assert_eq!(ids(Some("history")), vec!["y1"]);
    assert_eq!(ids(Some("all")).len(), 2);
    assert!(yarn_facets(&conn).unwrap().iter().all(|f| f.count == 0), "the weight counts are the stash's");
    set_yarn_used_up(&conn, "y1", None).unwrap();
    assert_eq!(ids(None).len(), 2, "back in the stash");
    assert!(set_yarn_used_up(&conn, "gone", None).is_err());
}

#[test]
fn ball_bands_are_filed_by_brand_and_name() {
    let conn = test_db();
    insert_ball_band(&conn, "b1", " Drops ", "Air").unwrap();
    let second = insert_ball_band(&conn, "b2", "DROPS", "air").unwrap();
    assert_eq!((second.brand.as_str(), second.name.as_str()), ("Drops", "Air"), "filed with the one there, whatever the case");
    assert!(insert_ball_band(&conn, "b3", "Drops", "  ").is_err(), "a band needs the yarn's name");
    insert_ball_band(&conn, "b4", "", "Mystery wool").unwrap();
    let all = rename_ball_bands(&conn, "drops", "AIR", "Garnstudio", "Air").unwrap();
    assert_eq!(all.iter().filter(|b| b.brand == "Garnstudio").count(), 2, "every picture of the yarn moves");
    assert_eq!(delete_ball_band(&conn, "b1").unwrap(), "");
    assert_eq!(list_ball_bands(&conn).unwrap().len(), 2);
}

#[test]
fn marking_a_yarn_used_up_counts_what_was_left_as_used() {
    let conn = test_db();
    let input = YarnInput { name: "Air".into(), brand: "Drops".into(), colourway: "01".into(), metres_per_ball: 150, grams_per_ball: 50, lots: vec![YarnLotInput { balls: 2.0, grams_left: 80, ..Default::default() }], ..YarnInput::default() };
    insert_yarn(&conn, "y1", &input).unwrap();
    set_yarn_used_up(&conn, "y1", Some(500)).unwrap();
    let uses = list_yarn_usage(&conn).unwrap();
    assert_eq!(uses.len(), 1);
    assert_eq!((uses[0].grams, uses[0].metres, uses[0].yarn_name.as_str(), uses[0].at), (80, 240, "Drops Air (01)", 500), "80 g of a 150 m / 50 g ball is 240 m");
    set_yarn_used_up(&conn, "y1", Some(900)).unwrap();
    assert_eq!(list_yarn_usage(&conn).unwrap().len(), 1, "marked again, it is not counted twice");
    set_yarn_used_up(&conn, "y1", None).unwrap();
    assert!(list_yarn_usage(&conn).unwrap().is_empty(), "back in the stash, it was not used after all");
    delete_yarn(&conn, "y1").unwrap();
}
