//! Turning a model reply into a change to a pattern.
//!
//! Kept separate from the HTTP layer so the decisions that matter â€” what gets
//! overwritten, what a note looks like, when a field counts as set â€” can be
//! tested directly.

use crate::db;
use crate::models::{AiSettings, Pattern, Suggestion};


/// The fields the AI can write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Field {
    Designer,
    Difficulty,
    NeedleSize,
    YarnWeight,
    Yarn,
    Tags,
    Summary,
}

impl Field {
    pub fn label(self) -> &'static str {
        match self {
            Field::Designer => "Designer",
            Field::Difficulty => "Difficulty",
            Field::NeedleSize => "Needle size",
            Field::YarnWeight => "Yarn weight",
            Field::Yarn => "Yarn",
            Field::Tags => "Tags",
            Field::Summary => "Summary",
        }
    }
}

/// Folds a suggestion into a copy of the pattern, respecting `skip_existing`.
///
/// With `skip_existing` on (the default) anything the user has already filled
/// in is left alone, so a rescan cannot quietly discard their own wording.
pub fn apply_to(pattern: &Pattern, suggestion: &Suggestion, settings: &AiSettings) -> Pattern {
    let mut next = pattern.clone();

    let keep_existing = |current: &str| -> bool {
        settings.skip_existing && !current.trim().is_empty()
    };

    if !keep_existing(&pattern.designer) && !suggestion.designer.is_empty() {
        next.designer = suggestion.designer.clone();
    }
    if !keep_existing(&pattern.difficulty) && !suggestion.difficulty.is_empty() {
        next.difficulty = suggestion.difficulty.clone();
    }
    if !keep_existing(&pattern.needle_size) && !suggestion.needle_size.is_empty() {
        next.needle_size = suggestion.needle_size.clone();
    }
    if !keep_existing(&pattern.yarn_weight) && !suggestion.yarn_weight.is_empty() {
        next.yarn_weight = suggestion.yarn_weight.clone();
        // The family is derived, so it follows the weight rather than being
        // asked of the model, which only knows how to read the page.
        next.yarn_weight_family =
            crate::yarn::family_of(&suggestion.yarn_weight).to_string();
    }

    // Yarn is not a stored field of its own, so it is folded into the notes
    // where it is still findable and editable.
    if !suggestion.yarn.is_empty() && !pattern.notes.contains(&suggestion.yarn) {
        let line = if next.notes.trim().is_empty() {
            format!("Yarn: {}", suggestion.yarn)
        } else {
            format!("{}\nYarn: {}", next.notes.trim_end(), suggestion.yarn)
        };
        next.notes = line;
    }

    // Tags are a set, not a value: merge rather than replace, so a tag the
    // user added is never lost.
    if !suggestion.tags.is_empty() {
        let mut merged = next.tags.clone();
        for tag in &suggestion.tags {
            if !merged.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
                merged.push(tag.clone());
            }
        }
        merged.sort();
        merged.dedup();
        next.tags = merged;
    }

    // The summary becomes the first line of the notes when there is room for
    // it, since that is what the notes field is for.
    if !suggestion.summary.is_empty()
        && !next.notes.contains(suggestion.summary.trim())
        && next.notes.trim().is_empty()
    {
        next.notes = suggestion.summary.clone();
    }

    next
}

/// Which fields a suggestion would actually change.
pub fn changed_fields(before: &Pattern, after: &Pattern) -> Vec<String> {
    let mut changed = Vec::new();
    if before.designer != after.designer {
        changed.push(Field::Designer.label().to_string());
    }
    if before.difficulty != after.difficulty {
        changed.push(Field::Difficulty.label().to_string());
    }
    if before.needle_size != after.needle_size {
        changed.push(Field::NeedleSize.label().to_string());
    }
    if before.yarn_weight != after.yarn_weight {
        changed.push(Field::YarnWeight.label().to_string());
    }
    if before.tags != after.tags {
        changed.push(Field::Tags.label().to_string());
    }
    if before.notes != after.notes {
        // The notes field carries yarn and the summary, so name it by what
        // actually caused the change.
        if after.notes.contains("Yarn:") && !before.notes.contains("Yarn:") {
            changed.push(Field::Yarn.label().to_string());
        } else {
            changed.push(Field::Summary.label().to_string());
        }
    }
    changed
}

