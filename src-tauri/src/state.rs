use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

/// Shared app state: the library folder and the open database.
///
/// The connection sits behind a `Mutex` because Tauri requires managed state to
/// be `Send + Sync`, and `rusqlite::Connection` is `Send` but not `Sync`. SQLite
/// serialises writes internally, and every command here is short, so a plain
/// mutex is the right amount of machinery.
pub struct AppState {
    pub conn: Mutex<Connection>,
    pub library_dir: PathBuf,
}

impl AppState {
    /// Locks the database. A poisoned lock means a previous command panicked
    /// mid-transaction; recovering the guard is better than cascading the
    /// panic into every later call.
    pub fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }
}
