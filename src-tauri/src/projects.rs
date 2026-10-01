//! Projects: a piece of knitting, and what it is made with.
//!
//! A project is what puts needles, hooks, cables and yarn "in use": they are
//! in use exactly while an active project has them. Finishing one releases
//! them and records the yarn left over, which goes back into the stash.

use tauri::State;

use crate::db;
use crate::models::{AppError, FinishInput, Project, ProjectInput};

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

#[tauri::command]
pub fn finish_project(state: State<'_, AppState>, id: String, input: FinishInput) -> CmdResult<Project> {
    db::finish_project(&state.db(), &id, &input)
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> CmdResult<()> {
    db::delete_project(&state.db(), &id)
}
