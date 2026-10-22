//! Making a backup: the whole library -- the database and every file of the
//! library folder (patterns, covers, photos, pictures) -- in one zip file.
//!
//! The database goes in as a clean copy made with `VACUUM INTO`, so what is
//! in the WAL is in it and nothing half-written is. The files are stored as
//! they are: PDFs and photos are compressed already, and a library of several
//! gigabytes is copied in a minute rather than squeezed for ten. The zip is
//! written beside where it is going under a `.part` name, and only renamed when
//! it is whole, so a backup that fails leaves no broken file behind.
//!
//! Restoring reads one back in, in place of what is there: first a backup of
//! the present is made beside the one restored, then the zip is unpacked to a
//! folder beside the library and its database opened (so an older one is
//! brought up to date), and only then are the two swapped in. Until the swap
//! the library is untouched; a swap that fails puts it back as it was.

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

use crate::models::AppError;
use crate::state::AppState;

type CmdResult<T> = Result<T, AppError>;

/// How far a backup has got: files written of the files there are. While a
/// backup is restored, `restoring` says it is being read back, not made.
#[derive(Debug, Serialize, Clone, Copy, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    pub running: bool,
    pub done: u64,
    pub total: u64,
    #[serde(default)]
    pub restoring: bool,
}

/// A backup made: where, when, how many files, and how big.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct BackupDone {
    pub path: String,
    #[serde(default)]
    pub at: i64,
    pub files: u64,
    pub bytes: u64,
}

/// The last backup made, for Settings to say when; None before the first.
#[tauri::command]
pub fn last_backup(state: State<'_, AppState>) -> CmdResult<Option<BackupDone>> {
    crate::db::get_setting(&state.db(), "last_backup")
}

static PROGRESS: Mutex<BackupProgress> = Mutex::new(BackupProgress { running: false, done: 0, total: 0, restoring: false });

fn set_progress(p: BackupProgress) {
    *PROGRESS.lock().unwrap_or_else(|e| e.into_inner()) = p;
}

