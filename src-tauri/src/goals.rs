//! Goals for a year, shown in the Stash's Statistics with how far along they
//! are: projects finished, grams or metres of the stash used, or one of your
//! own, counted by hand. How far the first three have got is worked out from
//! the projects and the yarn used; only your own keeps its count here.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::models::{AppError, AppResult};
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// What a goal counts.
pub const GOAL_KINDS: &[&str] = &["projects", "grams", "metres", "own"];

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub year: i64,
    /// One of `GOAL_KINDS`.
    pub kind: String,
    /// Your own goal's words: "learn brioche", "knit 10 hats".
    pub label: String,
    pub target: f64,
    /// Your own goal's count so far; the others are worked out.
    pub done: f64,
    pub added_at: i64,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GoalInput {
    #[serde(default)]
    pub id: Option<String>,
    pub year: i64,
    pub kind: String,
    #[serde(default)]
    pub label: String,
    pub target: f64,
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS goals (
            id       TEXT PRIMARY KEY,
            year     INTEGER NOT NULL,
            kind     TEXT NOT NULL,
            label    TEXT NOT NULL DEFAULT '',
            target   REAL NOT NULL,
            done     REAL NOT NULL DEFAULT 0,
            added_at INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Goal> {
    Ok(Goal { id: r.get(0)?, year: r.get(1)?, kind: r.get(2)?, label: r.get(3)?, target: r.get(4)?, done: r.get(5)?, added_at: r.get(6)? })
}

const COLUMNS: &str = "id, year, kind, label, target, done, added_at";

/// Every goal, the latest year first, in the order they were set.
pub fn list(conn: &Connection) -> AppResult<Vec<Goal>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM goals ORDER BY year DESC, added_at, rowid"))?;
    let rows = stmt.query_map([], row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn get(conn: &Connection, id: &str) -> AppResult<Goal> {
    Ok(conn.query_row(&format!("SELECT {COLUMNS} FROM goals WHERE id = ?1"), params![id], row)?)
}

/// Sets a goal, or changes the one named: what it counts, for which year, and how much.
pub fn save(conn: &Connection, input: &GoalInput) -> AppResult<Goal> {
    if !GOAL_KINDS.contains(&input.kind.as_str()) {
        return Err(AppError::Message(format!("“{}” is not a goal the app knows.", input.kind)));
    }
    if !(2000..=2100).contains(&input.year) {
        return Err(AppError::Message("A goal is for a year between 2000 and 2100.".into()));
    }
    if !input.target.is_finite() || input.target <= 0.0 || input.target > 10_000_000.0 {
        return Err(AppError::Message("A goal is a number more than 0.".into()));
    }
    let label = input.label.split_whitespace().collect::<Vec<_>>().join(" ");
    if input.kind == "own" && label.is_empty() {
        return Err(AppError::Message("Say what your own goal is.".into()));
    }
    let label: String = if input.kind == "own" { label.chars().take(120).collect() } else { String::new() };
    let target = (input.target * 100.0).round() / 100.0;
    let id = input.id.clone().filter(|i| !i.is_empty()).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO goals (id, year, kind, label, target, added_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (id) DO UPDATE SET year = ?2, kind = ?3, label = ?4, target = ?5",
        params![id, input.year, input.kind, label, target, now],
    )?;
    get(conn, &id)
}

/// Your own goal's count: never below 0.
pub fn set_done(conn: &Connection, id: &str, done: f64) -> AppResult<Goal> {
    let done = if done.is_finite() { done.clamp(0.0, 10_000_000.0) } else { 0.0 };
    conn.execute("UPDATE goals SET done = ?2 WHERE id = ?1 AND kind = 'own'", params![id, done])?;
    get(conn, id)
}

pub fn remove(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM goals WHERE id = ?1", params![id])?;
    Ok(())
}

#[tauri::command]
pub fn list_goals(state: State<'_, AppState>) -> CmdResult<Vec<Goal>> {
    list(&state.db())
}

#[tauri::command]
pub fn save_goal(state: State<'_, AppState>, input: GoalInput) -> CmdResult<Goal> {
    save(&state.db(), &input)
}

#[tauri::command]
pub fn set_goal_done(state: State<'_, AppState>, id: String, done: f64) -> CmdResult<Goal> {
    set_done(&state.db(), &id, done)
}

#[tauri::command]
pub fn remove_goal(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    remove(&state.db(), &id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn goals_are_kept_by_year_and_checked() {
        let conn = crate::db::open_test_db();
        let input = |kind: &str, label: &str, target: f64| GoalInput { id: None, year: 2026, kind: kind.into(), label: label.into(), target };
        let projects = save(&conn, &input("projects", "ignored", 12.0)).unwrap();
        assert_eq!((projects.kind.as_str(), projects.label.as_str(), projects.target), ("projects", "", 12.0), "only one's own goal has words");
        let own = save(&conn, &input("own", "  learn   brioche ", 3.0)).unwrap();
        assert_eq!(own.label, "learn brioche");
        save(&conn, &GoalInput { year: 2025, ..input("grams", "", 2000.0) }).unwrap();
        assert_eq!(list(&conn).unwrap().iter().map(|g| (g.year, g.kind.as_str())).collect::<Vec<_>>(), vec![(2026, "projects"), (2026, "own"), (2025, "grams")]);
        // Counted by hand, your own only.
        assert_eq!(set_done(&conn, &own.id, 2.0).unwrap().done, 2.0);
        assert_eq!(set_done(&conn, &own.id, -5.0).unwrap().done, 0.0);
        assert_eq!(set_done(&conn, &projects.id, 4.0).unwrap().done, 0.0, "a worked-out goal is not counted by hand");
        // Changed, it is that one.
        let changed = save(&conn, &GoalInput { id: Some(projects.id.clone()), ..input("projects", "", 15.0) }).unwrap();
        assert_eq!((changed.id, changed.target), (projects.id.clone(), 15.0));
        assert!(save(&conn, &input("hats", "", 3.0)).is_err());
        assert!(save(&conn, &input("own", " ", 3.0)).is_err());
        assert!(save(&conn, &input("grams", "", 0.0)).is_err());
        assert!(save(&conn, &GoalInput { year: 1990, ..input("grams", "", 10.0) }).is_err());
        remove(&conn, &own.id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 2);
    }
}
