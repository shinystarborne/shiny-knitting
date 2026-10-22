//! Charts kept as pictures: a knitting or crochet chart from a book, a
//! pattern or a screenshot, only the chart and not the whole pattern, in the
//! Charts tab and on a project's board. Not the charts drawn in Constructors:
//! these are images kept as they are.
//!
//! The picture lives in `library/chart-pictures/<id>.<ext>`; the frontend
//! downscales it first, so a big scan is kept at a size still sharp to read.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::models::{AppError, AppResult};
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// What a chart is worked in.
pub const CRAFTS: &[&str] = &["knitting", "crochet"];

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChartPicture {
    pub id: String,
    pub name: String,
    /// One of `CRAFTS`.
    pub craft: String,
    pub notes: String,
    /// The picture's size in pixels, so a card has its shape before it is read.
    pub width: i64,
    pub height: i64,
    pub added_at: i64,
}

#[derive(Debug, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChartPictureInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub craft: String,
    #[serde(default)]
    pub notes: String,
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chart_pictures (
            id        TEXT PRIMARY KEY,
            name      TEXT NOT NULL,
            craft     TEXT NOT NULL,
            notes     TEXT NOT NULL DEFAULT '',
            file_name TEXT NOT NULL DEFAULT '',
            width     INTEGER NOT NULL DEFAULT 0,
            height    INTEGER NOT NULL DEFAULT 0,
            added_at  INTEGER NOT NULL
        );",
    )?;
    Ok(())
}

/// A name of one line, a known craft, notes of a sensible length.
pub fn clean(input: &ChartPictureInput) -> AppResult<ChartPictureInput> {
    if !CRAFTS.contains(&input.craft.as_str()) {
        return Err(AppError::Message("Choose knitting or crochet for the chart.".into()));
    }
    let name: String = input.name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect();
    Ok(ChartPictureInput {
        name: if name.is_empty() { "A chart".into() } else { name },
        craft: input.craft.clone(),
        notes: input.notes.trim().chars().take(4000).collect(),
    })
}

fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChartPicture> {
    Ok(ChartPicture { id: r.get(0)?, name: r.get(1)?, craft: r.get(2)?, notes: r.get(3)?, width: r.get(4)?, height: r.get(5)?, added_at: r.get(6)? })
}

const COLUMNS: &str = "id, name, craft, notes, width, height, added_at";

/// Every chart, the newest first.
pub fn list(conn: &Connection) -> AppResult<Vec<ChartPicture>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM chart_pictures ORDER BY added_at DESC, rowid DESC"))?;
    let rows = stmt.query_map([], row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> AppResult<ChartPicture> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM chart_pictures WHERE id = ?1"), params![id], row)
        .optional()?
        .ok_or_else(|| AppError::NotFound("This chart no longer exists.".into()))
}

pub fn insert(conn: &Connection, id: &str, input: &ChartPictureInput) -> AppResult<ChartPicture> {
    let input = clean(input)?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO chart_pictures (id, name, craft, notes, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, input.name, input.craft, input.notes, now],
    )?;
    get(conn, id)
}

pub fn update(conn: &Connection, id: &str, input: &ChartPictureInput) -> AppResult<ChartPicture> {
    let input = clean(input)?;
    get(conn, id)?;
    conn.execute(
        "UPDATE chart_pictures SET name = ?2, craft = ?3, notes = ?4 WHERE id = ?1",
        params![id, input.name, input.craft, input.notes],
    )?;
    get(conn, id)
}

