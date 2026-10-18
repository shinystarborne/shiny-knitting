//! A way back when a new version will not open.
//!
//! An update that crashes at start leaves nothing to click: the Settings
//! button for going back is in the window that never comes up. So each start
//! leaves a note ("starting", with the version), and the window takes it away
//! once it has opened (`app_started`). A note still there at the next start
//! means that version did not open, and before anything else is tried the app
//! asks, in a plain Windows message, whether to go back to the version before.
//! A window that opens but never finishes (blank) is asked about after a
//! while, the same way. Going back only changes the app: the library, kept in
//! the app's data folder, stays as it is.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::State;

use crate::models::AppError;
use crate::state::AppState;

const MARKER: &str = "starting";
/// How long a window may take to open before it is thought not to.
const OPENING_TIME: Duration = Duration::from_secs(45);

fn marker(base: &Path) -> PathBuf {
    base.join(MARKER)
}

fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Whether the note says this very version started and never opened.
pub fn last_start_failed(base: &Path) -> bool {
    std::fs::read_to_string(marker(base)).is_ok_and(|v| v.trim() == version())
}

/// At start: asks about going back when this version did not open last time,
/// then leaves the note for this start, and watches for a window that never
/// opens.
pub fn on_start(base: &Path) {
    let failed = last_start_failed(base);
    let _ = std::fs::create_dir_all(base);
    let _ = std::fs::write(marker(base), version());
    if failed {
        offer_going_back(&format!("Shiny Knitting {} did not open properly the last time.", version()));
    }
    let base = base.to_path_buf();
    std::thread::spawn(move || {
        std::thread::sleep(OPENING_TIME);
        if last_start_failed(&base) {
            offer_going_back(&format!("Shiny Knitting {} has not finished opening.", version()));
        }
    });
}

/// The window has opened: the note is taken away.
pub fn opened(base: &Path) {
    let _ = std::fs::remove_file(marker(base));
}

/// Asks whether to go back to the version before; if so, fetches it, starts
/// its installer, and ends this app so the installer can replace it.
fn offer_going_back(why: &str) {
    let answer = rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Warning)
        .set_title("Shiny Knitting")
        .set_description(format!(
            "{why}\n\nGo back to the version before this one? It is downloaded and installed in its place, and the app opens again.\n\nYour patterns, projects, stash and everything else are kept: only the app changes."
        ))
        .set_buttons(rfd::MessageButtons::YesNo)
        .show();
    if answer != rfd::MessageDialogResult::Yes {
        return;
    }
    match crate::update::go_back_now() {
        Ok(()) => std::process::exit(0),
        Err(e) => {
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("Shiny Knitting")
                .set_description(format!(
                    "The version before could not be installed: {e}\n\nIts installer can be downloaded by hand from https://github.com/shinystarborne/shiny-knitting/releases"
                ))
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
        }
    }
}

/// The window says it has opened.
#[tauri::command]
pub fn app_started(state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(base) = state.library_dir.parent() {
        opened(base);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_start_that_never_opened_is_known_next_time() {
        let base = std::env::temp_dir().join(format!("shiny-guard-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        assert!(!last_start_failed(&base), "a first start");
        std::fs::write(marker(&base), version()).unwrap();
        assert!(last_start_failed(&base), "this version started and never opened");
        opened(&base);
        assert!(!last_start_failed(&base), "opened, nothing is asked");
        std::fs::write(marker(&base), "0.0.1").unwrap();
        assert!(!last_start_failed(&base), "another version's start is not this one's");
        let _ = std::fs::remove_dir_all(&base);
    }
}
