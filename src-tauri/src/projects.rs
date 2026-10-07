//! Projects: a piece of knitting, and what it is made with.
//!
//! A project is what puts needles, hooks, cables and yarn "in use": they are
//! in use exactly while an active project has them. Finishing one releases
//! them and records the yarn left over, which goes back into the stash.

use tauri::State;

use crate::db;
use crate::models::{AppError, BoardItem, BoardItemInput, BoardItemPatch, FinishInput, InspirationBoard, LogEntry, Project, ProjectInput};

use super::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// A blank pattern is no pattern, so a project made without one is not
/// refused for naming a pattern that does not exist.
fn tidy(mut input: ProjectInput) -> ProjectInput {
    input.pattern_id = input
        .pattern_id
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    input.tool_ids.retain(|t| !t.trim().is_empty());
    input.tool_ids.dedup();
    input
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> CmdResult<Vec<Project>> {
    db::list_projects(&state.db())
}

#[tauri::command]
pub fn add_project(state: State<'_, AppState>, input: ProjectInput) -> CmdResult<Project> {
    let id = uuid::Uuid::new_v4().to_string();
    db::insert_project(&state.db(), &id, &tidy(input))
}

#[tauri::command]
pub fn update_project(state: State<'_, AppState>, id: String, input: ProjectInput) -> CmdResult<Project> {
    db::update_project(&state.db(), &id, &tidy(input))
}

/// Every photo in a finished project's log, for the gallery.
#[tauri::command]
pub fn list_gallery_photos(state: State<'_, AppState>) -> CmdResult<Vec<crate::models::GalleryPhoto>> {
    db::list_gallery_photos(&state.db())
}

/// A finished project hidden from the gallery or shown, and the photos it leaves out.
#[tauri::command]
pub fn set_project_gallery(state: State<'_, AppState>, id: String, hidden: bool, skip: Vec<String>) -> CmdResult<Project> {
    db::set_project_gallery(&state.db(), &id, hidden, &skip)
}

/// The plans in the order given, as dragged.
#[tauri::command]
pub fn set_plan_order(state: State<'_, AppState>, ids: Vec<String>) -> CmdResult<()> {
    db::set_plan_order(&state.db(), &ids)
}

/// Active, paused or frogged, or a plan started; finishing is `finish_project`.
#[tauri::command]
pub fn set_project_status(state: State<'_, AppState>, id: String, status: String) -> CmdResult<Project> {
    db::set_project_status(&state.db(), &id, &status)
}

#[tauri::command]
pub fn finish_project(state: State<'_, AppState>, id: String, input: FinishInput) -> CmdResult<Project> {
    db::finish_project(&state.db(), &id, &input)
}

/// Removes a project, and its cover and board pictures with it.
#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let (cover, images) = db::project_files(&state.db(), &id)?;
    let log_photos = db::log_photos(&state.db(), &id)?;
    db::delete_project(&state.db(), &id)?;
    crate::covers::delete_project_cover_file(&state, &cover);
    for image in images {
        crate::covers::delete_board_image_file(&state, &image);
    }
    for photo in log_photos {
        crate::covers::delete_log_photo_file(&state, &photo);
    }
    Ok(())
}

// ---------- the log ----------
//
// A diary of the knitting: what was typed, dated as it was written, and the
// milestones the project's own changes write (see `db::log_milestone`).

/// The longest an entry may be: a long evening's notes, not a pasted pattern.
const MAX_LOG_TEXT: usize = 10_000;

fn log_text(text: &str) -> String {
    text.trim().chars().take(MAX_LOG_TEXT).collect()
}

#[tauri::command]
pub fn list_project_log(state: State<'_, AppState>, project_id: String) -> CmdResult<Vec<LogEntry>> {
    db::list_project_log(&state.db(), &project_id)
}

/// Adds an entry, dated now. Empty words are allowed: a photo may follow.
#[tauri::command]
pub fn add_log_entry(state: State<'_, AppState>, project_id: String, text: String) -> CmdResult<LogEntry> {
    db::insert_log_entry(&state.db(), &uuid::Uuid::new_v4().to_string(), &project_id, &log_text(&text), None)
}

/// Changes an entry's words, and when it happened.
#[tauri::command]
pub fn update_log_entry(state: State<'_, AppState>, id: String, text: String, at: i64) -> CmdResult<LogEntry> {
    if at <= 0 {
        return Err(AppError::Message("Give the day it happened.".into()));
    }
    db::update_log_entry(&state.db(), &id, &log_text(&text), at)
}

