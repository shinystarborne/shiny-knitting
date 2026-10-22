//! Abbreviations of your own, for the glossary. The common ones (ssk, k2tog,
//! w&t…) are the app's and live in the frontend; these are what you add: a
//! designer's own, or a meaning you would rather read. One of yours with the
//! same term as a common one is shown in its place.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::models::{AppError, AppResult};
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// An abbreviation of yours: what a pattern writes, and what it means.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Abbreviation {
    pub id: String,
    pub term: String,
    pub meaning: String,
    pub added_at: i64,
}

/// What the glossary sends: an `id` changes that one, none adds one.
#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AbbreviationInput {
    #[serde(default)]
    pub id: Option<String>,
    pub term: String,
    pub meaning: String,
}

/// The table, made when the database is opened.
pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS abbreviations (
            id       TEXT PRIMARY KEY,
            term     TEXT NOT NULL COLLATE NOCASE,
            meaning  TEXT NOT NULL,
            added_at INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

/// Yours, by their terms.
pub fn list(conn: &Connection) -> AppResult<Vec<Abbreviation>> {
    let mut stmt = conn.prepare("SELECT id, term, meaning, added_at FROM abbreviations ORDER BY term COLLATE NOCASE, added_at")?;
    let rows = stmt.query_map([], |r| Ok(Abbreviation { id: r.get(0)?, term: r.get(1)?, meaning: r.get(2)?, added_at: r.get(3)? }))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Adds one, or changes the one named: the term on one line, both said. A
/// term you have already is that one changed, not a second.
pub fn save(conn: &Connection, input: &AbbreviationInput) -> AppResult<Abbreviation> {
    let term = input.term.split_whitespace().collect::<Vec<_>>().join(" ");
    let meaning = input.meaning.trim().to_string();
    if term.is_empty() || meaning.is_empty() {
        return Err(AppError::Message("An abbreviation needs both the abbreviation and its meaning.".into()));
    }
    if term.chars().count() > 40 {
        return Err(AppError::Message("An abbreviation can be up to 40 characters.".into()));
    }
    if meaning.chars().count() > 1000 {
        return Err(AppError::Message("The meaning can be up to 1000 characters.".into()));
    }
    let same: Option<String> = conn
        .query_row("SELECT id FROM abbreviations WHERE term = ?1", params![term], |r| r.get(0))
        .ok();
    let id = match (input.id.clone().filter(|i| !i.is_empty()), same) {
        (Some(id), Some(other)) if other != id => {
            return Err(AppError::Message(format!("“{term}” is already a custom abbreviation.")));
        }
        (Some(id), _) => id,
        (None, Some(other)) => other,
        (None, None) => uuid::Uuid::new_v4().to_string(),
    };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO abbreviations (id, term, meaning, added_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (id) DO UPDATE SET term = ?2, meaning = ?3",
        params![id, term, meaning, now],
    )?;
    Ok(conn.query_row("SELECT id, term, meaning, added_at FROM abbreviations WHERE id = ?1", params![id], |r| {
        Ok(Abbreviation { id: r.get(0)?, term: r.get(1)?, meaning: r.get(2)?, added_at: r.get(3)? })
    })?)
}

pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM abbreviations WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn list_abbreviations(state: State<'_, AppState>) -> CmdResult<Vec<Abbreviation>> {
    list(&state.db())
}

#[tauri::command]
pub fn save_abbreviation(state: State<'_, AppState>, input: AbbreviationInput) -> CmdResult<Abbreviation> {
    save(&state.db(), &input)
}

#[tauri::command]
pub fn remove_abbreviation(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    remove(&state.db(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn your_own_abbreviations_are_kept_by_their_terms() {
        let conn = crate::db::open_test_db();
        let input = |id: Option<&str>, term: &str, meaning: &str| AbbreviationInput { id: id.map(String::from), term: term.into(), meaning: meaning.into() };
        let cdd = save(&conn, &input(None, "  CDD \n", " centred double decrease ")).unwrap();
        assert_eq!((cdd.term.as_str(), cdd.meaning.as_str()), ("CDD", "centred double decrease"), "on one line, trimmed");
        // The same term again, in another case, is that one changed.
        let again = save(&conn, &input(None, "cdd", "slip 2 together, k1, pass both over")).unwrap();
        assert_eq!(again.id, cdd.id);
        assert_eq!(list(&conn).unwrap().len(), 1);
        let mb = save(&conn, &input(None, "MB", "make bobble")).unwrap();
        assert_eq!(list(&conn).unwrap().iter().map(|a| a.term.as_str()).collect::<Vec<_>>(), vec!["cdd", "MB"], "as last typed");
        // Renamed to one there is: refused.
        assert!(save(&conn, &input(Some(&mb.id), "CDD", "x")).unwrap_err().to_string().contains("already a custom abbreviation"));
        assert!(save(&conn, &input(None, "x", " ")).is_err(), "a meaning is needed");
        assert!(save(&conn, &input(None, &"k".repeat(41), "long")).is_err());
        remove(&conn, &mb.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
    }
}