/// Writes a pattern and records the change so it can be undone.
pub fn commit(
    conn: &rusqlite::Connection,
    before: &Pattern,
    after: &Pattern,
) -> crate::models::AppResult<Pattern> {
    let updated = db::update_pattern(conn, after)?;
    db::record_ai_change(conn, &before.id, before, &updated)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    // `use super::*` does not carry the parent's imports across, so the names
    // the tests need are listed explicitly.
    use super::*;
    use crate::models::PatternInput;

    /// A pattern inserted into the given database, so tests that commit can
    /// see it.
    fn pattern_in(conn: &rusqlite::Connection) -> Pattern {
        let input = PatternInput {
            title: "Featherweight Lace Sock".to_string(),
            designer: String::new(),
            file_name: "x.pdf".to_string(),
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
        db::insert_pattern(conn, &id, &input, "C:/x.pdf", "pdf").unwrap()
    }

    /// A pattern on a throwaway database, for tests that never touch the db.
    fn pattern() -> Pattern {
        pattern_in(&crate::db::open_test_db())
    }

    fn suggestion() -> Suggestion {
        Suggestion {
            designer: "Jess Leslie".to_string(),
            difficulty: "intermediate".to_string(),
            needle_size: "4mm".to_string(),
            yarn_weight: "fingering".to_string(),
            yarn: "Shetland wool".to_string(),
            tags: vec!["lace".to_string(), "socks".to_string()],
            summary: "A fine gauge lace sock worked from a chart.".to_string(),
        }
    }

    fn defaults() -> AiSettings {
        AiSettings::default()
    }

    #[test]
    fn fills_empty_fields() {
        let p = pattern();
        let after = apply_to(&p, &suggestion(), &defaults());
        assert_eq!(after.designer, "Jess Leslie");
        assert_eq!(after.difficulty, "intermediate");
        assert_eq!(after.needle_size, "4mm");
        assert_eq!(after.tags, vec!["lace", "socks"]);
        assert!(after.notes.contains("Yarn: Shetland wool"));
    }

    #[test]
    fn respects_existing_values_by_default() {
        let mut p = pattern();
        p.designer = "My Own Label".to_string();
        let after = apply_to(&p, &suggestion(), &defaults());
        assert_eq!(after.designer, "My Own Label");
        // The empty ones are still filled in.
        assert_eq!(after.needle_size, "4mm");
    }

    #[test]
    fn overwrites_when_asked() {
        let mut settings = defaults();
        settings.skip_existing = false;
        let mut p = pattern();
        p.designer = "My Own Label".to_string();
        let after = apply_to(&p, &suggestion(), &settings);
        assert_eq!(after.designer, "Jess Leslie");
    }

    #[test]
    fn merges_tags_without_losing_ones_already_there() {
        let mut settings = defaults();
        settings.skip_existing = false;
        let mut p = pattern();
        p.tags = vec!["shetland".to_string()];
        let after = apply_to(&p, &suggestion(), &settings);
        assert!(after.tags.contains(&"shetland".to_string()));
        assert!(after.tags.contains(&"lace".to_string()));
        assert!(after.tags.contains(&"socks".to_string()));
    }

    #[test]
    fn tag_merge_ignores_case_and_duplicates() {
        let mut settings = defaults();
        settings.skip_existing = false;
        let mut p = pattern();
        p.tags = vec!["Lace".to_string()];
        let mut s = suggestion();
        s.tags = vec!["lace".to_string(), "LACE".to_string()];
        let after = apply_to(&p, &s, &settings);
        assert_eq!(
            after.tags.iter().filter(|t| t.eq_ignore_ascii_case("lace")).count(),
            1
        );
    }

    #[test]
    fn yarn_is_appended_below_existing_notes() {
        let mut p = pattern();
        p.notes = "Remember to swatch.".to_string();
        let after = apply_to(&p, &suggestion(), &defaults());
        assert!(after.notes.starts_with("Remember to swatch."));
        assert!(after.notes.contains("Yarn: Shetland wool"));
    }

    #[test]
    fn yarn_is_not_repeated_on_a_rescan() {
        let mut p = pattern();
        p.notes = "Yarn: Shetland wool".to_string();
        let after = apply_to(&p, &suggestion(), &defaults());
        assert_eq!(after.notes.matches("Yarn:").count(), 1);
    }

    #[test]
    fn an_empty_suggestion_changes_nothing() {
        let p = pattern();
        let empty = Suggestion::default();
        let after = apply_to(&p, &empty, &defaults());
        assert_eq!(after.designer, p.designer);
        assert_eq!(after.notes, p.notes);
        assert!(changed_fields(&p, &after).is_empty());
    }

    #[test]
    fn changed_fields_names_only_real_differences() {
        let p = pattern();
        let after = apply_to(&p, &suggestion(), &defaults());
        let changed = changed_fields(&p, &after);
        assert!(changed.contains(&"Designer".to_string()));
        assert!(changed.contains(&"Needle size".to_string()));
        assert!(changed.contains(&"Tags".to_string()));
        assert!(!changed.contains(&"Title".to_string()));
    }

    #[test]
    fn applying_the_same_suggestion_twice_is_idempotent() {
        let p = pattern();
        let once = apply_to(&p, &suggestion(), &defaults());
        let twice = apply_to(&once, &suggestion(), &defaults());
        assert_eq!(once.designer, twice.designer);
        assert_eq!(once.tags, twice.tags);
        assert_eq!(once.notes, twice.notes);
    }

    #[test]
    fn commit_records_an_undo_point() {
        let conn = crate::db::open_test_db();
        let before = pattern_in(&conn);
        let after = apply_to(&before, &suggestion(), &defaults());
        let saved = commit(&conn, &before, &after).unwrap();
        assert_eq!(saved.designer, "Jess Leslie");

        let (_id, restored) = db::latest_ai_change(&conn, &before.id).unwrap().unwrap();
        assert_eq!(restored.designer, "");
    }
}


