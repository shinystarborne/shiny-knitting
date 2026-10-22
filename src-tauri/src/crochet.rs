//! Crochet diagrams: rounds or rows written as a pattern writes them, drawn
//! by the page in the standard crochet symbols (views/crochet.ts). Kept here
//! as written: their name, their shape (rounds, rows, or a strip along a
//! spiral), US or UK terms, and the rounds or rows themselves.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::models::{AppError, AppResult};
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

pub const SHAPES: &[&str] = &["rounds", "rows", "spiral"];
pub const TERMS: &[&str] = &["us", "uk"];
/// More rounds than any doily has.
const MAX_ROWS: usize = 200;
/// A round written out longhand, with room to spare.
const MAX_ROW_CHARS: usize = 2000;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrochetData {
    pub shape: String,
    pub terms: String,
    pub rows: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CrochetDiagram {
    pub id: String,
    pub name: String,
    pub notes: String,
    pub data: CrochetData,
    pub added_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrochetInput {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub notes: String,
    pub data: CrochetData,
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS crochet_diagrams (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            notes      TEXT NOT NULL DEFAULT '',
            data       TEXT NOT NULL,
            added_at   INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

/// A known shape and terms, rows of a sensible number and length, each on one line.
pub fn clean(input: &CrochetInput) -> AppResult<CrochetInput> {
    let d = &input.data;
    if !SHAPES.contains(&d.shape.as_str()) {
        return Err(AppError::Message("A diagram is in rounds, in rows, or along a spiral.".into()));
    }
    if !TERMS.contains(&d.terms.as_str()) {
        return Err(AppError::Message("A diagram is written in US or UK terms.".into()));
    }
    if d.rows.len() > MAX_ROWS {
        return Err(AppError::Message(format!("A diagram has at most {MAX_ROWS} rounds or rows.")));
    }
    let rows = d.rows.iter().map(|r| r.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(MAX_ROW_CHARS).collect()).collect();
    let name: String = input.name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect();
    Ok(CrochetInput {
        id: input.id.clone().filter(|i| !i.trim().is_empty()),
        name: if name.is_empty() { "Untitled diagram".into() } else { name },
        notes: input.notes.trim().chars().take(4000).collect(),
        data: CrochetData { shape: d.shape.clone(), terms: d.terms.clone(), rows },
    })
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<CrochetDiagram> {
    let data: String = r.get(3)?;
    Ok(CrochetDiagram {
        id: r.get(0)?,
        name: r.get(1)?,
        notes: r.get(2)?,
        // Unreadable is empty rounds, which still opens and can be written again.
        data: serde_json::from_str(&data).unwrap_or(CrochetData { shape: "rounds".into(), terms: "us".into(), rows: vec![] }),
        added_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

const COLUMNS: &str = "id, name, notes, data, added_at, updated_at";

/// Every diagram, the one changed last first.
pub fn list(conn: &Connection) -> AppResult<Vec<CrochetDiagram>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM crochet_diagrams ORDER BY updated_at DESC, rowid DESC"))?;
    let rows = stmt.query_map([], row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<CrochetDiagram> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM crochet_diagrams WHERE id = ?1"), params![id], row)
        .optional()?
        .ok_or_else(|| AppError::NotFound("That diagram is no longer there.".into()))
}

/// A new diagram, or the one named changed.
pub fn save(conn: &Connection, input: &CrochetInput) -> AppResult<CrochetDiagram> {
    let input = clean(input)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    let data = serde_json::to_string(&input.data)?;
    let id = input.id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    conn.execute(
        "INSERT INTO crochet_diagrams (id, name, notes, data, added_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT (id) DO UPDATE SET name = ?2, notes = ?3, data = ?4, updated_at = ?5",
        params![id, input.name, input.notes, data, now],
    )?;
    get(conn, &id)
}

pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM crochet_diagrams WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn list_crochet_diagrams(state: State<'_, AppState>) -> CmdResult<Vec<CrochetDiagram>> {
    list(&state.db())
}

#[tauri::command]
pub fn save_crochet_diagram(state: State<'_, AppState>, input: CrochetInput) -> CmdResult<CrochetDiagram> {
    save(&state.db(), &input)
}

#[tauri::command]
pub fn delete_crochet_diagram(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    remove(&state.db(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(shape: &str, terms: &str, rows: &[&str]) -> CrochetInput {
        CrochetInput { id: None, name: " Granny  square ".into(), notes: String::new(), data: CrochetData { shape: shape.into(), terms: terms.into(), rows: rows.iter().map(|r| r.to_string()).collect() } }
    }

    #[test]
    fn a_diagram_is_kept_as_written_and_changed_in_place() {
        let conn = crate::db::open_test_db();
        let d = save(&conn, &input("rounds", "uk", &["ch 3,  11 tr in ring", "join"])).unwrap();
        assert_eq!(d.name, "Granny square");
        assert_eq!(d.data.rows, vec!["ch 3, 11 tr in ring", "join"]);
        assert_eq!(d.data.terms, "uk");
        let changed = save(&conn, &CrochetInput { id: Some(d.id.clone()), ..input("spiral", "us", &["ch 40"]) }).unwrap();
        assert_eq!((changed.id.as_str(), changed.data.shape.as_str(), changed.added_at), (d.id.as_str(), "spiral", d.added_at));
        assert_eq!(list(&conn).unwrap().len(), 1);
        remove(&conn, &d.id).unwrap();
        assert!(list(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_shape_and_terms_it_does_not_know_are_refused() {
        let conn = crate::db::open_test_db();
        assert!(save(&conn, &input("hexagon", "us", &[])).is_err());
        assert!(save(&conn, &input("rows", "fr", &[])).is_err());
        let many: Vec<&str> = vec!["sc"; MAX_ROWS + 1];
        assert!(save(&conn, &input("rows", "us", &many)).is_err());
        assert_eq!(save(&conn, &input("rows", "us", &[])).unwrap().name, "Granny square");
    }
}