/// What the Settings dialog shows while a backup is being made.
#[tauri::command]
pub fn backup_progress() -> BackupProgress {
    *PROGRESS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Asks where to save the backup, and makes it there. None when the dialog
/// was cancelled.
///
/// Async, so the dialog waits on a worker thread, and the copying runs on a
/// blocking one: the app goes on working while gigabytes are written.
#[tauri::command]
pub async fn make_backup(app: tauri::AppHandle, state: State<'_, AppState>, name: String) -> CmdResult<Option<BackupDone>> {
    if backup_progress().running {
        return Err(AppError::Message("A backup is being made already.".into()));
    }
    // The name to suggest comes from the app, which knows today's date where you are.
    let name: String = name.chars().filter(|c| !r#"<>:"/\|?*"#.contains(*c) && !c.is_control()).collect();
    let name = if name.trim().is_empty() { "Shiny Knitting backup.zip".to_string() } else { name.trim().to_string() };
    let picked = app
        .dialog()
        .file()
        .set_title("Save the backup")
        .set_file_name(name)
        .add_filter("Zip file", &["zip"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let out = picked.into_path().map_err(|e| AppError::Message(format!("Cannot save there: {e}")))?;

    set_progress(BackupProgress { running: true, ..Default::default() });
    let snapshot = std::env::temp_dir().join(format!("shiny-knitting-backup-{}.db", uuid::Uuid::new_v4()));
    let result = async {
        snapshot_db(&state.db(), &snapshot)?;
        let library = state.library_dir.clone();
        let snap = snapshot.clone();
        tauri::async_runtime::spawn_blocking(move || {
            write_backup(&snap, &library, &out, env!("CARGO_PKG_VERSION"), |done, total| {
                set_progress(BackupProgress { running: true, done, total, restoring: false })
            })
        })
        .await
        .map_err(|e| AppError::Message(format!("The backup stopped: {e}")))?
    }
    .await;
    let _ = std::fs::remove_file(&snapshot);
    set_progress(BackupProgress::default());
    let done = result?;
    crate::db::set_setting(&state.db(), "last_backup", &Some(done.clone()))?;
    Ok(Some(done))
}

/// A backup read back in: the zip restored, where what was there before was
/// saved, and how many files it had.
#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDone {
    pub from: String,
    pub saved_to: String,
    pub files: u64,
}

/// Asks for a backup, and puts it in place of the library: after a backup of
/// what is there now, saved beside it as `before_name`. None when the dialog
/// was cancelled. The app is restarted afterwards (`restart_app`), so every
/// screen reads the library restored.
#[tauri::command]
pub async fn restore_backup(app: tauri::AppHandle, state: State<'_, AppState>, before_name: String) -> CmdResult<Option<RestoreDone>> {
    if backup_progress().running {
        return Err(AppError::Message("A backup is being made already.".into()));
    }
    let picked = app.dialog().file().set_title("Restore a backup").add_filter("Zip file", &["zip"]).blocking_pick_file();
    let Some(picked) = picked else { return Ok(None) };
    let from = picked.into_path().map_err(|e| AppError::Message(format!("That file cannot be read: {e}")))?;
    let files = check_backup(&from)?;
    let name: String = before_name.chars().filter(|c| !r#"<>:"/\|?*"#.contains(*c) && !c.is_control()).collect();
    let name = if name.trim().is_empty() { "Shiny Knitting before restoring.zip".to_string() } else { name.trim().to_string() };
    let before = from.with_file_name(name);
    if before == from {
        return Err(AppError::Message("Saving the current library would overwrite the backup being restored.".into()));
    }

    set_progress(BackupProgress { running: true, ..Default::default() });
    let library = state.library_dir.clone();
    let staging = library.with_file_name("restoring");
    let snapshot = std::env::temp_dir().join(format!("shiny-knitting-backup-{}.db", uuid::Uuid::new_v4()));
    let result = async {
        // What is here now, saved first.
        snapshot_db(&state.db(), &snapshot)?;
        let (snap, lib, to) = (snapshot.clone(), library.clone(), before.clone());
        let saved = tauri::async_runtime::spawn_blocking(move || {
            write_backup(&snap, &lib, &to, env!("CARGO_PKG_VERSION"), |done, total| {
                set_progress(BackupProgress { running: true, done, total, restoring: false })
            })
        })
        .await
        .map_err(|e| AppError::Message(format!("Saving the current library stopped: {e}")))?
        .map_err(|e| AppError::Message(format!("The current library could not be saved first, so nothing was restored: {e}")))?;
        // The backup, unpacked beside the library and its database opened.
        let (zip, stage) = (from.clone(), staging.clone());
        tauri::async_runtime::spawn_blocking(move || {
            unpack_backup(&zip, &stage, |done, total| set_progress(BackupProgress { running: true, done, total, restoring: true }))
        })
        .await
        .map_err(|e| AppError::Message(format!("Reading the backup stopped: {e}")))??;
        swap_in(&state.conn, &library, &staging)?;
        Ok::<_, AppError>(RestoreDone { from: from.to_string_lossy().into_owned(), saved_to: saved.path, files })
    }
    .await;
    let _ = std::fs::remove_file(&snapshot);
    let _ = std::fs::remove_dir_all(&staging);
    set_progress(BackupProgress::default());
    result.map(Some)
}

/// Starts the app again: after a restore, so every screen reads it afresh.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Whether a zip is a Shiny Knitting backup, with a database in it; how many
/// files it holds when it is.
pub fn check_backup(path: &Path) -> Result<u64, AppError> {
    let not = |why: &str| AppError::Message(format!("Not a Shiny Knitting backup: {why}."));
    let mut zip = zip::ZipArchive::new(File::open(path)?).map_err(|_| not("it is not a zip file"))?;
    let manifest: serde_json::Value = {
        let mut text = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("backup.json").map_err(|_| not("it does not say what it is"))?, &mut text)?;
        serde_json::from_str(&text).map_err(|_| not("what it says of itself cannot be read"))?
    };
    if manifest.get("app").and_then(|a| a.as_str()) != Some("Shiny Knitting") {
        return Err(not("it is another app's"));
    }
    if zip.by_name("library.db").is_err() {
        return Err(not("it has no library in it"));
    }
    Ok(zip.len() as u64 - 1)
}

/// Unpacks a backup into `to`: `library.db`, and the files under `library/`.
/// Its database is opened there, so one from an older version is brought up
/// to date and one that will not open stops the restore before anything is
/// touched. `progress` hears entries read of entries there are.
pub fn unpack_backup(from: &Path, to: &Path, progress: impl Fn(u64, u64)) -> Result<(), AppError> {
    let _ = std::fs::remove_dir_all(to);
    std::fs::create_dir_all(to.join("library"))?;
    let mut zip = zip::ZipArchive::new(File::open(from)?).map_err(zip_err)?;
    let total = zip.len() as u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(zip_err)?;
        // Only where a backup puts things, and never outside them.
        let Some(name) = entry.enclosed_name() else { continue };
        let target = if name == Path::new("library.db") {
            to.join("library.db")
        } else if name.starts_with("library") && entry.is_file() {
            to.join(&name)
        } else {
            continue;
        };
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::io::copy(&mut entry, &mut BufWriter::new(File::create(&target)?))?;
        progress(i as u64 + 1, total);
    }
    let db = to.join("library.db");
    if !db.exists() {
        return Err(AppError::Message("This backup contains no library.".into()));
    }
    let conn = crate::db::open(&db).map_err(|e| AppError::Message(format!("The library in that backup cannot be opened: {e}")))?;
    drop(conn);
    Ok(())
}

/// Puts an unpacked backup in place of the library: the database closed, the
/// library folder and database moved aside, the backup's moved in, and the
/// database opened again. Anything that fails puts back what was there.
pub fn swap_in(conn: &Mutex<Connection>, library: &Path, staging: &Path) -> Result<(), AppError> {
    let db_path = library.with_file_name("library.db");
    let aside = library.with_file_name(format!("before-restore-{}", uuid::Uuid::new_v4()));
    let mut guard = conn.lock().unwrap_or_else(|e| e.into_inner());
    // Closed, so its files can be moved (and its WAL folded in).
    drop(std::mem::replace(&mut *guard, Connection::open_in_memory()?));
    let moved = (|| -> Result<(), AppError> {
        std::fs::create_dir_all(&aside)?;
        std::fs::rename(&db_path, aside.join("library.db"))?;
        for side in ["library.db-wal", "library.db-shm"] {
            let p = library.with_file_name(side);
            if p.exists() {
                std::fs::rename(&p, aside.join(side))?;
            }
        }
        if library.exists() {
            std::fs::rename(library, aside.join("library"))?;
        }
        std::fs::rename(staging.join("library"), library)?;
        std::fs::rename(staging.join("library.db"), &db_path)?;
        Ok(())
    })();
    if let Err(e) = moved {
        // As it was: the backup's taken back out, and the library's put back.
        if aside.join("library").exists() {
            if library.exists() {
                let _ = std::fs::rename(library, staging.join("library"));
            }
            let _ = std::fs::rename(aside.join("library"), library);
        }
        if aside.join("library.db").exists() {
            if db_path.exists() {
                let _ = std::fs::rename(&db_path, staging.join("library.db"));
            }
            let _ = std::fs::rename(aside.join("library.db"), &db_path);
        }
        for side in ["library.db-wal", "library.db-shm"] {
            let _ = std::fs::rename(aside.join(side), library.with_file_name(side));
        }
        *guard = crate::db::open(&db_path)?;
        let _ = std::fs::remove_dir_all(&aside);
        return Err(AppError::Message(format!("The backup could not be restored; the library is unchanged: {e}")));
    }
    *guard = crate::db::open(&db_path)?;
    drop(guard);
    let _ = std::fs::remove_dir_all(&aside);
    Ok(())
}

/// A clean copy of the database: everything committed, the WAL folded in.
pub fn snapshot_db(conn: &Connection, to: &Path) -> Result<(), AppError> {
    let _ = std::fs::remove_file(to);
    conn.execute("VACUUM INTO ?1", [to.to_string_lossy()])?;
    Ok(())
}

/// Every file under the library folder, by its path inside it, in order.
fn library_files(root: &Path) -> Result<Vec<(String, PathBuf)>, AppError> {
    let mut out = Vec::new();
    let mut dirs = vec![root.to_path_buf()];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            let kind = entry.file_type()?;
            if kind.is_dir() {
                dirs.push(path);
            } else if kind.is_file() {
                let rel = path.strip_prefix(root).unwrap_or(&path);
                let name = rel.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/");
                out.push((name, path));
            }
        }
    }
    out.sort();
    Ok(out)
}

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::Message(format!("The backup could not be written: {e}"))
}

