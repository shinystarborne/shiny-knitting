//! Opening things outside the app: a web link from inside a pattern, and a
//! pattern's own file in whatever program Windows uses for it.
//!
//! Both are deliberately narrow. A link must be http, https or mailto, so a
//! pattern cannot use a link to start a program; and a pattern's file is
//! looked up by id and must sit inside the library, so the frontend can never
//! ask for an arbitrary path to be opened.

use std::path::PathBuf;

use tauri::State;

use crate::db;
use crate::models::{AppError, AppResult};
use crate::AppState;

/// Whether a link from a pattern may be opened: http, https or mailto only.
fn is_openable_link(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    (lower.starts_with("https://") || lower.starts_with("http://") || lower.starts_with("mailto:"))
        // A control character has no business in a link and could only be
        // there to confuse whatever reads it next.
        && !url.chars().any(char::is_control)
}

/// Hands a link or a file to Windows to open with its default program.
#[cfg(windows)]
fn shell_open(target: &str) -> AppResult<()> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let target = HSTRING::from(target);
    let verb = HSTRING::from("open");
    // SAFETY: every pointer is to a string that outlives the call.
    let result = unsafe {
        ShellExecuteW(None, &verb, &target, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
    };
    // ShellExecute reports success as a value above 32.
    if result.0 as isize <= 32 {
        return Err(AppError::Message("Windows could not open that.".into()));
    }
    Ok(())
}

#[cfg(not(windows))]
fn shell_open(_target: &str) -> AppResult<()> {
    Err(AppError::Message("Opening outside the app is only supported on Windows.".into()))
}

/// Opens a link from inside a pattern in the default browser (or mail app).
#[tauri::command]
pub fn open_link(url: String) -> AppResult<()> {
    if !is_openable_link(&url) {
        return Err(AppError::Message("Only web and email links can be opened.".into()));
    }
    shell_open(url.trim())
}

/// Opens a pattern's file in the program Windows uses for that kind of file.
#[tauri::command]
pub fn open_pattern_file(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let pattern = db::get_pattern(&state.db(), &id)?;
    let path = PathBuf::from(&pattern.file_path);
    if !path.starts_with(&state.library_dir) {
        return Err(AppError::Message("That file is outside the library.".into()));
    }
    if !path.is_file() {
        return Err(AppError::Message("This pattern's file is missing from the library.".into()));
    }
    shell_open(&path.to_string_lossy())
}

#[cfg(test)]
mod tests {
    use super::is_openable_link;

    #[test]
    fn only_web_and_mail_links_open() {
        assert!(is_openable_link("https://example.com/pattern"));
        assert!(is_openable_link("HTTP://example.com"));
        assert!(is_openable_link("mailto:designer@example.com"));
        assert!(is_openable_link("  https://example.com  "));

        assert!(!is_openable_link("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_openable_link("C:\\Windows\\System32\\calc.exe"));
        assert!(!is_openable_link("javascript:alert(1)"));
        assert!(!is_openable_link("ms-settings:"));
        assert!(!is_openable_link(""));
        assert!(!is_openable_link("https://example.com/\nwith a newline"));
    }
}