/// The stored picture's file name; empty while it has none.
pub fn file_name(conn: &Connection, id: &str) -> AppResult<String> {
    Ok(conn
        .query_row("SELECT file_name FROM chart_pictures WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .unwrap_or_default())
}

pub fn set_file(conn: &Connection, id: &str, file_name: &str, width: i64, height: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE chart_pictures SET file_name = ?2, width = ?3, height = ?4 WHERE id = ?1",
        params![id, file_name, width.max(0), height.max(0)],
    )?;
    Ok(())
}

/// Removes the chart, returning its picture's file name for the file to go too.
pub fn remove(conn: &Connection, id: &str) -> AppResult<String> {
    let name = file_name(conn, id)?;
    conn.execute("DELETE FROM chart_pictures WHERE id = ?1", params![id])?;
    Ok(name)
}

/// The picture's size, from the `x-size` header: "width x height".
fn size_from(header: &str) -> (i64, i64) {
    let mut parts = header.split('x').map(|p| p.trim().parse::<i64>().unwrap_or(0));
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

fn header<'a>(request: &'a tauri::ipc::Request<'_>, name: &str) -> &'a str {
    request.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or_default()
}

#[tauri::command]
pub fn list_chart_pictures(state: State<'_, AppState>) -> CmdResult<Vec<ChartPicture>> {
    list(&state.db())
}

/// A new chart: its picture raw, as the request's body, its name, craft and
/// notes as JSON in the `x-input` header and its size in `x-size`, as a
/// pattern's upload does.
#[tauri::command]
pub fn add_chart_picture(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<ChartPicture> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Message("The picture arrived in the wrong form.".into()));
    };
    let input: ChartPictureInput = serde_json::from_str(&crate::charts::percent_decode(header(&request, "x-input")))
        .map_err(|e| AppError::Message(format!("The chart's details arrived in the wrong form: {e}")))?;
    let (width, height) = size_from(header(&request, "x-size"));
    let id = uuid::Uuid::new_v4().to_string();
    // The picture first: one that is no picture adds no chart.
    let file = crate::covers::write_chart_picture(&state, &id, bytes)?;
    let conn = state.db();
    let added = insert(&conn, &id, &input).and_then(|_| set_file(&conn, &id, &file, width, height));
    if let Err(err) = added {
        crate::covers::delete_chart_picture_file(&state, &file);
        return Err(err);
    }
    get(&conn, &id)
}

#[tauri::command]
pub fn update_chart_picture(state: State<'_, AppState>, id: String, input: ChartPictureInput) -> CmdResult<ChartPicture> {
    update(&state.db(), &id, &input)
}

/// A chart's picture changed (cropped): raw, as the body, the chart in `x-id`
/// and its new size in `x-size`.
#[tauri::command]
pub fn replace_chart_picture(state: State<'_, AppState>, request: tauri::ipc::Request<'_>) -> CmdResult<ChartPicture> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::Message("The picture arrived in the wrong form.".into()));
    };
    let id = crate::charts::percent_decode(header(&request, "x-id"));
    let (width, height) = size_from(header(&request, "x-size"));
    let old = file_name(&state.db(), &id)?;
    get(&state.db(), &id)?;
    crate::covers::delete_chart_picture_file(&state, &old);
    let file = crate::covers::write_chart_picture(&state, &id, bytes)?;
    set_file(&state.db(), &id, &file, width, height)?;
    get(&state.db(), &id)
}

/// The picture's bytes, as a raw payload.
#[tauri::command]
pub fn get_chart_picture(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let name = file_name(&state.db(), &id)?;
    let (_mime, bytes) = crate::covers::read_chart_picture(&state, &name)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn delete_chart_picture(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let name = remove(&state.db(), &id)?;
    crate::covers::delete_chart_picture_file(&state, &name);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, craft: &str) -> ChartPictureInput {
        ChartPictureInput { name: name.into(), craft: craft.into(), notes: String::new() }
    }

    #[test]
    fn a_chart_is_for_knitting_or_crochet_and_has_a_name() {
        let conn = crate::db::open_test_db();
        let rose = insert(&conn, "c1", &input("  Spiral   rose ", "crochet")).unwrap();
        assert_eq!((rose.name.as_str(), rose.craft.as_str()), ("Spiral rose", "crochet"));
        assert_eq!(insert(&conn, "c2", &input("", "knitting")).unwrap().name, "A chart", "nameless is still something to call it");
        assert!(insert(&conn, "c3", &input("Cables", "weaving")).is_err());
        assert!(update(&conn, "c1", &input("Rose", "")).is_err(), "a craft has to be said");
        assert_eq!(update(&conn, "c1", &input("Rose", "knitting")).unwrap().craft, "knitting");
        assert!(update(&conn, "gone", &input("Rose", "knitting")).is_err());
    }

    #[test]
    fn the_newest_comes_first_and_a_removed_one_gives_its_file() {
        let conn = crate::db::open_test_db();
        insert(&conn, "a", &input("First", "knitting")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        insert(&conn, "b", &input("Second", "crochet")).unwrap();
        set_file(&conn, "a", "a.png", 800, 600).unwrap();
        let all = list(&conn).unwrap();
        assert_eq!(all.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), vec!["Second", "First"]);
        assert_eq!((all[1].width, all[1].height), (800, 600));
        assert_eq!(remove(&conn, "a").unwrap(), "a.png");
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(size_from("1200x900"), (1200, 900));
        assert_eq!(size_from("nonsense"), (0, 0));
    }
}