#[tauri::command]
pub fn delete_log_entry(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let photo = db::delete_log_entry(&state.db(), &id)?;
    crate::covers::delete_log_photo_file(&state, &photo);
    Ok(())
}

#[tauri::command]
pub fn set_log_photo(state: State<'_, AppState>, id: String, bytes: Vec<u8>) -> CmdResult<()> {
    crate::covers::set_log_photo(&state, &id, bytes)
}

/// The photo's bytes, as a raw payload, like a cover.
#[tauri::command]
pub fn get_log_photo(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let (_mime, bytes) = crate::covers::read_log_photo(&state, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn remove_log_photo(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    crate::covers::remove_log_photo(&state, &id)
}

// ---------- the cover ----------

#[tauri::command]
pub fn set_project_cover(state: State<'_, AppState>, project_id: String, bytes: Vec<u8>) -> CmdResult<()> {
    crate::covers::set_project_cover(&state, &project_id, bytes)
}

/// The cover's bytes, as a raw payload, like a pattern's cover.
#[tauri::command]
pub fn get_project_cover(state: State<'_, AppState>, project_id: String) -> CmdResult<tauri::ipc::Response> {
    let (_mime, bytes) = crate::covers::read_project_cover(&state, &project_id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn remove_project_cover(state: State<'_, AppState>, project_id: String) -> CmdResult<()> {
    crate::covers::remove_project_cover(&state, &project_id)
}

// ---------- boards ----------
//
// A board belongs to a project, by the project's id, or is an inspiration
// board of its own; the items work the same either way.

#[tauri::command]
pub fn list_board_items(state: State<'_, AppState>, board_id: String) -> CmdResult<Vec<BoardItem>> {
    db::list_board_items(&state.db(), &board_id)
}

#[tauri::command]
pub fn add_board_item(state: State<'_, AppState>, board_id: String, input: BoardItemInput) -> CmdResult<BoardItem> {
    let id = uuid::Uuid::new_v4().to_string();
    db::insert_board_item(&state.db(), &id, &board_id, &input)
}

#[tauri::command]
pub fn update_board_item(state: State<'_, AppState>, id: String, patch: BoardItemPatch) -> CmdResult<BoardItem> {
    db::update_board_item(&state.db(), &id, &patch)
}

#[tauri::command]
pub fn delete_board_item(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let image = db::delete_board_item(&state.db(), &id)?;
    crate::covers::delete_board_image_file(&state, &image);
    Ok(())
}

/// Stores a picture for an image item.
#[tauri::command]
pub fn set_board_image(state: State<'_, AppState>, id: String, bytes: Vec<u8>) -> CmdResult<BoardItem> {
    crate::covers::set_board_image(&state, &id, bytes)?;
    db::get_board_item(&state.db(), &id)
}

#[tauri::command]
pub fn get_board_image(state: State<'_, AppState>, id: String) -> CmdResult<tauri::ipc::Response> {
    let (_mime, bytes) = crate::covers::read_board_image(&state, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---------- inspiration boards ----------

#[tauri::command]
pub fn list_inspiration_boards(state: State<'_, AppState>) -> CmdResult<Vec<InspirationBoard>> {
    db::list_inspiration_boards(&state.db())
}

#[tauri::command]
pub fn get_inspiration_board(state: State<'_, AppState>, id: String) -> CmdResult<InspirationBoard> {
    db::get_inspiration_board(&state.db(), &id)
}

#[tauri::command]
pub fn add_inspiration_board(state: State<'_, AppState>, name: String) -> CmdResult<InspirationBoard> {
    let id = uuid::Uuid::new_v4().to_string();
    db::insert_inspiration_board(&state.db(), &id, &name)
}

#[tauri::command]
pub fn rename_inspiration_board(state: State<'_, AppState>, id: String, name: String) -> CmdResult<InspirationBoard> {
    db::rename_inspiration_board(&state.db(), &id, &name)
}

/// Removes a board, with its pictures.
#[tauri::command]
pub fn delete_inspiration_board(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    let images = db::delete_inspiration_board(&state.db(), &id)?;
    for image in images {
        crate::covers::delete_board_image_file(&state, &image);
    }
    Ok(())
}
