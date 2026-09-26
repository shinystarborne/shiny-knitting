mod ai;
mod annotations;
mod commands;
mod covers;
mod db;
mod export;
mod models;
mod state;
mod yarn;

use std::path::PathBuf;

use tauri::Manager;

pub use state::AppState;

/// Builds the Tauri app. The library location and database are set up here,
/// before any window is shown, so the frontend can query immediately.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Everything lives under the OS app-data dir, which on Windows is
            // %APPDATA%\com.shiny.knittingapp.
            let base = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));

            let library_dir = base.join("library");
            std::fs::create_dir_all(&library_dir)?;

            let conn = db::open(&base.join("library.db"))?;
            app.manage(AppState {
                conn: std::sync::Mutex::new(conn),
                library_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::add_pattern,
            commands::list_patterns,
            commands::get_pattern,
            commands::update_pattern,
            commands::delete_pattern,
            commands::get_facets,
            commands::save_position,
            commands::read_file,
            commands::list_counters,
            commands::add_counter,
            commands::update_counter,
            commands::set_counter_enabled,
            commands::count_rows,
            commands::count_counter,
            commands::reset_counter,
            commands::delete_counter,
            commands::get_progress,
            commands::set_total_rows,
            commands::get_highlight,
            commands::save_highlight,
            commands::set_cover,
            commands::get_cover,
            commands::remove_cover,
            commands::get_ai_settings,
            commands::save_ai_settings,
            commands::test_ai_connection,
            commands::suggest_metadata,
            commands::apply_suggestion,
            commands::undo_last_ai_change,
            commands::has_ai_history,
            commands::patterns_missing_covers,
            commands::clear_ai_history,
            annotations::list_annotations,
            annotations::add_annotation,
            annotations::delete_annotation,
            annotations::edit_annotation,
            annotations::list_bookmarks,
            annotations::add_bookmark,
            annotations::rename_bookmark,
            annotations::move_bookmark,
            annotations::delete_bookmark,
            annotations::list_pins,
            annotations::pin_count,
            annotations::add_pin,
            annotations::update_pin,
            annotations::rename_pin,
            annotations::delete_pin,
            annotations::get_pin_image,
            annotations::save_export_pdf,
            export::estimate_export_dpi,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the knitting app");
}