/// Writes the zip: `library.db`, every file as `library/…`, and `backup.json`
/// saying what it is. `progress` hears files written of files there are.
pub fn write_backup(db: &Path, library: &Path, out: &Path, version: &str, progress: impl Fn(u64, u64)) -> Result<BackupDone, AppError> {
    let files = library_files(library)?;
    let total = files.len() as u64 + 1;
    progress(0, total);
    let part = out.with_extension("zip.part");
    let written = (|| -> Result<u64, AppError> {
        let mut zip = zip::ZipWriter::new(BufWriter::new(File::create(&part)?));
        let stored = |size: u64| SimpleFileOptions::default().compression_method(CompressionMethod::Stored).large_file(size >= u32::MAX as u64);
        let packed = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut bytes = 0u64;

        zip.start_file("library.db", packed.large_file(std::fs::metadata(db)?.len() >= u32::MAX as u64)).map_err(zip_err)?;
        bytes += std::io::copy(&mut File::open(db)?, &mut zip)?;
        progress(1, total);

        for (i, (name, path)) in files.iter().enumerate() {
            let size = std::fs::metadata(path)?.len();
            zip.start_file(format!("library/{name}"), stored(size)).map_err(zip_err)?;
            bytes += std::io::copy(&mut File::open(path)?, &mut zip)?;
            progress(i as u64 + 2, total);
        }

        let manifest = serde_json::json!({
            "app": "Shiny Knitting",
            "version": version,
            "madeAt": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            "files": files.len() + 1,
        });
        zip.start_file("backup.json", packed).map_err(zip_err)?;
        zip.write_all(serde_json::to_string_pretty(&manifest).unwrap_or_default().as_bytes())?;
        let mut inner = zip.finish().map_err(zip_err)?;
        inner.flush()?;
        Ok(bytes)
    })();
    let bytes = match written {
        Ok(bytes) => bytes,
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
    };
    let _ = std::fs::remove_file(out);
    std::fs::rename(&part, out)?;
    let at = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    Ok(BackupDone { path: out.to_string_lossy().into_owned(), at, files: total, bytes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn a_backup_is_the_database_and_every_file_in_one_zip() {
        let dir = std::env::temp_dir().join(format!("shiny-backup-test-{}", uuid::Uuid::new_v4()));
        let library = dir.join("library");
        std::fs::create_dir_all(library.join("covers")).unwrap();
        std::fs::create_dir_all(library.join("originals/sub")).unwrap();
        std::fs::write(library.join("covers/a.jpg"), b"jpeg bytes").unwrap();
        std::fs::write(library.join("originals/sub/pattern.pdf"), b"%PDF-1.7 pattern").unwrap();

        let conn = crate::db::open_test_db();
        conn.execute("INSERT INTO app_settings (key, value) VALUES ('backup-test', '\"kept\"')", []).unwrap();
        let snapshot = dir.join("snapshot.db");
        snapshot_db(&conn, &snapshot).unwrap();

        let out = dir.join("backup.zip");
        let seen = std::cell::RefCell::new(Vec::new());
        let done = write_backup(&snapshot, &library, &out, "9.9.9", |d, t| seen.borrow_mut().push((d, t))).unwrap();
        assert_eq!(done.files, 3, "the database and two files");
        assert!(!dir.join("backup.zip.part").exists(), "whole, it is renamed");
        assert_eq!(seen.borrow().last(), Some(&(3, 3)));

        let mut zip = zip::ZipArchive::new(File::open(&out).unwrap()).unwrap();
        let mut names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        names.sort();
        assert_eq!(names, vec!["backup.json", "library.db", "library/covers/a.jpg", "library/originals/sub/pattern.pdf"]);
        let mut pdf = String::new();
        zip.by_name("library/originals/sub/pattern.pdf").unwrap().read_to_string(&mut pdf).unwrap();
        assert_eq!(pdf, "%PDF-1.7 pattern");
        let mut manifest = String::new();
        zip.by_name("backup.json").unwrap().read_to_string(&mut manifest).unwrap();
        assert!(manifest.contains("\"version\": \"9.9.9\""), "{manifest}");

        // The database in it opens, with what was in it.
        let restored = dir.join("restored.db");
        std::io::copy(&mut zip.by_name("library.db").unwrap(), &mut File::create(&restored).unwrap()).unwrap();
        let back = Connection::open(&restored).unwrap();
        let kept: String = back.query_row("SELECT value FROM app_settings WHERE key = 'backup-test'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "\"kept\"");
        drop(back);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A real library, read only: SHINY_BACKUP_DB (a copy of library.db),
    /// SHINY_BACKUP_LIBRARY (the library folder) and SHINY_BACKUP_OUT (the zip).
    #[test]
    #[ignore]
    fn a_real_library_backs_up() {
        let var = |k: &str| PathBuf::from(std::env::var(k).expect(k));
        let (db, library, out) = (var("SHINY_BACKUP_DB"), var("SHINY_BACKUP_LIBRARY"), var("SHINY_BACKUP_OUT"));
        let snapshot = out.with_extension("db");
        snapshot_db(&Connection::open(&db).unwrap(), &snapshot).unwrap();
        let started = std::time::Instant::now();
        let done = write_backup(&snapshot, &library, &out, "test", |_, _| {}).unwrap();
        println!("{} files, {} bytes in {:?}", done.files, done.bytes, started.elapsed());
        let zip = zip::ZipArchive::new(File::open(&out).unwrap()).unwrap();
        assert_eq!(zip.len() as u64, done.files + 1, "every file, and backup.json");
        println!("zip is {} bytes, {} entries", std::fs::metadata(&out).unwrap().len(), zip.len());
        let _ = std::fs::remove_file(&snapshot);
    }

    #[test]
    fn a_backup_restored_takes_the_place_of_the_library() {
        let dir = std::env::temp_dir().join(format!("shiny-restore-test-{}", uuid::Uuid::new_v4()));
        let library = dir.join("library");
        std::fs::create_dir_all(library.join("covers")).unwrap();
        std::fs::write(library.join("covers/a.jpg"), b"the cover then").unwrap();
        let conn = Mutex::new(crate::db::open(&dir.join("library.db")).unwrap());
        conn.lock().unwrap().execute("INSERT INTO app_settings (key, value) VALUES ('restore-test', '\"then\"')", []).unwrap();

        // A backup of it as it was.
        let snapshot = dir.join("snapshot.db");
        snapshot_db(&conn.lock().unwrap(), &snapshot).unwrap();
        let zip = dir.join("backup.zip");
        write_backup(&snapshot, &library, &zip, "9.9.9", |_, _| {}).unwrap();
        assert_eq!(check_backup(&zip).unwrap(), 2, "the database and the cover");

        // Then changed: the setting, the cover, and a file more.
        conn.lock().unwrap().execute("UPDATE app_settings SET value = '\"now\"' WHERE key = 'restore-test'", []).unwrap();
        std::fs::write(library.join("covers/a.jpg"), b"the cover now").unwrap();
        std::fs::write(library.join("covers/b.jpg"), b"added since").unwrap();

        let staging = dir.join("restoring");
        let seen = std::cell::RefCell::new(0u64);
        unpack_backup(&zip, &staging, |d, _| *seen.borrow_mut() = d).unwrap();
        assert!(*seen.borrow() >= 2);
        swap_in(&conn, &library, &staging).unwrap();

        let value: String = conn.lock().unwrap().query_row("SELECT value FROM app_settings WHERE key = 'restore-test'", [], |r| r.get(0)).unwrap();
        assert_eq!(value, "\"then\"", "the database is the backup's, and open");
        assert_eq!(std::fs::read(library.join("covers/a.jpg")).unwrap(), b"the cover then");
        assert!(!library.join("covers/b.jpg").exists(), "what was added since is gone with the rest");
        assert!(!staging.join("library").exists());
        let left: Vec<_> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with("before-restore")).collect();
        assert!(left.is_empty(), "nothing set aside is left: {left:?}");
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_zip_that_is_no_backup_is_refused_and_a_failed_swap_puts_the_library_back() {
        let dir = std::env::temp_dir().join(format!("shiny-restore-refuse-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("library")).unwrap();
        // Some other zip.
        let other = dir.join("other.zip");
        let mut zip = zip::ZipWriter::new(File::create(&other).unwrap());
        zip.start_file("readme.txt", SimpleFileOptions::default()).unwrap();
        zip.write_all(b"hello").unwrap();
        zip.finish().unwrap();
        let err = check_backup(&other).unwrap_err().to_string();
        assert!(err.contains("Not a Shiny Knitting backup"), "{err}");
        std::fs::write(dir.join("text.zip"), b"not a zip").unwrap();
        assert!(check_backup(&dir.join("text.zip")).is_err());

        // An unpacked backup with no database: the swap fails, and puts back.
        std::fs::write(dir.join("library/keep.pdf"), b"%PDF").unwrap();
        let conn = Mutex::new(crate::db::open(&dir.join("library.db")).unwrap());
        conn.lock().unwrap().execute("INSERT INTO app_settings (key, value) VALUES ('kept', '1')", []).unwrap();
        let staging = dir.join("restoring");
        std::fs::create_dir_all(staging.join("library")).unwrap();
        assert!(swap_in(&conn, &dir.join("library"), &staging).is_err());
        assert!(dir.join("library/keep.pdf").exists(), "the library is as it was");
        let kept: String = conn.lock().unwrap().query_row("SELECT value FROM app_settings WHERE key = 'kept'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "1", "and its database open again");
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_backup_that_fails_leaves_nothing_behind() {
        let dir = std::env::temp_dir().join(format!("shiny-backup-fail-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("backup.zip");
        // No database to put in it.
        assert!(write_backup(&dir.join("missing.db"), &dir.join("library"), &out, "1", |_, _| {}).is_err());
        assert!(!out.exists() && !dir.join("backup.zip.part").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
