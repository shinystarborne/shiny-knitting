//! File work for async commands, done on a blocking thread.
//!
//! An async command runs on the async runtime's few worker threads. A file
//! written or a folder removed right there holds one of them until the disk
//! is done, and whatever else is waiting on that thread (a download, a link
//! preview, another command) waits with it. These hand the work to the
//! blocking pool instead, which is what it is for.

use std::path::PathBuf;

fn stopped(e: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::other(format!("the file work stopped: {e}"))
}

/// Writes `bytes` to `path`, which must be in a folder that exists.
pub async fn write(path: PathBuf, bytes: Vec<u8>) -> std::io::Result<()> {
    tauri::async_runtime::spawn_blocking(move || std::fs::write(&path, bytes))
        .await
        .map_err(stopped)?
}

/// Writes `bytes` to `path`, making its folder first if it is not there.
pub async fn write_into(path: PathBuf, bytes: Vec<u8>) -> std::io::Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&path, bytes)
    })
    .await
    .map_err(stopped)?
}

/// Removes a file left over from the work, if it is there; nothing to say if not.
pub async fn remove_file(path: PathBuf) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::fs::remove_file(path)).await;
}

/// Removes a folder left over from the work, if it is there; nothing to say if not.
pub async fn remove_dir_all(path: PathBuf) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::fs::remove_dir_all(path)).await;
}
